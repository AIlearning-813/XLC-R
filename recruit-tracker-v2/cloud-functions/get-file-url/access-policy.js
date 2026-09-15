/**
 * access-policy.js — 「谁能看这份简历」的纯判定逻辑
 *
 * 从 index.js 里抽出来单独成文件，是为了让这段安全核心逻辑能脱离云函数环境单测
 * （index.js 只导出 main，历史上因此无法测试——这正是漏洞长期没被发现的原因之一）。
 *
 * 判定规则刻意与前端 useCandidateStore.fetchById 保持**完全一致**：
 *   1. 管理员放行
 *   2. Candidate.ownerId === 调用者
 *   3. 存在一条 ownerId === 调用者 的 Application 关联该候选人
 * 第 3 条不能省：管理员导入简历后由专员接手是常见流程，
 * 此时 Candidate.ownerId 仍是导入者，只按第 2 条会把正常专员挡在门外。
 *
 * 注意归属**必须取自数据库**。加固前这两个值都由请求体提供并互相比对，
 * 等于没校验。
 *
 * 回归测试见同目录 access-policy.test.js。
 */

/**
 * @param {object} input
 * @param {{username: string, role: string}|null} input.actor 守卫校验后的调用者身份
 * @param {{ownerId?: string}|null} input.candidate 按 fileId 反查到的候选人
 * @param {string[]|null} input.applicationOwnerIds 关联该候选人的 Application 归属人列表
 * @returns {{allowed: boolean, reason?: string}}
 */
function decideFileAccess(input = {}) {
  const { actor, candidate, applicationOwnerIds } = input;

  // 失败关闭：身份缺失一律拒绝
  if (!actor || typeof actor.username !== 'string' || actor.username === '') {
    return { allowed: false, reason: '无权访问该文件' };
  }

  // 文件必须确实对应一条候选人记录，否则无法判定归属 → 拒绝
  if (!candidate || typeof candidate !== 'object') {
    return { allowed: false, reason: '未找到该文件对应的候选人记录' };
  }

  if (actor.role === 'admin') {
    return { allowed: true };
  }

  const ownerId = typeof candidate.ownerId === 'string' ? candidate.ownerId : '';
  if (ownerId !== '' && ownerId === actor.username) {
    return { allowed: true };
  }

  const owners = Array.isArray(applicationOwnerIds) ? applicationOwnerIds : [];
  const hasRelatedApplication = owners.some(
    (o) => typeof o === 'string' && o !== '' && o === actor.username
  );
  if (hasRelatedApplication) {
    return { allowed: true };
  }

  return { allowed: false, reason: '无权访问该文件' };
}

module.exports = { decideFileAccess };
