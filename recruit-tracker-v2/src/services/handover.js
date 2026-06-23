/* 新励成招聘管理系统 V2.0 — 专员数据移交服务
 *
 * 管理员在设置页触发，将离职专员的活跃候选人移交给接手专员。
 *
 * 流程：
 *   1. 预览移交清单（活跃候选人数量 + 各阶段分布）
 *   2. 选择接手专员
 *   3. 确认执行：
 *      - 批量更新 Application.ownerId（仅 active 状态）
 *      - 每条的 history 追加 owner_transferred 记录
 *      - 停用离职专员的 EmailConfig
 *      - 发送 ParseNotification 给接手专员
 *      - 写入 AuditLog
 */

import cloudbase from './cloudbase';

const db = cloudbase.db;

/**
 * 预览移交清单
 * @param {string} leavingOwnerId - 离职专员 ID
 * @returns {Promise<{ total: number, byStage: Object }>}
 */
export async function previewHandover(leavingOwnerId) {
  if (!leavingOwnerId) throw new Error('请指定离职专员');

  const dbInstance = db();
  const { data } = await dbInstance
    .collection('Application')
    .where({
      ownerId: leavingOwnerId,
      status: 'active',
    })
    .get();

  const apps = data || [];
  const byStage = {};
  for (const app of apps) {
    const stage = app.stage || 'unknown';
    byStage[stage] = (byStage[stage] || 0) + 1;
  }

  return {
    total: apps.length,
    byStage,
    applications: apps,
  };
}

/**
 * 执行专员数据移交
 * @param {string} leavingOwnerId - 离职专员 ID
 * @param {string} newOwnerId - 接手专员 ID
 * @param {Object} options - { operatorId }
 * @returns {Promise<{ transferred: number, errors: string[] }>}
 */
export async function executeHandover(leavingOwnerId, newOwnerId, options = {}) {
  if (!leavingOwnerId) throw new Error('请指定离职专员');
  if (!newOwnerId) throw new Error('请指定接手专员');

  const { operatorId = '' } = options;
  const dbInstance = db();

  // 1. 获取所有活跃 Application
  const { data: apps } = await dbInstance
    .collection('Application')
    .where({
      ownerId: leavingOwnerId,
      status: 'active',
    })
    .get();

  const targetApps = apps || [];
  if (targetApps.length === 0) {
    return { transferred: 0, errors: [] };
  }

  // 2. 批量更新 ownerId
  let errors = [];
  let transferred = 0;

  const now = new Date();
  const historyEntry = {
    fromStage: 'owner_change',
    toStage: 'owner_change',
    at: now,
    note: `专员数据移交: ${leavingOwnerId} → ${newOwnerId}`,
    operatorId,
    operator: operatorId,
    action: 'owner_transferred',
  };

  // 并发更新所有 Application（Promise.all 消除 N+1）
  const updateResults = await Promise.allSettled(
    targetApps.map((app) =>
      dbInstance.collection('Application').doc(app._id).update({
        ownerId: newOwnerId,
        updatedAt: now,
        history: dbInstance.command.push(historyEntry),
      })
    )
  );

  transferred = updateResults.filter((r) => r.status === 'fulfilled').length;
  errors = updateResults
    .filter((r) => r.status === 'rejected')
    .map((r, i) => `${targetApps[i]?._id}: ${r.reason?.message}`);

  // 3. 停用离职专员的邮箱配置
  try {
    const { data: configs } = await dbInstance
      .collection('EmailConfig')
      .where({ userId: leavingOwnerId, enabled: true })
      .get();

    // 并发停用邮箱配置
    if (configs && configs.length > 0) {
      await Promise.allSettled(
        configs.map((config) =>
          dbInstance.collection('EmailConfig').doc(config._id).update({
            enabled: false,
            updatedAt: now,
          })
        )
      );
    }
  } catch (err) {
    console.warn('[handover] 停用邮箱配置失败:', err.message);
  }

  // 4. 发送通知给接手专员
  try {
    await dbInstance.collection('ParseNotification').add({
      userId: newOwnerId,
      type: 'handover',
      title: `数据移交通知`,
      detail: `您收到来自 ${leavingOwnerId} 的 ${transferred} 位活跃候选人，请及时跟进。`,
      status: 'unread',
      createdAt: now,
    });
  } catch (err) {
    console.warn('[handover] 通知发送失败:', err.message);
  }

  // 5. 写入审计日志（异步）
  try {
    await cloudbase.callFunction('write-audit-log', {
      action: 'handover_applications',
      entityType: 'Application',
      entityIds: targetApps.map((a) => a._id),
      detail: {
        fromOwner: leavingOwnerId,
        toOwner: newOwnerId,
        count: transferred,
        failedCount: errors.length,
      },
      operator: operatorId,
    });
  } catch (err) {
    console.warn('[handover] 审计日志写入失败:', err.message);
  }

  return { transferred, errors };
}

/**
 * 批量归档（管理员手动触发）
 * @param {string[]} appIds - Application ID 列表
 * @returns {Promise<number>} 归档数量
 */
export async function batchArchive(appIds) {
  const dbInstance = db();
  const now = new Date();
  let count = 0;

  for (const id of appIds) {
    try {
      await dbInstance.collection('Application').doc(id).update({
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      });
      count++;
    } catch (err) {
      console.warn(`[handover] 归档 ${id} 失败:`, err.message);
    }
  }

  return count;
}
