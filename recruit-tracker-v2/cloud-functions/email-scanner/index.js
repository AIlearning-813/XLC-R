/**
 * email-scanner — 邮箱自动扫描云函数
 *
 * 定时/手动触发，扫描启用的邮箱配置，拉取招聘平台邮件附件，
 * 提取文本后写入 ParseQueue，由 parse-queue-processor 消费。
 *
 * 动作：
 *   - scan：扫描所有启用的邮箱
 *   - test：测试单个邮箱的 IMAP 连接
 *
 * 超时保护：剩余 < 60s 时停止处理下一个邮箱
 */

const cloudbase = require('@cloudbase/node-sdk');

// ===== 模块加载（逐个 try-catch，防止启动崩溃）=====

const modules = {};
const loadErrors = {};

// crypto（内置 crypto，已验证 OK）
try {
  modules.crypto = require('./crypto');
  console.log('[email-scanner] ✅ crypto 加载成功');
} catch (e) {
  loadErrors.crypto = e.message;
  console.error('[email-scanner] ❌ crypto 加载失败:', e.message);
}

// deduplicator（依赖 crypto + db）
try {
  modules.deduplicator = require('./deduplicator');
  console.log('[email-scanner] ✅ deduplicator 加载成功');
} catch (e) {
  loadErrors.deduplicator = e.message;
  console.error('[email-scanner] ❌ deduplicator 加载失败:', e.message);
}

// format-router（依赖 pdfjs-dist, mammoth, adm-zip, rtf-parser）
try {
  modules.formatRouter = require('./format-router');
  console.log('[email-scanner] ✅ format-router 加载成功');
} catch (e) {
  loadErrors.formatRouter = e.message;
  console.error('[email-scanner] ❌ format-router 加载失败:', e.message);
}

// imap-client（依赖 imapflow + crypto）
try {
  modules.imapClient = require('./imap-client');
  console.log('[email-scanner] ✅ imap-client 加载成功');
} catch (e) {
  loadErrors.imapClient = e.message;
  console.error('[email-scanner] ❌ imap-client 加载失败:', e.message);
}

// ===== CloudBase 初始化 =====

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

// ===== 主入口 =====

exports.main = async (event, context) => {
  const startTime = Date.now();
  const action = event?.action || 'scan';

  console.log(`[email-scanner] 收到 ${action} 请求`);

  // ---- 测试连接 ----
  if (action === 'test') {
    if (!modules.imapClient) {
      return { success: false, message: `IMAP 模块未加载：${loadErrors.imapClient}` };
    }
    try {
      const result = await modules.imapClient.testConnection(event.config);
      return result;
    } catch (err) {
      return { success: false, message: `测试连接异常：${err.message}` };
    }
  }

  // ---- 更新邮箱配置 ----
  if (action === 'updateConfig') {
    return handleUpdateConfig(event);
  }

  // ---- 删除邮箱配置 ----
  if (action === 'deleteConfig') {
    return handleDeleteConfig(event);
  }

  // ---- 诊断邮箱 ----
  if (action === 'diagnose') {
    return handleDiagnose(event);
  }

  // ---- 扫描邮件 ----
  if (action === 'scan') {
    // 检查关键模块
    if (!modules.imapClient) {
      return {
        success: false,
        message: `关键模块未加载：imapClient - ${loadErrors.imapClient}`,
        loadErrors,
      };
    }

    const scanResult = {
      success: true,
      totalEmails: 0,
      newResumes: 0,
      skipped: 0,
      errors: [],
      loadErrors: Object.keys(loadErrors).length > 0 ? loadErrors : null,
    };

    try {
      // 1. 查询启用的邮箱配置
      const { data: configs } = await db
        .collection('EmailConfig')
        .where({ enabled: true })
        .get();

      if (!configs || configs.length === 0) {
        scanResult.message = '没有启用的邮箱配置';
        return scanResult;
      }

      console.log(`[email-scanner] 找到 ${configs.length} 个启用的邮箱`);

      // 2. 逐个邮箱处理
      for (const config of configs) {
        // 超时保护：剩余 < 60 秒则停止
        const elapsed = Date.now() - startTime;
        const timeoutMs = (context.timeout || 300000) - 60000;
        if (elapsed > timeoutMs) {
          scanResult.message = `超时保护：已用 ${Math.round(elapsed / 1000)}s，剩余 ${Math.round((context.timeout - elapsed) / 1000)}s，停止扫描`;
          break;
        }

        try {
          const result = await processMailbox(config, scanResult);
          scanResult.totalEmails += result.totalEmails;
          scanResult.newResumes += result.newResumes;
          scanResult.skipped += result.skipped;
        } catch (err) {
          console.error(`[email-scanner] 邮箱 ${config.email} 处理失败:`, err.message);
          scanResult.errors.push({ email: config.email, error: err.message });

          // 更新失败计数
          try {
            await db.collection('EmailConfig').doc(config._id).update({
              failureCount: (config.failureCount || 0) + 1,
              lastError: err.message,
              updatedAt: new Date(),
            });
          } catch { /* 静默处理 */ }
        }

        // 邮箱之间间隔 3 秒，防限流
        await sleep(3000);
      }

      if (!scanResult.message) {
        scanResult.message = `扫描完成：发现 ${scanResult.totalEmails} 封邮件，新增 ${scanResult.newResumes} 份简历`;
      }
    } catch (err) {
      console.error('[email-scanner] 扫描异常:', err);
      scanResult.success = false;
      scanResult.message = `扫描异常：${err.message}`;
    }

    return scanResult;
  }

  // ---- 未知动作 ----
  return { success: false, message: `未知动作：${action}` };
};

// ===== EmailConfig CRUD（云函数端，绕过前端直接操作数据库的权限问题）=====

// 更新邮箱配置
async function handleUpdateConfig(event) {
  const { id, updates } = event;
  if (!id) return { success: false, message: '缺少配置 ID' };

  // 如果更新密码，需要解密验证（前端传来的已经是加密的）
  try {
    await db.collection('EmailConfig').doc(id).update({
      ...updates,
      updatedAt: new Date(),
    });
    return { success: true, message: '邮箱配置已更新' };
  } catch (err) {
    return { success: false, message: `更新失败：${err.message}` };
  }
}

// 删除邮箱配置
async function handleDeleteConfig(event) {
  const { id } = event;
  if (!id) return { success: false, message: '缺少配置 ID' };

  try {
    await db.collection('EmailConfig').doc(id).remove();
    return { success: true, message: '邮箱配置已删除' };
  } catch (err) {
    return { success: false, message: `删除失败：${err.message}` };
  }
}

// 诊断：测试 IMAP 连接并返回邮箱状态
async function handleDiagnose(event) {
  if (!modules.imapClient) {
    return { success: false, message: `IMAP 模块未加载：${loadErrors.imapClient}` };
  }

  const { config } = event;
  if (!config) return { success: false, message: '缺少邮箱配置' };

  // 先测试连接
  const connResult = await modules.imapClient.testConnection(config);
  if (!connResult.success) {
    return { success: false, message: connResult.message, connectionFailed: true };
  }

  // 尝试获取最近的发件人列表
  let recentSenders = [];
  try {
    const { ImapFlow } = require('imapflow');
    const { decrypt } = require('./crypto');
    const plainPassword = decrypt(config.imapPassword);

    const client = new ImapFlow({
      host: config.imapHost || 'imap.qq.com',
      port: config.imapPort || 993,
      secure: true,
      auth: { user: config.imapUser || config.email, pass: plainPassword },
      logger: false,
      tls: { rejectUnauthorized: true },
    });

    await client.connect();
    await client.mailboxOpen('INBOX');

    // 获取最近 50 封邮件的发件人
    const senders = new Set();
    for await (const msg of client.fetch('1:50', {
      envelope: true,
    })) {
      const from = msg.envelope.from?.[0]?.address || '';
      if (from) senders.add(from);
    }

    recentSenders = Array.from(senders);
    await client.logout();
  } catch (err) {
    recentSenders = [`获取发件人失败：${err.message}`];
  }

  return {
    success: true,
    message: '诊断完成',
    mailboxInfo: connResult.mailboxInfo,
    recentSenders,
    recruitmentDomains: ['@zhipin.com', '@kanzhun.com', '@zhaopin.com.cn', '@liepin.com', '@xlczg.com'],
  };
}

// ===== 核心逻辑 =====

/**
 * 处理单个邮箱
 */
async function processMailbox(config, scanResult) {
  const stats = { totalEmails: 0, newResumes: 0, skipped: 0 };

  // 检查退避：如果 nextRetryAt 未到，跳过
  if (config.nextRetryAt && new Date(config.nextRetryAt) > new Date()) {
    console.log(`[email-scanner] ${config.email} 处于退避期，跳过`);
    return stats;
  }

  // 拉取新简历邮件
  const messages = await modules.imapClient.fetchNewResumes(config);

  if (messages.length === 0) {
    return stats;
  }

  stats.totalEmails = messages.length;

  // 处理每封邮件
  for (const msg of messages) {
    for (const attachment of msg.attachments) {
      try {
        // 计算文件哈希
        const fileHash = modules.deduplicator
          ? modules.deduplicator.computeMD5(attachment.content)
          : null;

        // 去重检查
        if (modules.deduplicator) {
          const dupCheck = await modules.deduplicator.checkDuplicate(
            db, msg.messageId, fileHash
          );
          if (dupCheck.isDuplicate) {
            console.log(`[email-scanner] 跳过重复：${dupCheck.reason}`);
            stats.skipped++;
            continue;
          }
        }

        // 提取文本
        let extractedText = '';
        let extractedFormat = 'unknown';
        if (modules.formatRouter) {
          try {
            const result = await modules.formatRouter.route(
              attachment.content,
              attachment.filename,
              attachment.contentType
            );
            extractedText = result.text || '';
            extractedFormat = result.format || 'unknown';
          } catch (extractErr) {
            console.warn(`[email-scanner] 文本提取失败（${attachment.filename}）：${extractErr.message}`);
            extractedText = `[文本提取失败：${extractErr.message}]`;
            extractedFormat = 'extraction_failed';
          }
        } else {
          extractedText = '[格式路由模块未加载，无法提取文本]';
        }

        // 上传文件到云存储
        let fileUrl = null;
        try {
          const dateStr = new Date().toISOString().slice(0, 10);
          const cloudPath = `email-attachments/${dateStr}/${config._id}/${attachment.filename}`;
          const uploadResult = await app.uploadFile({
            cloudPath,
            fileContent: attachment.content,
          });
          fileUrl = uploadResult.fileID || uploadResult.downloadUrl || null;
        } catch (uploadErr) {
          console.warn(`[email-scanner] 文件上传失败：${uploadErr.message}`);
        }

        // 写入 ParseQueue
        const queueEntry = {
          source: 'email',
          sourceEmailId: msg.messageId,
          sourceEmailFrom: msg.from,
          sourceEmailSubject: msg.subject,
          sourceEmailDate: msg.date,
          sourceEmailConfigId: config._id,
          fileName: attachment.filename,
          fileType: attachment.contentType,
          fileSize: attachment.size,
          fileHash,
          fileUrl,
          extractedText,
          extractedFormat,
          status: 'pending',
          retryCount: 0,
          nextRetryAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await db.collection('ParseQueue').add(queueEntry);
        stats.newResumes++;
      } catch (err) {
        console.error(`[email-scanner] 处理附件 ${attachment.filename} 失败：`, err.message);
      }
    }
  }

  // 更新邮箱扫描状态
  await db.collection('EmailConfig').doc(config._id).update({
    lastScanAt: new Date(),
    failureCount: 0,
    lastError: null,
    nextRetryAt: null,
    updatedAt: new Date(),
  });

  return stats;
}

/**
 * Promise 版 sleep
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
