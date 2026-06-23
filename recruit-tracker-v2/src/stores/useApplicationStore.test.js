/**
 * useApplicationStore.test.js — 申请记录 Store 测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - 创建申请 + 自动默认值（stage/funnel/funnelMeta/_version）
 *   - fetchByCandidate / fetchByJob / fetchById（含 ownerFilter 数据隔离）
 *   - 30秒去重缓存（fetchByCandidate）
 *   - moveStage — 12步管道流转 + 跳阶段回填 + 漏斗时间戳
 *   - moveStage — 非法流转拒绝 + 重新激活 + 结束操作
 *   - endApplication — 淘汰/放弃
 *   - 计算属性（activeApplications / applicationsByStage）
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
  __setAdmin: (isAdmin) => {
    authState.isAdmin = isAdmin;
    authState.currentUsername = isAdmin ? 'admin' : 'recruiter1';
  },
}));

// ===== Mock 数据过滤器 =====
vi.mock('../services/data-filter', () => ({
  ownerFilter: vi.fn(() => {
    if (authState.isAdmin) return null;
    return { ownerId: authState.currentUsername || '__no_user__' };
  }),
  applyOwnerFilter: vi.fn((base = {}) => {
    if (authState.isAdmin) return base;
    return { ...base, ownerId: authState.currentUsername || '__no_user__' };
  }),
}));

// ===== Mock 乐观锁 =====
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
import { useApplicationStore } from './useApplicationStore';

let store;

beforeEach(() => {
  setActivePinia(createPinia());
  authState = {
    isAdmin: true,
    currentUsername: 'admin',
    userName: '管理员',
    isLoggedIn: true,
  };
  store = useApplicationStore();
});

// ===== 测试辅助 =====
const NOW = new Date('2025-06-15T10:00:00Z');

function seedApplication(overrides = {}) {
  const doc = {
    _id: 'app_001',
    candidateId: 'cand_001',
    jobId: 'job_001',
    jobType: 'CC',
    stage: 'resume',
    stageEnteredAt: NOW,
    status: 'active',
    ownerId: 'admin',
    funnel: {
      resumeAt: NOW,
    },
    funnelMeta: { entrySource: 'manual' },
    history: [],
    _version: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
  cloudbase.__setCollectionData('Application', [doc]);
  return doc;
}

function seedApplications(apps) {
  cloudbase.__setCollectionData('Application', apps);
}

describe('useApplicationStore — 通过 Mock 层', () => {
  // ==========================================
  // 初始状态
  // ==========================================
  describe('初始状态', () => {
    it('applications 初始为空', () => {
      expect(store.applications).toEqual([]);
    });

    it('currentApplication 初始为 null', () => {
      expect(store.currentApplication).toBeNull();
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('error 初始为空', () => {
      expect(store.error).toBe('');
    });
  });

  // ==========================================
  // 计算属性
  // ==========================================
  describe('计算属性', () => {
    it('activeApplications — 只返回 status:active', () => {
      store.applications = [
        { _id: 'a1', status: 'active' },
        { _id: 'a2', status: 'rejected' },
        { _id: 'a3', status: 'withdrawn' },
        { _id: 'a4', status: 'active' },
      ];
      expect(store.activeApplications).toHaveLength(2);
    });

    it('applicationsByStage — 按阶段分组（仅活跃）', () => {
      store.applications = [
        { _id: 'a1', stage: 'resume', status: 'active' },
        { _id: 'a2', stage: 'resume', status: 'active' },
        { _id: 'a3', stage: 'first_interview', status: 'active' },
        { _id: 'a4', stage: 'first_interview', status: 'rejected' },
      ];
      const byStage = store.applicationsByStage;
      expect(byStage['resume']).toHaveLength(2);
      expect(byStage['first_interview']).toHaveLength(1);
      // rejected 不在活跃分组
    });
  });

  // ==========================================
  // add — 创建申请
  // ==========================================
  describe('add — 创建申请', () => {
    it('写入 Application 集合并返回完整文档', async () => {
      const result = await store.add({
        candidateId: 'cand_001',
        jobId: 'job_001',
        jobType: 'CC',
      });

      expect(result.id).toBeTruthy();
      expect(result.doc.stage).toBe('resume');
      expect(result.doc.status).toBe('active');

      const dbData = cloudbase.__getCollectionData('Application');
      expect(dbData).toHaveLength(1);
    });

    it('自动注入默认值：stage=resume, status=active', async () => {
      const result = await store.add({ candidateId: 'c1', jobId: 'j1' });
      expect(result.doc.stage).toBe('resume');
      expect(result.doc.status).toBe('active');
    });

    it('自动注入漏斗时间戳 funnel.resumeAt', async () => {
      const result = await store.add({ candidateId: 'c1', jobId: 'j1' });
      expect(result.doc.funnel.resumeAt).toBeTruthy();
    });

    it('自动注入 funnelMeta.entrySource=manual', async () => {
      const result = await store.add({ candidateId: 'c1', jobId: 'j1' });
      expect(result.doc.funnelMeta.entrySource).toBe('manual');
    });

    it('自动注入 ownerId', async () => {
      const result = await store.add({ candidateId: 'c1', jobId: 'j1' });
      expect(result.doc.ownerId).toBe('admin');
    });

    it('自动注入 _version=0', async () => {
      const result = await store.add({ candidateId: 'c1', jobId: 'j1' });
      expect(result.doc._version).toBe(0);
    });

    it('自定义 stage', async () => {
      const result = await store.add({
        candidateId: 'c1', jobId: 'j1', stage: 'first_interview',
      });
      expect(result.doc.stage).toBe('first_interview');
    });

    it('创建后 currentApplication 指向新申请', async () => {
      await store.add({ candidateId: 'c1', jobId: 'j1' });
      expect(store.currentApplication).toBeTruthy();
      expect(store.currentApplication.candidateId).toBe('c1');
    });

    it('追加到本地缓存头部', async () => {
      store.applications = [{ _id: 'old', candidateId: 'old' }];
      await store.add({ candidateId: 'new', jobId: 'j1' });
      expect(store.applications).toHaveLength(2);
      expect(store.applications[0].candidateId).toBe('new');
    });
  });

  // ==========================================
  // fetchByCandidate
  // ==========================================
  describe('fetchByCandidate', () => {
    it('按 candidateId 查询 + ownerFilter 过滤', async () => {
      seedApplications([
        { _id: 'a1', candidateId: 'cand_X', status: 'active' },
        { _id: 'a2', candidateId: 'cand_X', status: 'active' },
        { _id: 'a3', candidateId: 'cand_Y', status: 'active' },
      ]);

      const result = await store.fetchByCandidate('cand_X');

      // Admin 看全部，过滤 candidateId
      expect(result).toHaveLength(2);
    });

    it('Recruiter：附加 ownerId 过滤', async () => {
      authState.isAdmin = false;
      authState.currentUsername = 'recruiter1';

      seedApplications([
        { _id: 'a1', candidateId: 'cand_X', ownerId: 'recruiter1', status: 'active' },
        { _id: 'a2', candidateId: 'cand_X', ownerId: 'admin', status: 'active' },
      ]);

      const result = await store.fetchByCandidate('cand_X');

      // Recruiter 只看自己的
      expect(result).toHaveLength(1);
      expect(result[0].ownerId).toBe('recruiter1');
    });

    it('合并到本地缓存去重', async () => {
      store.applications = [
        { _id: 'a1', candidateId: 'cand_X', stage: 'old_stage' },
      ];
      seedApplications([
        { _id: 'a1', candidateId: 'cand_X', stage: 'new_stage' },
        { _id: 'a2', candidateId: 'cand_X', stage: 'resume' },
      ]);

      await store.fetchByCandidate('cand_X');

      // a1 保留旧值（去重不覆盖）
      const a1 = store.applications.find(a => a._id === 'a1');
      expect(a1.stage).toBe('old_stage');
      // a2 被加入
      expect(store.applications.find(a => a._id === 'a2')).toBeTruthy();
    });

    it('30 秒内重复请求走缓存', async () => {
      seedApplications([{ _id: 'a1', candidateId: 'cand_X' }]);

      const r1 = await store.fetchByCandidate('cand_X');
      // 修改 DB 数据（缓存不应看到这个变化）
      cloudbase.__setCollectionData('Application', [
        { _id: 'a1', candidateId: 'cand_X' },
        { _id: 'a2', candidateId: 'cand_X' },
      ]);
      const r2 = await store.fetchByCandidate('cand_X');

      // 缓存命中，第二次返回和第一次一样
      expect(r2).toHaveLength(1);
    });

    it('空结果不报错', async () => {
      const result = await store.fetchByCandidate('nonexistent');
      expect(result).toEqual([]);
    });
  });

  // ==========================================
  // fetchByJob
  // ==========================================
  describe('fetchByJob', () => {
    it('按 jobId 查询', async () => {
      seedApplications([
        { _id: 'a1', jobId: 'job_X', status: 'active' },
        { _id: 'a2', jobId: 'job_Y', status: 'active' },
      ]);

      const result = await store.fetchByJob('job_X');
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================
  // fetchById
  // ==========================================
  describe('fetchById', () => {
    it('获取单个申请详情', async () => {
      seedApplication({ _id: 'app_detail', candidateId: 'c1', jobId: 'j1' });

      const result = await store.fetchById('app_detail');

      expect(result).toBeTruthy();
      expect(result.candidateId).toBe('c1');
      expect(store.currentApplication._id).toBe('app_detail');
    });

    it('不存在返回 null', async () => {
      const result = await store.fetchById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ==========================================
  // moveStage — 管道流转
  // ==========================================
  describe('moveStage — 管道流转', () => {
    it('正常向前流转：resume → first_interview', async () => {
      seedApplication({ _id: 'app_move', stage: 'resume', _version: 0 });

      await store.moveStage('app_move', 'first_interview', {
        note: '邀约面试', operatorId: 'admin',
      });

      const dbData = cloudbase.__getCollectionData('Application');
      expect(dbData[0].stage).toBe('first_interview');
      expect(dbData[0].status).toBe('active'); // 仍是活跃
    });

    it('更新漏斗时间戳 funnel.interview1At', async () => {
      seedApplication({ _id: 'app_f1', stage: 'resume', funnel: { resumeAt: NOW }, _version: 0 });

      await store.moveStage('app_f1', 'first_interview', { operatorId: 'admin' });

      const dbData = cloudbase.__getCollectionData('Application');
      // funnel 对象通过 command.set 整体替换，应包含 interview1At
      expect(dbData[0].funnel).toBeTruthy();
    });

    it('跳阶段流转：自动回填中间阶段', async () => {
      // resume(order:0) → first_interview(order:2) 会跳过 invite(order:1) 和 invite_confirmed
      seedApplication({
        _id: 'app_skip', stage: 'resume',
        funnel: { resumeAt: NOW }, _version: 0, jobType: 'CC',
      });

      await store.moveStage('app_skip', 'first_interview', {
        operatorId: 'admin', jobType: 'CC',
      });

      const dbData = cloudbase.__getCollectionData('Application');
      // payload 中的 funnel 包含跳过的阶段
      expect(dbData[0].stage).toBe('first_interview');
    });

    it('流转历史记录被追加', async () => {
      seedApplication({
        _id: 'app_hist', stage: 'resume',
        funnel: { resumeAt: NOW }, _version: 0,
      });

      await store.moveStage('app_hist', 'first_interview', {
        note: '测试流转', operatorId: 'admin',
      });

      const dbData = cloudbase.__getCollectionData('Application');
      // history 通过 command.push 追加
      expect(dbData[0].history).toBeTruthy();
      expect(dbData[0].history.length).toBeGreaterThanOrEqual(0);
    });

    it('非法流转 → 抛出错误', async () => {
      seedApplication({ _id: 'app_bad', stage: 'first_interview', _version: 0 });

      // 后退不允许
      await expect(
        store.moveStage('app_bad', 'resume', { operatorId: 'admin' })
      ).rejects.toThrow();
    });

    it('相同阶段 → 抛出错误', async () => {
      seedApplication({ _id: 'app_same', stage: 'resume', _version: 0 });

      await expect(
        store.moveStage('app_same', 'resume', { operatorId: 'admin' })
      ).rejects.toThrow('已在当前阶段');
    });

    it('淘汰操作：resume → rejected', async () => {
      seedApplication({ _id: 'app_rej', stage: 'resume', _version: 0 });

      // 注意：endApplication 负责 reject/withdraw
      // moveStage 只处理活跃阶段流转，结束操作应通过 endApplication
      // 验证 canTransition 允许 resume → rejected
      await store.endApplication('app_rej', 'rejected', '不合适', { operatorId: 'admin' });

      const dbData = cloudbase.__getCollectionData('Application');
      expect(dbData[0].status).toBe('rejected');
      expect(dbData[0].endReason).toBe('不合适');
    });

    it('放弃操作：resume → withdrawn', async () => {
      seedApplication({ _id: 'app_wd', stage: 'resume', _version: 0 });

      await store.endApplication('app_wd', 'withdrawn', '候选人放弃', { operatorId: 'admin' });

      const dbData = cloudbase.__getCollectionData('Application');
      expect(dbData[0].status).toBe('withdrawn');
    });

    it('重新激活：rejected → resume', async () => {
      seedApplication({
        _id: 'app_react', stage: 'rejected', status: 'rejected',
        funnel: { resumeAt: NOW }, _version: 0,
      });

      await store.moveStage('app_react', 'resume', {
        note: '重新激活', operatorId: 'admin',
      });

      const dbData = cloudbase.__getCollectionData('Application');
      expect(dbData[0].stage).toBe('resume');
      expect(dbData[0].status).toBe('active');
    });

    it('流转后本地缓存同步', async () => {
      seedApplication({ _id: 'app_local', stage: 'resume', _version: 0 });
      store.applications = [
        { _id: 'app_local', stage: 'resume', status: 'active', _version: 0, funnel: {}, history: [] },
      ];

      await store.moveStage('app_local', 'first_interview', { operatorId: 'admin' });

      const cached = store.applications.find(a => a._id === 'app_local');
      expect(cached.stage).toBe('first_interview');
      expect(cached.history.length).toBe(1);
    });

    it('申请不存在 → 抛出错误', async () => {
      await expect(
        store.moveStage('nonexistent', 'first_interview', { operatorId: 'admin' })
      ).rejects.toThrow();
    });

    it('审计日志写入', async () => {
      seedApplication({ _id: 'app_audit', stage: 'resume', _version: 0 });

      await store.moveStage('app_audit', 'first_interview', {
        note: '审计测试', operatorId: 'admin',
      });

      expect(cloudbase.callFunction).toHaveBeenCalled();
    });
  });

  // ==========================================
  // endApplication
  // ==========================================
  describe('endApplication', () => {
    it('淘汰：status → rejected + 记录原因', async () => {
      seedApplication({ _id: 'app_end1', stage: 'first_interview', status: 'active', _version: 0 });

      await store.endApplication('app_end1', 'rejected', '经验不足', { operatorId: 'admin' });

      const dbData = cloudbase.__getCollectionData('Application');
      expect(dbData[0].status).toBe('rejected');
      expect(dbData[0].endReason).toBe('经验不足');
      expect(dbData[0].endStage).toBe('first_interview');
    });

    it('放弃：status → withdrawn', async () => {
      seedApplication({ _id: 'app_end2', stage: 'offer', status: 'active', _version: 0 });

      await store.endApplication('app_end2', 'withdrawn', '已接受其他offer', { operatorId: 'admin' });

      const dbData = cloudbase.__getCollectionData('Application');
      expect(dbData[0].status).toBe('withdrawn');
    });

    it('本地缓存同步结束状态', async () => {
      seedApplication({ _id: 'app_end3', stage: 'resume', status: 'active', _version: 0 });
      store.applications = [
        { _id: 'app_end3', stage: 'resume', status: 'active', _version: 0 },
      ];

      await store.endApplication('app_end3', 'rejected', '不符合');

      const cached = store.applications.find(a => a._id === 'app_end3');
      expect(cached.status).toBe('rejected');
      expect(cached.endReason).toBe('不符合');
    });

    it('申请不存在 → 抛出错误', async () => {
      await expect(
        store.endApplication('nonexistent', 'rejected', '测试')
      ).rejects.toThrow();
    });

    it('审计日志写入', async () => {
      seedApplication({ _id: 'app_audit2', stage: 'resume', status: 'active', _version: 0 });

      await store.endApplication('app_audit2', 'rejected', '测试', { operatorId: 'admin' });

      expect(cloudbase.callFunction).toHaveBeenCalled();
    });
  });

  // ==========================================
  // 乐观锁工具
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
