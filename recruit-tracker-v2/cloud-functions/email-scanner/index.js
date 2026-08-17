/**
 * email-scanner — 邮箱自动扫描云函数
 *
 * 定时/手动触发，扫描启用的邮箱配置，拉取招聘平台邮件附件，
 * 提取文本后写入 ParseQueue，由 parse-queue-processor 消费。
 * 定时触发：工作日 09:00/12:00/15:00/18:00 各一次，周末不触发（cron: 0 0 9,12,15,18 * * 1-5 *）
 * 手动触发：传 userId 时只扫该专员自己的邮箱；管理员/定时器不传则扫全部
 * 超时设计：函数 900s，单邮箱 60s 预算，8 个邮箱全部轮流扫描
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

  // ---- 创建邮箱配置（云函数端加密密码）----
  if (action === 'createConfig') {
    return handleCreateConfig(event);
  }

  // ---- 更新邮箱配置（云函数端加密密码）----
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

  // ---- P0-1 密钥轮换（一次性迁移）----
  if (action === 'rotateKeys') {
    return handleRotateKeys(event);
  }

  // ---- 🆕 refetch：重新拉取丢失的简历附件 ----
  if (action === 'refetch') {
    return handleRefetch(event);
  }

  // ---- 🆕 extractText：服务端提取简历文本（浏览器端解析失败时的兜底）----
  if (action === 'extractText') {
    return handleExtractText(event);
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

    const forceRescan = event?.force === true;

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
      // 手动扫描按 userId 过滤：专员只扫自己的邮箱；管理员/定时器不传 userId 扫全部
      const scanWhere = { enabled: true };
      if (event?.userId) scanWhere.userId = event.userId;
      const { data: configs } = await db
        .collection('EmailConfig')
        .where(scanWhere)
        .get();

      if (!configs || configs.length === 0) {
        scanResult.message = '没有启用的邮箱配置';
        return scanResult;
      }

      console.log(`[email-scanner] 找到 ${configs.length} 个启用的邮箱`);

      // 1.5. 🆕 重试之前上传失败的 ParseQueue 条目（在扫描新邮件前）
      try {
        const uploadRetryResult = await retryFailedUploads(db, app, modules, configs);
        if (uploadRetryResult.retried > 0) {
          scanResult.uploadRetries = uploadRetryResult;
        }
      } catch (retryErr) {
        console.warn('[email-scanner] 上传重试异常:', retryErr.message);
      }

      // 2. 逐个邮箱处理
      for (const config of configs) {
        // 超时保护：剩余 < 60 秒则停止（配合单邮箱 60s 预算，保证所有邮箱轮流扫）
        const elapsed = Date.now() - startTime;
        const timeoutMs = (context.timeout || 900000) - 60000;
        if (elapsed > timeoutMs) {
          scanResult.message = `超时保护：已用 ${Math.round(elapsed / 1000)}s，剩余 ${Math.round((context.timeout - elapsed) / 1000)}s，停止扫描剩余邮箱`;
          scanResult.skippedMailboxes = configs.length - configs.indexOf(config);
          break;
        }

        try {
          const result = await processMailbox(config, scanResult, forceRescan);
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

      // 🔥 立即触发 parse-queue-processor 处理新条目，不等定时器（5分钟→秒级）
      if (scanResult.newResumes > 0) {
        app.callFunction({ name: 'parse-queue-processor' }).catch(err => {
          console.warn('[email-scanner] 触发 parse-queue-processor 失败:', err.message);
        });
        console.log('[email-scanner] 已触发 parse-queue-processor 立即处理新简历');
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

// 创建邮箱配置（云函数端加密密码后存储）
async function handleCreateConfig(event) {
  const { config } = event;
  if (!config) return { success: false, message: '缺少配置数据' };

  try {
    // 加密密码：前端永远传明文（通过 HTTPS），必须在云函数端加密后存储
    let encryptedPassword = config.imapPassword || '';
    if (encryptedPassword) {
      const plaintext = encryptedPassword.startsWith('PLAINTEXT:')
        ? encryptedPassword.slice('PLAINTEXT:'.length)
        : encryptedPassword;
      encryptedPassword = modules.crypto.encrypt(plaintext);
    }

    const doc = {
      userId: config.userId,
      email: config.email,
      imapHost: config.imapHost || 'imap.qq.com',
      imapPort: config.imapPort || 993,
      imapUser: config.imapUser || config.email,
      imapPassword: encryptedPassword,
      filterRules: config.filterRules || {},
      enabled: config.enabled !== false,
      failureCount: 0,
      nextRetryAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('EmailConfig').add(doc);
    return { success: true, id: result.id, config: { ...doc, _id: result.id } };
  } catch (err) {
    if (err.message && err.message.includes('E11000')) {
      return { success: false, message: `该邮箱 "${config.email}" 已配置过，请勿重复添加。如需修改请在列表中点"编辑"。` };
    }
    return { success: false, message: `创建失败：${err.message}` };
  }
}

// 更新邮箱配置（云函数端加密密码）
async function handleUpdateConfig(event) {
  const { id, updates } = event;
  if (!id) return { success: false, message: '缺少配置 ID' };

  try {
    const updateData = { ...updates };

    // 如果包含密码更新，在云函数端加密（前端永远传明文）
    if (updateData.imapPassword) {
      const plaintext = updateData.imapPassword.startsWith('PLAINTEXT:')
        ? updateData.imapPassword.slice('PLAINTEXT:'.length)
        : updateData.imapPassword;
      updateData.imapPassword = modules.crypto.encrypt(plaintext);
    }

    updateData.updatedAt = new Date();
    await db.collection('EmailConfig').doc(id).update(updateData);
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
    // 解密密码（兼容明文：来自前端 diagnose 的密码是明文）
    let plainPassword;
    try {
      plainPassword = decrypt(config.imapPassword);
    } catch {
      plainPassword = config.imapPassword; // 已是明文
    }

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
    recruitmentDomains: ['@zhipin.com', '@bosszhipin.com', '@kanzhun.com', '@zhaopin.com.cn', '@liepin.com', '@51job.com', '@xlczg.com'],
  };
}

// ===== 密钥轮换迁移（P0-1，一次性操作）=====

async function handleRotateKeys(event) {
  const crypto = modules.crypto;
  if (!crypto) {
    return { success: false, message: 'crypto 模块未加载' };
  }

  const oldMasterSecret = process.env.OLD_MASTER_SECRET;
  const oldPepper = process.env.OLD_SALT_PEPPER;

  if (!oldMasterSecret || !oldPepper) {
    return { success: false, message: 'OLD_MASTER_SECRET/OLD_SALT_PEPPER 未配置，无需迁移' };
  }

  try {
    const { data: configs } = await db.collection('EmailConfig').limit(1000).get();
    if (!configs || configs.length === 0) {
      return { success: true, message: '没有 EmailConfig 记录，无需迁移', migrated: 0, skipped: 0, failed: 0 };
    }

    let migrated = 0, skipped = 0, failed = 0;
    const failures = [];

    for (const config of configs) {
      try {
        if (!config.imapPassword) { skipped++; continue; }
        if (config.imapPassword.startsWith('PLAINTEXT:')) { skipped++; continue; }

        // 尝试用旧密钥解密
        let plaintext;
        try {
          // 使用 crypto 模块的内部解密能力（这里手动调用旧密钥解密）
          const packageBuffer = Buffer.from(config.imapPassword, 'base64');
          const SALT_LENGTH = 16, IV_LENGTH = 12, AUTH_TAG_LENGTH = 16;
          if (packageBuffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
            skipped++; continue;
          }
          const salt = packageBuffer.subarray(0, SALT_LENGTH);
          const iv = packageBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
          const encryptedData = packageBuffer.subarray(SALT_LENGTH + IV_LENGTH);
          const ciphertext = encryptedData.subarray(0, encryptedData.length - AUTH_TAG_LENGTH);
          const authTag = encryptedData.subarray(encryptedData.length - AUTH_TAG_LENGTH);

          const nodeCrypto = require('crypto');
          const oldKey = nodeCrypto.pbkdf2Sync(oldMasterSecret + oldPepper, salt, 100000, 32, 'sha256');
          const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', oldKey, iv);
          decipher.setAuthTag(authTag);
          plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
        } catch {
          // 可能已经用新密钥加密过
          skipped++;
          continue;
        }

        // 用新密钥重新加密
        const newEncrypted = crypto.encrypt(plaintext);
        await db.collection('EmailConfig').doc(config._id).update({
          imapPassword: newEncrypted,
          updatedAt: new Date(),
        });
        migrated++;
        console.log(`[rotateKeys] ✅ ${config.email} 迁移成功`);
      } catch (err) {
        failed++;
        failures.push({ email: config.email, error: err.message });
        console.error(`[rotateKeys] ❌ ${config.email} 失败:`, err.message);
      }
    }

    return {
      success: true,
      message: `密钥轮换完成：迁移 ${migrated}，跳过 ${skipped}，失败 ${failed}`,
      migrated, skipped, failed,
      failures: failures.length > 0 ? failures : undefined,
    };
  } catch (err) {
    return { success: false, message: `密钥轮换异常：${err.message}` };
  }
}

// ===== 核心逻辑 =====

/**
 * 处理单个邮箱
 */
async function processMailbox(config, scanResult, forceRescan = false) {
  const stats = { totalEmails: 0, newResumes: 0, skipped: 0 };

  // 强制重扫：清除该邮箱的历史 ParseQueue 记录（避免 Message-ID 去重阻挡）
  if (forceRescan) {
    console.log(`[email-scanner] 🔄 强制重扫模式：清除 ${config.email} 的历史 ParseQueue 记录`);
    try {
      const { data: oldEntries } = await db.collection('ParseQueue')
        .where({ sourceEmailConfigId: config._id, source: 'email' })
        .get();
      for (const entry of (oldEntries || [])) {
        await db.collection('ParseQueue').doc(entry._id).remove();
      }
      console.log(`[email-scanner] 已清除 ${(oldEntries || []).length} 条旧记录`);
    } catch (err) {
      console.warn(`[email-scanner] 清除旧记录失败:`, err.message);
    }
  }

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
            // P1-4：文本提取失败时标记为空字符串，让 parse-queue-processor 跳过 AI 解析
            console.warn(`[email-scanner] 文本提取失败（${attachment.filename}）：${extractErr.message}`);
            extractedText = '';
            extractedFormat = 'extraction_failed';
          }
        } else {
          extractedText = '[格式路由模块未加载，无法提取文本]';
        }

        // 上传文件到云存储（带重试，最多 3 次，间隔 2 秒）
        let fileUrl = null;
        const MAX_UPLOAD_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_UPLOAD_RETRIES; attempt++) {
          try {
            const dateStr = new Date().toISOString().slice(0, 10);
            // 净化文件名：防路径遍历 + 转 ASCII（COS 签名对中文路径编码不一致导致 SignatureDoesNotMatch）
            const rawFilename = (attachment.filename || 'attachment').replace(/\.\./g, '').replace(/[\\/]/g, '_');
            const ext = rawFilename.lastIndexOf('.') >= 0 ? rawFilename.slice(rawFilename.lastIndexOf('.')) : '.pdf';
            const asciiBase = (rawFilename.slice(0, rawFilename.lastIndexOf('.')) || 'resume')
              .replace(/[^a-zA-Z0-9_-]/g, '_');
            const safeFilename = asciiBase + ext;
            const uniquePrefix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const cloudPath = `email-attachments/${dateStr}/${config._id}/${uniquePrefix}/${safeFilename}`;
            const uploadResult = await app.uploadFile({
              cloudPath,
              fileContent: attachment.content,
            });
            fileUrl = uploadResult.fileID || uploadResult.downloadUrl || null;
            if (fileUrl) break;  // 成功则跳出重试循环
          } catch (uploadErr) {
            const attemptNum = attempt + 1;
            if (attempt < MAX_UPLOAD_RETRIES - 1) {
              console.warn(`[email-scanner] 文件上传失败（第${attemptNum}/${MAX_UPLOAD_RETRIES}次），2秒后重试：${uploadErr.message}`);
              await sleep(2000);
            } else {
              console.error(`[email-scanner] 文件上传失败（${MAX_UPLOAD_RETRIES}次尝试均失败），将进入重试队列：${uploadErr.message}`);
            }
          }
        }

        // 写入 ParseQueue
        const uploadFailed = !fileUrl;
        const queueEntry = {
          source: 'email',
          userId: config.userId,  // 邮箱配置所属用户，用于通知归属和 Application 分配
          sourceEmailId: msg.messageId,
          sourceEmailFrom: msg.from,
          sourceEmailSubject: msg.subject,
          sourceEmailDate: msg.date,
          sourceEmailConfigId: config._id,
          fileName: attachment.filename,
          fileType: attachment.contentType,
          mimeType: attachment.contentType,
          fileSize: attachment.size,
          fileHash,
          fileUrl,
          fileId: fileUrl,        // parse-queue-processor 使用此字段下载
          uploadFailed,           // 🆕 上传失败标记，用于后续重试
          preExtractedText: extractedText,  // parse-queue-processor 优先使用预提取文本
          extractedText,
          extractedFormat,
          status: uploadFailed ? 'retry' : 'pending',  // 上传失败 → retry，等待下次重试
          retryCount: uploadFailed ? 1 : 0,
          nextRetryAt: uploadFailed ? new Date(Date.now() + 5 * 60 * 1000) : null,  // 5 分钟后重试
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
    lastSuccessfulScanAt: new Date(),
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

/**
 * 🆕 重试之前上传失败的 ParseQueue 条目
 * 每次 scan 前调用，从 IMAP 重新下载附件 → 上传 COS → 回填 Candidate.fileId
 */
async function retryFailedUploads(db, app, modules, configs) {
  const now = new Date();
  const results = { retried: 0, success: 0, failed: 0 };

  try {
    // 查询 uploadFailed + status='retry' + 重试时间已到的条目
    const { data: entries } = await db
      .collection('ParseQueue')
      .where({
        uploadFailed: true,
        status: 'retry',
        nextRetryAt: db.command.lt(now),
      })
      .limit(10)
      .get();

    if (!entries || entries.length === 0) return results;

    console.log(`[email-scanner] 发现 ${entries.length} 条上传失败的 ParseQueue 条目，开始重试`);

    // 建立 EmailConfig 缓存
    const configCache = {};
    for (const cfg of configs) {
      configCache[cfg._id] = cfg;
    }

    for (const entry of entries) {
      try {
        const config = configCache[entry.sourceEmailConfigId];
        if (!config) {
          console.warn(`[email-scanner:upload-retry] ParseQueue ${entry._id}: EmailConfig ${entry.sourceEmailConfigId} 不存在或已禁用，跳过`);
          continue;
        }

        // 从 IMAP 重新下载附件
        console.log(`[email-scanner:upload-retry] 重新下载: ${(entry.sourceEmailSubject || '').substring(0, 50)}`);
        let attachments;
        try {
          attachments = await modules.imapClient.fetchEmailBySubject(
            config,
            entry.sourceEmailSubject || '',
            entry.sourceEmailFrom || ''
          );
        } catch (fetchErr) {
          console.warn(`[email-scanner:upload-retry] IMAP 下载失败: ${fetchErr.message}`);
          await updateUploadRetry(db, entry, fetchErr.message);
          results.failed++;
          continue;
        }

        if (!attachments || attachments.length === 0) {
          console.warn(`[email-scanner:upload-retry] 未在邮箱中找到匹配附件（邮件可能已删除）`);
          await updateUploadRetry(db, entry, '未在邮箱中找到匹配附件');
          results.failed++;
          continue;
        }

        const attachment = attachments[0];

        // 上传 COS（带 3 次重试）
        let fileUrl = null;
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const dateStr = new Date().toISOString().slice(0, 10);
            const rawFilename = (attachment.filename || 'resume').replace(/\.\./g, '').replace(/[\\/]/g, '_');
            const ext = rawFilename.lastIndexOf('.') >= 0 ? rawFilename.slice(rawFilename.lastIndexOf('.')) : '.pdf';
            const asciiBase = (rawFilename.slice(0, rawFilename.lastIndexOf('.')) || 'resume')
              .replace(/[^a-zA-Z0-9_-]/g, '_');
            const safeFilename = asciiBase + ext;
            const uniquePrefix = `retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const cloudPath = `email-attachments/${dateStr}/${entry.sourceEmailConfigId}/${uniquePrefix}/${safeFilename}`;
            const fileBuffer = Buffer.isBuffer(attachment.content)
              ? attachment.content
              : Buffer.from(attachment.content);
            const uploadResult = await app.uploadFile({
              cloudPath,
              fileContent: fileBuffer,
            });
            fileUrl = uploadResult.fileID || uploadResult.downloadUrl || null;
            if (fileUrl) break;
          } catch (uploadErr) {
            if (attempt < MAX_RETRIES - 1) {
              console.warn(`[email-scanner:upload-retry] 上传失败（第${attempt + 1}/${MAX_RETRIES}次），重试中...`);
              await sleep(2000);
            }
          }
        }

        if (!fileUrl) {
          await updateUploadRetry(db, entry, '上传重试 3 次均失败');
          results.failed++;
          continue;
        }

        // ✅ 上传成功 → 更新 ParseQueue 状态
        await db.collection('ParseQueue').doc(entry._id).update({
          fileUrl,
          fileId: fileUrl,
          uploadFailed: false,
          status: 'pending',   // 恢复为 pending，让 parse-queue-processor 正常消费
          retryCount: 0,
          nextRetryAt: null,
          updatedAt: new Date(),
        });

        // 回填已创建的 Candidate.fileId
        if (entry.parsedCandidateId) {
          await db.collection('Candidate').doc(entry.parsedCandidateId).update({
            fileId: fileUrl,
            fileName: attachment.filename || entry.fileName,
            updatedAt: new Date(),
          });
          console.log(`[email-scanner:upload-retry] ✅ Candidate ${entry.parsedCandidateId} fileId 已回填`);
        }

        results.success++;
        results.retried++;
        console.log(`[email-scanner:upload-retry] ✅ ParseQueue ${entry._id} 上传重试成功`);
      } catch (err) {
        console.error(`[email-scanner:upload-retry] ParseQueue ${entry._id} 处理异常:`, err.message);
        results.failed++;
      }
    }
  } catch (err) {
    console.error('[email-scanner:upload-retry] 查询失败:', err.message);
  }

  if (results.retried > 0) {
    console.log(`[email-scanner:upload-retry] 完成: 重试 ${results.retried}, 成功 ${results.success}, 失败 ${results.failed}`);
  }
  return results;
}

/**
 * 🆕 更新上传重试状态（指数退避）
 */
async function updateUploadRetry(db, entry, errorMsg) {
  const retryCount = (entry.retryCount || 0) + 1;
  const MAX_RETRIES = 5;
  const BACKOFF_MINUTES = [5, 10, 20, 40, 80];  // 指数退避

  if (retryCount >= MAX_RETRIES) {
    // 超过最大重试次数，标记为永久失败
    await db.collection('ParseQueue').doc(entry._id).update({
      status: 'failed',
      failReason: `上传重试耗尽（${retryCount}次）：${errorMsg}`,
      updatedAt: new Date(),
    });
    console.warn(`[email-scanner:upload-retry] ❌ ParseQueue ${entry._id} 上传重试耗尽，标记为 failed`);
  } else {
    const backoffIndex = Math.min(retryCount - 1, BACKOFF_MINUTES.length - 1);
    const nextRetryAt = new Date(Date.now() + BACKOFF_MINUTES[backoffIndex] * 60 * 1000);
    await db.collection('ParseQueue').doc(entry._id).update({
      retryCount,
      nextRetryAt,
      lastError: errorMsg,
      updatedAt: new Date(),
    });
    console.warn(`[email-scanner:upload-retry] ParseQueue ${entry._id} 第${retryCount}次重试失败，下次 ${nextRetryAt.toISOString()}`);
  }
}

// ===== 🆕 refetch：从邮箱重新拉取丢失的简历附件 =====

async function handleRefetch(event) {
  if (!modules.imapClient) {
    return { success: false, message: `IMAP 模块未加载：${loadErrors.imapClient}` };
  }

  const maxCandidates = event?.maxCandidates || 5;
  const candidateIds = event?.candidateIds || [];

  console.log(`[email-scanner:refetch] 开始，最多 ${maxCandidates} 个候选人`);

  // 1. 找到 fileId 为空的 email 来源候选人
  let candidates;
  if (candidateIds.length > 0) {
    const { data } = await db.collection('Candidate')
      .where({ _id: db.command.in(candidateIds) })
      .get();
    candidates = (data || []).filter(c => c.status !== 'deleted');
  } else {
    // 拉取全部候选人，筛选需要修复的
    const all = [];
    let cursor = null;
    let hasMore = true;
    while (hasMore) {
      let query = db.collection('Candidate').limit(100);
      if (cursor) query = query.where({ _id: db.command.gt(cursor) });
      const { data } = await query.get();
      if (data && data.length > 0) {
        all.push(...data);
        cursor = data[data.length - 1]._id;
        if (data.length < 100) hasMore = false;
      } else { hasMore = false; }
    }
    candidates = all.filter(c =>
      (!c.fileId || c.fileId.length === 0) &&
      c.source === 'email' &&
      c.status !== 'deleted'
    );
  }

  console.log(`[email-scanner:refetch] 找到 ${candidates.length} 个需要修复的候选人，处理前 ${maxCandidates} 个`);

  const toProcess = candidates.slice(0, maxCandidates);
  const results = [];
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  // 缓存 EmailConfig，避免重复查询
  const configCache = {};

  for (const candidate of toProcess) {
    const ctx = { _id: candidate._id, name: candidate.name };
    console.log(`[email-scanner:refetch] 处理: ${candidate.name}`);

    try {
      // 2. 查找关联的 ParseQueue 条目
      let pqEntry = null;
      try {
        const { data: pqData } = await db.collection('ParseQueue')
          .where({ parsedCandidateId: candidate._id })
          .limit(1)
          .get();
        pqEntry = pqData?.[0];
      } catch (_) {}

      if (!pqEntry) {
        // 尝试通过 source + 候选人名字匹配
        try {
          const { data: pq2 } = await db.collection('ParseQueue')
            .where({
              source: 'email',
              status: 'done',
            })
            .limit(50)
            .get();
          pqEntry = (pq2 || []).find(e =>
            (e.sourceEmailSubject || '').includes(candidate.name)
          );
        } catch (_) {}
      }

      if (!pqEntry) {
        skipCount++;
        results.push({ ...ctx, status: 'skipped', reason: '未找到关联的 ParseQueue 条目' });
        continue;
      }

      // 3. 获取 EmailConfig（使用缓存）
      const configId = pqEntry.sourceEmailConfigId;
      if (!configId) {
        skipCount++;
        results.push({ ...ctx, status: 'skipped', reason: 'ParseQueue 缺少 sourceEmailConfigId' });
        continue;
      }

      if (!configCache[configId]) {
        try {
          const { data: cfg } = await db.collection('EmailConfig').doc(configId).get();
          configCache[configId] = Array.isArray(cfg) ? cfg[0] : cfg;
        } catch (_) {
          configCache[configId] = null;
        }
      }

      const config = configCache[configId];
      if (!config || !config.enabled) {
        skipCount++;
        results.push({ ...ctx, status: 'skipped', reason: 'EmailConfig 不可用或已禁用' });
        continue;
      }

      // 4. 从 IMAP 重新下载附件
      console.log(`[email-scanner:refetch] 连接 ${config.email}, 搜索: ${(pqEntry.sourceEmailSubject || '').substring(0, 50)}`);
      let attachments;
      try {
        attachments = await modules.imapClient.fetchEmailBySubject(
          config,
          pqEntry.sourceEmailSubject || '',
          pqEntry.sourceEmailFrom || ''
        );
      } catch (fetchErr) {
        failCount++;
        results.push({ ...ctx, status: 'failed', reason: `IMAP获取失败: ${fetchErr.message}` });
        continue;
      }

      if (!attachments || attachments.length === 0) {
        failCount++;
        results.push({ ...ctx, status: 'failed', reason: '未在邮箱中找到匹配的附件（邮件可能已删除）' });
        continue;
      }

      // 取第一个匹配的附件
      const attachment = attachments[0];

      // 5. 上传到云存储（唯一路径，防止覆盖）
      const dateStr = new Date().toISOString().slice(0, 10);
      // COS 签名对中文/全角字符路径编码敏感，统一转 ASCII 防止签名不匹配
      const rawFilename = (attachment.filename || 'resume').replace(/\.\./g, '').replace(/[\\/]/g, '_');
      const ext = rawFilename.lastIndexOf('.') >= 0 ? rawFilename.slice(rawFilename.lastIndexOf('.')) : '.pdf';
      const asciiBase = (rawFilename.slice(0, rawFilename.lastIndexOf('.')) || 'resume')
        .replace(/[^a-zA-Z0-9_-]/g, '_');  // 非 ASCII 字符全部替换
      const safeFilename = asciiBase + ext;
      const uniquePrefix = `refetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const cloudPath = `email-attachments/${dateStr}/${configId}/${uniquePrefix}/${safeFilename}`;

      console.log(`[email-scanner:refetch] 上传: ${cloudPath} (${attachment.content?.length || 0} bytes, 原名: ${rawFilename})`);
      // 确保 content 是标准 Buffer
      const fileBuffer = Buffer.isBuffer(attachment.content)
        ? attachment.content
        : Buffer.from(attachment.content);
      const uploadResult = await app.uploadFile({
        cloudPath,
        fileContent: fileBuffer,
      });

      const newFileId = uploadResult.fileID || uploadResult.downloadUrl;
      if (!newFileId) {
        failCount++;
        results.push({ ...ctx, status: 'failed', reason: '云存储上传失败' });
        continue;
      }

      // 6. 更新 Candidate.fileId
      await db.collection('Candidate').doc(candidate._id).update({
        fileId: newFileId,
        fileName: attachment.filename || candidate.fileName,
        updatedAt: new Date(),
      });

      successCount++;
      results.push({
        ...ctx,
        status: 'success',
        newFileId,
        fileName: attachment.filename,
        size: attachment.size,
      });
      console.log(`[email-scanner:refetch] ✅ ${candidate.name} 简历已修复 (${attachment.size} 字节)`);
    } catch (err) {
      failCount++;
      results.push({ ...ctx, status: 'failed', reason: err.message });
      console.error(`[email-scanner:refetch] ❌ ${candidate.name}: ${err.message}`);
    }
  }

  return {
    success: true,
    total: candidates.length,
    processed: toProcess.length,
    successCount,
    skipCount,
    failCount,
    results,
  };
}

/**
 * 🆕 handleExtractText — 服务端提取简历文本
 *
 * 浏览器端 pdfjs-dist / mammoth 动态导入可能因缓存、网络代理、
 * 浏览器扩展等原因失败。此函数提供服务端兜底：
 * 接收文件 base64 内容，使用 format-router 提取文本后返回。
 *
 * 入参：{ fileContent, fileName, mimeType }
 *   - fileContent: 文件的 base64 编码字符串
 * 返回：{ success, text, format } 或 { success: false, error }
 */
async function handleExtractText(event) {
  const { fileContent, fileName, mimeType } = event;

  if (!fileContent) {
    return { success: false, error: '缺少 fileContent 参数' };
  }

  if (!modules.formatRouter) {
    return { success: false, error: `服务端文本提取模块未加载：${loadErrors.formatRouter || '未知错误'}` };
  }

  try {
    console.log(`[email-scanner:extractText] 开始提取: ${fileName || '(未知名)'} (${mimeType || '未知类型'}), base64: ${(fileContent.length / 1024).toFixed(1)}KB`);

    // 将 base64 解码为 Buffer
    const fileBuffer = Buffer.from(fileContent, 'base64');
    console.log(`[email-scanner:extractText] 解码成功: ${fileBuffer.length} 字节`);

    // 使用 format-router 提取文本
    const extractResult = await modules.formatRouter.route(
      fileBuffer,
      fileName || 'resume.pdf',
      mimeType || 'application/pdf'
    );

    console.log(`[email-scanner:extractText] 文本提取成功: ${extractResult.text.length} 字符, 格式: ${extractResult.format}`);

    return {
      success: true,
      text: extractResult.text,
      format: extractResult.format,
    };
  } catch (err) {
    const errMsg = err?.message || err?.code || String(err).slice(0, 200) || '未知错误';
    console.error(`[email-scanner:extractText] 文本提取失败:`, errMsg);
    // 打印完整错误栈用于排查
    if (err?.stack) {
      console.error(`[email-scanner:extractText] 错误栈:`, err.stack);
    }
    return {
      success: false,
      error: `文本提取失败：${errMsg}`,
    };
  }
}
