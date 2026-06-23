/* 新励成招聘管理系统 V2.0 — 浏览器端 PII 哈希工具
 *
 * P1-3：手机号/邮箱哈希存储，用于去重匹配，避免明文比对。
 * 使用 Web Crypto API（SubtleCrypto），无需额外依赖。
 *
 * ⚠️ P0-2 安全注意：
 *   浏览器端使用 SHA-256 仅用于本地快速去重提示（非权威）。
 *   服务器端（parse-queue-processor）已升级为 HMAC-SHA256 进行安全持久化。
 *   浏览器端计算结果与服务器端 HMAC 哈希不匹配属于正常现象——
 *   服务端去重才是权威结果。手动录入/导入的候选人去重以服务端为准。
 *
 *   未来重构：将 PII 哈希计算移至云函数端，前后端统一使用 HMAC-SHA256。
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
