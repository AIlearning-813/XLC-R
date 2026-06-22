/**
 * useCandidateStore.test.js — 候选人 Store 测试（Mock CloudBase SDK）
 *
 * 验证：创建候选人 / 软删除 / 恢复 / 永久删除 / 获取已删除列表
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock CloudBase
const { mockCloudbase, mockDb } = vi.hoisted(() => {
  // 模拟数据库集合
  const collections = {};
  const db = {
    collection: vi.fn((name) => {
      if (!collections[name]) {
        collections[name] = createMockCollection(name);
      }
      return collections[name];
    }),
  };

  function createMockCollection(name) {
    const docs = {};
    let nextId = 1;

    return {
      add: vi.fn(async (data) => {
        const id = `mock_${name}_${nextId++}`;
        docs[id] = { ...data, _id: id };
        return { id };
      }),
      doc: vi.fn((id) => ({
        get: vi.fn(async () => {
          if (!docs[id]) throw new Error('Document not found');
          return { data: [docs[id]] };
        }),
        update: vi.fn(async (data) => {
          if (docs[id]) {
            docs[id] = { ...docs[id], ...data };
          }
        }),
        remove: vi.fn(async () => {
          delete docs[id];
        }),
      })),
      where: vi.fn(() => ({
        get: vi.fn(async () => ({ data: Object.values(docs) })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn(async () => ({ data: Object.values(docs) })),
          })),
        })),
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({ data: Object.values(docs) })),
        })),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({ data: Object.values(docs) })),
        })),
      })),
    };
  }

  // 给 db 对象加 command
  db.command = {
    remove: vi.fn(() => ({ __command: 'remove' })),
    inc: vi.fn((n) => ({ __command: 'inc', value: n })),
    neq: vi.fn((v) => ({ __command: 'neq', value: v })),
  };

  const cloudbase = {
    getApp: vi.fn(() => ({})),
    db: vi.fn(() => db),
    auth: vi.fn(() => ({
      getLoginState: vi.fn(async () => ({ user: { uid: 'admin-uid' } })),
    })),
    storage: vi.fn(() => ({})),
    callFunction: vi.fn(async () => ({ result: { success: true } })),
    isReady: vi.fn(() => true),
  };

  return { mockCloudbase: cloudbase, mockDb: db };
});

vi.mock('../services/cloudbase', () => ({ default: mockCloudbase }));

// Mock auth store
vi.mock('./useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({
    isAdmin: true,
    currentUsername: 'admin',
    userName: '管理员',
    userRole: 'admin',
    isLoggedIn: true,
  })),
}));

// Mock data-filter
vi.mock('../services/data-filter', () => ({
  ownerFilter: vi.fn(() => null), // Admin sees all
}));

// Mock hash
vi.mock('../services/hash', () => ({
  attachHashes: vi.fn(async (data) => data),
}));

import { useCandidateStore } from './useCandidateStore';

let store;
beforeEach(() => {
  setActivePinia(createPinia());
  store = useCandidateStore();
});

describe('useCandidateStore', () => {
  describe('初始状态', () => {
    it('candidates 初始为空数组', () => {
      expect(store.candidates).toEqual([]);
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('error 初始为空', () => {
      expect(store.error).toBe('');
    });

    it('candidateCount 初始为 0', () => {
      expect(store.candidateCount).toBe(0);
    });
  });

  describe('add', () => {
    it('应成功创建候选人', async () => {
      const candidateData = {
        name: '张三',
        phone: '13800138000',
        email: 'zhang@test.com',
        expectedPosition: 'CC',
      };
      const result = await store.add(candidateData);
      expect(result).toHaveProperty('id');
      expect(result.id).toBeTruthy();
      expect(store.candidates.length).toBe(1);
      expect(store.candidates[0].name).toBe('张三');
    });

    it('创建后 currentCandidate 指向新候选人', async () => {
      const result = await store.add({ name: '李四' });
      expect(store.currentCandidate).toBeTruthy();
      expect(store.currentCandidate.name).toBe('李四');
    });
  });

  describe('softDelete', () => {
    it('管理员软删除应更新状态为 deleted', async () => {
      // 先创建一个候选人
      const { id } = await store.add({ name: '待删除' });

      // 软删除
      await store.softDelete(id, { skipApproval: true });

      // 本地缓存已更新
      const cached = store.candidates.find(c => c._id === id);
      expect(cached).toBeTruthy();
      expect(cached.status).toBe('deleted');
      expect(cached.deletedBy).toBe('admin');
    });
  });

  describe('fetchDeleted', () => {
    it('应调用数据库查询 status:deleted', async () => {
      await store.fetchDeleted();
      // 验证没有抛出异常
      expect(store.loading).toBe(false);
    });
  });

  describe('restore', () => {
    it('恢复候选人应从本地缓存移除', async () => {
      const { id } = await store.add({ name: '恢复测试', status: 'deleted', previousStatus: 'active' });
      store.candidates.value = [{
        _id: id, name: '恢复测试', status: 'deleted', previousStatus: 'active',
      }];

      await store.restore(id);
      // 恢复后本地缓存移除
      expect(store.candidates.find(c => c._id === id)).toBeUndefined();
    });
  });

  describe('permanentDelete', () => {
    it('永久删除应从本地缓存移除', async () => {
      store.candidates.value = [{ _id: 'perm_test_1', name: '永久删除' }];
      await store.permanentDelete('perm_test_1');
      expect(store.candidates.length).toBe(0);
    });

    it('永久删除当前候选人应清空 currentCandidate', async () => {
      store.candidates.value = [{ _id: 'current_test', name: '当前' }];
      store.currentCandidate = { _id: 'current_test', name: '当前' };
      await store.permanentDelete('current_test');
      expect(store.currentCandidate).toBeNull();
    });
  });
});
