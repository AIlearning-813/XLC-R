/* 新励成招聘管理系统 V2.0 — 批量操作引擎
 *
 * 在看板/列表勾选候选人后，通过底部浮现操作栏执行批量操作。
 * 每种操作独立走 pipeline-engine 校验 + 版本锁更新。
 *
 * 10 种批量操作：
 *   1. 移动阶段    — batchMoveStage
 *   2. 淘汰/放弃   — batchEndApplications
 *   3. 导出 Excel   — batchExportExcel
 *   4. 导出 CSV     — batchExportCSV
 *   5. 分配负责人   — batchReassignOwner
 *   6. 重新激活     — batchReactivate
 *   7. 打标签       — batchAddTags
 *   8. 添加沟通记录 — batchAddCommunication
 *   9. 标记邀约确认 — batchMarkInviteConfirmed
 *  10. 取消归档     — batchUnarchive
 */

import cloudbase from './cloudbase';
import { versionedUpdate } from './optimistic-lock';
import { canTransition, buildTransitionPayload, stageToFunnelKey } from './pipeline-engine';
import { addCommunication } from './communication';

// ===== 配置 =====
const MAX_BATCH_SIZE = 100;

// ===== 工具函数 =====

/** 递归将 Date 转为数字时间戳（与 useApplicationStore 保持一致） */
function toTimestamp(val) {
  if (val instanceof Date) return val.getTime();
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = toTimestamp(v);
    return out;
  }
  return val;
}

/** 分批执行，每批间隔 200ms 防限流 */
async function batchExecute(items, fn, onProgress) {
  const results = [];
  const errors = [];
  let completed = 0;

  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    const batch = items.slice(i, i + MAX_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((item) => fn(item).catch((err) => ({ error: err, item })))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push({ item: batch[0], error: result.reason });
      }
    }

    completed += batch.length;
    if (onProgress) onProgress(completed, items.length);

    // 批次间隔防限流
    if (i + MAX_BATCH_SIZE < items.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { results, errors };
}

// ===== 1. 批量移动阶段 =====

/**
 * @param {Array<Object>} applications - 完整 Application 文档列表
 * @param {string} toStage - 目标阶段 key
 * @param {Object} options - { note, operatorId, jobType }
 * @param {Function} onProgress - 进度回调 (done, total)
 * @returns {Promise<{ results: Array, errors: Array }>}
 */
export async function batchMoveStage(applications, toStage, options = {}, onProgress) {
  const { note = '', operatorId = '', jobType = null } = options;

  async function processOne(app) {
    const db = cloudbase.db();
    const oldStage = app.stage;
    const currentStatus = app.status || 'active';
    const expectedVersion = typeof app._version === 'number' ? app._version : 0;

    // 校验
    const validation = canTransition(oldStage, toStage, {
      jobType: jobType || app.jobType,
      currentStatus,
    });
    if (!validation.valid) {
      throw new Error(`${app.candidateId || app._id}: ${validation.reason}`);
    }

    // 构建载荷
    const payload = buildTransitionPayload(oldStage, toStage, { note, operatorId, jobType });
    if (payload.funnel) {
      const mergedFunnel = { ...(app.funnel || {}), ...payload.funnel };
      payload.funnel = db.command.set(toTimestamp(mergedFunnel));
    }
    if (payload.history) {
      payload.history = db.command.push(payload.history);
    }

    return versionedUpdate('Application', app._id, expectedVersion, payload);
  }

  return batchExecute(applications, processOne, onProgress);
}

// ===== 2. 批量结束（淘汰/放弃）=====

/**
 * @param {Array<Object>} applications
 * @param {'rejected'|'withdrawn'} status
 * @param {string} reason
 * @param {Object} options - { operatorId }
 */
export async function batchEndApplications(applications, status, reason, options = {}, onProgress) {
  const { operatorId = '' } = options;

  async function processOne(app) {
    const db = cloudbase.db();
    const expectedVersion = typeof app._version === 'number' ? app._version : 0;

    const updateData = {
      status,
      endStage: app.stage,
      endReason: reason,
      endedAt: new Date(),
      history: db.command.push({
        fromStage: app.stage,
        toStage: status,
        at: new Date(),
        note: reason,
        operator: operatorId,
        operatorId,
      }),
    };

    return versionedUpdate('Application', app._id, expectedVersion, updateData);
  }

  return batchExecute(applications, processOne, onProgress);
}

// ===== 3. 导出 Excel =====

export function batchExportExcel(applications, candidatesMap = {}, jobsMap = {}) {
  // 构建导出数据
  const rows = applications.map((app) => {
    const candidate = candidatesMap[app.candidateId] || {};
    const job = jobsMap[app.jobId] || {};
    const funnel = app.funnel || {};

    return {
      '姓名': candidate.name || '',
      '手机': candidate.phone || '',
      '邮箱': candidate.email || '',
      '岗位': job.title || job.name || '',
      '当前阶段': app.stage || '',
      '入职时间': funnel.onboardAt ? new Date(funnel.onboardAt).toLocaleDateString() : '',
      '淘汰/放弃': app.status === 'rejected' ? '淘汰' : app.status === 'withdrawn' ? '放弃' : '',
      '结束原因': app.endReason || '',
      '简历来源': app.funnelMeta?.entrySource || '',
    };
  });

  // 简单的 CSV → Excel（用 BOM + CSV 实现，兼容 Excel 打开）
  const headers = Object.keys(rows[0] || {});
  const bom = '﻿';
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = String(row[h] || '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    ),
  ].join('\n');

  const blob = new Blob([bom + csvContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `候选人导出_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  return { success: true, count: rows.length };
}

// ===== 4. 导出 CSV =====

export function batchExportCSV(applications, candidatesMap = {}, jobsMap = {}) {
  // 与 Excel 相同实现，文件名不同
  const rows = applications.map((app) => {
    const candidate = candidatesMap[app.candidateId] || {};
    const job = jobsMap[app.jobId] || {};
    return {
      '姓名': candidate.name || '',
      '手机': candidate.phone || '',
      '邮箱': candidate.email || '',
      '岗位': job.title || job.name || '',
      '当前阶段': app.stage || '',
      '状态': app.status === 'active' ? '活跃' : app.status === 'rejected' ? '淘汰' : '放弃',
      '结束原因': app.endReason || '',
    };
  });

  const headers = Object.keys(rows[0] || {});
  const bom = '﻿';
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = String(row[h] || '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    ),
  ].join('\n');

  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `候选人导出_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  return { success: true, count: rows.length };
}

// ===== 5. 批量分配负责人 =====

export async function batchReassignOwner(applications, newOwnerId, options = {}, onProgress) {
  const { operatorId = '' } = options;

  async function processOne(app) {
    const db = cloudbase.db();
    const expectedVersion = typeof app._version === 'number' ? app._version : 0;

    const updateData = {
      ownerId: newOwnerId,
      history: db.command.push({
        fromStage: app.stage,
        toStage: app.stage,
        at: new Date(),
        note: `负责人变更为 ${newOwnerId}`,
        operator: operatorId,
        operatorId,
        action: 'owner_transferred',
      }),
    };

    return versionedUpdate('Application', app._id, expectedVersion, updateData);
  }

  return batchExecute(applications, processOne, onProgress);
}

// ===== 6. 批量重新激活 =====

export async function batchReactivate(applications, targetStage = null, options = {}, onProgress) {
  const { note = '', operatorId = '' } = options;

  async function processOne(app) {
    const db = cloudbase.db();
    const expectedVersion = typeof app._version === 'number' ? app._version : 0;
    const stage = targetStage || app.endStage || 'resume';

    const updateData = {
      stage,
      stageEnteredAt: new Date(),
      status: 'active',
      endedAt: null,
      endReason: '',
      endStage: '',
      reactivatedAt: new Date(),
      reactivatedFrom: app.status,
      history: db.command.push({
        fromStage: app.status,
        toStage: stage,
        at: new Date(),
        note: note || '批量重新激活',
        operatorId,
        operator: operatorId,
      }),
    };

    return versionedUpdate('Application', app._id, expectedVersion, updateData);
  }

  return batchExecute(applications, processOne, onProgress);
}

// ===== 7. 批量打标签 =====

export async function batchAddTags(applications, tags, options = {}, onProgress) {
  if (!tags || !tags.length) return { results: [], errors: [] };

  async function processOne(app) {
    const db = cloudbase.db();
    // 标签直接追加到 Application（如果字段存在）
    const currentTags = app.tags || [];
    const newTags = [...new Set([...currentTags, ...tags])];

    const updateData = { tags: newTags };
    return cloudbase.db()
      .collection('Application')
      .doc(app._id)
      .update(updateData)
      .then(() => ({ _id: app._id, tags: newTags }));
  }

  return batchExecute(applications, processOne, onProgress);
}

// ===== 8. 批量添加沟通记录 =====

export async function batchAddCommunication(applications, data, options = {}, onProgress) {
  const { operator = '' } = options;

  async function processOne(app) {
    return addCommunication({
      candidateId: app.candidateId,
      applicationId: app._id,
      method: data.method || '电话',
      content: data.content || '',
      operator: operator,
    });
  }

  return batchExecute(applications, processOne, onProgress);
}

// ===== 9. 批量标记邀约已确认 =====

export async function batchMarkInviteConfirmed(applications, options = {}, onProgress) {
  const { operatorId = '' } = options;

  async function processOne(app) {
    const db = cloudbase.db();
    if (app.status !== 'active') {
      throw new Error('只能对活跃候选人标记邀约');
    }

    const now = new Date();
    const mergedFunnel = { ...(app.funnel || {}), inviteConfirmedAt: now };

    const updateData = {
      funnel: db.command.set(toTimestamp(mergedFunnel)),
      history: db.command.push({
        fromStage: app.stage,
        toStage: 'invite_confirmed',
        at: now,
        note: '批量标记邀约已确认',
        operatorId,
        operator: operatorId,
      }),
    };

    const expectedVersion = typeof app._version === 'number' ? app._version : 0;
    return versionedUpdate('Application', app._id, expectedVersion, updateData);
  }

  return batchExecute(applications, processOne, onProgress);
}

// ===== 10. 取消归档 =====

export async function batchUnarchive(applications, options = {}, onProgress) {
  async function processOne(app) {
    const db = cloudbase.db();
    return db.collection('Application')
      .doc(app._id)
      .update({ isArchived: false, updatedAt: new Date() })
      .then(() => ({ _id: app._id }));
  }

  return batchExecute(applications, processOne, onProgress);
}

export { MAX_BATCH_SIZE };
