/**
 * email-scanner — 邮箱扫描云函数
 *
 * 职责：
 *   1. 读取所有启用的 EmailConfig
 *   2. 逐邮箱连接 IMAP，拉取招聘平台新邮件
 *   3. 下载附件，计算哈希，去重检查
 *   4. 调用 format-router 提取文本
 *   5. 上传文件到云存储，写入 ParseQueue
 *   6. 更新邮箱扫描状态
 *
 * 触发方式：
 *   - 定时触发器：每 10 分钟 (`*/10 * * * *`)
 *   - 手动触发：CloudBase 控制台 → 云函数 → 测试（传 { action: "scan" }）
 *   - 测试连接：传 { action: "test", config: {...} }
 */

const cloudbase = require('@cloudbase/node-sdk');
const { fetchNewResumes, testConnection } = require('./imap-client');
const { computeMD5, checkDuplicate } = require('./deduplicator');
const { route: extractText } = require('./format-router');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const storage = app.storage();

// 配置
const MAX_EMAILS_PER_SCAN = 50;      // 每次扫描最多处理的邮件数
const SCAN_INTERVAL_MS = 5000;       // 多邮箱之间的间隔（防限流）
const TIMEOUT_BUFFER_MS = 60000;     // 超时缓冲（剩余 60 秒时停止）
const FUNCTION_TIMEOUT_MS = 300000;  // 云函数总超时 300 秒

/**
 * 云函数入口
 */
exports.main = async (event, context) => {
  const action = event.action || 'scan';

  switch (action) {
    case 'test':
      return handleTestConnection(event.config);
    case 'scan':
    default:
      return handleScan(context);
  }
};

/**
 * 处理"测试连接"请求
 */
async function handleTestConnection(config) {
  if (!config || !config.imapHost || !config.imapPassword) {
    return { success: false, message: '请提供完整的邮箱配置（IMAP 服务器、账号、授权码）' };
  }

  console.log(`[email-scanner] 测试连接：${config.email}`);
  return testConnection(config);
}

/**
 * 处理扫描：遍历所有启用的邮箱配置，拉取新简历
 */
async function handleScan(context) {
  const startTime = Date.now();
  const summary = {
    configsScanned: 0,
    configsFailed: 0,
    emailsFound: 0,
    attachmentsDownloaded: 0,
    parseQueueCreated: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  try {
    // 1. 查询所有启用的邮箱配置
    const now = new Date();
    const configsResult = await db
      .collection('EmailConfig')
      .where({
        enabled: true,
      })
      .get();

    const configs = configsResult.data || [];
    console.log(`[email-scanner] 发现 ${configs.length} 个启用的邮箱配置`);

    if (configs.length === 0) {
      return { success: true, message: '没有启用的邮箱配置', summary };
    }

    // 2. 过滤：仅扫描 nextScanAt 已到期的配置
    const dueConfigs = configs.filter((c) => {
      if (!c.nextRetryAt) return true;
      return new Date(c.nextRetryAt) <= now;
    });

    console.log(`[email-scanner] 其中 ${dueConfigs.length} 个配置达到扫描时间`);

    // 3. 逐邮箱处理
    for (const config of dueConfigs) {
      // 超时保护
      if (Date.now() - startTime > FUNCTION_TIMEOUT_MS - TIMEOUT_BUFFER_MS) {
        console.log('[email-scanner] 剩余时间不足，停止扫描，剩余邮箱下轮继续');
        summary.errors.push('超时保护触发，部分邮箱未扫描');
        break;
      }

      try {
        const result = await scanOneMailbox(db, storage, config, startTime);
        summary.configsScanned++;
        summary.emailsFound += result.emailsFound;
        summary.attachmentsDownloaded += result.attachmentsProcessed;
        summary.parseQueueCreated += result.enqueued;
        summary.duplicatesSkipped += result.duplicates;
      } catch (err) {
        summary.configsFailed++;
        summary.errors.push(`${config.email}: ${err.message}`);
        console.error(`[email-scanner] ${config.email} 扫描失败:`, err.message);

        // 更新失败状态（触发指数退避）
        await updateScanFailure(db, config, err.message);
      }

      // 多邮箱间隔（防止 QQ 邮箱限流）
      if (dueConfigs.indexOf(config) < dueConfigs.length - 1) {
        await sleep(SCAN_INTERVAL_MS + Math.floor(Math.random() * 5000));
      }
    }

    console.log('[email-scanner] 扫描完成:', JSON.stringify(summary));
    return { success: true, summary };
  } catch (err) {
    console.error('[email-scanner] 全局异常:', err.message);
    return { success: false, error: err.message, summary };
  }
}

/**
 * 扫描单个邮箱
 */
async function scanOneMailbox(db, storage, config, scanStartTime) {
  const result = {
    emailsFound: 0,
    attachmentsProcessed: 0,
    enqueued: 0,
    duplicates: 0,
  };

  // 更新扫描开始状态
  await db.collection('EmailConfig').doc(config._id).update({
    lastScanAt: new Date(),
  });

  // 拉取新简历邮件
  const emails = await fetchNewResumes(config);
  result.emailsFound = emails.length;

  if (emails.length === 0) {
    // 扫描成功但无新邮件，重置失败计数
    await db.collection('EmailConfig').doc(config._id).update({
      lastSuccessfulScanAt: new Date(),
      failureCount: 0,
      nextRetryAt: null,
      lastError: null,
    });
    return result;
  }

  // 限制每次扫描的邮件数量
  const toProcess = emails.slice(0, MAX_EMAILS_PER_SCAN);

  for (const email of toProcess) {
    // 超时保护（在处理每封邮件前检查）
    if (Date.now() - scanStartTime > FUNCTION_TIMEOUT_MS - TIMEOUT_BUFFER_MS) {
      console.log('[email-scanner] 邮件处理超时，剩余邮件下轮继续');
      break;
    }

    for (const attachment of email.attachments) {
      try {
        result.attachmentsProcessed++;

        // 下载附件内容（从 IMAP 获取的实际文件数据）
        // 注意：imapflow 的 fetch 需要单独下载附件内容
        // 这里 attachment 对象只包含元数据，实际下载在 imap-client 中完成
        // 我们需要处理已经从 imap-client 返回的 attachment buffer

        // 实际上附件内容需要重新从 IMAP 下载，但这在 imap-client.fetchNewResumes 中处理
        // 这里做二次确认 —— 如果附件没有 buffer，跳过
        if (!attachment.buffer || attachment.buffer.length === 0) {
          console.warn(`[email-scanner] 附件 "${attachment.filename}" 无内容，跳过`);
          continue;
        }

        // 计算文件哈希
        const md5Hash = computeMD5(attachment.buffer);

        // 去重检查
        const dupCheck = await checkDuplicate(db, email.messageId, md5Hash);
        if (dupCheck.isDuplicate) {
          console.log(`[email-scanner] 跳过重复：${dupCheck.reason}`);
          result.duplicates++;
          continue;
        }

        // 尝试提取文本（提取失败不阻塞流程——parse-queue-processor 会再次尝试）
        let extractedText = '';
        let extractedFormat = '';
        try {
          const extractResult = await extractText(
            attachment.buffer,
            attachment.filename,
            attachment.contentType
          );
          extractedText = extractResult.text;
          extractedFormat = extractResult.format;
        } catch (extractErr) {
          console.warn(`[email-scanner] 文本预提取失败（将在 processor 重试）:`, extractErr.message);
        }

        // 上传文件到云存储
        const dateStr = new Date().toISOString().slice(0, 10);
        const cloudPath = `email-attachments/${dateStr}/${config.userId}/${Date.now()}_${attachment.filename}`;

        let fileId = '';
        try {
          const uploadResult = await storage.uploadFile({
            cloudPath,
            fileContent: attachment.buffer,
          });
          fileId = uploadResult.fileID || '';
        } catch (uploadErr) {
          console.error(`[email-scanner] 文件上传失败:`, uploadErr.message);
          // 上传失败仍然写入 ParseQueue（后续可手动重新上传）
        }

        // 写入 ParseQueue
        await db.collection('ParseQueue').add({
          fileId,
          fileName: attachment.filename,
          fileHash: md5Hash,
          fileSize: attachment.buffer.length,
          mimeType: attachment.contentType || 'application/octet-stream',
          extractedFormat: extractedFormat || 'unknown',
          preExtractedText: extractedText || '',
          source: 'email',
          sourceEmailId: email.messageId,
          sourceEmailFrom: email.from,
          sourceEmailSubject: email.subject,
          sourceEmailDate: email.date,
          status: 'pending',
          retryCount: 0,
          userId: config.userId,
          emailConfigId: config._id,
          createdAt: new Date(),
        });

        result.enqueued++;
      } catch (err) {
        console.error(`[email-scanner] 处理附件 "${attachment.filename}" 失败:`, err.message);
      }
    }
  }

  // 更新邮箱扫描成功状态
  await db.collection('EmailConfig').doc(config._id).update({
    lastSuccessfulScanAt: new Date(),
    failureCount: 0,
    nextRetryAt: null,
    lastError: null,
  });

  return result;
}

/**
 * 更新扫描失败状态（指数退避）
 */
async function updateScanFailure(db, config, errorMsg) {
  const failureCount = (config.failureCount || 0) + 1;

  // 指数退避时间表（分钟）
  const backoffMinutes = [10, 30, 60, 240, 240]; // 10min → 30min → 1h → 4h → 4h...
  const backoffIndex = Math.min(failureCount - 1, backoffMinutes.length - 1);
  const backoffMs = backoffMinutes[backoffIndex] * 60 * 1000;

  const nextRetryAt = new Date(Date.now() + backoffMs);

  await db.collection('EmailConfig').doc(config._id).update({
    failureCount,
    nextRetryAt,
    lastError: errorMsg,
  });

  // 如果连续失败 ≥ 3 次，写入 ErrorLog 告警
  if (failureCount >= 3) {
    try {
      await db.collection('ErrorLog').add({
        type: 'email_scan_failure',
        level: failureCount >= 5 ? 'critical' : 'warning',
        message: `邮箱 ${config.email} 连续 ${failureCount} 次扫描失败`,
        detail: {
          email: config.email,
          failureCount,
          lastError: errorMsg,
        },
        createdAt: new Date(),
      });
    } catch {
      // 告警写入失败不阻塞主流程
    }
  }
}

/**
 * 延时工具函数
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
