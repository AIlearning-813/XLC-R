/**
 * candidate-listing.perf.test.js — D-1 性能契约
 *
 * 背景：候选人首屏实测 5-9 秒。根因是「取数层的网络往返次数」随数据量线性增长：
 *   - fetchAllApplications 分批串行拉全量（admin 4895 条 → 10 次串行）
 *   - fetchCandidatesByIds 按「整个 Tab」而非「当前页」批量拉候选人（active Tab 1277 条 → 13 次串行）
 *
 * D-1 的目标是「不改语义、只改取数方式」：
 *   1. 分批拉取并发化（降低串行等待）
 *   2. 已分配类 Tab（active/in-progress/ended）只按当前页取候选人
 *
 * 本文件断言两件事：
 *   A. 性能契约 —— 请求次数下降、并发度 > 1
 *   B. 语义等价 —— 结果与「全量装配后分页」逐条一致（这是 D-1 不破坏正确性的前提）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./cloudbase');

import cloudbase from './cloudbase';
import {
  loadWorkspace,
  fetchAllApplications,
  fetchCandidatesByIds,
  fetchCandidatesByOwner,
} from './candidate-listing';

beforeEach(() => {
  cloudbase.__resetAll();
});

// ===== 工具 =====
function mkApp(overrides = {}) {
  return {
    _id: overrides._id || 'app_' + Math.random().toString(36).slice(2, 10),
    candidateId: 'cand_default',
    ownerId: '王莉',
    jobId: '',
    status: 'active',
    stage: 'resume',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    funnelMeta: {},
    ...overrides,
  };
}

function mkCand(id, name, overrides = {}) {
  return { _id: id, name, phone: '138' + id, email: id + '@x.com', ownerId: '王莉', ...overrides };
}

/** 生成 n 条 active Tab 申请，updatedAt 递增（i 越大越新） */
function mkActiveApps(n) {
  return Array.from({ length: n }, (_, i) =>
    mkApp({
      _id: 'a' + String(i).padStart(4, '0'),
      candidateId: 'c' + i,
      jobId: 'job1',
      updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(),
    })
  );
}

// ===================== A. 性能契约 =====================

describe('D-1 性能契约 — 首屏按当前页取候选人', () => {
  it('250 条 active 申请、每页 20 条 → Candidate 只查 1 次（不再按整个 Tab 分批）', async () => {
    const apps = mkActiveApps(250);
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((_, i) => mkCand('c' + i, '候选人' + i)));

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {}, page: 1, pageSize: 20,
    });

    expect(r.rows).toHaveLength(20);
    expect(r.total).toBe(250);

    // 改造前：250 个 candidateId / BATCH_CAND(100) = 3 次
    // 改造后：只取当前页 20 个 → 1 次
    expect(cloudbase.__countQueries('Candidate')).toBe(1);
  });

  it('第 2 页同样只查 1 次，且不重复拉取前面页的候选人', async () => {
    const apps = mkActiveApps(250);
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((_, i) => mkCand('c' + i, '候选人' + i)));

    cloudbase.__resetQueryLog();
    await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {}, page: 2, pageSize: 20,
    });
    expect(cloudbase.__countQueries('Candidate')).toBe(1);
  });

  it('fetchAllApplications 分批并发拉取（不是串行等待）', async () => {
    const apps = Array.from({ length: 1200 }, (_, i) => mkApp({ _id: 'rec_' + i, candidateId: 'c' + i }));
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setQueryDelay(5);

    const got = await fetchAllApplications(cloudbase.db(), { isAdmin: true });

    expect(got).toHaveLength(1200);                                  // 仍取全，不截断
    expect(cloudbase.__getMaxInFlight()).toBeGreaterThan(1);         // 证明并发
  });

  it('fetchCandidatesByIds 分批并发拉取（不是串行等待）', async () => {
    const cands = Array.from({ length: 350 }, (_, i) => mkCand('c' + i, '候选人' + i));
    cloudbase.__setCollectionData('Candidate', cands);
    cloudbase.__setQueryDelay(5);

    const map = await fetchCandidatesByIds(cloudbase.db(), cands.map((c) => c._id));

    expect(map.size).toBe(350);
    expect(cloudbase.__getMaxInFlight()).toBeGreaterThan(1);
  });
});

// ===================== A2. 不截断契约（防御 count 失真） =====================
//
// 背景：CloudBase 的安全规则在多数情况下「不报错、静默过滤」——count() 可能返回 0 或偏小值。
// 并发拉取依赖 count 推断批数，一旦 count 失真就会截断数据，正好破坏本模块最核心的
// 「取全不截断」契约（文件头记录的两个线上故障都由截断引起）。
// 因此收尾用「最后一批是否满」续拉兜底，以下用例专门守住这条保险丝。

describe('D-1 不截断契约 — count() 失真时仍取全', () => {
  const mk1200 = () =>
    Array.from({ length: 1200 }, (_, i) => mkApp({ _id: 'rec_' + String(i).padStart(4, '0'), candidateId: 'c' + i }));

  it('count() 返回 0（被安全规则静默过滤）→ 仍取全 1200 条', async () => {
    cloudbase.__setCollectionData('Application', mk1200());
    cloudbase.__setCountOverride('Application', 0);

    const got = await fetchAllApplications(cloudbase.db(), { isAdmin: true });
    expect(got).toHaveLength(1200);
    expect(new Set(got.map((a) => a._id)).size).toBe(1200);
  });

  it('count() 偏小（600，实际 1200）→ 仍取全', async () => {
    cloudbase.__setCollectionData('Application', mk1200());
    cloudbase.__setCountOverride('Application', 600);

    const got = await fetchAllApplications(cloudbase.db(), { isAdmin: true });
    expect(got).toHaveLength(1200);
  });

  it('count() 抛错（权限拒绝）→ 回退串行，仍取全', async () => {
    cloudbase.__setCollectionData('Application', mk1200());
    cloudbase.__setCountError('Application', true);

    const got = await fetchAllApplications(cloudbase.db(), { isAdmin: true });
    expect(got).toHaveLength(1200);
  });

  it('总数恰好整除批次大小（1000 = 2×500）→ 不漏不重', async () => {
    cloudbase.__setCollectionData(
      'Application',
      Array.from({ length: 1000 }, (_, i) => mkApp({ _id: 'e_' + String(i).padStart(4, '0'), candidateId: 'c' + i }))
    );

    const got = await fetchAllApplications(cloudbase.db(), { isAdmin: true });
    expect(got).toHaveLength(1000);
    expect(new Set(got.map((a) => a._id)).size).toBe(1000);
  });

  it('CandidatesByOwner 在 count 失真时同样取全', async () => {
    cloudbase.__setCollectionData(
      'Candidate',
      Array.from({ length: 1200 }, (_, i) => mkCand('c' + i, '候选人' + i))
    );
    cloudbase.__setCountOverride('Candidate', 0);

    const got = await fetchCandidatesByOwner(cloudbase.db(), '王莉');
    expect(got).toHaveLength(1200);
  });

  it('count() 异常偏大（API 抖动）→ 回退串行，不引发请求风暴', async () => {
    cloudbase.__setCollectionData('Application', mk1200());
    cloudbase.__setCountOverride('Application', 1e9);

    const got = await fetchAllApplications(cloudbase.db(), { isAdmin: true });

    expect(got).toHaveLength(1200);
    // 若无上限防御，会按 1e9/500 = 两百万批并发发起
    expect(cloudbase.__countQueries('Application')).toBeLessThan(10);
  });

  it('批次不满一批的账号仍只发 1 次请求（不误触发 count）', async () => {
    cloudbase.__setCollectionData('Application', mk1200().slice(0, 30));

    const got = await fetchAllApplications(cloudbase.db(), { isAdmin: true });
    expect(got).toHaveLength(30);
    expect(cloudbase.__countQueries('Application')).toBe(1);
  });
});

// ===================== B. 语义等价 =====================

describe('D-1 语义等价 — 与「全量装配后分页」结果一致', () => {
  it('当前页内容与排序键（updatedAt 降序）不变', async () => {
    const apps = mkActiveApps(50); // updatedAt 递增：a0049 最新
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((_, i) => mkCand('c' + i, '候选人' + i)));

    const p1 = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {}, page: 1, pageSize: 20,
    });
    expect(p1.rows.map((x) => x.candidateId)).toEqual(
      Array.from({ length: 20 }, (_, i) => 'c' + (49 - i))
    );

    const p3 = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {}, page: 3, pageSize: 20,
    });
    expect(p3.rows).toHaveLength(10);
    expect(p3.rows.map((x) => x.candidateId)).toEqual(
      Array.from({ length: 10 }, (_, i) => 'c' + (9 - i))
    );
  });

  it('行内仍带候选人姓名（说明当前页候选人确实被查回来了）', async () => {
    const apps = mkActiveApps(30);
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((_, i) => mkCand('c' + i, '候选人' + i)));

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {}, page: 1, pageSize: 20,
    });
    expect(r.rows[0].name).toBe('候选人29');
    expect(r.rows.every((x) => typeof x.name === 'string')).toBe(true);
  });

  it('非搜索类筛选（stage/jobId）在分页前生效，total 是筛选后的全量条数', async () => {
    const apps = [
      ...mkActiveApps(30).map((a) => ({ ...a, stage: 'interview' })),
      ...Array.from({ length: 10 }, (_, i) =>
        mkApp({ _id: 'b' + i, candidateId: 'bc' + i, jobId: 'job1', stage: 'resume' })
      ),
    ];
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((a, i) => mkCand(a.candidateId, '候选人' + i)));

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: { stage: 'interview' }, page: 1, pageSize: 20,
    });
    expect(r.total).toBe(30);
    expect(r.rows).toHaveLength(20);
    expect(r.rows.every((x) => x.stage === 'interview')).toBe(true);
  });

  it('in-progress Tab 同样只按当前页取候选人，且排除 resume/onboard 端点', async () => {
    const apps = mkActiveApps(120).map((a, i) => ({ ...a, stage: i % 2 ? 'resume' : 'interview' }));
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((_, i) => mkCand('c' + i, '候选人' + i)));

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'in-progress', filters: {}, page: 1, pageSize: 20,
    });
    expect(r.total).toBe(60); // 只留 interview
    expect(r.rows.every((x) => x.stage === 'interview')).toBe(true);
    expect(cloudbase.__countQueries('Candidate')).toBe(1);
  });

  it('页码超出范围时返回空行，total 仍为全量条数', async () => {
    const apps = mkActiveApps(25);
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((_, i) => mkCand('c' + i, '候选人' + i)));

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {}, page: 99, pageSize: 20,
    });
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(25);
    expect(cloudbase.__countQueries('Candidate')).toBe(0); // 没有行就无需查候选人
  });

  it('候选人文档缺失时行仍返回，不抛错', async () => {
    const apps = mkActiveApps(5);
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', []); // 故意不提供

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {}, page: 1, pageSize: 20,
    });
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0].name).toBeUndefined();
  });

  it('搜索模式行为不变：仍跨 Tab 合并，且候选人按全量拉取以支持姓名/电话/邮箱匹配', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1' }),
      mkApp({ _id: 'a2', candidateId: 'c2', jobId: '' }), // 待分配
    ]);
    cloudbase.__setCollectionData('Candidate', [mkCand('c1', '张三'), mkCand('c2', '李四')]);

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: { search: '李四' },
    });
    expect(r.rows.map((x) => x.name)).toEqual(['李四']);
    expect(r.rows[0].sourceTab).toBe('unassigned');
  });

  it('四个 Tab 角标计数不受取数方式改变影响', async () => {
    cloudbase.__setCollectionData('Application', [
      ...mkActiveApps(5),
      mkApp({ _id: 'e1', candidateId: 'ec1', jobId: 'job1', status: 'rejected' }),
      mkApp({ _id: 'u1', candidateId: 'uc1', jobId: '' }),
    ]);
    cloudbase.__setCollectionData('Candidate', []);

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {},
    });
    expect(r.tabCounts.active).toBe(5);
    expect(r.tabCounts.ended).toBe(1);
    expect(r.tabCounts.unassigned).toBe(1);
  });
});
