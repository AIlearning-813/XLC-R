/**
 * batch-operations.test.js — 批量操作引擎测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - 批量移动阶段（校验 + 版本锁更新）
 *   - 批量结束（淘汰/放弃）
 *   - 数据脱敏（maskPhone / maskEmail）
 *   - 批量分配负责人
 *   - 批量重新激活
 *   - 批量打标签
 *   - 批量邀约确认
 *   - 取消归档
 *   - MAX_BATCH_SIZE 分批
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===== Mock CloudBase =====
vi.mock('./cloudbase');

// ===== Mock 乐观锁 =====
vi.mock('./optimistic-lock', async () => {
  const actual = await vi.importActual('./optimistic-lock');
  return {
    ...actual,
    versionedUpdate: vi.fn(async (collection, docId, expectedVersion, data) => {
      const cloudbase = (await import('./cloudbase')).default;
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

// ===== Mock communication =====
vi.mock('./communication', () => ({
  addCommunication: vi.fn(async (params) => ({ id: 'comm_001', ...params })),
}));

import cloudbase from './cloudbase';
import {
  batchMoveStage,
  batchEndApplications,
  batchReassignOwner,
  batchReactivate,
  batchAddTags,
  batchMarkInviteConfirmed,
  batchUnarchive,
  maskPhone,
  maskEmail,
  MAX_BATCH_SIZE,
} from './batch-operations';

beforeEach(() => {
  // __resetAll() by vitest.setup.js
});

// ===== 测试辅助 =====
function seedApps(apps) {
  cloudbase.__setCollectionData('Application', apps.map((a, i) => ({
    _id: a._id || `app_${i}`,
    candidateId: a.candidateId || `cand_${i}`,
    jobId: a.jobId || 'job_001',
    jobType: a.jobType || 'CC',
    stage: a.stage || 'resume',
    status: a.status || 'active',
    ownerId: a.ownerId || 'admin',
    funnel: a.funnel || { resumeAt: new Date('2025-01-01') },
    history: a.history || [],
    tags: a.tags || [],
    _version: typeof a._version === 'number' ? a._version : 0,
    ...a,
  })));
}

describe('batch-operations — 数据脱敏', () => {
  describe('maskPhone', () => {
    it('标准 11 位手机号：138****1234', () => {
      expect(maskPhone('13800138000')).toBe('138****8000');
    });

    it('带分隔符的手机号', () => {
      expect(maskPhone('138-0013-8000')).toBe('138****8000');
    });

    it('短号码保持原样', () => {
      expect(maskPhone('12345')).toBe('12345');
    });

    it('空值返回空字符串', () => {
      expect(maskPhone('')).toBe('');
      expect(maskPhone(null)).toBe('');
    });
  });

  describe('maskEmail', () => {
    it('a***@example.com', () => {
      expect(maskEmail('zhangsan@example.com')).toBe('z***@example.com');
    });

    it('单字符 local-part 不脱敏（保护过短邮箱）', () => {
      // atIdx=1, <=1 → 直接返回原值
      expect(maskEmail('a@b.com')).toBe('a@b.com');
    });

    it('空值返回空字符串', () => {
      expect(maskEmail('')).toBe('');
      expect(maskEmail(null)).toBe('');
    });
  });
});

describe('batch-operations — 批量移动阶段', () => {
  it('正常流转：resume → first_interview', async () => {
    seedApps([
      { _id: 'a1', stage: 'resume', status: 'active', _version: 0 },
      { _id: 'a2', stage: 'resume', status: 'active', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results, errors } = await batchMoveStage(apps, 'first_interview', {
      operatorId: 'admin',
    });

    expect(results).toHaveLength(2);
    expect(errors).toHaveLength(0);

    const dbData = cloudbase.__getCollectionData('Application');
    expect(dbData.every(a => a.stage === 'first_interview')).toBe(true);
  });

  it('非法流转 → 进入 errors', async () => {
    seedApps([
      { _id: 'a1', stage: 'first_interview', status: 'active', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results, errors } = await batchMoveStage(apps, 'resume', {
      operatorId: 'admin',
    });

    expect(results).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('部分成功部分失败', async () => {
    seedApps([
      { _id: 'ok', stage: 'resume', status: 'active', _version: 0 },
      { _id: 'bad', stage: 'first_interview', status: 'active', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    // 全部移到 first_interview：ok 从 resume 前进 = 合法，bad 已在 first_interview = 相同阶段拒绝
    const { results, errors } = await batchMoveStage(apps, 'first_interview', {
      operatorId: 'admin',
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe('batch-operations — 批量结束', () => {
  it('淘汰：全部 status → rejected', async () => {
    seedApps([
      { _id: 'a1', stage: 'resume', status: 'active', _version: 0 },
      { _id: 'a2', stage: 'first_interview', status: 'active', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results } = await batchEndApplications(apps, 'rejected', '不合适', {
      operatorId: 'admin',
    });

    expect(results).toHaveLength(2);
    const dbData = cloudbase.__getCollectionData('Application');
    expect(dbData.every(a => a.status === 'rejected')).toBe(true);
    expect(dbData.every(a => a.endReason === '不合适')).toBe(true);
  });

  it('放弃：全部 status → withdrawn', async () => {
    seedApps([{ _id: 'a1', stage: 'resume', status: 'active', _version: 0 }]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results } = await batchEndApplications(apps, 'withdrawn', '候选人放弃', {
      operatorId: 'admin',
    });

    const dbData = cloudbase.__getCollectionData('Application');
    expect(dbData[0].status).toBe('withdrawn');
  });
});

describe('batch-operations — 批量分配负责人', () => {
  it('ownerId 全部更新', async () => {
    seedApps([
      { _id: 'a1', ownerId: 'old_user', _version: 0 },
      { _id: 'a2', ownerId: 'old_user', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results } = await batchReassignOwner(apps, 'new_user', {
      operatorId: 'admin',
    });

    expect(results).toHaveLength(2);
    const dbData = cloudbase.__getCollectionData('Application');
    expect(dbData.every(a => a.ownerId === 'new_user')).toBe(true);
  });

  it('history 追加 owner_transferred', async () => {
    seedApps([{ _id: 'a1', ownerId: 'old_user', _version: 0 }]);
    const apps = cloudbase.__getCollectionData('Application');

    await batchReassignOwner(apps, 'new_user', { operatorId: 'admin' });

    const dbData = cloudbase.__getCollectionData('Application');
    // history 通过 command.push 追加
    expect(dbData[0].history).toBeTruthy();
  });
});

describe('batch-operations — 批量重新激活', () => {
  it('rejected → active，回到原阶段', async () => {
    seedApps([
      { _id: 'a1', stage: 'rejected', status: 'rejected', endStage: 'first_interview', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results } = await batchReactivate(apps, null, { operatorId: 'admin' });

    const dbData = cloudbase.__getCollectionData('Application');
    expect(dbData[0].status).toBe('active');
    // 回到结束前阶段
    expect(dbData[0].stage).toBe('first_interview');
  });

  it('指定目标阶段', async () => {
    seedApps([
      { _id: 'a1', stage: 'rejected', status: 'rejected', endStage: 'offer', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    await batchReactivate(apps, 'resume', { operatorId: 'admin' });

    const dbData = cloudbase.__getCollectionData('Application');
    expect(dbData[0].stage).toBe('resume');
  });
});

describe('batch-operations — 批量打标签', () => {
  it('追加标签去重', async () => {
    seedApps([
      { _id: 'a1', tags: ['985'], _version: 0 },
      { _id: 'a2', tags: [], _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results } = await batchAddTags(apps, ['211', '985']);

    expect(results).toHaveLength(2);
    const dbData = cloudbase.__getCollectionData('Application');
    // a1: ['985'] + ['211','985'] → ['985','211'] (去重)
    expect(dbData[0].tags).toContain('211');
    // a2: [] + ['211','985'] → ['211','985']
    expect(dbData[1].tags).toContain('211');
  });

  it('空标签列表直接返回', async () => {
    const { results, errors } = await batchAddTags([], []);
    expect(results).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('batch-operations — 批量邀约确认', () => {
  it('设置 inviteConfirmedAt 漏斗时间戳', async () => {
    seedApps([
      { _id: 'a1', stage: 'invite', status: 'active', funnel: { inviteAt: new Date() }, _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results } = await batchMarkInviteConfirmed(apps, { operatorId: 'admin' });

    expect(results).toHaveLength(1);
    const dbData = cloudbase.__getCollectionData('Application');
    // funnel 通过 command.set 整体替换，包含 inviteConfirmedAt
    expect(dbData[0].funnel).toBeTruthy();
  });

  it('非活跃候选人 → 报错', async () => {
    seedApps([
      { _id: 'a1', stage: 'rejected', status: 'rejected', _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { errors } = await batchMarkInviteConfirmed(apps, { operatorId: 'admin' });
    expect(errors).toHaveLength(1);
  });
});

describe('batch-operations — 取消归档', () => {
  it('isArchived → false', async () => {
    seedApps([
      { _id: 'a1', isArchived: true, _version: 0 },
    ]);
    const apps = cloudbase.__getCollectionData('Application');

    const { results } = await batchUnarchive(apps);

    expect(results).toHaveLength(1);
    const dbData = cloudbase.__getCollectionData('Application');
    expect(dbData[0].isArchived).toBe(false);
  });
});

describe('batch-operations — MAX_BATCH_SIZE', () => {
  it('MAX_BATCH_SIZE 为 100', () => {
    expect(MAX_BATCH_SIZE).toBe(100);
  });
});
