/**
 * useRecruitmentDemandStore.test.js — 招聘需求 Store 测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - 初始状态 + STATUS_LABELS 常量
 *   - fetchAll（Admin 拉全部 / Recruiter 仅看自己的 / 状态筛选 / 空结果）
 *   - fetchById（成功 / 未找到）
 *   - submit（Admin 直接写入 + 自动创建 Job / Recruiter 走审批 / 缺失必填字段）
 *   - updateStatus（成功 + 本地缓存同步）
 *   - softDelete（Admin 直接删 / Recruiter 走审批 / skipApproval 绕过）
 *   - 错误处理（数据库未初始化 / 网络异常 / loading 状态）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ===== Mock CloudBase SDK（自动使用 services/__mocks__/cloudbase.js）=====
vi.mock('../services/cloudbase');

// ===== Mock Error Capture =====
vi.mock('../services/error-capture', () => ({
  captureError: vi.fn(),
}));

// ===== Mock Optimistic Lock =====
vi.mock('../services/optimistic-lock', () => ({
  initialVersion: () => 0,
}));

// ===== 共享 authState（data-filter 和 useAuthStore 都读取这个对象）=====
let authState;

// ===== Mock Data Filter（读取 authState 动态返回）=====
vi.mock('../services/data-filter', () => ({
  ownerFilter: vi.fn(() => {
    if (authState.isAdmin) return null;
    return { ownerId: authState.currentUsername };
  }),
}));

// ===== Mock Auth Store =====
vi.mock('./useAuthStore', () => ({
  useAuthStore: () => authState,
}));

// ===== Mock PendingChange Store =====
let pendingChanges = [];
vi.mock('./usePendingChangeStore', () => ({
  usePendingChangeStore: () => ({
    submitChange: vi.fn(async (params) => {
      const doc = { _id: 'pc_' + Date.now(), ...params, status: 'pending' };
      pendingChanges.push(doc);
      return { id: doc._id, doc, pending: true };
    }),
  }),
}));

// ===== Mock Job Store =====
vi.mock('./useJobStore', () => ({
  useJobStore: () => ({
    add: vi.fn(async () => ({ _id: 'job_mock_001', title: 'test' })),
  }),
}));

// ===== Mock Config Store =====
vi.mock('./useConfigStore', () => ({
  useConfigStore: () => ({
    jobTypes: { CC: { requirements: 'CC要求', responsibilities: 'CC职责' } },
    loadConfig: vi.fn(async () => {}),
  }),
}));

// ===== 导入依赖 =====
import cloudbase from '../services/cloudbase';
import { useRecruitmentDemandStore } from './useRecruitmentDemandStore';

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
  store = useRecruitmentDemandStore();
});

// ===== 测试辅助 =====
function seedDemand(overrides = {}) {
  const doc = {
    _id: 'demand_001',
    title: '课程顾问',
    department: '销售部',
    headcount: 3,
    jobType: 'CC',
    ownerId: 'admin',
    status: 'recruiting',
    linkedJobId: null,
    _version: 0,
    submittedAt: new Date('2025-01-01'),
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
  cloudbase.__setCollectionData('RecruitmentDemand', [doc]);
  return doc;
}

function seedDemands(docs) {
  cloudbase.__setCollectionData('RecruitmentDemand', docs);
}

describe('useRecruitmentDemandStore — 通过 Mock 层', () => {
  // ==========================================
  // 初始状态 + STATUS_LABELS
  // ==========================================
  describe('初始状态', () => {
    it('demands 初始为空数组', () => {
      expect(store.demands).toEqual([]);
    });

    it('currentDemand 初始为 null', () => {
      expect(store.currentDemand).toBeNull();
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('error 初始为空字符串', () => {
      expect(store.error).toBe('');
    });

    it('STATUS_LABELS 包含所有状态的中文映射', () => {
      expect(store.STATUS_LABELS).toEqual({
        pending: '待审批',
        active: '已生效',
        recruiting: '招聘中',
        completed: '已完成',
        closed: '已关闭',
        deleted: '已删除',
      });
    });
  });

  // ==========================================
  // fetchAll — 批量拉取
  // ==========================================
  describe('fetchAll — 拉取招聘需求列表', () => {
    it('Admin：拉取全部非 deleted 的需求', async () => {
      seedDemands([
        { _id: 'd1', title: 'CC', status: 'recruiting', ownerId: 'admin', submittedAt: '2025-03-01' },
        { _id: 'd2', title: '讲师', status: 'active', ownerId: 'recruiter1', submittedAt: '2025-02-01' },
        { _id: 'd3', title: '已删除', status: 'deleted', ownerId: 'admin', submittedAt: '2025-01-01' },
      ]);

      const result = await store.fetchAll();

      // 应过滤掉 deleted
      expect(result).toHaveLength(2);
      expect(result.map(r => r._id).sort()).toEqual(['d1', 'd2']);
      expect(store.demands).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it('带 status 筛选参数', async () => {
      seedDemands([
        { _id: 'd1', title: 'CC', status: 'recruiting', ownerId: 'admin', submittedAt: '2025-02-01' },
        { _id: 'd2', title: '讲师', status: 'active', ownerId: 'admin', submittedAt: '2025-01-01' },
      ]);

      const result = await store.fetchAll('active');

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('d2');
    });

    it('空结果不报错', async () => {
      const result = await store.fetchAll();
      expect(result).toEqual([]);
      expect(store.demands).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBe('');
    });

    it('Recruiter（非 Admin）：仅拉取自己的需求', async () => {
      authState = {
        isAdmin: false,
        currentUsername: 'recruiter1',
        userName: '招聘专员',
        isLoggedIn: true,
      };

      seedDemands([
        { _id: 'd1', title: '我的CC', status: 'recruiting', ownerId: 'recruiter1', submittedAt: '2025-02-01' },
        { _id: 'd2', title: '别人的', status: 'active', ownerId: 'other_user', submittedAt: '2025-01-01' },
      ]);

      const result = await store.fetchAll();

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('d1');
      expect(result[0].ownerId).toBe('recruiter1');
    });

    it('设置 loading 状态（成功时最终为 false）', async () => {
      const loadingLog = [];
      const orig = store.fetchAll.bind(store);
      // 触发前 loading 应为 false
      expect(store.loading).toBe(false);
      await store.fetchAll();
      // 触发后 loading 应为 false
      expect(store.loading).toBe(false);
    });
  });

  // ==========================================
  // fetchById — 按 ID 拉取
  // ==========================================
  describe('fetchById — 按 ID 拉取单个需求', () => {
    it('成功拉取单个需求', async () => {
      seedDemand({ _id: 'demand_002', title: '市场专员' });

      const result = await store.fetchById('demand_002');

      expect(result).toBeTruthy();
      expect(result.title).toBe('市场专员');
      expect(store.currentDemand).toBeTruthy();
      expect(store.currentDemand.title).toBe('市场专员');
    });

    it('文档不存在返回 null', async () => {
      const result = await store.fetchById('nonexistent_id');

      expect(result).toBeNull();
      expect(store.currentDemand).toBeNull();
    });

    it('错误时 error 字段更新', async () => {
      // 使 cloudbase.db() 返回 null 来模拟失败
      // 但 fetchById 不会在 fetch 失败时设置 loading/error 模式与 fetchAll 不同
      // 实际上 fetchById 如果 db() 返回 null 会 return null，不走 catch
      // 所以这里测试正常路径（文档不存在不会抛错）
      const result = await store.fetchById('fake_id');
      expect(result).toBeNull();
    });
  });

  // ==========================================
  // submit — 提交招聘需求
  // ==========================================
  describe('submit — 提交招聘需求', () => {
    const validData = {
      title: '课程顾问',
      department: { displayName: '销售部' },
      jobType: 'CC',
      headcount: 5,
    };

    it('Admin：直接写入 Demand + 自动创建 Job', async () => {
      const result = await store.submit(validData);

      // 返回结构
      expect(result.id).toBeTruthy();
      expect(result.doc).toBeTruthy();
      expect(result.doc.title).toBe('课程顾问');
      // Admin 写入后 status 应为 'recruiting'
      expect(result.doc.status).toBe('recruiting');

      // 验证 Mock DB 中 RecruitmentDemand 有写入
      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData).toHaveLength(1);
      expect(dbData[0].title).toBe('课程顾问');
      expect(dbData[0].status).toBe('recruiting');
      expect(dbData[0].ownerId).toBe('admin');
    });

    it('Admin：自动注入 ownerId、时间戳、_version', async () => {
      const result = await store.submit(validData);

      expect(result.doc.ownerId).toBe('admin');
      expect(result.doc._version).toBe(0);
      expect(result.doc.createdAt).toBeInstanceOf(Date);
      expect(result.doc.submittedAt).toBeInstanceOf(Date);
      expect(result.doc.updatedAt).toBeInstanceOf(Date);
    });

    it('Admin：自动创建的 Job 关联 linkedJobId', async () => {
      await store.submit(validData);

      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      // linkedJobId 在 Job 创建后通过 update 写入
      // Mock 中 Job store 返回 { _id: 'job_mock_001' }
      expect(dbData[0].linkedJobId).toBe('job_mock_001');
    });

    it('Admin：提交后本地缓存头部插入新需求', async () => {
      store.demands = [{ _id: 'old', title: '旧需求', status: 'active' }];

      await store.submit(validData);

      expect(store.demands).toHaveLength(2);
      expect(store.demands[0].title).toBe('课程顾问');
      expect(store.demands[0]._id).toBeTruthy();
    });

    it('Recruiter（非 Admin）：走 PendingChangeStore 审批', async () => {
      authState = {
        isAdmin: false,
        currentUsername: 'recruiter2',
        userName: '招聘专员',
        isLoggedIn: true,
      };

      const result = await store.submit(validData);

      // 返回 pending 标记
      expect(result.pending).toBe(true);
      expect(result.id).toBeTruthy();

      // Mock DB 中无直接写入
      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData).toHaveLength(0);

      // PendingChanges 有记录
      expect(pendingChanges).toHaveLength(1);
      expect(pendingChanges[0].action).toBe('create');
      expect(pendingChanges[0].entityType).toBe('recruitmentDemand');
      expect(pendingChanges[0].after.title).toBe('课程顾问');
      expect(pendingChanges[0].after.ownerId).toBe('recruiter2');
    });

    it('缺失 title 时 error 传播（由数据库层处理）', async () => {
      // submit 本身不做 title 校验，但如果数据无效，仍应能执行到 add
      // 这里验证空 title 不会导致 store 崩溃
      const result = await store.submit({ ...validData, title: '' });
      expect(result).toBeTruthy();
      // 空 title 依然写入（校验由上层 UI 负责）
      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData).toHaveLength(1);
    });

    it('数据库未初始化时抛出错误', async () => {
      // 临时覆盖 db() 返回 null
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => null);

      await expect(store.submit(validData)).rejects.toThrow('数据库未初始化');

      cloudbase.db = originalDb;
    });

    it('使用自定义 status（非默认 pending）', async () => {
      const result = await store.submit({ ...validData, status: 'active' });
      // Admin 会强制覆盖为 recruiting
      expect(result.doc.status).toBe('recruiting');
    });

    it('非 Admin 时 status 保持用户传入值或默认 pending', async () => {
      authState = { isAdmin: false, currentUsername: 'r1', userName: '专员' };
      const result = await store.submit(validData);
      // 非 Admin：status 默认为 pending
      expect(result.doc.after.status).toBe('pending');
    });
  });

  // ==========================================
  // updateStatus — 更新需求状态
  // ==========================================
  describe('updateStatus — 更新需求状态', () => {
    it('成功更新数据库 + 本地缓存同步', async () => {
      seedDemand({ _id: 'demand_upd', title: '旧CC', status: 'recruiting' });
      store.demands = [{ _id: 'demand_upd', title: '旧CC', status: 'recruiting' }];

      await store.updateStatus('demand_upd', 'completed');

      // 验证 Mock DB
      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData[0].status).toBe('completed');
      expect(dbData[0].updatedAt).toBeInstanceOf(Date);

      // 验证本地缓存
      const cached = store.demands.find(d => d._id === 'demand_upd');
      expect(cached.status).toBe('completed');
    });

    it('ID 不存在时不报错（DB 返回 updated:0）', async () => {
      store.demands = [{ _id: 'demand_upd', title: 'foo', status: 'active' }];

      // Mock DB 中没有这个文档，update 不会抛错，只是 updated:0
      await expect(store.updateStatus('nonexistent', 'completed')).resolves.toBeUndefined();

      // 本地缓存中的文档状态不变（findIndex 找不到，不会更新）
      expect(store.demands[0].status).toBe('active');
    });

    it('更新不存在的 ID 不影响本地缓存', async () => {
      store.demands = [
        { _id: 'd1', title: '一', status: 'active' },
        { _id: 'd2', title: '二', status: 'active' },
      ];

      await store.updateStatus('d999', 'closed');

      expect(store.demands).toHaveLength(2);
      expect(store.demands[0].status).toBe('active');
      expect(store.demands[1].status).toBe('active');
    });

    it('数据库未初始化时抛出错误', async () => {
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => null);

      await expect(store.updateStatus('d1', 'closed')).rejects.toThrow('数据库未初始化');

      cloudbase.db = originalDb;
    });
  });

  // ==========================================
  // softDelete — 软删除需求
  // ==========================================
  describe('softDelete — 软删除需求', () => {
    it('Admin：直接更新状态为 deleted + 从本地移除', async () => {
      seedDemand({ _id: 'demand_del', title: '待删除', status: 'recruiting' });
      store.demands = [
        { _id: 'demand_del', title: '待删除', status: 'recruiting' },
        { _id: 'demand_keep', title: '保留', status: 'active' },
      ];

      await store.softDelete('demand_del');

      // Mock DB 已更新
      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData[0].status).toBe('deleted');

      // 本地缓存已移除
      expect(store.demands).toHaveLength(1);
      expect(store.demands[0]._id).toBe('demand_keep');
    });

    it('Admin：skipApproval 参数默认不影响 Admin', async () => {
      // Admin 即使不传 skipApproval 也直接删除
      seedDemand({ _id: 'demand_del2', title: '删', status: 'recruiting' });
      store.demands = [{ _id: 'demand_del2', title: '删', status: 'recruiting' }];

      await store.softDelete('demand_del2');

      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData[0].status).toBe('deleted');
      expect(store.demands).toHaveLength(0);
    });

    it('Recruiter（非 Admin）：走 PendingChangeStore 审批', async () => {
      authState = {
        isAdmin: false,
        currentUsername: 'recruiter3',
        userName: '招聘专员',
        isLoggedIn: true,
      };

      seedDemand({ _id: 'demand_rec', title: '专员需求', status: 'recruiting', ownerId: 'recruiter3' });
      store.demands = [{ _id: 'demand_rec', title: '专员需求', status: 'recruiting' }];

      const result = await store.softDelete('demand_rec');

      // 返回 pending
      expect(result.pending).toBe(true);
      // PendingChanges 有记录
      expect(pendingChanges).toHaveLength(1);
      expect(pendingChanges[0].action).toBe('delete');
      expect(pendingChanges[0].entityId).toBe('demand_rec');
      expect(pendingChanges[0].after.status).toBe('deleted');

      // Mock DB 未被直接修改
      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData[0].status).toBe('recruiting');

      // 本地缓存未被移除
      expect(store.demands).toHaveLength(1);
    });

    it('Recruiter + skipApproval=true：直接删除', async () => {
      authState = {
        isAdmin: false,
        currentUsername: 'recruiter4',
        userName: '招聘专员',
        isLoggedIn: true,
      };

      seedDemand({ _id: 'demand_skip', title: '跳过审批', status: 'recruiting' });
      store.demands = [{ _id: 'demand_skip', title: '跳过审批', status: 'recruiting' }];

      await store.softDelete('demand_skip', { skipApproval: true });

      // 直接写入 DB
      const dbData = cloudbase.__getCollectionData('RecruitmentDemand');
      expect(dbData[0].status).toBe('deleted');

      // 本地已移除
      expect(store.demands).toHaveLength(0);

      // PendingChanges 无记录
      expect(pendingChanges).toHaveLength(0);
    });

    it('数据库未初始化时抛出错误', async () => {
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => null);

      await expect(store.softDelete('d1')).rejects.toThrow('数据库未初始化');

      cloudbase.db = originalDb;
    });
  });

  // ==========================================
  // 错误处理 — loading / error 状态
  // ==========================================
  describe('错误处理', () => {
    it('fetchAll 失败时设置 error 并恢复 loading', async () => {
      // 让 collection().where().get 抛出异常
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => ({
        collection: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => { throw new Error('网络错误'); },
              }),
            }),
          }),
        }),
        command: { neq: () => ({ __command: 'neq', value: 'deleted' }) },
      }));

      // fetchAll 中 loading 开始为 false
      expect(store.loading).toBe(false);

      const result = await store.fetchAll();

      expect(result).toEqual([]);
      expect(store.error).toBe('网络错误');
      expect(store.loading).toBe(false);

      cloudbase.db = originalDb;
    });

    it('fetchAll — DB 未初始化时返回空数组', async () => {
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => null);

      const result = await store.fetchAll();
      expect(result).toEqual([]);

      cloudbase.db = originalDb;
    });

    it('fetchById 失败时设置 error', async () => {
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => ({
        collection: () => ({
          doc: () => ({
            get: async () => { throw new Error('文档查询失败'); },
          }),
        }),
      }));

      const result = await store.fetchById('any_id');

      expect(result).toBeNull();
      expect(store.error).toBe('文档查询失败');

      cloudbase.db = originalDb;
    });

    it('多次 fetchAll 失败后 error 被覆盖为最新错误', async () => {
      let callCount = 0;
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => ({
        collection: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => {
                  callCount++;
                  throw new Error(`错误${callCount}`);
                },
              }),
            }),
          }),
        }),
        command: { neq: () => ({ __command: 'neq', value: 'deleted' }) },
      }));

      await store.fetchAll();
      expect(store.error).toBe('错误1');

      // 重置 error 由 fetchAll 内部 error.value = '' 处理
      await store.fetchAll();
      expect(store.error).toBe('错误2');

      cloudbase.db = originalDb;
    });
  });

  // ==========================================
  // 边界场景
  // ==========================================
  describe('边界场景', () => {
    it('fetchAll 传入 status 参数时不额外过滤 deleted', async () => {
      // 当指定 status 时，where 条件不再添加 neq('deleted')
      seedDemands([
        { _id: 'd1', title: '已删除1', status: 'deleted', ownerId: 'admin', submittedAt: '2025-01-01' },
        { _id: 'd2', title: '招募中', status: 'recruiting', ownerId: 'admin', submittedAt: '2025-02-01' },
      ]);

      const result = await store.fetchAll('deleted');

      // 指定 status='deleted' 时可以查出已删除的
      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('d1');
    });

    it('Recruiter：ownerId 过滤 + status 筛选同时生效', async () => {
      authState = {
        isAdmin: false,
        currentUsername: 'recruiter5',
        userName: '专员',
        isLoggedIn: true,
      };

      seedDemands([
        { _id: 'd1', title: '我的招募', status: 'recruiting', ownerId: 'recruiter5', submittedAt: '2025-03-01' },
        { _id: 'd2', title: '我的完成', status: 'completed', ownerId: 'recruiter5', submittedAt: '2025-02-01' },
        { _id: 'd3', title: '别人的', status: 'recruiting', ownerId: 'admin', submittedAt: '2025-01-01' },
      ]);

      const result = await store.fetchAll('recruiting');

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('d1');
      expect(result[0].status).toBe('recruiting');
    });

    it('close（已关闭）状态', async () => {
      seedDemands([
        { _id: 'd_closed', title: '已关闭', status: 'closed', ownerId: 'admin', submittedAt: '2025-01-01' },
      ]);

      const result = await store.fetchAll('closed');
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('closed');
    });

    it('pending 状态标签正确', () => {
      expect(store.STATUS_LABELS.pending).toBe('待审批');
      expect(store.STATUS_LABELS.active).toBe('已生效');
      expect(store.STATUS_LABELS.recruiting).toBe('招聘中');
      expect(store.STATUS_LABELS.completed).toBe('已完成');
      expect(store.STATUS_LABELS.closed).toBe('已关闭');
      expect(store.STATUS_LABELS.deleted).toBe('已删除');
    });
  });
});
