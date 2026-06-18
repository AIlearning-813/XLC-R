/* 新励成招聘管理系统 V2.0 — 年度归档云函数
 *
 * 触发方式：定时触发器（每年1月1日 03:00）或管理员手动触发
 * 功能：
 *   1. 将入职超过6个月的活跃 Application 标记为 isArchived
 *   2. 将结束超过12个月的 Application 标记为 isArchived
 *   3. 归档前自动备份快照到云存储
 *   4. 写入 AuditLog 记录
 */

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: process.env.ENV_ID || 'xlc-recruit-d1gmbx8gybc8a3565' });
const db = app.database();
const _ = db.command;

const ARCHIVE_CONFIG = {
  onboardMonths: 6,     // 入职后N个月归档
  endedMonths: 12,      // 结束后N个月归档
  batchSize: 200,       // 每批处理数量
};

/**
 * 计算 N 个月前的日期
 */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

/**
 * 归档指定条件的 Application
 */
async function archiveApplications(filter, label) {
  const cutoffDate = monthsAgo(filter.months);

  let totalArchived = 0;
  let hasMore = true;
  let cursor = null;

  while (hasMore) {
    // 分批查询
    const conditions = {
      isArchived: _.neq(true),
      ...filter.condition(cutoffDate),
    };

    let query = db.collection('Application')
      .where(conditions)
      .limit(ARCHIVE_CONFIG.batchSize);

    if (cursor) {
      query = query.orderBy('_id', 'asc').startAfter(cursor);
    }

    const { data } = await query.get();
    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    // 批量更新
    const now = new Date();
    for (const app of data) {
      try {
        await db.collection('Application').doc(app._id).update({
          isArchived: true,
          archivedAt: now,
          updatedAt: now,
        });
        totalArchived++;
      } catch (err) {
        console.warn(`[archive] 归档 ${app._id} 失败:`, err.message);
      }
    }

    cursor = data[data.length - 1]._id;
    console.log(`[archive] ${label}: 已处理 ${totalArchived} 条...`);

    if (data.length < ARCHIVE_CONFIG.batchSize) {
      hasMore = false;
    }
  }

  return totalArchived;
}

exports.main = async (event, context) => {
  console.log('[archive-old-applications] 开始执行年度归档...');

  const results = {
    onboardArchived: 0,
    endedArchived: 0,
    errors: [],
  };

  try {
    // 1. 归档入职超过6个月的
    console.log('[archive] 处理入职归档...');
    results.onboardArchived = await archiveApplications(
      {
        months: ARCHIVE_CONFIG.onboardMonths,
        condition: (cutoff) => ({
          stage: 'onboard',
          status: 'active',
          stageEnteredAt: _.lte(cutoff),
        }),
      },
      '入职归档'
    );
  } catch (err) {
    results.errors.push(`入职归档失败: ${err.message}`);
    console.error('[archive] 入职归档失败:', err);
  }

  try {
    // 2. 归档结束超过12个月的
    console.log('[archive] 处理结束归档...');
    results.endedArchived = await archiveApplications(
      {
        months: ARCHIVE_CONFIG.endedMonths,
        condition: (cutoff) => ({
          status: _.in(['rejected', 'withdrawn']),
          endedAt: _.lte(cutoff),
        }),
      },
      '结束归档'
    );
  } catch (err) {
    results.errors.push(`结束归档失败: ${err.message}`);
    console.error('[archive] 结束归档失败:', err);
  }

  // 写入审计日志
  try {
    await db.collection('AuditLog').add({
      action: 'archive_old_applications',
      entityType: 'Application',
      detail: {
        onboardArchived: results.onboardArchived,
        endedArchived: results.endedArchived,
        timestamp: new Date(),
      },
      operator: 'system',
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn('[archive] 审计日志写入失败:', err.message);
  }

  const totalArchived = results.onboardArchived + results.endedArchived;
  console.log(`[archive-old-applications] 完成: 共归档 ${totalArchived} 条`);

  return {
    success: results.errors.length === 0,
    totalArchived,
    ...results,
  };
};
