/* 新励成招聘管理系统 V2.0 — 浏览器端 SHA-256 哈希工具
 *
 * P1-3：手机号/邮箱哈希存储，用于去重匹配，避免明文比对。
 * 使用 Web Crypto API（SubtleCrypto），无需额外依赖。
 *
 * 使用方式：
 *   import { sha256 } from '../services/hash';
 *   const hash = await sha256('13800138000');
 */

/**
 * 计算字符串的 SHA-256 哈希（hex 格式）
 * @param {string} input - 待哈希的字符串
 * @returns {Promise<string>} 64位 hex 哈希值
 */
export async function sha256(input) {
  if (!input || typeof input !== 'string') return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(input.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 为候选人数据添加 phoneHash 和 emailHash 字段
 * @param {Object} candidateData - 候选人数据（可能含 phone / email）
 * @returns {Promise<Object>} 附加了 phoneHash / emailHash 的数据副本
 */
export async function attachHashes(candidateData) {
  const result = { ...candidateData };
  if (result.phone && !result.phoneHash) {
    result.phoneHash = await sha256(result.phone);
  }
  if (result.email && !result.emailHash) {
    result.emailHash = await sha256(result.email);
  }
  return result;
}
