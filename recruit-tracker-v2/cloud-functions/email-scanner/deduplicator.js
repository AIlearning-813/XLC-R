/**
 * deduplicator.js — 邮件/文件去重模块
 *
 * 三层去重策略：
 *   1. 邮件级：Message-ID 是否已在 ParseQueue 中
 *   2. 文件级：MD5 哈希是否已在 Candidate 中
 *   3. 候选人级：移交 parse-queue-processor 处理（phone + email 匹配）
 */

const crypto = require('crypto');

/**
 * 计算文件 Buffer 的 MD5 哈希（用于文件级去重）
 * @param {Buffer} buffer
 * @returns {string} 16进制 MD5 哈希
 */
function computeMD5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * 计算文件 Buffer 的 SHA-256 哈希（用于 Candidate 匹配）
 * @param {Buffer} buffer
 * @returns {string} 16进制 SHA-256 哈希
 */
function computeSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 邮件级去重：检查 Message-ID 是否已经处理过
 * @param {object} db - CloudBase 数据库实例
 * @param {string} messageId - 邮件的 Message-ID
 * @returns {Promise<boolean>} true = 重复，应跳过
 */
async function isMessageIdDuplicate(db, messageId) {
  if (!messageId) return false;

  try {
    const result = await db
      .collection('ParseQueue')
      .where({
        sourceEmailId: messageId,
        status: db.command.in(['pending', 'parsing', 'done']),
      })
      .count();

    return result.total > 0;
  } catch (err) {
    console.warn('[deduplicator] Message-ID 去重检查失败，放行:', err.message);
    return false;
  }
}

/**
 * 文件级去重：检查文件 MD5 是否已存在于 Candidate 集合
 * @param {object} db - CloudBase 数据库实例
 * @param {string} fileHash - 文件 MD5 哈希
 * @returns {Promise<boolean>} true = 重复，应跳过
 */
async function isFileHashDuplicate(db, fileHash) {
  if (!fileHash) return false;

  try {
    const result = await db
      .collection('Candidate')
      .where({ fileHash })
      .count();

    return result.total > 0;
  } catch (err) {
    console.warn('[deduplicator] 文件哈希去重检查失败，放行:', err.message);
    return false;
  }
}

/**
 * 全面去重检查（邮件 + 文件两级）
 * @param {object} db - CloudBase 数据库实例
 * @param {string} messageId - 邮件 Message-ID
 * @param {string} fileHash - 文件 MD5 哈希
 * @returns {Promise<{isDuplicate: boolean, reason: string}>}
 */
async function checkDuplicate(db, messageId, fileHash) {
  // 第 1 层：邮件 Message-ID 去重
  if (messageId) {
    const msgDup = await isMessageIdDuplicate(db, messageId);
    if (msgDup) {
      return { isDuplicate: true, reason: '邮件已处理（Message-ID 重复）' };
    }
  }

  // 第 2 层：文件 MD5 去重
  if (fileHash) {
    const fileDup = await isFileHashDuplicate(db, fileHash);
    if (fileDup) {
      return { isDuplicate: true, reason: '文件已存在（MD5 哈希重复）' };
    }
  }

  return { isDuplicate: false, reason: '' };
}

module.exports = { computeMD5, computeSHA256, checkDuplicate, isMessageIdDuplicate, isFileHashDuplicate };
