/**
 * access-policy.js — 邮箱配置操作的权限判定（纯逻辑，可单测）
 *
 * 背景（2026-09-14 第 3 阶段加固）：
 *   email-scanner 加固前**所有动作都无鉴权**，公网可调用 createConfig /
 *   updateConfig / deleteConfig / rotateKeys / diagnose / debugInbox。
 *   其中 createConfig 的 userId 直接取自请求体，updateConfig/deleteConfig
 *   只凭一个 id 就改删，等于任何人都能改任何人的收件邮箱配置。
 *
 * 权限模型按「归属」而非「一律管理员」收紧，因为本系统的设计是
 * **每个用户（含专员）管理自己的收件邮箱**：
 *   · 前端 useEmailConfigStore.fetchConfigs 按 currentUsername 取列表
 *   · EmailConfigPage 新建时写 userId: auth.currentUsername
 *   · 侧边栏「邮箱配置」对专员可见（路由未设 requireAdmin）
 * 若粗暴改成仅管理员可操作，会直接废掉专员的正常使用。
 *
 * 因此：
 *   · 配置类动作（create/update/delete/diagnose）→ 只能操作**自己的**
 *   · 一次性迁移与调试工具（rotateKeys/debugInbox）→ 仅管理员
 *   · 扫描范围 → 非管理员强制只扫自己的邮箱
 */

/** 仅管理员可执行的动作：一次性密钥迁移、临时排查工具 */
const ADMIN_ONLY_ACTIONS = ['rotateKeys', 'debugInbox'];

/**
 * 能否操作某条邮箱配置。
 *
 * @param {{username:string, role:string}|null} actor
 * @param {{userId?:string}|null} config 数据库里的配置文档
 * @returns {{allowed: boolean, reason?: string}}
 */
function canManageConfig(actor, config) {
  if (!actor || typeof actor.username !== 'string' || actor.username === '') {
    return { allowed: false, reason: '无权操作该邮箱配置' };
  }
  if (actor.role === 'admin') {
    return { allowed: true };
  }
  if (!config || typeof config !== 'object') {
    return { allowed: false, reason: '邮箱配置不存在' };
  }

  const owner = typeof config.userId === 'string' ? config.userId : '';
  // 归属为空视为无主配置，专员不得认领
  if (owner === '' || owner !== actor.username) {
    return { allowed: false, reason: '无权操作该邮箱配置' };
  }
  return { allowed: true };
}

/**
 * 解析这次扫描实际该扫谁的邮箱。
 *
 * 非管理员**一律只扫自己**，请求体里的 userId 不作数——
 * 否则专员传别人的名字即可让系统去连别人的邮箱。
 *
 * @returns {{ok:true, userId:string} | {ok:false, reason:string}}
 */
function resolveScanUserId(actor, requestedUserId) {
  if (!actor || typeof actor.username !== 'string' || actor.username === '') {
    return { ok: false, reason: '无权执行扫描' };
  }
  if (actor.role === 'admin') {
    // 空串表示"全部邮箱"（定时器与管理员全局扫描的语义）
    const requested = typeof requestedUserId === 'string' ? requestedUserId.trim() : '';
    return { ok: true, userId: requested };
  }
  return { ok: true, userId: actor.username };
}

/**
 * 新建配置时该把配置归给谁。
 * 非管理员只能建自己的；管理员可代建（需显式指定）。
 */
function resolveConfigOwner(actor, requestedUserId) {
  if (!actor || typeof actor.username !== 'string' || actor.username === '') {
    return { ok: false, reason: '无权创建邮箱配置' };
  }
  if (actor.role === 'admin') {
    const requested = typeof requestedUserId === 'string' ? requestedUserId.trim() : '';
    return { ok: true, userId: requested || actor.username };
  }
  return { ok: true, userId: actor.username };
}

/**
 * 该动作是否仅限管理员。
 */
function isAdminOnlyAction(action) {
  return ADMIN_ONLY_ACTIONS.includes(action);
}

module.exports = {
  canManageConfig,
  resolveScanUserId,
  resolveConfigOwner,
  isAdminOnlyAction,
  ADMIN_ONLY_ACTIONS,
};
