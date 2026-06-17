/**
 * imap-client.js — IMAP 邮件客户端
 *
 * 使用 imapflow 库连接 IMAP 服务器，搜索并下载招聘平台发送的简历邮件附件。
 *
 * 支持的招聘平台发件人域名：
 *   @zhipin.com (BOSS直聘), @kanzhun.com (BOSS直聘/看准),
 *   @zhaopin.com.cn (智联招聘), @liepin.com (猎聘)
 */

const { decrypt } = require('./crypto');

// 招聘平台发件人域名过滤
const RECRUITMENT_DOMAINS = [
  '@zhipin.com',
  '@kanzhun.com',
  '@zhaopin.com.cn',
  '@liepin.com',
];

// 支持的简历附件 MIME 类型
const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/html',
  'application/rtf',
  'text/rtf',
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'application/zip',
  'application/x-rar-compressed',
];

// 支持的文件扩展名
const RESUME_EXTENSIONS = [
  '.pdf', '.docx', '.doc', '.txt', '.html', '.htm',
  '.rtf', '.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif',
  '.webp', '.zip', '.rar', '.pages',
];

/**
 * 检查文件名是否为简历附件（非内嵌图片/签名）
 */
function isResumeAttachment(attachment) {
  const fileName = (attachment.filename || '').toLowerCase();
  const mimeType = (attachment.contentType || '').toLowerCase();
  const disposition = (attachment.disposition || '').toLowerCase();

  // 跳过内嵌图片（content-id 存在且 disposition 为 inline）
  if (attachment.contentId && disposition === 'inline' && mimeType.startsWith('image/')) {
    // 但如果文件大小 > 100KB，可能是简历截图，仍然处理
    if (attachment.size < 100 * 1024) {
      return false;
    }
  }

  // 跳过签名图片等很小的文件
  if (attachment.size < 1024) {
    return false;
  }

  // 按 MIME 类型匹配
  if (RESUME_MIME_TYPES.some((t) => mimeType.includes(t))) {
    return true;
  }

  // 按扩展名匹配
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  if (RESUME_EXTENSIONS.includes(ext)) {
    return true;
  }

  // 无扩展名但 MIME 是 application/octet-stream，可能是简历（根据文件名判断）
  if (mimeType === 'application/octet-stream' && attachment.size > 50 * 1024) {
    return true;
  }

  return false;
}

/**
 * 检查发件人是否来自招聘平台
 */
function isRecruitmentSender(from) {
  if (!from) return false;
  const fromLower = from.toLowerCase();
  return RECRUITMENT_DOMAINS.some((domain) => fromLower.includes(domain));
}

/**
 * 连接到 IMAP 服务器并拉取新简历邮件
 *
 * @param {object} config - EmailConfig 文档
 * @param {string} config.email - 邮箱地址
 * @param {string} config.imapHost - IMAP 服务器地址
 * @param {number} config.imapPort - IMAP 端口（通常 993）
 * @param {string} config.imapUser - IMAP 登录用户名
 * @param {string} config.imapPassword - 加密存储的密码（Base64）
 * @param {object} config.filterRules - 过滤规则（可选）
 * @returns {Promise<Array<{messageId, from, subject, date, attachments: Array}>>}
 */
async function fetchNewResumes(config) {
  const { ImapFlow } = require('imapflow');

  // 解密密码
  let plainPassword;
  try {
    plainPassword = decrypt(config.imapPassword);
  } catch (err) {
    throw new Error(`密码解密失败：${err.message}`);
  }

  const client = new ImapFlow({
    host: config.imapHost || 'imap.qq.com',
    port: config.imapPort || 993,
    secure: true,
    auth: {
      user: config.imapUser || config.email,
      pass: plainPassword,
    },
    logger: false,
    tls: {
      rejectUnauthorized: true,
    },
  });

  const results = [];

  try {
    // 连接到 IMAP 服务器（30 秒超时）
    await connectWithTimeout(client, 30000);

    // 打开收件箱
    const mailbox = await client.mailboxOpen('INBOX');
    console.log(`[imap-client] 已连接 ${config.email}，收件箱共 ${mailbox.exists} 封邮件`);

    // 搜索未读邮件
    const searchQuery = { unseen: true };
    const messages = [];

    for await (const msg of client.fetch(searchQuery, {
      uid: true,
      envelope: true,
      bodyStructure: true,
      source: true,
    })) {
      const from = msg.envelope.from?.[0]?.address || '';

      // 按发件人域名过滤
      if (!isRecruitmentSender(from)) {
        continue;
      }

      const messageId = msg.envelope.messageId || '';
      const subject = msg.envelope.subject || '';
      const date = msg.envelope.date || new Date();

      // 提取附件
      const attachments = extractAttachments(msg);

      if (attachments.length > 0) {
        results.push({
          uid: msg.uid,
          messageId,
          from,
          subject,
          date,
          attachments,
        });
      }

      // 标记为已读
      await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);
    }

    console.log(`[imap-client] ${config.email}：发现 ${results.length} 封招聘邮件`);
  } finally {
    // 确保连接关闭
    try {
      await client.logout();
    } catch {
      // 忽略关闭错误
    }
  }

  return results;
}

/**
 * 测试 IMAP 连接（用于"测试连接"按钮）
 *
 * @param {object} config - EmailConfig（密码已加密）
 * @returns {Promise<{success: boolean, message: string, mailboxInfo?: object}>}
 */
async function testConnection(config) {
  const { ImapFlow } = require('imapflow');

  // 解密密码
  let plainPassword;
  try {
    plainPassword = decrypt(config.imapPassword);
  } catch (err) {
    return { success: false, message: `密码解密失败：${err.message}` };
  }

  const client = new ImapFlow({
    host: config.imapHost || 'imap.qq.com',
    port: config.imapPort || 993,
    secure: true,
    auth: {
      user: config.imapUser || config.email,
      pass: plainPassword,
    },
    logger: false,
    tls: {
      rejectUnauthorized: true,
    },
  });

  try {
    await connectWithTimeout(client, 15000);
    const mailbox = await client.mailboxOpen('INBOX');

    return {
      success: true,
      message: `连接成功！收件箱共 ${mailbox.exists} 封邮件`,
      mailboxInfo: {
        totalMessages: mailbox.exists,
        unseen: 0, // IMAP 不直接返回此值，需额外搜索
      },
    };
  } catch (err) {
    // 根据错误类型给出中文提示
    let message = err.message || '未知错误';
    if (message.includes('Invalid credentials') || message.includes('AUTHENTICATIONFAILED')) {
      message = '认证失败 — 请检查授权码是否正确（注意：不是 QQ 登录密码，需在 QQ 邮箱设置中开启 IMAP 并获取授权码）';
    } else if (message.includes('ETIMEDOUT') || message.includes('ENOTFOUND') || message.includes('timeout')) {
      message = '连接超时 — 请检查 IMAP 服务器地址和端口：通常为 imap.qq.com:993（SSL）';
    } else if (message.includes('certificate') || message.includes('SSL') || message.includes('TLS')) {
      message = 'SSL/TLS 证书错误 — 请确认端口是否为 993（SSL 加密）';
    }

    return { success: false, message };
  } finally {
    try {
      await client.logout();
    } catch {
      // 忽略
    }
  }
}

/**
 * 带超时的 IMAP 连接
 */
function connectWithTimeout(client, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('IMAP 连接超时'));
    }, timeoutMs);

    client.connect()
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * 从 IMAP 邮件消息中提取附件
 */
function extractAttachments(msg) {
  const attachments = [];

  if (!msg.bodyStructure) return attachments;

  // 递归遍历 MIME 树结构查找附件
  function walkStructure(struct, path = []) {
    if (!struct) return;

    // 叶子节点：有 type 且可能是附件
    if (struct.type && struct.disposition) {
      const dispositionLower = (struct.disposition || '').toLowerCase();
      if (dispositionLower === 'attachment' || dispositionLower === 'inline') {
        attachments.push({
          filename: struct.filename || struct.parameters?.name || `attachment_${path.join('_')}`,
          contentType: `${struct.type}/${struct.subtype || 'octet-stream'}`,
          disposition: struct.disposition,
          size: struct.size || 0,
          part: path.join('.'),
          contentId: struct.id || null,
        });
      }
    }

    // 递归子节点
    if (Array.isArray(struct.childNodes)) {
      struct.childNodes.forEach((child, index) => {
        walkStructure(child, [...path, String(index + 1)]);
      });
    }
  }

  walkStructure(msg.bodyStructure);

  // 过滤：仅保留简历附件
  return attachments.filter(isResumeAttachment);
}

module.exports = { fetchNewResumes, testConnection, isRecruitmentSender };
