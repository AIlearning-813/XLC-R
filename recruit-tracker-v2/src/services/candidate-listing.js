/**
 * candidate-listing.js — 候选人列表 / 待分配 全量数据服务
 *
 * 背景（修复运维反馈的两类故障）：
 *   1. 候选人「已入库却搜不到」—— 旧逻辑只拉本人最近前 200 条 Application 再内存过滤，
 *      申请量大的账号，更早入库的候选人（含已分配的）被排挤出窗口，列表与搜索都看不到。
 *   2. 候选人「已分配却滞留待分配」—— 同一候选人若同时存在「空 jobId 残留申请」与
 *      「已分配申请」，旧逻辑只取本人前 500 条申请做排除，已分配那条排到窗口外即漏判。
 *   3. 候选人「搜不到」但查重又说已存在 —— 搜索只在当前 Tab 内进行，邮箱归集来的候选人
 *      （jobId 为空）只落在「待分配」Tab，用户在默认的「活跃候选人」Tab 里怎么搜都没有；
 *      而重复检测是查全库的，两边口径不一致。现已改为：有搜索词时跨 Tab 合并搜索并标注来源 Tab。
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

// 分批拉取时的并发度。取 6 是在「等待时间」与「云环境 QPS / 连接数」之间的折中：
// 再高收益递减，且个人版环境可能限流。
export const BATCH_CONCURRENCY = 6;

// count() 推断批数的合理上限（200 批 ≈ 10 万条）。
// 超过即认为 count 返回值不可信（API 抖动 / 规则异常），回退串行探测，
// 避免异常大的 count 引发并发请求风暴。
export const MAX_BATCHES = 200;

/**
 * 限流并发执行（并发池），结果顺序与入参一致（纯工具函数）。
 * 用于把「一批批串行等待」改成「一批批并发发出」——总请求数不变，等待轮次大幅减少。
 * @param {Array} items
 * @param {number} limit - 最大并发数
 * @param {Function} fn - (item, index) => Promise
 * @returns {Promise<Array>}
 */
export async function mapLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  if (list.length === 0) return out;

  let cursor = 0;
  const width = Math.max(1, Math.min(limit || 1, list.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 分页拉全当前用户的 Application（admin 拉全库）
 * 不过滤 isArchived —— 归档状态由调用方在内存中按语义处理。
 *
 * D-1 改造：批次由「串行等待」改为「并发发出」。
 *   - 小账号（不足一批）：仍是 1 次请求，与改造前一致；
 *   - 大账号：首批探测 + count 定总批数 + 余下批次并发。
 *   - count 不可用时回退为逐批串行探测，功能不退化。
 * 每次批次都重建查询链，避免复用同一个 query 对象在并发下互相覆盖条件。
 *
 * @param {Object} db - cloudbase.db() 实例
 * @param {Object} opts
 * @param {string|null} opts.ownerId - 专员用户名；admin 传 null
 * @param {boolean} opts.isAdmin
 * @returns {Promise<Array>}
 */
export async function fetchAllApplications(db = cloudbase.db(), { ownerId = null, isAdmin = false } = {}) {
  if (!db) return [];

  const buildQuery = () => {
    let q = db.collection('Application');
    if (!isAdmin && ownerId) q = q.where({ ownerId });
    return q.orderBy('_id', 'asc');
  };
  const fetchBatch = async (skip) => {
    const { data } = await buildQuery().skip(skip).limit(BATCH_APP).get();
    return data || [];
  };

  // 首批兼作「是否还有后续」的探针：不足一批即结束，小账号 1 次请求搞定。
  const firstChunk = await fetchBatch(0);
  const all = [...firstChunk];
  if (firstChunk.length < BATCH_APP) return all;

  let total = null;
  try {
    const countQuery = isAdmin
      ? db.collection('Application')
      : db.collection('Application').where({ ownerId });
    const c = await countQuery.count();
    if (c && typeof c.total === 'number') total = c.total;
  } catch { /* 回退串行 */ }

  if (total === null || !Number.isFinite(total) || total < 0 || Math.ceil(total / BATCH_APP) > MAX_BATCHES) {
    let skip = BATCH_APP;
    for (;;) {
      const chunk = await fetchBatch(skip);
      all.push(...chunk);
      if (chunk.length < BATCH_APP) break;
      skip += BATCH_APP;
    }
    return all;
  }

  const batchCount = Math.ceil(total / BATCH_APP);
  const starts = [];
  for (let i = 1; i < batchCount; i++) starts.push(i * BATCH_APP);
  const chunks = starts.length
    ? await mapLimit(starts, BATCH_CONCURRENCY, (skip) => fetchBatch(skip))
    : [];
  for (const chunk of chunks) all.push(...chunk);

  // 收尾兜底 —— 这段是「取全不截断」契约的保险丝，不可删：
  // count() 在 CloudBase 上可能被安全规则静默过滤而偏小，查询期间数据也可能新增，
  // 两种情况都会让上面推断的批数偏少。只要「最后一批仍是满的」，就说明后面可能还有，
  // 继续串行拉直到出现不足批。正常情况最后一批不满 500，这里一次额外请求都不会发。
  let skip = Math.max(batchCount * BATCH_APP, BATCH_APP);
  let tail = chunks.length ? chunks[chunks.length - 1] : firstChunk;
  while (tail.length === BATCH_APP) {
    const chunk = await fetchBatch(skip);
    all.push(...chunk);
    tail = chunk;
    if (chunk.length < BATCH_APP) break;
    skip += BATCH_APP;
  }
  return all;
}

/**
 * 按 id 批量取 Candidate（100/批 + 单条兜底），返回 Map<id, doc>
 *
 * D-1 改造：批次并发发出（原为串行 for 循环）。
 * 写入仍按批次原顺序进行，且 id 已去重，故「同一 id 取首次出现」的语义不变。
 * @returns {Promise<Map>}
 */
export async function fetchCandidatesByIds(db, ids) {
  const map = new Map();
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!db || uniq.length === 0) return map;

  const batches = [];
  for (let i = 0; i < uniq.length; i += BATCH_CAND) batches.push(uniq.slice(i, i + BATCH_CAND));

  const results = await mapLimit(batches, BATCH_CONCURRENCY, async (batch) => {
    try {
      const { data } = await db.collection('Candidate')
        .where({ _id: db.command.in(batch) })
        .get();
      return { batch, data: data || [], failed: false };
    } catch {
      return { batch, data: [], failed: true };
    }
  });

  const failedBatches = [];
  for (const r of results) {
    if (r.failed) { failedBatches.push(r.batch); continue; }
    for (const c of r.data) {
      if (!map.has(c._id)) map.set(c._id, c);
    }
  }

  // 批量失败时逐条降级（与旧列表逻辑一致）
  for (const batch of failedBatches) {
    for (const id of batch) {
      if (map.has(id)) continue;
      try {
        const { data } = await db.collection('Candidate').doc(id).get();
        if (data?.[0]) map.set(id, data[0]);
      } catch { /* skip */ }
    }
  }
  return map;
}

/**
 * 分页拉取 ownerId==当前用户的全部 Candidate（孤儿候选人兜底用）
 *
 * D-1 改造：与 fetchAllApplications 同法 —— 首批探测，其余并发。
 * @returns {Promise<Array>}
 */
export async function fetchCandidatesByOwner(db, ownerId) {
  if (!db || !ownerId) return [];

  const buildQuery = () => db.collection('Candidate').where({ ownerId }).orderBy('_id', 'asc');
  const fetchBatch = async (skip) => {
    const { data } = await buildQuery().skip(skip).limit(BATCH_OWNER).get();
    return data || [];
  };

  const firstChunk = await fetchBatch(0);
  const all = [...firstChunk];
  if (firstChunk.length < BATCH_OWNER) return all;

  let total = null;
  try {
    const c = await db.collection('Candidate').where({ ownerId }).count();
    if (c && typeof c.total === 'number') total = c.total;
  } catch { /* 回退串行 */ }

  if (total === null || !Number.isFinite(total) || total < 0 || Math.ceil(total / BATCH_OWNER) > MAX_BATCHES) {
    let skip = BATCH_OWNER;
    for (;;) {
      const chunk = await fetchBatch(skip);
      all.push(...chunk);
      if (chunk.length < BATCH_OWNER) break;
      skip += BATCH_OWNER;
    }
    return all;
  }

  const batchCount = Math.ceil(total / BATCH_OWNER);
  const starts = [];
  for (let i = 1; i < batchCount; i++) starts.push(i * BATCH_OWNER);
  const chunks = starts.length
    ? await mapLimit(starts, BATCH_CONCURRENCY, (skip) => fetchBatch(skip))
    : [];
  for (const chunk of chunks) all.push(...chunk);

  // 收尾兜底：同 fetchAllApplications —— count 偏小时靠「最后一批是否满」续拉，保证不截断。
  let skip = Math.max(batchCount * BATCH_OWNER, BATCH_OWNER);
  let tail = chunks.length ? chunks[chunks.length - 1] : firstChunk;
  while (tail.length === BATCH_OWNER) {
    const chunk = await fetchBatch(skip);
    all.push(...chunk);
    tail = chunk;
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

// ===================== 跨 Tab 搜索 + 角标计数（A / B） =====================

/**
 * 跨 Tab 搜索时纳入的 Tab 集合。
 * 有意不并入 'in-progress' —— 它是 'active' 的子集（selectTabApps 里 in-progress 只是再排除
 * resume/onboard 两端），并入会让同一份 Application 在结果中出现两次。
 */
export const SEARCH_TABS = ['active', 'ended', 'unassigned'];

/**
 * 给每行打上来源 Tab 标记（纯函数，不改原数组）
 * href: <td> 与非搜索模式共用一个表格组件，靠 sourceTab 决定行内操作（如"重新激活"）
 * @returns {Array} 每行新增 sourceTab 字段
 */
export function tagRows(rows, tab) {
  return (rows || []).map((r) => ({ ...r, sourceTab: tab }));
}

/**
 * 四个 Tab 各自的条数（纯函数）—— 用于 Tab 角标常显。
 * 口径是"未叠加筛选条件的积压量"，因此在有筛选时也不变，便于用户判断积压规模。
 * @param {Array} apps - 本人(或全量)申请
 * @param {Array} unassignedEntries - collectUnassignedEntries 的结果
 * @returns {{ active:number, 'in-progress':number, unassigned:number, ended:number }}
 */
export function countByTab(apps, unassignedEntries) {
  return {
    active: selectTabApps(apps, 'active').length,
    'in-progress': selectTabApps(apps, 'in-progress').length,
    unassigned: (unassignedEntries || []).length,
    ended: selectTabApps(apps, 'ended').length,
  };
}

/**
 * 按 _id 去重并保持首次出现顺序（纯函数）
 * 跨 Tab 合并时的防御：待分配行 _id = appId || candidateId，孤儿行 _id = candidateId，
 * 普通行 _id = appId，理论上不重叠，但仍做一次兜底。
 */
export function dedupeById(rows) {
  const seen = new Set();
  const out = [];
  for (const r of (rows || [])) {
    if (!r || seen.has(r._id)) continue;
    seen.add(r._id);
    out.push(r);
  }
  return out;
}

/**
 * 对申请列表套用非搜索类筛选条件（纯函数）
 * 注意：日期按 createdAt 比较，dateTo 取当天 23:59:59.999
 */
export function applyAppFilters(appList, filters = {}) {
  let list = appList || [];
  if (filters.stage) {
    list = list.filter((a) => a.stage === filters.stage);
  }
  if (filters.jobId) {
    list = list.filter((a) => a.jobId === filters.jobId);
  }
  if (filters.source) {
    list = list.filter((a) => (a.funnelMeta?.entrySource || '') === filters.source);
  }
  if (filters.dateFrom) {
    const t = new Date(filters.dateFrom).getTime();
    list = list.filter((a) => new Date(a.createdAt).getTime() >= t);
  }
  if (filters.dateTo) {
    const d = new Date(filters.dateTo);
    d.setHours(23, 59, 59, 999);
    const t = d.getTime();
    list = list.filter((a) => new Date(a.createdAt).getTime() <= t);
  }
  return list;
}

/**
 * 把已分配的申请装配成列表行（纯函数）
 * 行字段形状与重构前完全一致，避免牵连 CandidateTable / 详情跳转 / 弹窗。
 * @param {Array} appList - 已筛选排序的 Application[]
 * @param {Map} candidatesMap - candidateId -> Candidate
 * @param {Object} jobsMap - jobId -> Job
 */
export function buildApplicationRows(appList, candidatesMap, jobsMap = {}) {
  return (appList || []).map((app) => {
    const candidate = candidatesMap.get(app.candidateId) || {};
    const job = jobsMap[app.jobId] || {};

    return {
      _id: app._id,
      appId: app._id,
      candidateId: app.candidateId,
      name: candidate.name,
      phone: candidate.phone,
      email: candidate.email,
      expectedPosition: candidate.expectedPosition,
      sourceEmailSubject: candidate.sourceEmailSubject || '',
      jobTitle: job.title || job.name,
      jobName: job.title || job.name,
      jobId: app.jobId,
      stage: app.stage,
      source: app.funnelMeta?.entrySource || candidate.source,
      status: app.status,
      ownerId: candidate.ownerId || app.ownerId,
      createdBy: candidate.createdBy,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      _candidate: candidate,
      _application: app,
      _job: job,
    };
  });
}

/**
 * 把待分配条目装配成列表行（纯函数）
 * 待分配行没有已分配岗位，故 jobTitle/jobName/jobId 恒为空、status 恒为 'unassigned'。
 * @param {Array} entries - collectUnassignedEntries 的结果
 * @param {Map} candidatesMap - candidateId -> Candidate（孤儿条目自带 candidate，无需查）
 * @param {Object} opts
 * @param {string|null} opts.ownerId
 */
export function buildUnassignedRows(entries, candidatesMap, { ownerId = null } = {}) {
  return (entries || []).map((e) => {
    const c = e.orphan ? e.candidate : (candidatesMap.get(e.candidateId) || {});
    const cid = c._id || e.candidateId;
    const joblessApp = e.app || null;

    return {
      _id: joblessApp?._id || cid,
      candidateId: cid,
      appId: joblessApp?._id || '',
      name: c.name,
      phone: c.phone,
      email: c.email,
      sourceEmailSubject: c.sourceEmailSubject || '',
      expectedPosition: c.expectedPosition || '',
      jobTitle: '',
      jobName: '',
      jobId: '',
      stage: joblessApp?.stage || '',
      source: joblessApp?.funnelMeta?.entrySource || c.source || 'email',
      status: 'unassigned',
      ownerId: c.ownerId || ownerId || '',
      createdBy: c.createdBy,
      createdAt: joblessApp?.createdAt || c.createdAt,
      updatedAt: c.updatedAt,
      _candidate: c,
      _application: joblessApp,
      _job: null,
    };
  });
}

/**
 * 装配单个 Tab 的行集（内部函数，含 DB 取数）
 * @param {Object} ctx - { apps, unassignedEntries, ownerId, filters, jobsLookup }
 */
async function buildRowsForTab(db, tabName, ctx) {
  const { apps, unassignedEntries, ownerId, filters = {}, jobsLookup = null } = ctx;

  // 待分配：保持原有语义 —— 只认搜索词，忽略 stage/jobId/source/date
  if (tabName === 'unassigned') {
    const needIds = unassignedEntries.filter((e) => !e.orphan).map((e) => e.candidateId);
    const candidatesMap = await fetchCandidatesByIds(db, needIds);
    return tagRows(buildUnassignedRows(unassignedEntries, candidatesMap, { ownerId }), 'unassigned');
  }

  const appList = applyAppFilters(selectTabApps(apps, tabName), filters);

  const candidateIds = [...new Set(appList.map((a) => a.candidateId).filter(Boolean))];
  const candidatesMap = await fetchCandidatesByIds(db, candidateIds);

  const jobIds = [...new Set(appList.map((a) => a.jobId).filter(Boolean))];
  const jobsMap = {};
  for (const jobId of jobIds) {
    const job = jobsLookup ? jobsLookup(jobId) : null;
    if (job) jobsMap[jobId] = job;
  }

  return tagRows(buildApplicationRows(appList, candidatesMap, jobsMap), tabName);
}

/**
 * 装配「已分配类」Tab 的行（active / in-progress / ended）—— 候选人只按「当前页」取。
 *
 * 为什么可以提前分页（这是 D-1 的正确性前提，改动前必须逐条核对）：
 *   1. 筛选链路（selectTabApps + applyAppFilters）只读 Application 自身字段，与候选人无关；
 *   2. 行的排序键 row.updatedAt === app.updatedAt，回退键 createdAt 同理（见 buildApplicationRows），
 *      故对 appList 排序与对装配后的行排序结果一致；
 *   3. 综上，「先排序取当页 → 再查这些行的候选人」与
 *      「先查全部候选人 → 装配成行 → 再排序取当页」得到的行集与顺序一致。
 *
 * 不适用（仍在 loadWorkspace 走全量装配）：
 *   - 搜索：要按候选人姓名/电话/邮箱匹配，必须拿到候选人才能过滤；
 *   - 待分配 Tab：行按 Candidate.updatedAt 排序，必须拿到候选人才知道顺序。
 */
async function buildPagedApplicationRows(db, tabName, { apps, filters = {}, jobsLookup = null, page = 1, pageSize = 20 }) {
  const appList = applyAppFilters(selectTabApps(apps, tabName), filters);
  const { rows: pageApps, total } = pickPage(sortByUpdatedDesc(appList), page, pageSize);

  const candidatesMap = await fetchCandidatesByIds(
    db,
    [...new Set(pageApps.map((a) => a.candidateId).filter(Boolean))]
  );

  const jobsMap = {};
  for (const jobId of [...new Set(pageApps.map((a) => a.jobId).filter(Boolean))]) {
    const job = jobsLookup ? jobsLookup(jobId) : null;
    if (job) jobsMap[jobId] = job;
  }

  return { rows: tagRows(buildApplicationRows(pageApps, candidatesMap, jobsMap), tabName), total };
}

/**
 * 候选人工作区统一加载入口 —— **D-1 的全量装配路径**，自 D-2 起作为
 * 下推路径的降级兜底与「结果对照基准」（oracle）保留。
 *
 * D-2 改造只是把它整体下沉为 legacy，内部逻辑逐字未动：
 * 全量拉 Application（+ 专员孤儿候选人）后，在内存里完成归属判定 / Tab 语义 /
 * 搜索 / 排序 / 分页。它永远正确，只是数据量大时慢（这正是 D-2 要解决的）。
 *
 * 行为约定：
 *   - 有搜索词 → 跨 active / ended / unassigned 三个 Tab 合并搜索，每行带 sourceTab
 *     （修复"待分配的候选人在活跃 Tab 永远搜不到"）
 *   - 无搜索词 → 只构建当前 Tab，行集与排序与重构前逐条一致
 *   - 非搜索类筛选（stage/jobId/source/date）仅在「当前 Tab」上生效，保持原语义
 *
 * @param {Object} db - cloudbase.db() 实例
 * @param {Object} options
 * @param {string|null} options.ownerId
 * @param {boolean} options.isAdmin
 * @param {string} options.tab - 'active'|'in-progress'|'unassigned'|'ended'
 * @param {Object} options.filters - { search, stage, jobId, source, dateFrom, dateTo }
 * @param {number} options.page
 * @param {number} options.pageSize
 * @param {Function|null} options.jobsLookup - jobId -> Job（由页面注入 jobStore）
 * @returns {Promise<{ rows: Array, total: number, tabCounts: Object }>}
 */
export async function loadWorkspaceLegacy(db, options = {}) {
  const {
    ownerId = null,
    isAdmin = false,
    tab = 'active',
    filters = {},
    page = 1,
    pageSize = 20,
    jobsLookup = null,
  } = options;

  // 两个分页拉取互相独立，并发执行以缩短首屏等待（数据量大的账号收益明显）
  const [apps, orphanCandidates] = await Promise.all([
    fetchAllApplications(db, { ownerId, isAdmin }),
    // 孤儿候选人兜底（专员：Candidate.ownerId==me 且本人名下无申请引用）
    // 角标计数依赖它，因此在所有 Tab 下都要取，不能只给待分配 Tab 用
    (!isAdmin && ownerId) ? fetchCandidatesByOwner(db, ownerId) : Promise.resolve([]),
  ]);
  const idx = buildApplicationIndex(apps);

  const unassignedEntries = collectUnassignedEntries(apps, idx, orphanCandidates, { ownerId, isAdmin });
  const tabCounts = countByTab(apps, unassignedEntries);

  const q = (filters.search || '').trim();
  const ctx = { apps, unassignedEntries, ownerId, jobsLookup };

  // 搜索：要按候选人姓名/电话/邮箱匹配，必须拿到候选人才过滤 → 保持全量装配
  if (q) {
    const parts = [];
    for (const t of SEARCH_TABS) {
      // 非搜索类筛选只作用于当前 Tab，其他 Tab 保持全量参与搜索
      const tabFilters = t === tab ? filters : {};
      parts.push(await buildRowsForTab(db, t, { ...ctx, filters: tabFilters }));
    }
    const matched = sortByUpdatedDesc(dedupeById(parts.flat()))
      .filter((row) => rowMatch(row, q));
    const paged = pickPage(matched, page, pageSize);
    return { rows: paged.rows, total: paged.total, tabCounts };
  }

  // 待分配 Tab：行按 Candidate.updatedAt 排序，须先拿到候选人才能定序 → 保持全量装配
  if (tab === 'unassigned') {
    const sorted = sortByUpdatedDesc(await buildRowsForTab(db, tab, { ...ctx, filters }));
    const paged = pickPage(sorted, page, pageSize);
    return { rows: paged.rows, total: paged.total, tabCounts };
  }

  // 已分配类 Tab（active / in-progress / ended）：筛选与排序都只依赖 Application，
  // 故提前分页，候选人只查当页 —— 首屏 Candidate 请求数从「整个 Tab 分批」降为 1 次。
  const paged = await buildPagedApplicationRows(db, tab, { apps, filters, jobsLookup, page, pageSize });
  return { rows: paged.rows, total: paged.total, tabCounts };
}

// ===========================================================================
// D-2：把筛选 / 排序 / 分页 / 角标整体下推到数据库
//
// D-1 已经把「三个已分配 Tab」改成「先分页再取当页候选人」，但 loadWorkspace 仍在
// 分派分支前**无条件全量拉取**——因为三件事当时都依赖完整数据集：
//   1. collectUnassignedEntries（待分配判定）
//   2. countByTab（四个角标）
//   3. buildPagedApplicationRows 的输入 apps
// 后果：默认落地页只显示 20 行，却要把全库 4900+ 条申请（约 2MB）拉下来。
//
// 本段把这三件事一并下推，只在搜索 / 待分配两个分支保留 legacy 全量装配。
//
// 正确性前提（每条都有对应的判定矩阵单测守着，改动前务必先跑）：
//   a. 三个 Tab 的谓词只读 Application 自身字段，与 Candidate 无关；
//   b. 行的排序键 row.updatedAt === app.updatedAt，故「先按申请排序取当页」与
//      「先装配成行再排序取当页」结果一致；
//   c. 谓词的 MongoDB 形态与 JS 形态逐条等价（见 tabPredicate 注释里的实测依据）。
//
// ⚠️ 已知且**已实测为零**的一处差异（保留兜底，勿删）：
//   legacy 的排序键是 `updatedAt || createdAt`，下推只能按 `updatedAt` 排。
//   生产环境 4916 条申请中 `updatedAt` 缺失数为 **0**，故两者等价。
//   为防这个前提将来被破坏，fetchTabPage 会对当页做一次排序键完整性检查，
//   一旦发现缺失就抛错降级到 legacy（见 SORT_KEY 相关代码）。
// ===========================================================================

/** 走「已分配类」下推的三个 Tab（unassigned 与搜索不走） */
export const ASSIGNED_TABS = ['active', 'in-progress', 'ended'];

/** 孤儿项实算时，`$in` 分块的批大小 */
export const ORPHAN_REF_CHUNK = 500;

// 一行回滚开关：环境变量 VITE_LIST_PUSHDOWN=false 即整体退回 D-1 的全量装配路径。
// 另有一个「熔断」标记，在一致性守卫判定角标不可信后置位，避免每次首屏都白跑一轮。
const ENV_PUSHDOWN = (import.meta && import.meta.env && import.meta.env.VITE_LIST_PUSHDOWN) || '';
let pushdownDisabled = ENV_PUSHDOWN === 'false';
let pushdownBroken = false;

/** 测试/运维用：强制开关下推路径 */
export function __setListPushdownEnabled(on) {
  pushdownDisabled = !on;
  pushdownBroken = false;
}

/** 测试用：复位熔断标记 */
export function __resetListPushdown() {
  pushdownBroken = false;
}

function isPushdownEnabled() {
  return !pushdownDisabled && !pushdownBroken;
}

/**
 * 下推路径「不可信」时抛出 —— 调用方据此整条降级到 legacy。
 * 带 reason 是为了让日志说清到底是哪一条不变量被破坏（排查时不必猜）。
 */
export class ListPushdownUnavailableError extends Error {
  constructor(reason) {
    super(`列表下推不可用：${reason}`);
    this.name = 'ListPushdownUnavailableError';
    this.reason = reason;
  }
}

// ---------- 谓词构造（纯函数，可直接单测） ----------

/**
 * 单个 Tab 的谓词（**不含** ownerId 与非搜索类筛选）。
 *
 * 与 selectTabApps 的 JS 形态逐条等价，依据是生产库实测：
 *   - `{isArchived:{$ne:true}}` 匹配「缺字段」——4903 = 4916 − 13，与 `isArchived !== true` 等价
 *   - `{jobId:{$nin:[null,'']}}` 等价于 `jobId && jobId !== ''`：
 *     空串 2713 + 非空 2203 = 4916，`null` 必须带上，否则缺字段会被误收进结果
 *   - `$nin` 数组里**不含** null 时，缺字段可命中 → `stage $nin ['resume','onboard']`
 *     正好对应 `stage !== 'resume' && stage !== 'onboard'`
 */
export function tabPredicate(db, tab) {
  if (tab === 'ended') {
    return {
      status: db.command.in(['rejected', 'withdrawn']),
      isArchived: db.command.neq(true),
    };
  }
  if (tab === 'active' || tab === 'in-progress') {
    const cond = {
      status: 'active',
      isArchived: db.command.neq(true),
      jobId: db.command.nin([null, '']),
    };
    if (tab === 'in-progress') cond.stage = db.command.nin(['resume', 'onboard']);
    return cond;
  }
  return {};
}

/**
 * 非搜索类筛选条件，返回**条件片段数组**（而非合并后的对象）。
 *
 * 之所以返回数组：dateFrom 与 dateTo 落在同一个 `createdAt` 字段上，
 * 合并进一个对象会互相覆盖，必须作为并列条件交给 `$and`。
 *
 * 日期处理与 applyAppFilters 严格对齐：
 *   - dateFrom 直接用 `new Date(filters.dateFrom)`（与 JS 侧 `.getTime()` 同源）
 *   - dateTo 必须复用 `setHours(23,59,59,999)` 的**本地时区**语义。
 *     若图省事传字符串，`new Date('2026-03-05')` 是 UTC 零点，会与本地口径差 8 小时。
 */
export function buildAppFilterParts(db, filters = {}) {
  const parts = [];
  const plain = {};
  if (filters.stage) plain.stage = filters.stage;
  if (filters.jobId) plain.jobId = filters.jobId;
  if (filters.source) plain['funnelMeta.entrySource'] = filters.source;
  if (Object.keys(plain).length > 0) parts.push(plain);

  if (filters.dateFrom) {
    parts.push({ createdAt: db.command.gte(new Date(filters.dateFrom)) });
  }
  if (filters.dateTo) {
    const d = new Date(filters.dateTo);
    d.setHours(23, 59, 59, 999);
    parts.push({ createdAt: db.command.lte(d) });
  }
  return parts;
}

/**
 * 把条件片段组装成一次 where 能接受的条件对象。
 *
 * 由于 `where()` 是**替换**而非合并语义，同一次调用里必须把所有条件一次性给全；
 * 而同一次 where 的各键之间是隐式 AND，所以能并进同一个对象的就并进去。
 *
 * **同键冲突必须另起并列项**：`dateFrom` 与 `dateTo` 都落在 `createdAt` 上，
 * 若直接 `Object.assign` 后者会覆盖前者（区间变成单边），故改用 `$and` 并列。
 */
export function assembleWhere(db, parts) {
  const plain = {};
  const list = [];
  for (const p of parts || []) {
    if (!p) continue;
    if (p.__command) { list.push(p); continue; }
    const keys = Object.keys(p);
    if (keys.length === 0) continue;
    if (keys.some((k) => k in plain)) { list.push(p); continue; } // 同键 → 不能被合并吞掉
    Object.assign(plain, p);
  }
  if (Object.keys(plain).length > 0) list.unshift(plain);
  if (list.length === 0) return {};
  if (list.length === 1) return list[0];
  return db.command.and(list);
}

/** 某个 Tab 的完整查询条件（Tab 谓词 + 非搜索筛选 + ownerId 作用域） */
export function buildTabWhere(db, tab, { ownerId = null, isAdmin = false, filters = {} } = {}) {
  const parts = [tabPredicate(db, tab), ...buildAppFilterParts(db, filters)];
  // 非 admin 一律显式带 ownerId，**绝不依赖安全规则做作用域**：
  // 规则被静默绕过时最坏是「数值不对」而不是「越权读到别人的数据」，
  // 且随后的一致性守卫会把它拦下来降级。
  if (!isAdmin && ownerId) parts.unshift({ ownerId });
  return assembleWhere(db, parts);
}

/**
 * total 的单调修复（纯函数）。
 *
 * 存在的理由：CloudBase 的安全规则会**静默过滤**，count() 可能偏小；
 * 而查询期间数据也在增长。既然当页确实取回了 rowCount 条，总数就至少是 start + rowCount。
 *
 * 关键：**只在取到行时才向上修复**。若无条件 Math.max，
 * 越界页（rowCount=0，start 很大）会把 total 顶成 start，破坏「页码越界时 total 仍为全量条数」
 * 的既有契约（candidate-listing.perf.test.js 有一条用例专门守着它）。
 */
export function repairTotal(counted, page, pageSize, rowCount) {
  const start = Math.max(0, (page - 1) * pageSize);
  if (!Number.isFinite(counted) || counted < 0) return start + rowCount;
  return rowCount > 0 ? Math.max(counted, start + rowCount) : counted;
}

// ---------- 待分配角标：|E| + 真实孤儿数 ----------

/**
 * 待分配聚合的分组规格。
 *
 * 只用 $ifNull / $eq / $and / $cond / $max 五个运算符，有意绕开 $ne：
 * 真实 SDK 的 `db.command.aggregate` 暴露的是 `neq`（产出 `$neq`），
 * 而 MongoDB 聚合认识的是 `$ne`，这个不确定地带不值得赌。
 * 「非空」改用 `$cond($eq(...,''), 0, 1)` 表达，「未归档」用 `$ifNull(isArchived,false) === false`。
 */
function unassignedGroupSpec(db) {
  const A = db.command.aggregate;
  const ifNull = (field, fallback) => A.ifNull([field, fallback]);
  const eq = (a, b) => A.eq([a, b]);
  return {
    _id: '$candidateId',
    // jobId 非空（含缺失/空串/null 之外的一切）→ 该候选人「已分配」
    hasAssigned: A.max(A.cond([eq(ifNull('$jobId', ''), ''), 0, 1])),
    // 存在「空 jobId 且 active 且未归档」的申请 → 候选待分配
    hasEmptyActive: A.max(
      A.cond(
        [
          A.and([
            eq(ifNull('$jobId', ''), ''),
            eq(ifNull('$status', ''), 'active'),
            eq(ifNull('$isArchived', false), false),
          ]),
          1,
          0,
        ]
      )
    ),
  };
}

/** 把申请按 candidateId 归并，返回每人的两个标志位（专员视角带 ownerId 作用域） */
export async function groupApplicationsByCandidate(db, ownerId = null) {
  const agg = db.collection('Application').aggregate();
  if (ownerId) agg.match({ ownerId });
  agg.group(unassignedGroupSpec(db));
  const { data } = await agg.end();
  return data || [];
}

/**
 * |E| = 「有空 jobId 活跃申请、且名下无任何已分配申请」的候选人数（admin 视角的待分配角标）。
 * 分组后直接 $match + $count，全在服务端完成，只回 1 行。
 */
export async function countEmptyActiveCandidates(db) {
  const agg = db.collection('Application').aggregate();
  agg.group(unassignedGroupSpec(db));
  agg.match({ hasAssigned: 0, hasEmptyActive: 1 });
  agg.count('n');
  const { data } = await agg.end();
  return (data && data[0] && data[0].n) || 0;
}

/**
 * 孤儿候选人数 = |C_me| − |C_me ∩ R|
 *   C_me = Candidate.ownerId == me 的候选人
 *   R    = 本人名下申请引用到的 candidateId 集合
 *
 * 为什么不能用近似值：真实存在「申请创建失败 → 回滚删除 Candidate 也失败」的路径
 * （useCandidateStore 里会打印「回滚删除 Candidate 失败（需手动清理）」），
 * 此时候选人留在库里但没有任何申请引用它——按旧逻辑它必须出现在待分配列表里。
 * 用户明确选择「精确优先」，故这里多花 1 + ceil(|R|/500) 次请求实算。
 *
 * 另注：handover 移交只改 Application.ownerId、**不动 Candidate.ownerId**，
 * 所以 `app.ownerId === candidate.ownerId` 这个假设不成立，不能据此简化。
 */
export async function countOrphans(db, ownerId, referencedIds = []) {
  if (!ownerId) return 0;
  const owned = await db.collection('Candidate').where({ ownerId }).count();
  const totalOwned = (owned && owned.total) || 0;

  const uniq = [...new Set((referencedIds || []).filter(Boolean))];
  let ownedAndReferenced = 0;
  for (let i = 0; i < uniq.length; i += ORPHAN_REF_CHUNK) {
    const chunk = uniq.slice(i, i + ORPHAN_REF_CHUNK);
    const c = await db.collection('Candidate')
      .where({ ownerId, _id: db.command.in(chunk) })
      .count();
    ownedAndReferenced += (c && c.total) || 0;
  }

  const orphans = totalOwned - ownedAndReferenced;
  if (orphans < 0) {
    // 负数说明「按 ownerId 计数」与「按 _id ∈ R 计数」两套口径不一致
    // （例如安全规则把其中一侧静默过滤了），此时角标不可信 → 交给调用方降级。
    throw new ListPushdownUnavailableError(
      `孤儿项算得负数（|C_me|=${totalOwned}, |C_me∩R|=${ownedAndReferenced}），计数口径不一致`
    );
  }
  return orphans;
}

/** 待分配角标：admin = |E|；专员 = |E| + 真实孤儿数 */
export async function fetchUnassignedCount(db, { ownerId = null, isAdmin = false } = {}) {
  if (isAdmin || !ownerId) return countEmptyActiveCandidates(db);

  // 专员这一次列表聚合同时给出两个量：|R|（行数）与 |E|（标志位筛出的行数）
  const rows = await groupApplicationsByCandidate(db, ownerId);
  const emptyActive = rows.filter((r) => !r.hasAssigned && r.hasEmptyActive).length;
  const orphans = await countOrphans(db, ownerId, rows.map((r) => r._id));
  return emptyActive + orphans;
}

/**
 * 四个 Tab 的角标。
 * 口径是「未叠加筛选条件的积压量」，因此**绝不合并 filters** —— countByTab 的既有语义。
 */
export async function fetchTabCounts(db, { ownerId = null, isAdmin = false } = {}) {
  const scope = !isAdmin && ownerId ? { ownerId } : {};
  const countTab = async (pred) => {
    const { total } = await db.collection('Application').where({ ...scope, ...pred }).count();
    return Number.isFinite(total) ? total : 0;
  };

  const [active, inProgress, ended, unassigned] = await Promise.all([
    countTab(tabPredicate(db, 'active')),
    countTab(tabPredicate(db, 'in-progress')),
    countTab(tabPredicate(db, 'ended')),
    fetchUnassignedCount(db, { ownerId, isAdmin }),
  ]);

  return { active, 'in-progress': inProgress, unassigned, ended };
}

/** 条件对象是否为空（空条件要跳过 where / $match，避免边界行为） */
function isWhereEmpty(where) {
  return !where || (typeof where === 'object' && !where.__command && Object.keys(where).length === 0);
}

/** 给查询链套上 where（空条件时跳过，避免 `where({})` 的边界行为） */
function applyWhere(query, where) {
  return isWhereEmpty(where) ? query : query.where(where);
}

/**
 * 取某个已分配类 Tab 的当页行 + 筛选后的全量条数。
 * 候选人只按当页 20 条取 —— 与 D-1 的 buildPagedApplicationRows 同一策略。
 */
export async function fetchTabPage(db, {
  ownerId = null, isAdmin = false, tab, filters = {},
  page = 1, pageSize = 20, jobsLookup = null,
}) {
  const where = buildTabWhere(db, tab, { ownerId, isAdmin, filters });
  const start = Math.max(0, (page - 1) * pageSize);

  let counted;
  try {
    const c = await applyWhere(db.collection('Application'), where).count();
    counted = c && c.total;
  } catch {
    // count 不可用时无法给出可信 total，降级 legacy 由它精确算出（结果正确，只是慢）
    throw new ListPushdownUnavailableError('count() 不可用，无法给出可信 total');
  }
  if (!Number.isFinite(counted) || counted < 0) {
    throw new ListPushdownUnavailableError('count() 返回值不可信');
  }

  // 排序 + 翻页走**聚合管道**，绝不能用 find 的链式 orderBy。
  //
  // 为什么（2026-09-16 生产实测，见 CHANGELOG 的 D-2 条目）：
  // 真实 SDK（@cloudbase/js-sdk 3.4.6）的 `orderBy` **不叠加**。链式写
  // `.orderBy('updatedAt','desc').orderBy('_id','asc')` 时，主排序键会被顶掉——
  // 实测其当页与「只写 .orderBy('_id','asc')」逐条相同，取回的是 _id 最小的一批，
  // 与 legacy 的当页交集 0/20（而 total 与四个角标都对得上，所以非常难察觉）。
  // 它**不报错**，是静默错序。
  //
  // 聚合的 `$sort` 支持多键，且实测与 legacy 全序逐条相同：
  // admin/专员 × active/in-progress/ended × 页首页中页尾共 18 组，18/18 逐条相同。
  // 排序链与索引 {updatedAt:-1, _id:1} 逐位一致（见 scripts/init-database.md #29/#30）。
  //
  // `_id` 升序 tiebreaker 不能省：JS 侧的隐式 _id asc 来自 fetchAllApplications 的
  // orderBy('_id','asc')，下推后那个输入序列不复存在；缺了它，同 updatedAt 的行会在
  // 页与页之间漂移。
  const pagePipe = db.collection('Application').aggregate();
  const { data } = await (isWhereEmpty(where) ? pagePipe : pagePipe.match(where))
    .sort({ updatedAt: -1, _id: 1 })
    .skip(start)
    .limit(pageSize)
    .end();
  const pageApps = data || [];

  // 排序键完整性兜底：legacy 用 `updatedAt || createdAt` 排序，下推只能按 updatedAt。
  // 生产实测缺失数为 0，但一旦前提被破坏，排序就会静默错位 → 宁可降级。
  if (pageApps.some((a) => a.updatedAt === undefined || a.updatedAt === null)) {
    throw new ListPushdownUnavailableError('当页存在缺失 updatedAt 的申请，排序键与 legacy 口径不一致');
  }

  const total = repairTotal(counted, page, pageSize, pageApps.length);

  const candidatesMap = await fetchCandidatesByIds(
    db,
    [...new Set(pageApps.map((a) => a.candidateId).filter(Boolean))]
  );

  const jobsMap = {};
  for (const jobId of [...new Set(pageApps.map((a) => a.jobId).filter(Boolean))]) {
    const job = jobsLookup ? jobsLookup(jobId) : null;
    if (job) jobsMap[jobId] = job;
  }

  return { rows: tagRows(buildApplicationRows(pageApps, candidatesMap, jobsMap), tab), total };
}

/**
 * 候选人工作区统一加载入口（编排）。
 *
 * 与 D-1 相比，唯一变化是：**不再无条件全量拉取**。
 *   - 无搜索词且是 active / in-progress / ended → 走数据库下推（首屏只回 1 页 + 角标）
 *   - 搜索 / 待分配 → 仍走 legacy 全量装配（前者要按候选人字段过滤，后者行序依赖 Candidate.updatedAt）
 *
 * 一致性守卫：角标是「未叠加筛选的积压量」，筛选只会让它变小，
 * 故恒有 `tabCounts[tab] >= paged.total`。一旦违反，说明两套查询口径已经对不上
 * （最可能是聚合被安全规则静默过滤），此时整条降级 legacy 并熔断，避免每次首屏白跑。
 *
 * **降级策略：下推路径里的任何异常都降级，不向上抛。**
 * 下推只是性能优化，legacy 才是正确性基准；若让异常冒到 UI，用户会因为一次
 * 「优化没生效」而看到白屏——这是比「慢一点」严重得多的失败。代价是可能把真 bug
 * 也一起掩盖，故对非预期异常用 console.error（而非 warn）打出原始错误对象，
 * 并保留熔断，使其在控制台可见且不会被反复触发。
 * 注意兜底本身仍是安全的：legacy 若因同一底层原因也不可用，异常会从 legacy 抛出。
 *
 * @returns {Promise<{ rows: Array, total: number, tabCounts: Object }>}
 */
export async function loadWorkspace(db, options = {}) {
  if (!db || !isPushdownEnabled()) return loadWorkspaceLegacy(db, options);

  const { ownerId = null, isAdmin = false, tab = 'active', filters = {} } = options;
  const q = (filters.search || '').trim();

  // 搜索要按姓名/电话/邮箱匹配、待分配行序依赖 Candidate.updatedAt —— 两者都必须拿到候选人
  if (q || tab === 'unassigned' || !ASSIGNED_TABS.includes(tab)) {
    return loadWorkspaceLegacy(db, options);
  }

  try {
    const [paged, tabCounts] = await Promise.all([
      fetchTabPage(db, { ...options, ownerId, isAdmin, tab, filters }),
      fetchTabCounts(db, { ownerId, isAdmin }),
    ]);

    if (tabCounts[tab] < paged.total) {
      throw new ListPushdownUnavailableError(
        `角标(${tabCounts[tab]}) 小于筛选后总数(${paged.total})，口径不一致`
      );
    }
    return { rows: paged.rows, total: paged.total, tabCounts };
  } catch (err) {
    pushdownBroken = true;
    if (err instanceof ListPushdownUnavailableError) {
      console.warn(`[候选人列表] 下推不可用，已降级全量装配：${err.reason}`);
    } else {
      console.error('[候选人列表] 下推路径异常，已降级全量装配（这可能是个 bug，请上报）：', err);
    }
    return loadWorkspaceLegacy(db, options);
  }
}
