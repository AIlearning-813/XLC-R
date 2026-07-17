/**
 * useCandidateStore.test.js — 候选人 Store 测试
 *
 * 使用 CloudBase Mock 层（src/services/__mocks__/cloudbase.js）验证：
 *   - 创建候选人 / 软删除 / 恢复 / 永久删除 / 获取已删除列表
 *   - 关联 Application 同步更新
 *   - 管理员 vs 专员权限差异
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ===== Mock CloudBase SDK（自动使用 __mocks__/cloudbase.js）=====
vi.mock('../services/cloudbase');

// ===== Mock 依赖模块 =====
vi.mock('./useAuthStore', () => {
  let adminState = {
    isAdmin: true,
    currentUsername: 'admin',
    userName: '管理员',
    userRole: 'admin',
    isLoggedIn: true,
  };
  return {
    useAuthStore: vi.fn(() => adminState),
    // 暴露内部状态用于测试切换角色
    __setAdmin: (isAdmin) => {
      adminState.isAdmin = isAdmin;
      adminState.currentUsername = isAdmin ? 'admin' : 'recruiter1';
      adminState.userName = isAdmin ? '管理员' : '招聘专员';
      adminState.userRole = isAdmin ? 'admin' : 'recruiter';
    },
  };
});

vi.mock('../services/data-filter', () => ({
  ownerFilter: vi.fn(() => null), // Admin 看全部
}));

vi.mock('../services/hash', () => ({
  attachHashes: vi.fn(async (data) => data),
}));

// ===== 导入依赖 =====
import cloudbase from '../services/cloudbase';
import { useCandidateStore } from './useCandidateStore';

let store;

beforeEach(() => {
  setActivePinia(createPinia());
  // cloudbase.__resetAll() 由 vitest.setup.js 自动调用
  store = useCandidateStore();
});

// ===== 测试辅助 =====
function seedCandidate(overrides = {}) {
  const doc = {
    _id: 'c_test_001',
    name: '张三',
    phone: '13800138000',
    email: 'zhang@test.com',
    expectedPosition: 'CC',
    status: 'active',
    ownerId: 'admin',
    ...overrides,
  };
  cloudbase.__setCollectionData('Candidate', [doc]);
  return doc;
}

function seedApplications(apps) {
  cloudbase.__setCollectionData('Application', apps);
}

describe('useCandidateStore — 通过 Mock 层', () => {
  describe('初始状态', () => {
    it('candidates 初始为空数组', () => {
      expect(store.candidates).toEqual([]);
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('candidateCount 初始为 0', () => {
      expect(store.candidateCount).toBe(0);
    });
  });

  describe('add — 创建候选人', () => {
    it('应写入 Candidate 集合并返回 id', async () => {
      const result = await store.add({
        name: '张三', phone: '13800138000', email: 'zhang@test.com',
        expectedPosition: 'CC',
      });

      expect(result.id).toBeTruthy();
      expect(store.candidates.length).toBe(1);
      expect(store.candidates[0].name).toBe('张三');

      // 验证 Mock 层数据库
      const dbData = cloudbase.__getCollectionData('Candidate');
      expect(dbData.length).toBe(1);
      expect(dbData[0].name).toBe('张三');
    });

    it('自动注入 ownerId', async () => {
      await store.add({ name: '李四' });
      const dbData = cloudbase.__getCollectionData('Candidate');
      expect(dbData[0].ownerId).toBe('admin');
    });

    it('自动注入 createdBy', async () => {
      await store.add({ name: '王五' });
      const dbData = cloudbase.__getCollectionData('Candidate');
      expect(dbData[0].createdBy).toBe('admin');
    });

    it('创建后 currentCandidate 指向新候选人', async () => {
      await store.add({ name: '赵六' });
      expect(store.currentCandidate).toBeTruthy();
      expect(store.currentCandidate.name).toBe('赵六');
    });
  });

  describe('softDelete — 软删除', () => {
    it('管理员删除：Candidate status → deleted', async () => {
      seedCandidate({ _id: 'c_del_001', name: '待删除' });

      await store.softDelete('c_del_001', { skipApproval: true });

      const dbData = cloudbase.__getCollectionData('Candidate');
      expect(dbData[0].status).toBe('deleted');
      expect(dbData[0].deletedBy).toBe('admin');
      expect(dbData[0].previousStatus).toBe('active');
    });

    it('管理员删除：关联 Application → withdrawn', async () => {
      seedCandidate({ _id: 'c_del_002', name: '待删除2' });
      seedApplications([
        { _id: 'app_001', candidateId: 'c_del_002', status: 'active' },
        { _id: 'app_002', candidateId: 'c_del_002', status: 'active' },
      ]);

      await store.softDelete('c_del_002', { skipApproval: true });

      const appData = cloudbase.__getCollectionData('Application');
      expect(appData.length).toBe(2);
      expect(appData.every(a => a.status === 'withdrawn')).toBe(true);
    });

    it('删除后本地缓存同步更新', async () => {
      seedCandidate({ _id: 'c_local_001', name: '本地缓存' });
      store.candidates = [{ _id: 'c_local_001', name: '本地缓存', status: 'active' }];

      await store.softDelete('c_local_001', { skipApproval: true });

      const cached = store.candidates.find(c => c._id === 'c_local_001');
      expect(cached).toBeTruthy();
      expect(cached.status).toBe('deleted');
    });

    it('数据库无记录也能直接删除（管理员）', async () => {
      // 不 seed 数据，Mock DB 中没有这个 candidate
      // 软删除应该也能成功（因为管理员跳过本地查找）
      await expect(
        store.softDelete('c_ghost_001', { skipApproval: true })
      ).resolves.not.toThrow();
    });
  });

  describe('fetchDeleted — 查询已删除', () => {
    it('只返回 status:deleted 的候选人', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c1', name: '活跃', status: 'active' },
        { _id: 'c2', name: '已删除1', status: 'deleted', deletedAt: new Date() },
        { _id: 'c3', name: '已删除2', status: 'deleted', deletedAt: new Date() },
        { _id: 'c4', name: '活跃2', status: 'active' },
      ]);

      await store.fetchDeleted();

      expect(store.candidates.length).toBe(2);
      expect(store.candidates.every(c => c.status === 'deleted')).toBe(true);
    });

    it('空结果不报错', async () => {
      await store.fetchDeleted();
      expect(store.candidates).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });

  describe('restore — 恢复候选人', () => {
    it('Candidate status 恢复到 previousStatus', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c_restore_001', name: '恢复测试', status: 'deleted',
          previousStatus: 'active', deletedBy: 'admin', deletedAt: new Date() },
      ]);
      seedApplications([
        { _id: 'app_r1', candidateId: 'c_restore_001', status: 'withdrawn' },
      ]);

      await store.restore('c_restore_001');

      const dbData = cloudbase.__getCollectionData('Candidate');
      expect(dbData[0].status).toBe('active');
      // deletedBy/deletedAt 被 remove 命令清除
      expect(dbData[0].deletedBy).toBeUndefined();
      expect(dbData[0].deletedAt).toBeUndefined();
      expect(dbData[0].previousStatus).toBeUndefined();
    });

    it('关联 Application 从 withdrawn 恢复为 active', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c_restore_002', name: '恢复', status: 'deleted', previousStatus: 'active' },
      ]);
      seedApplications([
        { _id: 'app_r2', candidateId: 'c_restore_002', status: 'withdrawn' },
        { _id: 'app_r3', candidateId: 'c_restore_002', status: 'withdrawn' },
      ]);

      await store.restore('c_restore_002');

      const appData = cloudbase.__getCollectionData('Application');
      expect(appData.every(a => a.status === 'active')).toBe(true);
    });

    it('恢复后从本地缓存移除', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c_restore_003', name: '本地', status: 'deleted', previousStatus: 'active' },
      ]);
      store.candidates = [
        { _id: 'c_restore_003', name: '本地', status: 'deleted', previousStatus: 'active' },
      ];

      await store.restore('c_restore_003');
      expect(store.candidates.find(c => c._id === 'c_restore_003')).toBeUndefined();
    });
  });

  describe('permanentDelete — 永久删除', () => {
    it('Candidate 和关联 Application 全部移除', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c_perm_001', name: '永久删除' },
      ]);
      seedApplications([
        { _id: 'app_p1', candidateId: 'c_perm_001', status: 'withdrawn' },
        { _id: 'app_p2', candidateId: 'c_perm_001', status: 'withdrawn' },
      ]);

      await store.permanentDelete('c_perm_001');

      expect(cloudbase.__getCollectionData('Candidate').length).toBe(0);
      expect(cloudbase.__getCollectionData('Application').length).toBe(0);
    });

    it('本地缓存同步移除', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c_local_p1', name: '本地删除' },
      ]);
      store.candidates = [{ _id: 'c_local_p1', name: '本地删除' }];
      await store.permanentDelete('c_local_p1');
      expect(store.candidates.length).toBe(0);
    });

    it('删除当前候选人时清空 currentCandidate', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c_current', name: '当前' },
      ]);
      store.candidates = [{ _id: 'c_current', name: '当前' }];
      store.currentCandidate = { _id: 'c_current', name: '当前' };
      await store.permanentDelete('c_current');
      expect(store.currentCandidate).toBeNull();
    });
  });

  describe('fetchById — 按ID查询', () => {
    it('找到候选人的数据', async () => {
      cloudbase.__setCollectionData('Candidate', [
        { _id: 'c_by_id', name: '按ID查', status: 'active' },
      ]);

      const result = await store.fetchById('c_by_id');
      expect(result).toBeTruthy();
      expect(result.name).toBe('按ID查');
      expect(store.currentCandidate.name).toBe('按ID查');
    });

    it('找不到返回 null', async () => {
      const result = await store.fetchById('nonexistent');
      expect(result).toBeNull();
    });
  });
});
