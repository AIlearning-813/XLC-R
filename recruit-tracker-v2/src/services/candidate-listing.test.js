/**
 * candidate-listing.test.js — 候选人全量列表/待分配数据服务
 *
 * 验证两个关键修复：
 *   1. 分页拉全（>500 不截断）——消除"入库却搜不到"
 *   2. 已分配统一判定（跨分页去重）——消除"已分配却滞留待分配"
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===== Mock CloudBase =====
vi.mock('./cloudbase');

import cloudbase from './cloudbase';
import {
  fetchAllApplications,
  fetchCandidatesByIds,
  fetchCandidatesByOwner,
  buildApplicationIndex,
  selectTabApps,
  collectUnassignedEntries,
  sortByUpdatedDesc,
  rowMatch,
  pickPage,
  tagRows,
  countByTab,
  dedupeById,
  applyAppFilters,
  buildApplicationRows,
  buildUnassignedRows,
  loadWorkspace,
  SEARCH_TABS,
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

describe('fetchAllApplications — 分页拉全，不截断', () => {
  it('超过单批(500)仍能取全（专员视角，带 ownerId 过滤）', async () => {
    const apps = Array.from({ length: 1200 }, (_, i) =>
      mkApp({
        _id: 'rec_' + String(i).padStart(5, '0'),
        candidateId: 'cand_' + i,
        ownerId: '王莉',
      })
    );
    cloudbase.__setCollectionData('Application', apps);

    const got = await fetchAllApplications(cloudbase.db(), { ownerId: '王莉', isAdmin: false });
    expect(got.length).toBe(1200);
    expect(new Set(got.map((a) => a._id)).size).toBe(1200); // 无重复
  });

  it('ownerId 过滤生效（不含他人数据）', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', ownerId: '王莉' }),
      mkApp({ _id: 'a2', candidateId: 'c2', ownerId: '刘滢滢' }),
      mkApp({ _id: 'a3', candidateId: 'c3', ownerId: '王莉' }),
    ]);
    const got = await fetchAllApplications(cloudbase.db(), { ownerId: '王莉', isAdmin: false });
    expect(got.map((a) => a._id).sort()).toEqual(['a1', 'a3']);
  });

  it('admin 不加 ownerId 过滤，取全库', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', ownerId: '王莉' }),
      mkApp({ _id: 'a2', ownerId: '刘滢滢' }),
    ]);
    const got = await fetchAllApplications(cloudbase.db(), { ownerId: null, isAdmin: true });
    expect(got.length).toBe(2);
  });
});

describe('已分配/待分配统一判定', () => {
  it('存在任一已分配申请 → 不出现在待分配（修复"假待分配"）', () => {
    const apps = [
      mkApp({ _id: 'c1_empty', candidateId: 'c1', jobId: '' }),            // 残留空 jobId active
      mkApp({ _id: 'c1_assigned', candidateId: 'c1', jobId: 'J1' }),       // 真已分配
      mkApp({ _id: 'c2_empty', candidateId: 'c2', jobId: '' }),            // 真正待分配
      mkApp({ _id: 'c3_empty_ended', candidateId: 'c3', jobId: '', status: 'rejected' }), // 已结束空申请
    ];
    const idx = buildApplicationIndex(apps);
    const entries = collectUnassignedEntries(apps, idx, [], { ownerId: '王莉', isAdmin: false });

    const ids = entries.map((e) => e.candidateId);
    expect(ids).toContain('c2');   // 真待分配保留
    expect(ids).not.toContain('c1'); // 已分配过 → 排除
    expect(ids).not.toContain('c3'); // 空申请已结束 → 排除
    expect(entries.find((e) => e.candidateId === 'c2').app?._id).toBe('c2_empty');
  });

  it('孤儿候选人（ownerId==me 且无本人申请）计入待分配；admin 不看孤儿', () => {
    const apps = [mkApp({ _id: 'a1', candidateId: 'c1', jobId: '' })];
    const orphans = [{ _id: 'orphan1', ownerId: '王莉', name: '孤儿' }];

    const idx = buildApplicationIndex(apps);
    const recruiter = collectUnassignedEntries(apps, idx, orphans, { ownerId: '王莉', isAdmin: false });
    expect(recruiter.map((e) => e.candidateId)).toEqual(['c1', 'orphan1']);

    const admin = collectUnassignedEntries(apps, idx, orphans, { ownerId: null, isAdmin: true });
    expect(admin.map((e) => e.candidateId)).toEqual(['c1']); // admin 不纳入孤儿
  });

  it('被本人申请引用的候选人不再重复算作孤儿', () => {
    const apps = [mkApp({ _id: 'a1', candidateId: 'c1', jobId: '' })]; // 王莉的申请引用 c1
    const orphans = [
      { _id: 'c1', ownerId: '王莉', name: '已有申请' },   // 已被引用 → 非孤儿
      { _id: 'orphan2', ownerId: '王莉', name: '真孤儿' }, // 未被引用 → 孤儿
    ];
    const idx = buildApplicationIndex(apps);
    const entries = collectUnassignedEntries(apps, idx, orphans, { ownerId: '王莉', isAdmin: false });
    expect(entries.map((e) => e.candidateId)).toEqual(['c1', 'orphan2']);
  });
});

describe('selectTabApps — Tab 语义', () => {
  const apps = [
    mkApp({ _id: 'a_resume', candidateId: 'c1', stage: 'resume', jobId: 'J1' }),
    mkApp({ _id: 'a_offer', candidateId: 'c2', stage: 'offer', jobId: 'J2' }),
    mkApp({ _id: 'a_empty', candidateId: 'c3', jobId: '' }),
    mkApp({ _id: 'a_rejected', candidateId: 'c4', status: 'rejected' }),
    mkApp({ _id: 'a_archived', candidateId: 'c5', jobId: 'J3', isArchived: true }),
  ];

  it('active：active+未归档+jobId 非空', () => {
    const got = selectTabApps(apps, 'active').map((a) => a._id).sort();
    expect(got).toEqual(['a_offer', 'a_resume']);
  });

  it('in-progress：active 基础上排除 resume/onboard', () => {
    const got = selectTabApps(apps, 'in-progress').map((a) => a._id);
    expect(got).toEqual(['a_offer']);
  });

  it('ended：仅 rejected/withdrawn', () => {
    const got = selectTabApps(apps, 'ended').map((a) => a._id);
    expect(got).toEqual(['a_rejected']);
  });
});

describe('搜索/排序/分页纯函数', () => {
  it('rowMatch 命中姓名/电话/邮箱，空关键词恒真', () => {
    const row = { name: '高雪纯', phone: '13505494867', email: 'gxc@qq.com' };
    expect(rowMatch(row, '高雪纯')).toBe(true);
    expect(rowMatch(row, '94867')).toBe(true);
    expect(rowMatch(row, 'GXC')).toBe(true);   // 邮箱大小写不敏感
    expect(rowMatch(row, '  ')).toBe(true);    // 空白视为无关键词
    expect(rowMatch(row, '张三')).toBe(false);
  });

  it('sortByUpdatedDesc 按 updatedAt 降序，缺失回退 createdAt', () => {
    const list = [
      mkApp({ _id: 'old', updatedAt: '2026-01-01T00:00:00Z' }),
      mkApp({ _id: 'new', updatedAt: '2026-03-01T00:00:00Z' }),
      { _id: 'noUpd', createdAt: '2026-02-01T00:00:00Z' }, // 无 updatedAt
    ];
    expect(sortByUpdatedDesc(list).map((x) => x._id)).toEqual(['new', 'noUpd', 'old']);
  });

  it('pickPage 正确切片并返回总数', () => {
    const list = [1, 2, 3, 4, 5, 6, 7];
    const p1 = pickPage(list, 1, 3);
    expect(p1.total).toBe(7);
    expect(p1.rows).toEqual([1, 2, 3]);
    const p3 = pickPage(list, 3, 3);
    expect(p3.rows).toEqual([7]);
  });
});

describe('fetchCandidatesByIds / fetchCandidatesByOwner', () => {
  it('按 id 批量取候选人（返回 Map）', async () => {
    cloudbase.__setCollectionData('Candidate', [
      { _id: 'x1', name: '甲' },
      { _id: 'x2', name: '乙' },
      { _id: 'x3', name: '丙' },
    ]);
    const map = await fetchCandidatesByIds(cloudbase.db(), ['x1', 'x2', 'missing']);
    expect(map.size).toBe(2);
    expect(map.get('x1').name).toBe('甲');
    expect(map.has('missing')).toBe(false);
  });

  it('按 ownerId 分页取候选人', async () => {
    const cands = Array.from({ length: 600 }, (_, i) => ({
      _id: 'cc_' + String(i).padStart(5, '0'),
      ownerId: '王莉',
      name: 'n' + i,
    }));
    cloudbase.__setCollectionData('Candidate', cands);
    const got = await fetchCandidatesByOwner(cloudbase.db(), '王莉');
    expect(got.length).toBe(600);
  });
});

// ===================== 跨 Tab 搜索 + 角标计数（A / B） =====================

/** 构造候选人文档 */
function mkCand(id, name, overrides = {}) {
  return { _id: id, name, ownerId: '王莉', ...overrides };
}

/** 复现真实故障：郑嘉鹏在库两条（邮箱归集待分配 + 手动导入已分配），fileHash 相同 */
function seedZhengJiapeng() {
  cloudbase.__setCollectionData('Application', [
    mkApp({ _id: 'a_unassigned', candidateId: 'c1', jobId: '', status: 'active', ownerId: '王莉' }),
    mkApp({ _id: 'a_active', candidateId: 'c2', jobId: 'job1', status: 'active', ownerId: '王莉' }),
  ]);
  cloudbase.__setCollectionData('Candidate', [
    mkCand('c1', '郑嘉鹏', { sourceEmailSubject: '郑嘉鹏 | 3年，应聘 课程顾问 | 青岛8-13K【BOSS直聘】' }),
    mkCand('c2', '郑嘉鹏', { recruitmentSource: 'BOSS直聘' }),
  ]);
}

describe('tagRows — 来源 Tab 标记', () => {
  it('每行都带上 sourceTab，且不改原数组', () => {
    const input = [{ _id: 'r1' }, { _id: 'r2' }];
    const out = tagRows(input, 'unassigned');
    expect(out.every((r) => r.sourceTab === 'unassigned')).toBe(true);
    expect(input[0].sourceTab).toBeUndefined(); // 原数组未被污染
    expect(out[0]._id).toBe('r1');
  });

  it('空输入返回空数组', () => {
    expect(tagRows(null, 'active')).toEqual([]);
  });
});

describe('countByTab — 四个 Tab 角标计数', () => {
  it('四类申请混合时四个计数正确', () => {
    const apps = [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', status: 'active', stage: 'resume' }),
      mkApp({ _id: 'a2', candidateId: 'c2', jobId: 'job1', status: 'active', stage: 'interview' }),
      mkApp({ _id: 'a3', candidateId: 'c3', jobId: '', status: 'active' }),
      mkApp({ _id: 'a4', candidateId: 'c4', jobId: 'job1', status: 'rejected' }),
    ];
    const idx = buildApplicationIndex(apps);
    const entries = collectUnassignedEntries(apps, idx, [], { ownerId: '王莉', isAdmin: false });

    expect(countByTab(apps, entries)).toEqual({
      active: 2,          // a1 + a2
      'in-progress': 1,   // a2（排除 resume 端点）
      unassigned: 1,      // a3
      ended: 1,           // a4
    });
  });

  it('in-progress 是 active 的子集，两个计数并存互不影响', () => {
    const apps = [mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', stage: 'interview' })];
    const counts = countByTab(apps, []);
    expect(counts.active).toBe(1);
    expect(counts['in-progress']).toBe(1);
  });

  it('归档申请不计入任何角标', () => {
    const apps = [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', status: 'active', isArchived: true }),
      mkApp({ _id: 'a2', candidateId: 'c2', jobId: 'job1', status: 'rejected', isArchived: true }),
    ];
    expect(countByTab(apps, [])).toEqual({ active: 0, 'in-progress': 0, unassigned: 0, ended: 0 });
  });
});

describe('dedupeById — 跨 Tab 合并去重', () => {
  it('按 _id 去重且保持首次出现顺序', () => {
    const out = dedupeById([{ _id: 'x' }, { _id: 'y' }, { _id: 'x' }]);
    expect(out.map((r) => r._id)).toEqual(['x', 'y']);
  });

  it('过滤空元素', () => {
    expect(dedupeById([null, { _id: 'x' }, undefined])).toHaveLength(1);
  });
});

describe('applyAppFilters — 非搜索类筛选', () => {
  const apps = [
    mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', stage: 'resume', createdAt: '2026-01-10T00:00:00Z', funnelMeta: { entrySource: 'email' } }),
    mkApp({ _id: 'a2', candidateId: 'c2', jobId: 'job2', stage: 'interview', createdAt: '2026-02-10T00:00:00Z', funnelMeta: { entrySource: 'manual' } }),
  ];

  it('按 stage 筛选', () => {
    expect(applyAppFilters(apps, { stage: 'interview' }).map((a) => a._id)).toEqual(['a2']);
  });

  it('按 jobId 筛选', () => {
    expect(applyAppFilters(apps, { jobId: 'job1' }).map((a) => a._id)).toEqual(['a1']);
  });

  it('按 entrySource 筛选', () => {
    expect(applyAppFilters(apps, { source: 'manual' }).map((a) => a._id)).toEqual(['a2']);
  });

  it('dateTo 覆盖当天 23:59:59.999（当天创建的不会被漏掉）', () => {
    // 注意：dateTo 的边界按本地时区计算（setHours），夹具取当天本地白天，避免跑在非 UTC+8 时区时抖动
    const sameDay = [mkApp({ _id: 'd1', candidateId: 'c1', createdAt: '2026-03-05T06:00:00Z' })];
    expect(applyAppFilters(sameDay, { dateTo: '2026-03-05' })).toHaveLength(1);
    expect(applyAppFilters(sameDay, { dateFrom: '2026-03-06' })).toHaveLength(0);
  });

  it('无筛选条件时原样返回', () => {
    expect(applyAppFilters(apps, {})).toHaveLength(2);
  });
});

describe('loadWorkspace — 跨 Tab 搜索（A）', () => {
  it('只在「待分配」的候选人在「活跃」Tab 搜索也能命中，并标注来源 Tab', async () => {
    seedZhengJiapeng();

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', isAdmin: false, tab: 'active',
      filters: { search: '郑嘉鹏' }, page: 1, pageSize: 20,
    });

    expect(r.total).toBe(2);
    const byTab = Object.fromEntries(r.rows.map((x) => [x.sourceTab, x]));
    expect(byTab.unassigned).toBeDefined();
    expect(byTab.unassigned.name).toBe('郑嘉鹏');
    expect(byTab.unassigned.jobId).toBe('');
    expect(byTab.active.jobId).toBe('job1');
  });

  it('搜索按手机号同样跨 Tab 命中', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: '', status: 'active' }),
    ]);
    cloudbase.__setCollectionData('Candidate', [
      mkCand('c1', '某人', { phone: '13800001111' }),
    ]);

    const byPhone = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: { search: '13800001111' },
    });
    expect(byPhone.total).toBe(1);
    expect(byPhone.rows[0].sourceTab).toBe('unassigned');
  });

  it('不并入 in-progress：同时属于 active 与 in-progress 的申请只出现一次', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a_both', candidateId: 'c1', jobId: 'job1', stage: 'interview' }),
    ]);
    cloudbase.__setCollectionData('Candidate', [mkCand('c1', '张三')]);

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: { search: '张三' },
    });

    expect(r.rows.filter((x) => x.appId === 'a_both')).toHaveLength(1);
    expect(SEARCH_TABS).not.toContain('in-progress');
  });

  it('搜索模式下的行集按 _id 去重', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', status: 'active' }),
    ]);
    cloudbase.__setCollectionData('Candidate', [mkCand('c1', '李四')]);

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: { search: '李四' },
    });
    expect(new Set(r.rows.map((x) => x._id)).size).toBe(r.rows.length);
  });

  it('搜索时仍返回四个 Tab 的角标数', async () => {
    seedZhengJiapeng();
    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: { search: '郑嘉鹏' },
    });
    // in-progress 为 0：该申请 stage 是 resume 端点，本就不属于「流程中」
    expect(r.tabCounts).toEqual({ active: 1, 'in-progress': 0, unassigned: 1, ended: 0 });
  });
});

describe('loadWorkspace — 无搜索词时的行为回归（与重构前一致）', () => {
  it('只返回当前 Tab 的行集，不跨 Tab', async () => {
    seedZhengJiapeng();

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: {}, page: 1, pageSize: 20,
    });

    expect(r.total).toBe(1);
    expect(r.rows[0].appId).toBe('a_active');
    expect(r.rows[0].sourceTab).toBe('active');
  });

  it('待分配 Tab 只返回真正未分配的候选人', async () => {
    seedZhengJiapeng();

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'unassigned', filters: {},
    });

    expect(r.total).toBe(1);
    expect(r.rows[0].candidateId).toBe('c1');
    expect(r.rows[0].status).toBe('unassigned');
  });

  it('待分配 Tab 忽略 stage/jobId/source/date，只认搜索词（现状保留）', async () => {
    seedZhengJiapeng();

    const withFilters = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'unassigned',
      filters: { stage: '不存在的阶段', jobId: 'job1', source: 'manual' },
    });

    expect(withFilters.total).toBe(1); // 筛选被忽略 → 仍在
  });

  it('已结束 Tab 只返回 rejected/withdrawn', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', status: 'rejected' }),
      mkApp({ _id: 'a2', candidateId: 'c2', jobId: 'job1', status: 'active' }),
      mkApp({ _id: 'a3', candidateId: 'c3', jobId: 'job1', status: 'withdrawn' }),
    ]);
    cloudbase.__setCollectionData('Candidate', [
      mkCand('c1', '甲'), mkCand('c2', '乙'), mkCand('c3', '丙'),
    ]);

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'ended', filters: {},
    });
    expect(r.rows.map((x) => x.candidateId).sort()).toEqual(['c1', 'c3']);
    expect(r.rows.every((x) => x.sourceTab === 'ended')).toBe(true);
  });

  it('非搜索类筛选在无搜索词时照常作用于当前 Tab', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', stage: 'interview' }),
      mkApp({ _id: 'a2', candidateId: 'c2', jobId: 'job1', stage: 'resume' }),
    ]);
    cloudbase.__setCollectionData('Candidate', [mkCand('c1', '甲'), mkCand('c2', '乙')]);

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: { stage: 'interview' },
    });
    expect(r.rows.map((x) => x.candidateId)).toEqual(['c1']);
  });

  it('行按 updatedAt 降序排列', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', updatedAt: '2026-01-01T00:00:00Z' }),
      mkApp({ _id: 'a2', candidateId: 'c2', jobId: 'job1', updatedAt: '2026-05-01T00:00:00Z' }),
    ]);
    cloudbase.__setCollectionData('Candidate', [mkCand('c1', '旧'), mkCand('c2', '新')]);

    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: {},
    });
    expect(r.rows.map((x) => x.candidateId)).toEqual(['c2', 'c1']);
  });

  it('admin 视角不加 ownerId 过滤，取全库', async () => {
    cloudbase.__setCollectionData('Application', [
      mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1', ownerId: '王莉' }),
      mkApp({ _id: 'a2', candidateId: 'c2', jobId: 'job1', ownerId: '刘滢滢' }),
    ]);
    cloudbase.__setCollectionData('Candidate', [
      { _id: 'c1', name: '甲', ownerId: '王莉' },
      { _id: 'c2', name: '乙', ownerId: '刘滢滢' },
    ]);

    const r = await loadWorkspace(cloudbase.db(), {
      isAdmin: true, ownerId: null, tab: 'active', filters: {},
    });
    expect(r.total).toBe(2);
  });
});

describe('loadWorkspace — 分页与返回值形状', () => {
  it('total 是筛选后的全量条数，不是当页条数', async () => {
    const apps = Array.from({ length: 25 }, (_, i) =>
      mkApp({ _id: 'a' + String(i).padStart(2, '0'), candidateId: 'c' + i, jobId: 'job1' })
    );
    cloudbase.__setCollectionData('Application', apps);
    cloudbase.__setCollectionData('Candidate', apps.map((a, i) => mkCand('c' + i, '候选人' + i)));

    const p1 = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: {}, page: 1, pageSize: 20,
    });
    expect(p1.rows).toHaveLength(20);
    expect(p1.total).toBe(25);

    const p2 = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: {}, page: 2, pageSize: 20,
    });
    expect(p2.rows).toHaveLength(5);
    expect(p2.total).toBe(25);
  });

  it('返回 { rows, total, tabCounts } 三件套', async () => {
    seedZhengJiapeng();
    const r = await loadWorkspace(cloudbase.db(), { ownerId: '王莉', tab: 'active' });
    expect(Object.keys(r).sort()).toEqual(['rows', 'tabCounts', 'total']);
  });

  it('行字段形状与旧版一致（派生字段不缺）', async () => {
    seedZhengJiapeng();
    const r = await loadWorkspace(cloudbase.db(), {
      ownerId: '王莉', tab: 'active', filters: {},
    });
    const row = r.rows[0];
    for (const k of ['_id', 'appId', 'candidateId', 'name', 'jobId', 'stage', 'status', '_candidate', '_application', '_job', 'sourceTab']) {
      expect(row).toHaveProperty(k);
    }
  });
});

describe('buildApplicationRows / buildUnassignedRows — 纯装配', () => {
  it('已分配行带岗位标题，未分配行岗位字段为空', () => {
    const app = mkApp({ _id: 'a1', candidateId: 'c1', jobId: 'job1' });
    const cm = new Map([['c1', mkCand('c1', '甲')]]);

    const assigned = buildApplicationRows([app], cm, { job1: { title: '课程顾问' } });
    expect(assigned[0].jobTitle).toBe('课程顾问');
    expect(assigned[0].status).toBe('active');

    const unassigned = buildUnassignedRows(
      [{ candidateId: 'c1', app: { _id: 'a2', stage: 'resume' }, orphan: false }],
      cm,
      { ownerId: '王莉' }
    );
    expect(unassigned[0].jobTitle).toBe('');
    expect(unassigned[0].jobId).toBe('');
    expect(unassigned[0].status).toBe('unassigned');
    expect(unassigned[0]._id).toBe('a2');
  });

  it('孤儿行以 candidateId 作 _id（无申请可承载）', () => {
    const rows = buildUnassignedRows(
      [{ candidateId: 'c9', app: null, orphan: true, candidate: mkCand('c9', '孤儿') }],
      new Map(),
      { ownerId: '王莉' }
    );
    expect(rows[0]._id).toBe('c9');
    expect(rows[0].appId).toBe('');
    expect(rows[0]._job).toBeNull();
  });

  it('候选人文档缺失时不抛错', () => {
    const rows = buildApplicationRows([mkApp({ _id: 'a1', candidateId: 'gone' })], new Map(), {});
    expect(rows[0].name).toBeUndefined();
  });
});
