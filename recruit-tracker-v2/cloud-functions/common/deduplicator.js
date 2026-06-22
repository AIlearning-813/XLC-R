/**
 * deduplicator.js — 邮件/文件去重模块
 *
 * 三层去重策略：
 *   1. 邮件级：Message-ID 是否已在 ParseQueue 中
 *   2. 文件级：SHA-256 哈希是否已在 Candidate 中
 *   3. 候选人级：移交 parse-queue-processor 处理（phone + email 匹配）
 *
 * P0-8 修复：统一使用 SHA-256（前后端一致）。
 *   原 MD5 仅保留为 computeMD5 别名，内部调用 SHA-256。
 */

const crypto = require('crypto');

// 去重失败计数器（模块级，云函数实例生命周期内有效）
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

/** 记录去重失败并判断是否应阻止放行 */
function trackFailure(db, context) {
  consecutiveFailures++;
  const shouldBlock = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  // 尝试写入 ErrorLog
  try {
    db.collection('ErrorLog').add({
      type: 'cloudFunction',
      source: 'deduplicator',
      message: `去重检查连续失败 ${consecutiveFailures} 次${shouldBlock ? '，已进入安全阻止模式' : ''}`,
      context,
      severity: shouldBlock ? 'critical' : 'warning',
      createdAt: new Date(),
    }).catch(() => {});
  } catch (_) {}
  return shouldBlock;
}

/** 去重成功时重置失败计数 */
function resetFailures() {
  consecutiveFailures = 0;
}

/**
 * 计算文件 Buffer 的 SHA-256 哈希（用于文件级去重）
 * P0-8：统一使用 SHA-256，与浏览器端 resume-parser.js 保持一致
 * @param {Buffer} buffer
 * @returns {string} 16进制 SHA-256 哈希
 */
function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 【已废弃】计算文件 Buffer 的 MD5 哈希
 * P0-8：改为 SHA-256 别名，保持向后兼容
 * @deprecated 使用 computeFileHash 替代
 * @param {Buffer} buffer
 * @returns {string} 16进制 SHA-256 哈希
 */
function computeMD5(buffer) {
  return computeFileHash(buffer);
}

/**
 * 计算文件 Buffer 的 SHA-256 哈希
 * @param {Buffer} buffer
 * @returns {string} 16进制 SHA-256 哈希
 */
function computeSHA256(buffer) {
  return computeFileHash(buffer);
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

    resetFailures();
    return result.total > 0;
  } catch (err) {
    console.warn('[deduplicator] Message-ID 去重检查失败:', err.message);
    const blocked = trackFailure(db, { type: 'messageId', id: messageId, error: err.message });
    if (blocked) return true;  // 连续失败3次→阻止放行
    return false;
  }
}

/**
 * 文件级去重：检查文件 SHA-256 是否已存在于 Candidate 集合
 * @param {object} db - CloudBase 数据库实例
 * @param {string} fileHash - 文件 SHA-256 哈希
 * @returns {Promise<boolean>} true = 重复，应跳过
 */
async function isFileHashDuplicate(db, fileHash) {
  if (!fileHash) return false;

  try {
    const result = await db
      .collection('Candidate')
      .where({ fileHash })
      .count();

    resetFailures();
    return result.total > 0;
  } catch (err) {
    console.warn('[deduplicator] 文件哈希去重检查失败:', err.message);
    const blocked = trackFailure(db, { type: 'fileHash', hash: fileHash, error: err.message });
    if (blocked) return true;  // 连续失败3次→阻止放行
    return false;
  }
}

/**
 * 全面去重检查（邮件 + 文件两级）
 * @param {object} db - CloudBase 数据库实例
 * @param {string} messageId - 邮件 Message-ID
 * @param {string} fileHash - 文件 SHA-256 哈希
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

  // 第 2 层：文件 SHA-256 去重
  if (fileHash) {
    const fileDup = await isFileHashDuplicate(db, fileHash);
    if (fileDup) {
      return { isDuplicate: true, reason: '文件已存在（SHA-256 哈希重复）' };
    }
  }

  return { isDuplicate: false, reason: '' };
}

module.exports = { computeFileHash, computeMD5, computeSHA256, checkDuplicate, isMessageIdDuplicate, isFileHashDuplicate };
