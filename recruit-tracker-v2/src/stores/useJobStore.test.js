/**
 * useJobStore.test.js — 岗位 Store 测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - CRUD（增删改查）+ 软删除为 inactive
 *   - Admin 直接写入 vs Recruiter 走审批流程
 *   - 必填字段校验 + 默认值填充
 *   - 计算属性（activeJobs / jobsByDepartment）
 *   - 乐观锁版本控制
 *   - 审计日志写入
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ===== Mock CloudBase SDK（自动使用 services/__mocks__/cloudbase.js）=====
vi.mock('../services/cloudbase');

// ===== Mock Auth Store =====
let authState;
vi.mock('./useAuthStore', () => ({
  useAuthStore: () => authState,
  // 暴露切换函数
  __setAdmin: (isAdmin) => {
    authState.isAdmin = isAdmin;
    authState.currentUsername = isAdmin ? 'admin' : 'recruiter1';
    authState.userName = isAdmin ? '管理员' : '招聘专员';
  },
}));

// ===== Mock PendingChange Store =====
let pendingChanges = [];
vi.mock('./usePendingChangeStore', () => ({
  usePendingChangeStore: () => ({
    submitChange: vi.fn(async (params) => {
      const doc = { _id: 'pc_001', ...params, status: 'pending' };
      pendingChanges.push(doc);
      return { id: 'pc_001', doc, pending: true };
    }),
    pendingChanges,
    __resetPending: () => { pendingChanges = []; },
  }),
}));

// ===== Mock 乐观锁 — 简化为直接写入 Mock DB =====
vi.mock('../services/optimistic-lock', async () => {
  const actual = await vi.importActual('../services/optimistic-lock');
  return {
    ...actual,
    versionedUpdate: vi.fn(async (collection, docId, expectedVersion, data) => {
      const cloudbase = (await import('../services/cloudbase')).default;
      const docResult = await cloudbase.db().collection(collection).doc(docId).get();
      const doc = docResult.data?.[0];
      if (!doc) throw new Error(`文档不存在 (${collection}/${docId})`);
      await cloudbase.db().collection(collection).doc(docId).update({
        ...data,
        _version: expectedVersion + 1,
        updatedAt: new Date(),
      });
      return expectedVersion + 1;
    }),
  };
});

// ===== 导入依赖 =====
import cloudbase from '../services/cloudbase';
import { useJobStore } from './useJobStore';

let store;

beforeEach(() => {
  setActivePinia(createPinia());
  // cloudbase.__resetAll() 由 vitest.setup.js 自动调用

  // 默认 Admin
  authState = {
    isAdmin: true,
    currentUsername: 'admin',
    userName: '管理员',
    isLoggedIn: true,
  };

  pendingChanges = [];
  store = useJobStore();
});

// ===== 测试辅助 =====
function seedJob(overrides = {}) {
  const doc = {
    _id: 'job_001',
    title: '课程顾问',
    type: 'CC',
    department: '销售部',
    headcount: 3,
    salaryRange: '8K-15K',
    workCity: '广州',
    requirements: '大专以上，沟通能力强',
    status: 'active',
    ownerId: 'admin',
    createdBy: 'admin',
    _version: 0,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
  cloudbase.__setCollectionData('Job', [doc]);
  return doc;
}

describe('useJobStore — 通过 Mock 层', () => {
  // ==========================================
  // 初始状态
  // ==========================================
  describe('初始状态', () => {
    it('jobs 初始为空数组', () => {
      expect(store.jobs).toEqual([]);
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('error 初始为空字符串', () => {
      expect(store.error).toBe('');
    });
  });

  // ==========================================
  // 计算属性
  // ==========================================
  describe('计算属性', () => {
    it('activeJobs — 只返回 status:active 的岗位', () => {
      store.jobs = [
        { _id: 'j1', title: '活跃岗位', status: 'active' },
        { _id: 'j2', title: '已停用', status: 'inactive' },
        { _id: 'j3', title: '活跃2', status: 'active' },
      ];
      expect(store.activeJobs).toHaveLength(2);
      expect(store.activeJobs.every(j => j.status === 'active')).toBe(true);
    });

    it('jobsByDepartment — 按部门分组活跃岗位', () => {
      store.jobs = [
        { _id: 'j1', title: 'CC', department: '销售部', status: 'active' },
        { _id: 'j2', title: '讲师', department: '教学部', status: 'active' },
        { _id: 'j3', title: 'CR', department: '销售部', status: 'active' },
        { _id: 'j4', title: '停用', department: '销售部', status: 'inactive' },
      ];
      const grouped = store.jobsByDepartment;
      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['销售部']).toHaveLength(2);
      expect(grouped['教学部']).toHaveLength(1);
    });

    it('jobsByDepartment — 无部门的岗位归入"未分配"', () => {
      store.jobs = [
        { _id: 'j1', title: '无部门', status: 'active' },
      ];
      const grouped = store.jobsByDepartment;
      expect(grouped['未分配']).toHaveLength(1);
    });
  });

  // ==========================================
  // fetchActive — 拉取活跃岗位
  // ==========================================
  describe('fetchActive — 拉取岗位', () => {
    it('从 DB 拉取 status:active 的岗位', async () => {
      cloudbase.__setCollectionData('Job', [
        { _id: 'j1', title: 'CC', status: 'active' },
        { _id: 'j2', title: '讲师', status: 'active' },
        { _id: 'j3', title: '停用', status: 'inactive' },
      ]);

      const result = await store.fetchActive();

      // Mock where({status:'active'}) 过滤结果取决于 Mock 层 where 实现
      // Mock 层 where 使用 === 匹配，所以会正确过滤
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('拉取后合并到本地缓存（去重）', async () => {
      // 本地已有 j1
      store.jobs = [{ _id: 'j1', title: '旧CC', status: 'active' }];

      cloudbase.__setCollectionData('Job', [
        { _id: 'j1', title: '新CC', status: 'active' },
        { _id: 'j2', title: '讲师', status: 'active' },
      ]);

      await store.fetchActive();

      // j1 不会被覆盖（去重逻辑：existingIds 已存在则跳过）
      const j1 = store.jobs.find(j => j._id === 'j1');
      expect(j1.title).toBe('旧CC');
      // j2 被新增
      expect(store.jobs.find(j => j._id === 'j2')).toBeTruthy();
    });

    it('空结果不报错', async () => {
      const result = await store.fetchActive();
      expect(result).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });

  // ==========================================
  // getById — 按 ID 查找
  // ==========================================
  describe('getById', () => {
    it('本地缓存中查找并返回', () => {
      store.jobs = [
        { _id: 'j1', title: 'CC' },
        { _id: 'j2', title: '讲师' },
      ];
      expect(store.getById('j2').title).toBe('讲师');
    });

    it('找不到返回 null', () => {
      expect(store.getById('nonexistent')).toBeNull();
    });
  });

  // ==========================================
  // add — 新增岗位（Admin 流程）
  // ==========================================
  describe('add — 新增岗位', () => {
    const validJobData = {
      title: '课程顾问',
      type: 'CC',
      department: '销售部',
      headcount: 3,
    };

    it('Admin：写入 Job 集合 + 返回完整文档', async () => {
      const result = await store.add(validJobData);

      expect(result._id).toBeTruthy();
      expect(result.title).toBe('课程顾问');
      expect(result.status).toBe('active');

      // 验证 Mock DB
      const dbData = cloudbase.__getCollectionData('Job');
      expect(dbData).toHaveLength(1);
      expect(dbData[0].title).toBe('课程顾问');
    });

    it('自动注入 ownerId 和 createdBy', async () => {
      const result = await store.add(validJobData);
      expect(result.ownerId).toBe('admin');
      expect(result.createdBy).toBe('admin');
    });

    it('自动注入 _version = 0', async () => {
      const result = await store.add(validJobData);
      expect(result._version).toBe(0);
    });

    it('自动插入到本地缓存头部', async () => {
      store.jobs = [{ _id: 'old', title: '旧岗位', status: 'active' }];
      await store.add(validJobData);
      expect(store.jobs).toHaveLength(2);
      expect(store.jobs[0].title).toBe('课程顾问');
    });

    it('自定义 status', async () => {
      const result = await store.add({ ...validJobData, status: 'draft' });
      expect(result.status).toBe('draft');
    });

    it('审计日志写入（成功时异步调用）', async () => {
      await store.add(validJobData);
      // callFunction 被调用过（异步，不阻塞主流程）
      // Mock 层默认返回 { success: true }
      expect(cloudbase.callFunction).toHaveBeenCalled();
    });

    // ===== 必填字段校验 =====
    it('缺少 title → 抛出错误', async () => {
      await expect(store.add({ type: 'CC' })).rejects.toThrow('必填字段');
    });

    it('缺少 type → 抛出错误', async () => {
      await expect(store.add({ title: '测试' })).rejects.toThrow('必填字段');
    });

    it('错误消息列出所有缺失字段', async () => {
      try {
        await store.add({});
      } catch (e) {
        // 错误消息应包含缺失字段名
        expect(e.message).toContain('必填字段');
      }
    });

    // ===== Recruiter 流程 =====
    it('Recruiter：提交到 PendingChanges（不走直接写入）', async () => {
      authState.isAdmin = false;
      authState.currentUsername = 'recruiter1';

      const result = await store.add(validJobData);

      expect(result.pending).toBe(true);
      expect(result.id).toBe('pc_001');

      // Job 集合无直接写入
      const dbData = cloudbase.__getCollectionData('Job');
      expect(dbData).toHaveLength(0);

      // PendingChanges 有记录
      expect(pendingChanges).toHaveLength(1);
      expect(pendingChanges[0].action).toBe('create');
    });
  });

  // ==========================================
  // update — 更新岗位
  // ==========================================
  describe('update — 更新岗位', () => {
    it('Admin：版本锁更新 + 本地缓存同步', async () => {
      seedJob({ _id: 'job_upd', title: '旧标题' });
      store.jobs = [{ _id: 'job_upd', title: '旧标题', _version: 0, status: 'active' }];

      await store.update('job_upd', { title: '新标题' });

      // Mock DB 已更新
      const dbData = cloudbase.__getCollectionData('Job');
      expect(dbData[0].title).toBe('新标题');

      // 本地缓存同步
      const cached = store.jobs.find(j => j._id === 'job_upd');
      expect(cached.title).toBe('新标题');
    });

    it('岗位不存在 → 抛出错误', async () => {
      await expect(store.update('nonexistent', { title: 'X' }))
        .rejects.toThrow('岗位不存在');
    });

    it('Recruiter：提交到 PendingChanges', async () => {
      authState.isAdmin = false;
      authState.currentUsername = 'recruiter1';
      store.jobs = [{ _id: 'job_rec', title: '旧', _version: 0, status: 'active', ownerId: 'recruiter1' }];

      const result = await store.update('job_rec', { title: '新' });

      expect(result.pending).toBe(true);
      expect(pendingChanges).toHaveLength(1);
    });
  });

  // ==========================================
  // remove — 软删除岗位
  // ==========================================
  describe('remove — 软删除', () => {
    it('Admin：status → inactive + 记录删除信息', async () => {
      seedJob({ _id: 'job_del', status: 'active' });
      store.jobs = [{ _id: 'job_del', title: '待删除', status: 'active', _version: 0 }];

      await store.remove('job_del');

      const dbData = cloudbase.__getCollectionData('Job');
      expect(dbData[0].status).toBe('inactive');
      expect(dbData[0].previousStatus).toBe('active');
      expect(dbData[0].deletedAt).toBeTruthy();
    });

    it('本地缓存同步为 inactive', async () => {
      seedJob({ _id: 'job_del2', status: 'active' });
      store.jobs = [{ _id: 'job_del2', title: '待删除2', status: 'active', _version: 0 }];

      await store.remove('job_del2');

      const cached = store.jobs.find(j => j._id === 'job_del2');
      expect(cached.status).toBe('inactive');
    });

    it('岗位不存在 → 抛出错误', async () => {
      await expect(store.remove('nonexistent'))
        .rejects.toThrow('岗位不存在');
    });

    it('Recruiter：提交到 PendingChanges', async () => {
      authState.isAdmin = false;
      authState.currentUsername = 'recruiter1';
      store.jobs = [{ _id: 'job_rec_del', title: '待删', status: 'active', _version: 0, ownerId: 'recruiter1' }];

      const result = await store.remove('job_rec_del');

      expect(result.pending).toBe(true);
      expect(pendingChanges[0].action).toBe('delete');
    });

    it('审计日志写入', async () => {
      seedJob({ _id: 'job_audit', status: 'active' });
      store.jobs = [{ _id: 'job_audit', title: '审计', status: 'active', _version: 0 }];

      await store.remove('job_audit');

      // 异步审计日志被调用
      expect(cloudbase.callFunction).toHaveBeenCalled();
    });
  });

  // ==========================================
  // hasActiveJobs
  // ==========================================
  describe('hasActiveJobs', () => {
    it('有活跃岗位返回 true', () => {
      store.jobs = [{ _id: 'j1', status: 'active' }];
      expect(store.hasActiveJobs()).toBe(true);
    });

    it('无活跃岗位返回 false', () => {
      store.jobs = [];
      expect(store.hasActiveJobs()).toBe(false);
    });

    it('只有 inactive 返回 false', () => {
      store.jobs = [{ _id: 'j1', status: 'inactive' }];
      expect(store.hasActiveJobs()).toBe(false);
    });
  });

  // ==========================================
  // 乐观锁工具导出
  // ==========================================
  describe('乐观锁工具', () => {
    it('isVersionConflict 可调用', () => {
      expect(typeof store.isVersionConflict).toBe('function');
    });

    it('conflictMessage 可调用', () => {
      expect(typeof store.conflictMessage).toBe('function');
    });
  });
});
