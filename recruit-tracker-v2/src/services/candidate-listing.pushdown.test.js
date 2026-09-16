/**
 * candidate-listing.pushdown.test.js — D-2：分页下推的验收网
 *
 * 下推是把「在 JS 里算」换成「在数据库里算」，等价性无法靠阅读代码确认，
 * 只能用两把尺子量：
 *
 *   1. **判定矩阵**（静态）：造出 isArchived × jobId × stage × status 的全组合，
 *      对每个 Tab 断言「JS 谓词接受集 ≡ buildTabWhere 接受集」，**双向**相等。
 *      任一方向的差集非空都会立刻暴露（比如 $nin 漏了 null 会多收缺失字段的文档）。
 *   2. **差分对拍**（动态，最强护栏）：同一夹具下 loadWorkspace（下推）与
 *      loadWorkspaceLegacy（D-1 全量装配，oracle）的 rows/_id 序列、total、tabCounts 逐条相等。
 *
 * 另有一处必须显式防守的失败模式：**静默降级**。
 * 若下推因任何原因抛错，loadWorkspace 会吞掉异常改走 legacy——此时对拍必然通过，
 * 但测的是 legacy 自己。所以每次对拍都断言「聚合确实被调用过」（legacy 从不使用 aggregate）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./cloudbase');

import cloudbase, {
  __countQueries,
  __countAggregates,
  __setAggregateError,
  __setCountError,
  __setCountOverride,
} from './cloudbase';

import {
  loadWorkspace,
  loadWorkspaceLegacy,
  selectTabApps,
  buildTabWhere,
  buildAppFilterParts,
  assembleWhere,
  tabPredicate,
  repairTotal,
  fetchTabCounts,
  fetchUnassignedCount,
  ListPushdownUnavailableError,
  __setListPushdownEnabled,
  __resetListPushdown,
  ASSIGNED_TABS,
} from './candidate-listing';

const db = () => cloudbase.db();
const ISO = '2026-01-01T00:00:00.000Z';

beforeEach(() => {
  cloudbase.__resetAll();
  __setListPushdownEnabled(true); // 每个用例都从「下推可用」开始
  __resetListPushdown();
});

afterEach(() => {
  __setListPushdownEnabled(true);
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. 判定矩阵：JS 谓词 ≡ 数据库谓词
// ===========================================================================

/**
 * isArchived(4) × jobId(4) × stage(4) × status(4) = 256 条全组合 + 1 条他人数据。
 * 缺失字段用「不写这个键」表示（而非写 undefined），确保测的是真正的「字段不存在」。
 */
function boundaryApps() {
  const isArchiveds = [undefined, false, true, null];
  const jobIds = [undefined, '', null, 'J1'];
  const stages = [undefined, 'resume', 'onboard', 'interview'];
  const statuses = ['active', 'rejected', 'withdrawn', undefined];

  const out = [];
  let n = 0;
  for (const isArchived of isArchiveds) {
    for (const jobId of jobIds) {
      for (const stage of stages) {
        for (const status of statuses) {
          const doc = {
            _id: 'b' + String(n).padStart(3, '0'),
            candidateId: 'c' + n,
            ownerId: '王莉',
            createdAt: ISO,
            updatedAt: ISO,
          };
          n += 1;
          if (isArchived !== undefined) doc.isArchived = isArchived;
          if (jobId !== undefined) doc.jobId = jobId;
          if (stage !== undefined) doc.stage = stage;
          if (status !== undefined) doc.status = status;
          out.push(doc);
        }
      }
    }
  }
  // 他人数据：验证 ownerId 作用域确实生效（漏掉它 = 越权读到别人的行）
  out.push({
    _id: 'other', candidateId: 'cX', ownerId: '刘滢滢', jobId: 'J1',
    status: 'active', stage: 'interview', isArchived: false, createdAt: ISO, updatedAt: ISO,
  });
  return out;
}

async function dbIds(where) {
  const { data } = await db().collection('Application').where(where).get();
  return data.map((d) => d._id).sort();
}

describe('判定矩阵 — buildTabWhere 与 JS 谓词逐条等价', () => {
  for (const tab of ASSIGNED_TABS) {
    it(`${tab}：专员视角接受集双向相等`, async () => {
      const apps = boundaryApps();
      cloudbase.__setCollectionData('Application', apps);

      const jsIds = selectTabApps(apps.filter((a) => a.ownerId === '王莉'), tab)
        .map((a) => a._id)
        .sort();
      const got = await dbIds(buildTabWhere(db(), tab, { ownerId: '王莉', isAdmin: false }));

      // 双向：既不能漏（js 有 db 无），也不能多（db 有 js 无）
      expect(got).toEqual(jsIds);
      expect(jsIds.length).toBeGreaterThan(0); // 夹具本身要有效，否则 0≡0 是假绿
    });

    it(`${tab}：admin 视角不按 ownerId 作用域（含他人数据）`, async () => {
      const apps = boundaryApps();
      cloudbase.__setCollectionData('Application', apps);

      const jsIds = selectTabApps(apps, tab).map((a) => a._id).sort();
      const got = await dbIds(buildTabWhere(db(), tab, { ownerId: null, isAdmin: true }));
      expect(got).toEqual(jsIds);
    });
  }

  it('三条关键谓词分别钉住：$ne 匹配缺失、$nin 排除缺失、$nin 保留缺失', async () => {
    cloudbase.__setCollectionData('Application', [
      { _id: 'no-field', ownerId: '王莉' },
      { _id: 'null-field', ownerId: '王莉', isArchived: null, jobId: null, stage: null },
      { _id: 'false-field', ownerId: '王莉', isArchived: false, jobId: '', stage: 'resume' },
      { _id: 'real', ownerId: '王莉', isArchived: false, jobId: 'J1', stage: 'interview' },
    ]);

    // a.isArchived !== true ⟺ $ne:true（缺失/ null 都要匹配）
    const notArchived = await dbIds({ ownerId: '王莉', isArchived: db().command.neq(true) });
    expect(notArchived).toEqual(['false-field', 'no-field', 'null-field', 'real']);

    // a.jobId && a.jobId !== '' ⟺ $nin:[null,'']（缺失/null/空串都要排除）
    const withJob = await dbIds({ ownerId: '王莉', jobId: db().command.nin([null, '']) });
    expect(withJob).toEqual(['real']);

    // a.stage !== 'resume' && a.stage !== 'onboard' ⟺ $nin:['resume','onboard']（缺失要保留）
    const notEndpoint = await dbIds({ ownerId: '王莉', stage: db().command.nin(['resume', 'onboard']) });
    expect(notEndpoint).toEqual(['no-field', 'null-field', 'real']);
  });

  /**
   * 已知且**有意接受**的偏差，记录在此以免日后被误认为 bug：
   * JS 的 `a.jobId && a.jobId !== ''` 会排除一切假值，而 `$nin:[null,'']` 只排除 null / 缺失 / 空串，
   * 会**保留** `jobId: 0` / `false` 这类非字符串假值。
   * 生产库实测：空串 2713 + 非空 2203 = 4916，即 jobId 要么是 '' 要么是真 id，不存在第三种形态。
   */
  it('已知偏差：jobId 为非字符串假值时两侧不等价（生产数据不存在此形态）', async () => {
    cloudbase.__setCollectionData('Application', [
      { _id: 'zero', ownerId: '王莉', jobId: 0, status: 'active', isArchived: false },
      { _id: 'real', ownerId: '王莉', jobId: 'J1', status: 'active', isArchived: false },
    ]);
    const jsIds = selectTabApps(
      cloudbase.__getCollectionData('Application').filter((a) => a.ownerId === '王莉'), 'active'
    ).map((a) => a._id).sort();
    expect(jsIds).toEqual(['real']); // JS 排除 0

    const got = await dbIds(buildTabWhere(db(), 'active', { ownerId: '王莉' }));
    expect(got).toEqual(['real', 'zero']); // DB 保留 0 —— 偏差在此，知悉即可
  });
});

// ===========================================================================
// 2. 差分对拍：loadWorkspace ≡ loadWorkspaceLegacy
// ===========================================================================

/**
 * 差分夹具。覆盖了所有会让两条路径分叉的形态：
 *   - 同一候选人有「已分配申请」+「残留空 jobId 申请」→ 不得进待分配
 *   - stage 落在 resume / onboard 端点 → 属 active 不属 in-progress
 *   - isArchived:true 的 active 空申请 → 不得进待分配
 *   - 已结束的空申请（rejected）→ 不得进待分配
 *   - updatedAt 相同的两条申请 → 检验 _id 升序 tiebreaker（否则页间漂移）
 *   - 申请指向不存在的候选人 → 行仍要在，name 为 undefined
 *   - 孤儿候选人（Candidate 有、无任何申请引用）→ 专员待分配要算进去
 *   - 他人数据 → 专员不可见
 */
function diffFixture() {
  const app = (id, candidateId, ownerId, jobId, status, stage, updatedAt, extra = {}) => ({
    _id: id, candidateId, ownerId, jobId, status,
    ...(stage === null ? {} : { stage }),
    isArchived: false, createdAt: ISO, updatedAt, funnelMeta: {}, ...extra,
  });

  const apps = [
    app('p01', 'c1', '王莉', 'J1', 'active', 'interview', '2026-03-01T00:00:00Z'),
    app('p02', 'c1', '王莉', '', 'active', 'interview', '2026-03-02T00:00:00Z'),   // 残留空申请
    app('p03', 'c2', '王莉', '', 'active', 'resume', '2026-03-03T00:00:00Z'),      // 真待分配
    app('p04', 'c3', '王莉', 'J2', 'active', 'resume', '2026-03-04T00:00:00Z'),    // active only
    app('p05', 'c4', '王莉', 'J3', 'rejected', 'interview', '2026-03-05T00:00:00Z'),
    app('p06', 'c5', '王莉', 'J4', 'withdrawn', 'onboard', '2026-03-06T00:00:00Z'),
    app('p07', 'c6', '王莉', 'J5', 'active', 'interview', '2026-03-07T00:00:00Z', { isArchived: true }),
    app('p08', 'c7', '王莉', 'J6', 'unknown', 'interview', '2026-03-08T00:00:00Z'),
    app('p09', 'c8', '王莉', 'J7', 'active', 'onboard', '2026-03-09T00:00:00Z'),   // active only
    app('p10', 'c9', '刘滢滢', 'J8', 'active', 'interview', '2026-03-10T00:00:00Z'), // 他人
    app('p11', 'c10', '王莉', 'J9', 'active', 'interview', '2026-03-01T00:00:00Z'), // 与 p01 同 updatedAt
    app('p12', 'c11', '王莉', '', 'rejected', 'interview', '2026-03-12T00:00:00Z'),
    app('p13', 'c12', '王莉', '', 'active', 'interview', '2026-03-13T00:00:00Z', { isArchived: true }),
    app('p14', 'c_missing', '王莉', 'J10', 'active', 'interview', '2026-03-14T00:00:00Z'),
    app('p15', 'c13', '王莉', 'J11', 'active', null, '2026-03-15T00:00:00Z'),       // stage 缺失
  ];

  const cand = (id, name, extra = {}) => ({ _id: id, name, ownerId: '王莉', ...extra });
  const candidates = [
    cand('c1', '甲'), cand('c2', '乙'), cand('c3', '丙'), cand('c4', '丁'),
    cand('c5', '戊'), cand('c6', '己'), cand('c7', '庚'), cand('c8', '辛'),
    cand('c10', '壬'), cand('c11', '癸'), cand('c12', '子'), cand('c13', '丑'),
    cand('orph1', '孤儿一'), cand('orph2', '孤儿二'),           // 无任何申请引用
    cand('c9', '别人的', { ownerId: '刘滢滢' }),
  ];

  return { apps, candidates };
}

/**
 * 走一次下推路径，并断言「确实走了下推」——否则降级会让对拍退化成 legacy 自己跟自己比。
 * legacy 路径从不调用 aggregate()，所以聚合日志非空是下推生效的充分证据。
 */
async function loadPushed(options) {
  cloudbase.__resetAggregateLog();
  const r = await loadWorkspace(db(), options);
  expect(__countAggregates('Application')).toBeGreaterThan(0);
  return r;
}

/** 对拍：行 _id 序列（**顺序敏感**）、total、tabCounts 三项全等 */
async function assertSameAsLegacy(options) {
  const pushed = await loadPushed(options);
  const legacy = await loadWorkspaceLegacy(db(), options);

  expect(pushed.rows.map((r) => r._id)).toEqual(legacy.rows.map((r) => r._id));
  expect(pushed.total).toBe(legacy.total);
  expect(pushed.tabCounts).toEqual(legacy.tabCounts);
  return { pushed, legacy };
}

describe('差分对拍 — 下推结果与全量装配逐条一致', () => {
  beforeEach(() => {
    const { apps, candidates } = diffFixture();
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', candidates);
  });

  for (const tab of ASSIGNED_TABS) {
    it(`专员视角 · ${tab}`, async () => {
      await assertSameAsLegacy({ ownerId: '王莉', isAdmin: false, tab, filters: {}, page: 1, pageSize: 20 });
    });

    it(`admin 视角 · ${tab}`, async () => {
      await assertSameAsLegacy({ ownerId: null, isAdmin: true, tab, filters: {}, page: 1, pageSize: 20 });
    });
  }

  it('待分配 Tab 与搜索仍走 legacy（下推不介入，结果自然一致）', async () => {
    for (const opts of [
      { ownerId: '王莉', tab: 'unassigned', filters: {}, page: 1, pageSize: 20 },
      { ownerId: '王莉', tab: 'active', filters: { search: '乙' }, page: 1, pageSize: 20 },
    ]) {
      cloudbase.__resetAggregateLog();
      const pushed = await loadWorkspace(db(), opts);
      expect(__countAggregates('Application')).toBe(0); // 未使用聚合 = 确实走的 legacy
      const legacy = await loadWorkspaceLegacy(db(), opts);
      expect(pushed.rows.map((r) => r._id)).toEqual(legacy.rows.map((r) => r._id));
      expect(pushed.total).toBe(legacy.total);
      expect(pushed.tabCounts).toEqual(legacy.tabCounts);
    }
  });

  /**
   * 与 candidate-listing.test.js 里 `seedZhengJiapeng` 同形的夹具。
   * 那份 44 例回归网中的 6 个 loadWorkspace 用例若靠「静默降级」蒙混也能全绿，
   * 所以这里显式断言聚合被调用过 —— 证明它们确实跑在下推路径上。
   */
  it('同形夹具确认既有回归网跑在下推路径上（而非靠降级假绿）', async () => {
    cloudbase.__setCollectionData('Application', [
      { _id: 'a_unassigned', candidateId: 'c1', ownerId: '王莉', jobId: '', status: 'active', stage: 'resume', isArchived: false, createdAt: ISO, updatedAt: ISO, funnelMeta: {} },
      { _id: 'a_active', candidateId: 'c2', ownerId: '王莉', jobId: 'job1', status: 'active', stage: 'resume', isArchived: false, createdAt: ISO, updatedAt: ISO, funnelMeta: {} },
    ]);
    cloudbase.__setCollectionData('Candidate', [
      { _id: 'c1', name: '郑嘉鹏', ownerId: '王莉' },
      { _id: 'c2', name: '郑嘉鹏', ownerId: '王莉' },
    ]);

    const pushed = await loadPushed({ ownerId: '王莉', tab: 'active', filters: {}, page: 1, pageSize: 20 });
    const legacy = await loadWorkspaceLegacy(db(), { ownerId: '王莉', tab: 'active', filters: {}, page: 1, pageSize: 20 });

    expect(pushed.rows.map((r) => r.appId)).toEqual(['a_active']);
    expect(pushed.total).toBe(1);
    expect(pushed.tabCounts).toEqual({ active: 1, 'in-progress': 0, unassigned: 1, ended: 0 });
    expect(pushed.tabCounts).toEqual(legacy.tabCounts);
  });

  it('专员待分配角标 = |E| + 精确孤儿数（差分夹具里孤儿为 2）', async () => {
    const counts = await fetchTabCounts(db(), { ownerId: '王莉', isAdmin: false });
    const legacy = await loadWorkspaceLegacy(db(), { ownerId: '王莉', tab: 'active' });
    expect(counts.unassigned).toBe(legacy.tabCounts.unassigned);
    expect(counts.unassigned).toBe(3); // |E|=1（c2）+ 孤儿 2（orph1 / orph2）
  });

  it('admin 角标按定义不含孤儿', async () => {
    const counts = await fetchTabCounts(db(), { isAdmin: true, ownerId: null });
    const legacy = await loadWorkspaceLegacy(db(), { isAdmin: true, ownerId: null, tab: 'active' });
    expect(counts).toEqual(legacy.tabCounts);
  });

  it('updatedAt 相同的两条申请靠 _id 升序定序，且跨页不重不漏', async () => {
    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      const r = await loadPushed({
        ownerId: '王莉', tab: 'active', filters: {}, page, pageSize: 5,
      });
      seen.push(...r.rows.map((x) => x._id));
    }
    expect(new Set(seen).size).toBe(seen.length);           // 无重复
    const p1 = await loadPushed({ ownerId: '王莉', tab: 'active', filters: {}, page: 1, pageSize: 5 });
    expect(p1.total).toBe(seen.length);                      // 无遗漏
    expect(seen).toContain('p01');
    expect(seen).toContain('p11');                           // 同 updatedAt 的另一条也要在
    // 同 updatedAt 时 _id 升序：p01 必须排在 p11 前
    expect(seen.indexOf('p01')).toBeLessThan(seen.indexOf('p11'));
  });

  it('非搜索筛选（stage / jobId / source / 日期）与 legacy 同结果', async () => {
    cloudbase.__setCollectionData('Application', [
      { _id: 'f1', candidateId: 'c1', ownerId: '王莉', jobId: 'J1', status: 'active', stage: 'interview', isArchived: false, createdAt: '2026-02-10T06:00:00Z', updatedAt: '2026-02-10T06:00:00Z', funnelMeta: { entrySource: 'email' } },
      { _id: 'f2', candidateId: 'c2', ownerId: '王莉', jobId: 'J2', status: 'active', stage: 'offer', isArchived: false, createdAt: '2026-03-10T06:00:00Z', updatedAt: '2026-03-10T06:00:00Z', funnelMeta: { entrySource: 'manual' } },
      { _id: 'f3', candidateId: 'c3', ownerId: '王莉', jobId: 'J1', status: 'active', stage: 'interview', isArchived: false, createdAt: '2026-04-10T06:00:00Z', updatedAt: '2026-04-10T06:00:00Z', funnelMeta: {} },
    ]);
    cloudbase.__setCollectionData('Candidate', [
      { _id: 'c1', name: '甲', ownerId: '王莉' },
      { _id: 'c2', name: '乙', ownerId: '王莉' },
      { _id: 'c3', name: '丙', ownerId: '王莉' },
    ]);

    const cases = [
      { stage: 'interview' },
      { jobId: 'J1' },
      { source: 'manual' },
      { source: 'email' },
      { dateFrom: '2026-03-01' },
      { dateTo: '2026-02-28' },                 // 边界：只留 f1
      { dateFrom: '2026-02-01', dateTo: '2026-03-31' }, // 上下界同时存在（同一 createdAt 字段）
      { stage: 'interview', jobId: 'J1', source: 'email' },
    ];
    for (const filters of cases) {
      const r = await assertSameAsLegacy({
        ownerId: '王莉', isAdmin: false, tab: 'active', filters, page: 1, pageSize: 20,
      });
      expect(r.legacy.total).toBeGreaterThan(0); // 每个用例都要有判别力
    }
  });

  it('dateTo 沿用本地时区 23:59:59.999 语义（当天创建的不会被漏掉）', async () => {
    cloudbase.__setCollectionData('Application', [
      { _id: 'd1', candidateId: 'c1', ownerId: '王莉', jobId: 'J1', status: 'active', stage: 'interview', isArchived: false, createdAt: '2026-03-05T06:00:00Z', updatedAt: '2026-03-05T06:00:00Z', funnelMeta: {} },
    ]);
    cloudbase.__setCollectionData('Candidate', [{ _id: 'c1', name: '甲', ownerId: '王莉' }]);

    const r = await assertSameAsLegacy({
      ownerId: '王莉', tab: 'active', filters: { dateTo: '2026-03-05' }, page: 1, pageSize: 20,
    });
    expect(r.pushed.rows.map((x) => x._id)).toEqual(['d1']);
  });

  it('分页越界：rows 为空但 total 仍是全量（repairTotal 的 rowCount>0 守卫）', async () => {
    const apps = Array.from({ length: 25 }, (_, i) => ({
      _id: 'x' + String(i).padStart(2, '0'), candidateId: 'c' + i, ownerId: '王莉',
      jobId: 'J1', status: 'active', stage: 'interview', isArchived: false,
      createdAt: ISO, updatedAt: ISO, funnelMeta: {},
    }));
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((a) => ({ _id: a.candidateId, name: 'x', ownerId: '王莉' })));

    const r = await loadPushed({ ownerId: '王莉', tab: 'active', filters: {}, page: 99, pageSize: 20 });
    cloudbase.__resetQueryLog();
    const empty = await loadPushed({ ownerId: '王莉', tab: 'active', filters: {}, page: 99, pageSize: 20 });
    expect(empty.rows).toEqual([]);
    expect(empty.total).toBe(25); // 若 repairTotal 无条件 Math.max，这里会变成 1960
    // 2 次候选人请求全部来自角标的孤儿实算（|C_me| 1 次 + 分块 1 次），当页本身 0 次
    expect(__countQueries('Candidate')).toBe(2);

    cloudbase.__resetQueryLog();
    const first = await loadPushed({ ownerId: '王莉', tab: 'active', filters: {}, page: 1, pageSize: 20 });
    expect(first.rows).toHaveLength(20);
    expect(__countQueries('Candidate')).toBe(3); // 上面 2 次 + 当页候选人的 1 批
  });
});

// ===========================================================================
// 3. 请求数契约 —— 「首屏不再随数据规模增长」是 D-2 的全部意义
// ===========================================================================

describe('请求数契约', () => {
  function bigFixture(n) {
    const apps = Array.from({ length: n }, (_, i) => ({
      _id: 'big' + String(i).padStart(5, '0'),
      candidateId: 'c' + i,
      ownerId: i % 3 === 0 ? '高艺' : '王莉',
      jobId: 'J' + (i % 7),
      status: i % 5 === 0 ? 'rejected' : 'active',
      stage: i % 4 === 0 ? 'resume' : 'interview',
      isArchived: false,
      createdAt: ISO,
      updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
      funnelMeta: {},
    }));
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData(
      'Candidate',
      apps.map((a) => ({ _id: a.candidateId, name: 'n', ownerId: a.ownerId }))
    );
    return apps;
  }

  it('admin 首屏固定 7 次请求，与全库条数无关', async () => {
    bigFixture(1200);
    cloudbase.__resetQueryLog();
    cloudbase.__resetAggregateLog();

    const r = await loadWorkspace(db(), { isAdmin: true, ownerId: null, tab: 'active', page: 1, pageSize: 20 });

    expect(r.rows).toHaveLength(20);
    expect(__countQueries('Application')).toBe(4);  // 分页 total 1 次 count + 角标 3 次 count
    expect(__countQueries('Candidate')).toBe(1);    // 只有当页 20 条（**不是** 1200 条分 3 批）
    expect(__countAggregates('Application')).toBe(2); // 当页管道 + 待分配 |E|
    // 合计恰为 7 —— 这正是 D-2 的目标值
    expect(__countQueries('Application') + __countQueries('Candidate') + __countAggregates('Application')).toBe(7);
  });

  /**
   * 这条守着 2026-09-16 生产实测到的真实缺陷：翻页曾用 find 的**链式 orderBy**，
   * 而真实 SDK 的 orderBy 不叠加——主排序键被 tiebreaker 静默顶掉，当页取回的是
   * `_id` 最小的一批，与 legacy 交集 0/20。mock 里抓不到，因为 JS 稳定排序掩盖了它。
   * 所以这里直接断言管道的形状与排序键载荷。
   */
  it('翻页走聚合管道，排序键必须是 updatedAt 降序 + _id 升序', async () => {
    bigFixture(120);
    cloudbase.__resetAggregateLog();

    await loadWorkspace(db(), { isAdmin: true, ownerId: null, tab: 'active', page: 1, pageSize: 20 });

    const pipe = cloudbase.__getAggregateLog()
      .find((a) => a.collection === 'Application' && a.stages.includes('$sort') && a.stages.includes('$limit'));
    expect(pipe, '翻页必须走聚合管道').toBeTruthy();
    expect(pipe.stages).toEqual(['$match', '$sort', '$skip', '$limit']);

    const sortSpec = pipe.stageParams[pipe.stages.indexOf('$sort')];
    // _id tiebreaker 不能省：JS 侧的隐式 _id asc 来自被下推掉的 fetchAllApplications
    expect(sortSpec).toEqual({ updatedAt: -1, _id: 1 });
  });

  it('专员首屏 ≤ 11 次请求（含精确孤儿的分块 count）', async () => {
    bigFixture(1200);
    cloudbase.__resetQueryLog();
    cloudbase.__resetAggregateLog();

    await loadWorkspace(db(), { ownerId: '高艺', isAdmin: false, tab: 'active', page: 1, pageSize: 20 });

    expect(__countQueries('Application')).toBe(4); // 分页 total 1 次 count + 3 角标 count
    // 当页候选人 1 + |C_me| 1 + ceil(|R|/500) 分块
    expect(__countQueries('Candidate')).toBeLessThanOrEqual(5);
    expect(__countAggregates('Application')).toBe(2); // 当页管道 + 待分配聚合（专员档复用同一次）
    const total = __countQueries('Application') + __countQueries('Candidate') + __countAggregates('Application');
    expect(total).toBeLessThanOrEqual(11);
  });

  it('请求数与数据规模解耦：1200 条与 120 条请求数相同', async () => {
    const count = async (n) => {
      cloudbase.__resetAll();
      __setListPushdownEnabled(true);
      bigFixture(n);
      cloudbase.__resetQueryLog();
      cloudbase.__resetAggregateLog();
      await loadWorkspace(db(), { isAdmin: true, ownerId: null, tab: 'active', page: 1, pageSize: 20 });
      return __countQueries('Application') + __countQueries('Candidate') + __countAggregates('Application');
    };
    expect(await count(120)).toBe(await count(1200));
  });
});

// ===========================================================================
// 4. 降级阶梯与熔断 —— 下推的任何一环坏掉，结果仍必须正确
// ===========================================================================

describe('降级阶梯', () => {
  beforeEach(() => {
    const { apps, candidates } = diffFixture();
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', candidates);
  });

  /** 静音并捕获两种日志：已知不可用走 warn，非预期异常走 error */
  function silenceLogs() {
    return {
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  }

  it('聚合不可用 → 降级 legacy，结果与 legacy 一致', async () => {
    __setAggregateError('Application', true);
    silenceLogs();

    const r = await loadWorkspace(db(), { ownerId: '王莉', isAdmin: false, tab: 'active', page: 1, pageSize: 20 });
    const legacy = await loadWorkspaceLegacy(db(), { ownerId: '王莉', isAdmin: false, tab: 'active', page: 1, pageSize: 20 });

    expect(r.rows.map((x) => x._id)).toEqual(legacy.rows.map((x) => x._id));
    expect(r.total).toBe(legacy.total);
    expect(r.tabCounts).toEqual(legacy.tabCounts);
  });

  it('非预期异常也降级，但用 error 级日志打出原始错误（不静默掩盖 bug）', async () => {
    // __setAggregateError 抛的是普通 Error，属于「非预期」分支
    __setAggregateError('Application', true);
    const logs = silenceLogs();

    await loadWorkspace(db(), { ownerId: '王莉', tab: 'active' });

    expect(logs.error).toHaveBeenCalled();
    expect(logs.error.mock.calls[0][1]).toBeInstanceOf(Error); // 原始错误对象被带出
  });

  it('熔断：首次失败后不再重试下推（避免每次首屏白跑一轮）', async () => {
    __setAggregateError('Application', true);
    silenceLogs();

    await loadWorkspace(db(), { ownerId: '王莉', tab: 'active' });
    cloudbase.__resetAggregateLog();
    await loadWorkspace(db(), { ownerId: '王莉', tab: 'active' });

    expect(__countAggregates('Application')).toBe(0); // 第二次直接走 legacy
  });

  it('熔断可复位（__resetListPushdown / 重新启用）', async () => {
    __setAggregateError('Application', true);
    silenceLogs();
    await loadWorkspace(db(), { ownerId: '王莉', tab: 'active' });

    __resetListPushdown();
    cloudbase.__resetAggregateLog();
    await loadWorkspace(db(), { ownerId: '王莉', tab: 'active' });
    expect(__countAggregates('Application')).toBeGreaterThan(0); // 恢复尝试
  });

  it('count() 抛错 → 降级 legacy，结果仍正确', async () => {
    __setCountError('Application', true);
    silenceLogs();

    const r = await loadWorkspace(db(), { isAdmin: true, ownerId: null, tab: 'active', page: 1, pageSize: 20 });
    const legacy = await loadWorkspaceLegacy(db(), { isAdmin: true, ownerId: null, tab: 'active', page: 1, pageSize: 20 });
    expect(r.rows.map((x) => x._id)).toEqual(legacy.rows.map((x) => x._id));
    expect(r.total).toBe(legacy.total);
  });

  it('一致性守卫：角标小于筛选后总数 → 判定下推不可信，降级并熔断', async () => {
    // count 失真（安全规则静默过滤的典型症状）：25 条 active 但 count 只报 1，
    // 于是 repairTotal 把 total 修到 20，而角标仍是 1 → 1 < 20，守卫必须触发。
    const apps = Array.from({ length: 25 }, (_, i) => ({
      _id: 'g' + String(i).padStart(2, '0'), candidateId: 'c' + i, ownerId: '王莉',
      jobId: 'J1', status: 'active', stage: 'interview', isArchived: false,
      createdAt: ISO, updatedAt: ISO, funnelMeta: {},
    }));
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((a) => ({ _id: a.candidateId, name: 'x', ownerId: '王莉' })));
    __setCountOverride('Application', 1);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await loadWorkspace(db(), { isAdmin: true, ownerId: null, tab: 'active', page: 1, pageSize: 20 });

    expect(warn.mock.calls.flat().join(' ')).toMatch(/口径不一致/);
    expect(error).not.toHaveBeenCalled(); // 守卫是「已知不可用」，不该按 bug 报
    expect(r.rows).toHaveLength(20);   // 降级后 legacy 仍取全（首批不满 500 即停）
    expect(r.total).toBe(25);
  });

  it('开关关闭时完全不走下推（一行回滚）', async () => {
    __setListPushdownEnabled(false);
    cloudbase.__resetAggregateLog();
    const r = await loadWorkspace(db(), { ownerId: '王莉', tab: 'active' });
    expect(__countAggregates('Application')).toBe(0);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('undefined / 非法 db 不抛到调用方（下推是优化，不能成为新的失败源）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // db 为 undefined → 短路走 legacy；legacy 用默认参数 cloudbase.db()
    const r = await loadWorkspace(undefined, { ownerId: '王莉', tab: 'active', page: 1, pageSize: 20 });
    expect(r.total).toBeGreaterThan(0);
    expect(error).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. 纯函数单测
// ===========================================================================

describe('repairTotal — 只在取到行时向上修复', () => {
  it('取到行时抬到 start + rowCount', () => {
    expect(repairTotal(1, 1, 20, 20)).toBe(20);
    expect(repairTotal(100, 3, 20, 20)).toBe(100); // 已更大则不动
  });

  it('未取到行时原样返回（越界页的 total 契约）', () => {
    expect(repairTotal(25, 99, 20, 0)).toBe(25);
    expect(repairTotal(0, 99, 20, 0)).toBe(0);
  });

  it('count 不可信时退回 start + rowCount', () => {
    expect(repairTotal(undefined, 2, 20, 5)).toBe(25);
    expect(repairTotal(-3, 2, 20, 5)).toBe(25);
  });
});

describe('assembleWhere / buildAppFilterParts', () => {
  it('日期上下界作为并列条件（同一 createdAt 字段不能被覆盖）', () => {
    const parts = buildAppFilterParts(db(), { dateFrom: '2026-02-01', dateTo: '2026-03-31' });
    const createdAtParts = parts.filter((p) => 'createdAt' in p);
    expect(createdAtParts).toHaveLength(2); // 若合并成一个对象，只剩最后一个

    const where = assembleWhere(db(), parts);
    expect(where.__command).toBe('and');
    expect(where.value).toHaveLength(2);
  });

  it('键不冲突时全部合并成一个对象（不无谓地套 $and）', () => {
    const gte = db().command.gte(new Date('2026-01-01'));
    const where = assembleWhere(db(), [
      { status: 'active', jobId: 'J1' },
      { createdAt: gte },
    ]);
    expect(where.__command).toBeUndefined();
    expect(where).toEqual({ status: 'active', jobId: 'J1', createdAt: gte });
  });

  it('键冲突时第二次出现的条件另起并列项，两边都保留', () => {
    const gte = db().command.gte(new Date('2026-01-01'));
    const lte = db().command.lte(new Date('2026-12-31'));
    const where = assembleWhere(db(), [{ status: 'active' }, { createdAt: gte }, { createdAt: lte }]);
    expect(where.__command).toBe('and');
    expect(where.value[0]).toEqual({ status: 'active', createdAt: gte });
    expect(where.value[1]).toEqual({ createdAt: lte });
  });

  it('空筛选返回空对象，单条件返回其结果本身', () => {
    expect(assembleWhere(db(), [])).toEqual({});
    expect(assembleWhere(db(), [{ status: 'active' }])).toEqual({ status: 'active' });
  });

  it('dateTo 用本地时区当日末刻，而非 UTC 零点', () => {
    const [part] = buildAppFilterParts(db(), { dateTo: '2026-03-05' }).filter((p) => 'createdAt' in p);
    const expected = new Date('2026-03-05');
    expected.setHours(23, 59, 59, 999);
    expect(part.createdAt.value.getTime()).toBe(expected.getTime());
    expect(part.createdAt.value.getHours()).toBe(23); // 若传字符串会得到 UTC 零点 → 本地 8 点
  });
});

describe('tabPredicate', () => {
  it('三个 Tab 的谓词形状固定（改动需同步判定矩阵）', () => {
    expect(Object.keys(tabPredicate(db(), 'ended')).sort()).toEqual(['isArchived', 'status']);
    expect(Object.keys(tabPredicate(db(), 'active')).sort()).toEqual(['isArchived', 'jobId', 'status']);
    expect(Object.keys(tabPredicate(db(), 'in-progress')).sort()).toEqual(['isArchived', 'jobId', 'stage', 'status']);
  });

  it('未知 Tab 返回空谓词（调用方不会走到，但保证不抛）', () => {
    expect(tabPredicate(db(), 'nope')).toEqual({});
  });
});

describe('fetchUnassignedCount — 孤儿实算', () => {
  it('孤儿数为 0 时返回 |E|', async () => {
    cloudbase.__setCollectionData('Application', [
      { _id: 'a1', candidateId: 'c1', ownerId: '王莉', jobId: '', status: 'active', isArchived: false },
    ]);
    cloudbase.__setCollectionData('Candidate', [{ _id: 'c1', ownerId: '王莉', name: 'x' }]);
    expect(await fetchUnassignedCount(db(), { ownerId: '王莉' })).toBe(1);
  });

  it('移交场景：申请归我、候选人归他人 → 不算孤儿', async () => {
    // handover 只改 Application.ownerId，Candidate.ownerId 留在原主手里。
    // 此时 |C_me| 不含该候选人，|C_me∩R| 也不含 → 差额正确为 0。
    cloudbase.__setCollectionData('Application', [
      { _id: 'a1', candidateId: 'c1', ownerId: '王莉', jobId: 'J1', status: 'active', isArchived: false },
    ]);
    cloudbase.__setCollectionData('Candidate', [{ _id: 'c1', ownerId: '刘滢滢', name: 'x' }]);
    expect(await fetchUnassignedCount(db(), { ownerId: '王莉' })).toBe(0);
  });

  it('计数口径不一致（算得负数）→ 抛 ListPushdownUnavailableError 触发降级', async () => {
    cloudbase.__setCollectionData('Application', [
      { _id: 'a1', candidateId: 'c1', ownerId: '王莉', jobId: '', status: 'active', isArchived: false },
    ]);
    cloudbase.__setCollectionData('Candidate', [
      { _id: 'c1', ownerId: '王莉' }, { _id: 'c2', ownerId: '王莉' },
    ]);
    // 模拟「同一个集合，两次 count 口径不一致」：按 _id ∈ R 的那次报大数 → 交集大于全集
    __setCountOverride('Candidate', ({ conditions }) => ('_id' in (conditions || {}) ? 5 : 2));
    await expect(fetchUnassignedCount(db(), { ownerId: '王莉' }))
      .rejects.toThrow(ListPushdownUnavailableError);
  });

  it('admin 不查孤儿（按定义无孤儿），只用 1 次聚合', async () => {
    const { apps, candidates } = diffFixture();
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', candidates);
    cloudbase.__resetQueryLog();
    cloudbase.__resetAggregateLog();

    await fetchUnassignedCount(db(), { isAdmin: true, ownerId: null });

    expect(__countQueries('Candidate')).toBe(0);
    expect(__countAggregates('Application')).toBe(1);
  });
});
