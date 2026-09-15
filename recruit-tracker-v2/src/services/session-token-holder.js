/**
 * session-token-holder.js — 当前会话令牌的载体
 *
 * 为什么单独一个小模块（2026-09-14 第 3 阶段加固）：
 *   加固后 report-aggregator / get-file-url / email-scanner 都要求携带 sessionToken。
 *   若让每个调用点各自记得带上，必然会漏——本仓库有 9 处 report-aggregator 调用、
 *   6 处 email-scanner 调用，漏一处就是线上「时好时坏」。
 *   因此改为在 services/cloudbase.js 的 callFunction 里**统一注入**。
 *
 *   但 cloudbase.js 不能直接 import useAuthStore（store 又 import cloudbase，
 *   会形成循环依赖）。所以用这个不依赖任何模块的小载体做中转：
 *     useAuthStore 写入 → cloudbase.js 读取 → 注入到每次 callFunction
 *
 * 令牌不是秘密（它本来就存在 localStorage 里），这里只是搬运，不做加解密。
 */

let currentToken = '';

/**
 * 写入当前会话令牌（登录、恢复会话时调用；登出传空串）
 * @param {string} token
 */
export function setSessionToken(token) {
  currentToken = typeof token === 'string' ? token : '';
}

/**
 * 读取当前会话令牌；未登录时为空串
 * @returns {string}
 */
export function getSessionToken() {
  return currentToken;
}
