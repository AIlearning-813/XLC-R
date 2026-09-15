/**
 * access-guard.js — 云函数统一访问守卫
 *
 * 为什么需要它（2026-09-14 第 3 阶段加固）：
 *   加固前三个云函数对公网完全敞开，且各有各的错法——
 *     · get-file-url：candidateOwnerId 与 callerUsername **都取自请求体**，
 *       专员只要把自己名字填进 candidateOwnerId，就能下载存储桶里任意简历。
 *     · report-aggregator：连身份参数都没有，main 直接聚合；
 *       还能通过 params.ownerId 指定看谁的数据。
 *     · email-scanner：createConfig / rotateKeys / debugInbox 等动作全部无鉴权。
 *   与其逐个打补丁，不如把「验令牌 → 回查数据库 → 强制归属」收敛到一处，
 *   新函数直接复用，不再各自发明判定逻辑。
 *
 * 三条不可退让的规则：
 *   1. 角色以**数据库当前值**为准。令牌里的 role 只是签发时快照，
 *      账号被降级或删除后旧令牌不能继续当管理员用。
 *   2. 非管理员的 ownerId **一律强制为本人**，请求体传什么都不作数。
 *   3. 任何异常路径都**失败关闭**——查库出错就拒绝，绝不因异常放行。
 *
 * 部署约定（重要）：
 *   云函数各自独立打包上传，无法跨目录 require。因此本文件与 session-token.js
 *   以「canonical 放 _shared/，各函数目录放副本」的方式分发，
 *   副本由 scripts/sync-shared.cjs 生成，并由 shared-sync.test.js 断言逐字节一致。
 *   **改这里之后必须跑同步脚本**，否则线上各函数行为会不一致。
 *
 * 回归测试见同目录 access-guard.test.js。
 */
const { createSessionTokenService } = require('./session-token');

/** 未通过身份校验（没令牌 / 令牌无效或过期） */
const UNAUTHENTICATED = 'UNAUTHENTICATED';
/** 身份有效但无权限（角色不足 / 账号已变更） */
const FORBIDDEN = 'FORBIDDEN';

/**
 * @param {object} options
 * @param {string} options.signingKey HMAC 签名密钥，必须非空（缺失即拒绝一切）
 * @param {(username: string) => Promise<{username, role, name?}|null>} options.findUser
 *        按用户名回查数据库当前状态；返回 null 表示账号不存在
 */
function createAccessGuard(options = {}) {
  const { signingKey, findUser } = options;

  if (!signingKey || typeof signingKey !== 'string') {
    throw new Error('createAccessGuard: 签名密钥不能为空');
  }
  if (typeof findUser !== 'function') {
    throw new Error('createAccessGuard: 必须注入 findUser 才能回查账号当前状态');
  }

  const sessions = createSessionTokenService(signingKey);

  /**
   * 只验令牌签名与有效期，**不查数据库**。
   * 适用于「登录态够用、不看角色」的场景（如专员提交自己的数据）。
   */
  async function identify(sessionToken) {
    const res = sessions.verify(sessionToken);
    if (!res.valid) {
      return { ok: false, code: UNAUTHENTICATED, error: res.error };
    }
    return { ok: true, username: res.username, role: res.role, name: res.name };
  }

  /**
   * 验令牌 + 回查数据库确认账号仍在、角色以库中为准。
   */
  async function requireUser(sessionToken) {
    const identified = await identify(sessionToken);
    if (!identified.ok) return identified;

    let current;
    try {
      current = await findUser(identified.username);
    } catch (err) {
      // 失败关闭：查不到就拒绝，绝不放行
      console.error('[access-guard] 回查账号失败，按拒绝处理:', err.message);
      return { ok: false, code: FORBIDDEN, error: '无权限，账号校验失败，请稍后重试' };
    }

    if (!current || !current.username) {
      return { ok: false, code: FORBIDDEN, error: '无权限，账号状态已变更，请重新登录' };
    }

    return {
      ok: true,
      username: current.username,
      // 角色取数据库当前值，不采信令牌里的签发时快照
      role: current.role,
      name: current.name || identified.name,
    };
  }

  /**
   * 管理员判定：令牌有效 + 数据库当前角色为 admin。
   */
  async function requireAdmin(sessionToken) {
    const actor = await requireUser(sessionToken);
    if (!actor.ok) return actor;
    if (actor.role !== 'admin') {
      return { ok: false, code: FORBIDDEN, error: '无权限，仅管理员可执行此操作' };
    }
    return actor;
  }

  /**
   * 归属过滤：决定这次查询实际能看谁的数据。
   *
   * 管理员传谁看谁（不传=全部）；非管理员**一律返回本人**，
   * 无论请求体里写了什么——这是越权取数的唯一封堵点。
   *
   * @returns {{ok:true, ownerId:string} | {ok:false, code:string, error:string}}
   */
  function ownerFilterFor(actor, requestedOwnerId) {
    if (!actor || !actor.username) {
      return { ok: false, code: FORBIDDEN, error: '无权限，缺少调用者身份' };
    }
    if (actor.role === 'admin') {
      // 只有管理员能"不指定"，空串对上层表示"全部"
      const requested = typeof requestedOwnerId === 'string' ? requestedOwnerId.trim() : '';
      return { ok: true, ownerId: requested };
    }
    return { ok: true, ownerId: actor.username };
  }

  return { identify, requireUser, requireAdmin, ownerFilterFor };
}

/**
 * 把守卫的失败结果转成云函数统一的返回体。
 */
function guardError(result) {
  return {
    success: false,
    error: result.error,
    code: result.code,
  };
}

module.exports = { createAccessGuard, guardError, UNAUTHENTICATED, FORBIDDEN };
