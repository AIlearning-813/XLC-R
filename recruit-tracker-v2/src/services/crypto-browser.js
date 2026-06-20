/**
 * crypto-browser.js — 浏览器端密码加密模块（安全重构版）
 *
 * 【安全策略变更】P0-1 修复：
 *   加密操作已全部移至云函数端执行，浏览器端不再持有 MASTER_SECRET / SALT_PEPPER。
 *   浏览器通过 HTTPS 将明文密码传给云函数，云函数端加密后存入数据库。
 *
 *   为什么移除浏览器端加密：
 *     - VITE_ 前缀的环境变量会被 Vite 编译进前端 JS bundle
 *     - 任何人打开浏览器 DevTools 都能提取密钥，解密所有邮箱密码
 *     - 加密操作在云函数端执行，密钥永不离开服务端
 *
 * 本模块保留为兼容性存根，所有加密操作通过云函数 email-scanner 完成。
 */

/**
 * 【已废弃】浏览器端不再执行加密，请通过云函数 email-scanner 完成密码加密。
 * @deprecated 使用 email-scanner 云函数的 encryptPassword action
 * @param {string} plaintext - 明文密码
 * @returns {Promise<string>} 返回明文（由云函数端加密）
 */
export async function encryptPassword(plaintext) {
  if (!plaintext) {
    throw new Error('密码不能为空');
  }
  // 浏览器端不再加密，明文通过 HTTPS 传给云函数
  // 云函数端（crypto.js）负责 PBKDF2 + AES-256-GCM 加密
  console.warn(
    '[crypto-browser] encryptPassword 已废弃，密码加密已移至云函数端。' +
    '请确保 email-config.js 通过云函数 email-scanner 处理密码。'
  );
  // 返回标记前缀，云函数端识别后加密
  return 'PLAINTEXT:' + plaintext;
}

/**
 * 检查加密环境是否就绪（云函数端加密始终可用）
 * @returns {boolean}
 */
export function isCryptoReady() {
  // 云函数端加密始终可用（密钥存在环境变量中，不暴露给前端）
  return true;
}
