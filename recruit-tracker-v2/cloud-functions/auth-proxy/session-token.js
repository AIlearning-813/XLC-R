/**
 * session-token.js — 会话令牌的签发、校验与授权判定
 *
 * 令牌格式：base64(username|role|name|expiry).base64(HMAC-SHA256(key, payload))
 * 签名密钥来自环境变量 MASTER_SECRET，由调用方显式注入本模块。
 *
 * 为什么要抽成独立模块（2026-09-14）：
 *   原实现把签发/校验/授权判定全部内联在 index.js 里，而 index.js 只导出 main，
 *   导致这段安全核心逻辑完全无法单测。第 2 阶段加固前先把它变成可测的纯逻辑模块。
 *
 * 安全要点：
 *   - 授权判定必须基于「签名校验通过的令牌」，绝不能采信请求体里的 callerUsername
 *     之类的自称字段——那等同于不校验。
 *   - 比较签名时先比长度再 timingSafeEqual，因为后者长度不等会抛异常，
 *     而依赖 catch 兜底会把「长度不符」与「签名错误」混为一谈。
 *
 * 回归测试见同目录 session-token.test.js。
 */
const crypto = require('crypto');

/** 令牌有效期 24 小时 */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 合法角色 */
const VALID_ROLES = ['admin', 'recruiter'];

/**
 * 创建一个绑定到指定签名密钥的令牌服务。
 *
 * 采用工厂而非模块级常量，是为了让「密钥」成为显式依赖：
 * 测试可以注入任意密钥，生产代码则在 index.js 里显式读环境变量并校验其存在性，
 * 避免历史上那种 `process.env.X || '硬编码默认串'` 的静默降级（默认串一旦生效，
 * 任何读过源码的人都能伪造令牌）。
 *
 * @param {string} signingKey HMAC 签名密钥，必须非空
 * @param {{ ttlMs?: number }} [options]
 */
function createSessionTokenService(signingKey, options = {}) {
  if (!signingKey || typeof signingKey !== 'string') {
    throw new Error('createSessionTokenService: 签名密钥不能为空');
  }

  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : SESSION_TTL_MS;
  const key = signingKey;

  function sign(payload) {
    return crypto.createHmac('sha256', key).update(payload).digest('base64');
  }

  /**
   * 签发令牌
   * @returns {string} base64(payload).base64(signature)
   */
  function generate(username, role, name, now = Date.now()) {
    const expiry = now + ttlMs;
    const payload = `${username}|${role}|${name}|${expiry}`;
    return `${Buffer.from(payload).toString('base64')}.${sign(payload)}`;
  }

  /**
   * 校验令牌完整性与有效期
   * @returns {{valid: true, username, role, name, expiry} | {valid: false, error: string}}
   */
  function verify(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: '令牌不能为空' };
    }

    try {
      const parts = token.split('.');
      if (parts.length !== 2) {
        return { valid: false, error: '令牌格式无效' };
      }

      const payload = Buffer.from(parts[0], 'base64').toString('utf-8');

      // 严格比对 base64 字符串本身：Buffer.from(x,'base64') 会静默忽略非法字符，
      // 用它比对等于允许在签名后追加垃圾字符，不如按原样比字节
      const provided = Buffer.from(parts[1], 'utf-8');
      const expected = Buffer.from(sign(payload), 'utf-8');

      if (provided.length !== expected.length) {
        return { valid: false, error: '签名不匹配，令牌可能被篡改' };
      }
      if (!crypto.timingSafeEqual(provided, expected)) {
        return { valid: false, error: '签名不匹配，令牌可能被篡改' };
      }

      const fields = payload.split('|');
      if (fields.length !== 4) {
        return { valid: false, error: '令牌载荷格式无效' };
      }

      const [username, role, name, expiryStr] = fields;
      const expiry = parseInt(expiryStr, 10);

      if (!Number.isFinite(expiry)) {
        return { valid: false, error: '令牌载荷格式无效' };
      }
      if (Date.now() > expiry) {
        return { valid: false, error: '令牌已过期，请重新登录' };
      }

      return { valid: true, username, role, name, expiry };
    } catch (err) {
      return { valid: false, error: `令牌解析失败：${err.message}` };
    }
  }

  /**
   * 管理员授权判定：签名有效 + 角色为 admin。
   *
   * 注意：这里的角色取自令牌内的**签发时快照**。调用方还必须回查数据库确认该账号
   * 现在仍然是管理员（账号可能已被删除或降级，而旧令牌尚未过期），
   * 这一步无法在本纯逻辑模块内完成，见 index.js 的 requireAdmin。
   *
   * @returns {{ok: true, username, role, name, expiry} | {ok: false, error: string}}
   */
  function authorizeAdmin(token) {
    const res = verify(token);
    if (!res.valid) {
      return { ok: false, error: res.error };
    }
    if (res.role !== 'admin') {
      return { ok: false, error: '无权限，仅管理员可执行此操作' };
    }
    return { ok: true, username: res.username, role: res.role, name: res.name, expiry: res.expiry };
  }

  /**
   * 「只能操作自己」授权判定：签名有效 + 令牌内用户名与被操作账号一致。
   *
   * 用于修改密码：原实现只凭请求体里的 username + oldPassword 就执行改密，
   * 既不需要令牌也没有失败计数，等于架空了 handleLogin 的「5 次失败锁 15 分钟」——
   * 攻击者改用改密接口即可无限次试密码，且猜中时的返回值会从「旧密码错误」
   * 变为「密码修改成功」，是个完美的密码预言机。要求持有效令牌后该通道即关闭。
   *
   * @returns {{ok: true, username, role, name, expiry} | {ok: false, error: string}}
   */
  function authorizeSelf(token, username) {
    const res = verify(token);
    if (!res.valid) {
      return { ok: false, error: res.error };
    }
    if (!username || res.username !== username) {
      return { ok: false, error: '无权限，只能操作自己的账号' };
    }
    return { ok: true, username: res.username, role: res.role, name: res.name, expiry: res.expiry };
  }

  return { generate, verify, authorizeAdmin, authorizeSelf, ttlMs };
}

/**
 * 常数时间比较两个字符串是否相等。
 *
 * 用于比对部署密钥（seedDefaults 的 bootstrapKey）。
 * 长度不等直接返回 false —— 长度本身不是秘密；
 * 等长时走 timingSafeEqual，避免逐字符提前返回而泄露前缀信息。
 * 注意 timingSafeEqual 在缓冲区长度不等时会抛异常，所以必须先自行判长度，
 * 不能依赖 catch 兜底（那样会把「长度不符」与「内容不符」混为一谈）。
 */
function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;

  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;

  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { createSessionTokenService, timingSafeStringEqual, SESSION_TTL_MS, VALID_ROLES };
