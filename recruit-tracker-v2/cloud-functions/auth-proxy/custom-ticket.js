/**
 * custom-ticket.js — 自定义登录票据签发封装
 *
 * 为什么单独成文件：与 access-policy.js 同理，index.js 只导出 main，
 * 抽出来才能脱离云函数环境单测（历史上正是「无法测试」让安全问题长期潜伏）。
 *
 * 背景：前端此前用「匿名登录」获取 SDK 上下文，CloudBase 数据库安全规则因此
 * 拿不到用户身份（auth.uid 是随机匿名 ID），生产库一度对匿名访客完全开放读写。
 * 登录成功后额外签一张自定义登录票据，前端用它把会话升级为真实身份，
 * 规则即可写成「仅登录用户可读写」。
 *
 * 容错契约（关键）：**任何失败一律返回 null，绝不抛错**。
 * 票据签发依赖控制台已开启自定义登录并配置私钥；未配置时若抛错，
 * 就会把「功能没开启」升级成「所有人都登录不了」。
 *
 * @param {object} authOrApp 云函数的 app 实例（内部会用 app.auth()）或 auth 对象
 * @param {string} username  自定义用户 ID（本系统直接用用户名）
 * @returns {Promise<string|null>} 票据字符串，失败为 null
 */
async function issueCustomTicket(authOrApp, username) {
  if (typeof username !== 'string' || username === '') return null;

  let auth = authOrApp;
  try {
    if (auth && typeof auth.createTicket !== 'function' && typeof auth.auth === 'function') {
      auth = auth.auth();
    }
  } catch {
    return null;
  }

  if (!auth || typeof auth.createTicket !== 'function') return null;

  try {
    const res = await auth.createTicket(username);
    // ⚠️ node-sdk 的 createTicket 返回的是**纯字符串**（形如 keyId/@@/签名），
    // 不是 { ticket } 对象。早期实现只认 res.ticket，于是即便签发成功也返回 null
    // ——「票据签得出来、却永远传不出去」。此处对三种形状都兼容。
    const ticket = typeof res === 'string'
      ? res
      : (res && (res.ticket || (res.data && res.data.ticket)));
    return typeof ticket === 'string' && ticket !== '' ? ticket : null;
  } catch {
    return null;
  }
}

module.exports = { issueCustomTicket };