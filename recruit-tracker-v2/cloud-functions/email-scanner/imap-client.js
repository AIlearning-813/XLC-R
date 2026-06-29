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

// 招聘平台发件人域名过滤（不含 @ 前缀，支持子域名匹配）
const RECRUITMENT_DOMAINS = [
  'zhipin.com',        // BOSS直聘（含 notice.zhipin.com 等子域名）
  'kanzhun.com',        // BOSS直聘/看准
  'zhaopin.com.cn',     // 智联招聘
  'liepin.com',         // 猎聘
  '51job.com',          // 前程无忧
  'xlczg.com',          // 公司邮箱
];

// 支持的简历附件 MIME 类型
const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/octet-stream', // BOSS直聘等简历附件常见为无扩展名二进制
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
 * 支持子域名匹配：notice.zhipin.com 匹配 zhipin.com
 */
function isRecruitmentSender(from) {
  if (!from) return false;
  const fromLower = from.toLowerCase();
  // 提取邮箱域名（@ 后面的部分）
  const atIndex = fromLower.lastIndexOf('@');
  const domain = atIndex >= 0 ? fromLower.slice(atIndex + 1) : fromLower;

  return RECRUITMENT_DOMAINS.some((d) =>
    domain === d || domain.endsWith('.' + d)
  );
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

    // 策略：未读邮件 + 最近10封合并去重，确保不漏（已读的也能回溯）
    let unseenSeqs = [];
    try {
      unseenSeqs = await client.search({ unseen: true });
      console.log(`[imap-client] ${config.email}：SEARCH 找到 ${unseenSeqs.length} 封未读`);
    } catch (err) {
      console.warn(`[imap-client] SEARCH 失败:`, err.message);
    }

    // 同时拉最近 10 封（序号倒序），防止测试邮件被之前的扫描标为已读
    const recentSeqs = [];
    for (let i = mailbox.exists; i >= Math.max(1, mailbox.exists - 9); i--) {
      recentSeqs.push(i);
    }

    // 合并去重
    const seqSet = new Set([...unseenSeqs, ...recentSeqs]);
    let allSeqs = Array.from(seqSet).sort((a, b) => a - b);

    // 最多处理 30 封
    if (allSeqs.length > 30) {
      console.log(`[imap-client] ${config.email}：合并后 ${allSeqs.length} 封，只处理最近 30 封`);
      allSeqs = allSeqs.slice(-30);
    }

    console.log(`[imap-client] ${config.email}：共 ${allSeqs.length} 封待查（未读 ${unseenSeqs.length} + 最近 ${recentSeqs.length}，合并去重后）`);

    if (allSeqs.length === 0) {
      console.log(`[imap-client] ${config.email}：没有邮件需要检查`);
      return results;
    }

    // 逐封 FETCH（避免批量 for-await 卡死在某封邮件上）
    let msgCount = 0;
    const fetchStart = Date.now();

    for (const seq of allSeqs) {
      msgCount++;
      let msg;
      try {
        msg = await fetchOneMessage(client, seq);
      } catch (err) {
        console.warn(`[imap-client]   ❌ 获取 #${seq} 失败: ${err.message}`);
        continue;
      }

      const subject = msg.envelope?.subject || '(无主题)';
      console.log(`[imap-client]   处理 #${msgCount}/${allSeqs.length} seq=${seq}: ${subject.slice(0, 50)}`);

      const from = msg.envelope?.from?.[0]?.address || '';

      // 按发件人域名过滤
      if (!isRecruitmentSender(from)) {
        console.log(`[imap-client]   跳过（发件人 ${from} 不匹配）`);
        continue;
      }

      console.log(`[imap-client]   ✅ 发件人匹配: ${from}`);

      const messageId = msg.envelope?.messageId || '';
      const date = msg.envelope?.date || new Date();

      // 提取附件元数据
      const attachmentMetas = extractAttachments(msg, seq);

      if (attachmentMetas.length === 0) {
        console.log(`[imap-client]   跳过（无附件）`);
        continue;
      }

      console.log(`[imap-client]   发现 ${attachmentMetas.length} 个附件，下载中...`);

      // 下载每个附件的内容
      const attachments = [];
      for (const meta of attachmentMetas) {
        try {
          console.log(`[imap-client]   下载附件: ${meta.filename} (part=${meta.part}, size=${meta.size})`);
          const downloadResult = await downloadWithTimeout(client, seq, meta.part);

          // 详细诊断下载返回值
          const resultType = typeof downloadResult;
          const isBuffer = Buffer.isBuffer(downloadResult);
          const isObject = resultType === 'object' && downloadResult !== null;
          console.log(`[imap-client]   下载返回: type=${resultType}, isBuffer=${isBuffer}, isObject=${isObject}${isObject ? ', keys=' + Object.keys(downloadResult).join(',') : ''}`);

          // 从下载结果中提取内容（imapflow 返回 { meta, content: stream }）
          let content = null;
          if (isBuffer) {
            content = downloadResult;
          } else if (isObject) {
            const rawContent = downloadResult.content;
            if (Buffer.isBuffer(rawContent)) {
              content = rawContent;
            } else if (rawContent && typeof rawContent === 'object') {
              // 是流（PassThrough/LimitedPassthrough）→ 消费成 Buffer
              console.log(`[imap-client]   content 是流，消费中...`);
              content = await streamToBuffer(rawContent);
            }
          }

          if (content && content.length > 0) {
            attachments.push({
              filename: meta.filename,
              contentType: meta.contentType,
              size: meta.size,
              content,
            });
            console.log(`[imap-client]   ✅ 下载成功: ${meta.filename} (${content.length} bytes)`);
          } else {
            console.warn(`[imap-client]   ⚠️ 下载返回空内容: ${meta.filename}`);
          }
        } catch (err) {
          console.warn(`[imap-client]   ❌ 下载失败 ${meta.filename}:`, err.message);
        }
      }

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
      try {
        await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);
      } catch (err) {
        console.warn(`[imap-client]   标记已读失败:`, err.message);
      }
    }

    console.log(`[imap-client] ${config.email}：FETCH 耗时 ${Date.now() - fetchStart}ms，共处理 ${msgCount} 封，发现 ${results.length} 封招聘邮件`);
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

  // 解密密码（兼容明文：来自前端 test/diagnose 的密码是明文，来自 DB 的是密文）
  let plainPassword;
  try {
    plainPassword = decrypt(config.imapPassword);
  } catch (err) {
    // 解密失败，假定已是明文密码（test/diagnose 直接从浏览器传过来的）
    if (config.imapPassword && config.imapPassword.length > 0) {
      plainPassword = config.imapPassword;
    } else {
      return { success: false, message: `密码解密失败：${err.message}` };
    }
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
      reject(new Error('邮件服务器连接超时'));
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
 * 单封邮件 FETCH（带超时，避免批量 for-await 卡死）
 */
function fetchOneMessage(client, seq) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`FETCH seq=${seq} 超时（30s）`));
    }, 30000);

    (async () => {
      try {
        for await (const msg of client.fetch(String(seq), {
          uid: true,
          envelope: true,
          bodyStructure: true,
        })) {
          clearTimeout(timer);
          resolve(msg);
          return;
        }
        clearTimeout(timer);
        reject(new Error(`FETCH seq=${seq} 无结果`));
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });
}

/**
 * 带超时的附件下载（60s 超时，大附件容忍）
 */
function downloadWithTimeout(client, seq, part) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`下载超时 seq=${seq} part=${part}（60s）`));
    }, 60000);

    client.download(String(seq), part)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * 将 Node.js Readable/PassThrough 流消费成 Buffer
 * imapflow 的 download() 返回 { meta, content: LimitedPassthrough }
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * 从 IMAP 邮件消息中提取附件
 * @param {object} msg - IMAP 消息
 * @param {number} seq - 邮件序号（用于日志）
 */
function extractAttachments(msg, seq) {
  const attachments = [];

  if (!msg.bodyStructure) {
    console.log(`[imap-client]   seq=${seq} 无 bodyStructure`);
    return attachments;
  }

  // 诊断：打印 bodyStructure 摘要
  console.log(`[imap-client]   seq=${seq} bodyStructure: type=${msg.bodyStructure.type}/${msg.bodyStructure.subtype}, childNodes=${msg.bodyStructure.childNodes?.length || 0}, disposition=${msg.bodyStructure.disposition || '无'}, filename=${msg.bodyStructure.filename || '无'}`);

  // 递归遍历 MIME 树结构查找附件
  function walkStructure(struct, path = [], depth = 0) {
    if (!struct) return;

    const indent = '  '.repeat(depth);

    // 诊断每个节点
    if (struct.type) {
      console.log(`[imap-client]   ${indent}节点[${path.join('.') || 'root'}]: ${struct.type}/${struct.subtype || '?'} disp="${struct.disposition || ''}" file="${struct.filename || ''}" size=${struct.size || 0} children=${struct.childNodes?.length || 0}`);
    }

    // message/rfc822：内嵌邮件（转发/回复带附件时常见）
    if (struct.type === 'message' && struct.subtype === 'rfc822') {
      if (Array.isArray(struct.childNodes)) {
        struct.childNodes.forEach((child, index) => {
          walkStructure(child, [...path, String(index + 1)], depth + 1);
        });
      }
      return;
    }

    // 叶子节点（非 multipart、非 message）
    const isMultipart = (struct.type || '').startsWith('multipart');
    const isMessage = (struct.type || '') === 'message';
    if (struct.type && !isMultipart && !isMessage) {
      const hasDisposition = !!(struct.disposition);
      const hasFilename = !!(struct.filename || struct.parameters?.name);

      // 放宽条件：有 disposition 或 filename 的都当作附件候选
      if (hasDisposition || hasFilename) {
        // imapflow 有时把完整 MIME 放在 type 字段（如 "application/octet-stream"），
        // 需要正确拆分，避免拼成 "application/octet-stream/octet-stream"
        let mimeType, mimeSubtype;
        if ((struct.type || '').includes('/')) {
          [mimeType, mimeSubtype] = struct.type.split('/');
        } else {
          mimeType = struct.type;
          mimeSubtype = struct.subtype || 'octet-stream';
        }

        // 空 path 表示根节点就是附件，IMAP part 编号为 "1"
        const partId = path.length === 0 ? '1' : path.join('.');
        attachments.push({
          filename: struct.filename || struct.parameters?.name || `resume_attachment_${path.join('_')}`,
          contentType: `${mimeType}/${mimeSubtype}`,
          disposition: struct.disposition || 'attachment',
          size: struct.size || 0,
          part: partId,
          contentId: struct.id || null,
        });
      }
    }

    // 递归子节点
    if (Array.isArray(struct.childNodes)) {
      struct.childNodes.forEach((child, index) => {
        walkStructure(child, [...path, String(index + 1)], depth + 1);
      });
    }
  }

  walkStructure(msg.bodyStructure);

  console.log(`[imap-client]   seq=${seq} 提取到 ${attachments.length} 个原始附件（过滤前）`);

  // 过滤：仅保留简历附件
  const filtered = attachments.filter((a) => {
    const keep = isResumeAttachment(a);
    if (!keep) {
      console.log(`[imap-client]   seq=${seq} 过滤掉: ${a.filename} (${a.contentType}, ${a.size} bytes)`);
    }
    return keep;
  });

  console.log(`[imap-client]   seq=${seq} 过滤后 ${filtered.length} 个简历附件`);
  return filtered;
}

module.exports = { fetchNewResumes, testConnection, isRecruitmentSender };
