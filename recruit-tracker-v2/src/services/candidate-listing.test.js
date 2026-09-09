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
