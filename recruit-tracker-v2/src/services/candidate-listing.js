/**
 * candidate-listing.js — 候选人列表 / 待分配 全量数据服务
 *
 * 背景（修复运维反馈的两类故障）：
 *   1. 候选人「已入库却搜不到」—— 旧逻辑只拉本人最近前 200 条 Application 再内存过滤，
 *      申请量大的账号，更早入库的候选人（含已分配的）被排挤出窗口，列表与搜索都看不到。
 *   2. 候选人「已分配却滞留待分配」—— 同一候选人若同时存在「空 jobId 残留申请」与
 *      「已分配申请」，旧逻辑只取本人前 500 条申请做排除，已分配那条排到窗口外即漏判。
 *
 * 定位：一次性分页拉全当前用户（或 admin=全量）数据，在内存中统一完成
 *       归属判定 / Tab 语义 / 搜索 / 排序 / 分页 —— 所有计算基于全量，从根上消除截断失真。
 *
 * 数据可见性口径（维持现状，不扩大权限）：
 *   - 专员 = 其名下 Application 的 ownerId 对应候选人，另加 Candidate.ownerId==自己的孤儿候选人。
 *   - Admin = 全部数据（不加 ownerId 过滤）。
 *
 * 「已分配 / 待分配」统一语义：
 *   - 候选人存在任一 jobId 非空的申请（含归档/已结束）→ 已分配，绝不出现在待分配。
 *   - 无已分配申请，且存在「空 jobId + active + 未归档」申请，或为孤儿 → 待分配。
 *   - 仅存在「空 jobId 已结束」申请 → 不出现在待分配。
 */

import cloudbase from './cloudbase';

// ===== 分批大小（CloudBase 单次查询约上限 1000，取安全值）=====
export const BATCH_APP = 500;   // Application 分页批
export const BATCH_CAND = 100;  // Candidate $in 批量
export const BATCH_OWNER = 500; // Candidate.ownerId 分页批

/**
 * 分页拉全当前用户的 Application（admin 拉全库）
 * 不过滤 isArchived —— 归档状态由调用方在内存中按语义处理。
 * @param {Object} db - cloudbase.db() 实例
 * @param {Object} opts
 * @param {string|null} opts.ownerId - 专员用户名；admin 传 null
 * @param {boolean} opts.isAdmin
 * @returns {Promise<Array>}
 */
export async function fetchAllApplications(db = cloudbase.db(), { ownerId = null, isAdmin = false } = {}) {
  if (!db) return [];
  let query = db.collection('Application');
  if (!isAdmin && ownerId) query = query.where({ ownerId });

  const all = [];
  let skip = 0;
  for (;;) {
    const { data } = await query.orderBy('_id', 'asc').skip(skip).limit(BATCH_APP).get();
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < BATCH_APP) break;
    skip += BATCH_APP;
  }
  return all;
}

/**
 * 按 id 批量取 Candidate（100/批 + 单条兜底），返回 Map<id, doc>
 * @returns {Promise<Map>}
 */
export async function fetchCandidatesByIds(db, ids) {
  const map = new Map();
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!db || uniq.length === 0) return map;

  for (let i = 0; i < uniq.length; i += BATCH_CAND) {
    const batch = uniq.slice(i, i + BATCH_CAND);
    try {
      const { data } = await db.collection('Candidate')
        .where({ _id: db.command.in(batch) })
        .get();
      for (const c of (data || [])) {
        if (!map.has(c._id)) map.set(c._id, c);
      }
    } catch (err) {
      // 批量失败时逐条降级（与旧列表逻辑一致）
      for (const id of batch) {
        if (map.has(id)) continue;
        try {
          const { data } = await db.collection('Candidate').doc(id).get();
          if (data?.[0]) map.set(id, data[0]);
        } catch { /* skip */ }
      }
    }
  }
  return map;
}

/**
 * 分页拉取 ownerId==当前用户的全部 Candidate（孤儿候选人兜底用）
 * @returns {Promise<Array>}
 */
export async function fetchCandidatesByOwner(db, ownerId) {
  if (!db || !ownerId) return [];
  const all = [];
  let skip = 0;
  for (;;) {
    const { data } = await db.collection('Candidate')
      .where({ ownerId })
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(BATCH_OWNER)
      .get();
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < BATCH_OWNER) break;
    skip += BATCH_OWNER;
  }
  return all;
}

/**
 * 对申请集合建立索引（纯函数）
 * @param {Array} apps
 * @returns {{ byCandidate: Map, assignedCandidateIds: Set, emptyActiveAppByCandidate: Map }}
 *   - byCandidate: candidateId -> Application[]（保持 apps 原顺序）
 *   - assignedCandidateIds: 存在任一 jobId 非空申请的候选人
 *   - emptyActiveAppByCandidate: 未分配且存在「空 jobId+active+未归档」申请的候选人 -> 该申请
 */
export function buildApplicationIndex(apps) {
  const byCandidate = new Map();
  for (const a of (apps || [])) {
    const cid = a && a.candidateId;
    if (!cid) continue;
    if (!byCandidate.has(cid)) byCandidate.set(cid, []);
    byCandidate.get(cid).push(a);
  }

  const assignedCandidateIds = new Set();
  for (const [cid, list] of byCandidate) {
    if (list.some((a) => a.jobId && a.jobId !== '')) assignedCandidateIds.add(cid);
  }

  const emptyActiveAppByCandidate = new Map();
  for (const [cid, list] of byCandidate) {
    if (assignedCandidateIds.has(cid)) continue;
    const activeEmpty = list.find(
      (a) => (!a.jobId || a.jobId === '') && a.status === 'active' && a.isArchived !== true
    );
    if (activeEmpty) emptyActiveAppByCandidate.set(cid, activeEmpty);
  }

  return { byCandidate, assignedCandidateIds, emptyActiveAppByCandidate };
}

/**
 * 按 Tab 语义选出作为"行"的申请（纯函数）
 * tab: 'active' | 'in-progress' | 'ended'
 *   - active / in-progress：status=active、未归档、jobId 非空（in-progress 再排除 resume/onboard 端点）
 *   - ended：status in [rejected, withdrawn]、未归档
 */
export function selectTabApps(apps, tab) {
  if (tab === 'ended') {
    return (apps || []).filter(
      (a) => (a.status === 'rejected' || a.status === 'withdrawn') && a.isArchived !== true
    );
  }
  if (tab === 'active' || tab === 'in-progress') {
    let list = (apps || []).filter(
      (a) => a.status === 'active' && a.isArchived !== true && a.jobId && a.jobId !== ''
    );
    if (tab === 'in-progress') {
      list = list.filter((a) => a.stage !== 'resume' && a.stage !== 'onboard');
    }
    return list;
  }
  return [];
}

/**
 * 收集"待分配候选人"条目（纯函数）——统一判定入口，CandidatesPage 与 PipelinePage 共用。
 * @param {Array} apps - 本人(或全量)申请
 * @param {Object} idx - buildApplicationIndex(apps) 的结果
 * @param {Array} [orphanCandidates] - Candidate.ownerId==本人 的候选人（孤儿兜底，仅专员）
 * @param {Object} opts
 * @returns {Array<{ candidateId:string, app:Object|null, orphan:boolean, candidate?:Object }>}
 */
export function collectUnassignedEntries(apps, idx, orphanCandidates = [], { ownerId = null, isAdmin = false } = {}) {
  const seen = new Set();
  const entries = [];

  // 1) 有空 jobId active 未归档申请、且本人名下无任何已分配申请的候选人
  for (const [cid, app] of idx.emptyActiveAppByCandidate) {
    seen.add(cid);
    entries.push({ candidateId: cid, app, orphan: false });
  }

  // 2) 孤儿候选人：Candidate.ownerId==本人 但本人名下无任何申请引用（仅专员视角）
  if (!isAdmin && ownerId) {
    const referenced = new Set(idx.byCandidate.keys());
    for (const c of (orphanCandidates || [])) {
      if (!c || !c._id) continue;
      if (!referenced.has(c._id) && !seen.has(c._id)) {
        seen.add(c._id);
        entries.push({ candidateId: c._id, app: null, orphan: true, candidate: c });
      }
    }
  }

  return entries;
}

/**
 * 将列表按 updatedAt（回退 createdAt）降序（纯函数，不改原数组）
 */
export function sortByUpdatedDesc(list) {
  return [...(list || [])].sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
}

/**
 * 按行内姓名/电话/邮箱匹配关键词（与旧搜索口径一致：toLowerCase().includes）
 */
export function rowMatch(row, q) {
  const s = (q || '').toLowerCase().trim();
  if (!s) return true;
  return [row && row.name, row && row.phone, row && row.email]
    .some((v) => v != null && String(v).toLowerCase().includes(s));
}

/**
 * 分页切片（纯函数）
 * @returns {{ rows: Array, total: number }}
 */
export function pickPage(list, page = 1, pageSize = 20) {
  const arr = list || [];
  const total = arr.length;
  const start = Math.max(0, (page - 1) * pageSize);
  return { rows: arr.slice(start, start + pageSize), total };
}
