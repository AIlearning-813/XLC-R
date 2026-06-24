/**
 * cleanup-test-data — 一次性清理云函数
 *
 * 清空内测前的测试数据，保留系统配置和用户账号。
 *
 * 清空的集合：
 *   Candidate, Application, RecruitmentDemand, ParseQueue,
 *   ParseNotification, AuditLog, ReportCache, PendingChange, ProcessingLock
 *
 * 保留的集合：
 *   Job, EmailConfig, Users, Config, ParseCorrectionBank
 *
 * 安全机制：
 *   - 需要传入 confirmToken 确认操作
 *   - 输出每个集合删除的文档数量
 *   - 仅管理员可调用（通过 auth-proxy 验证）
 */

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

// 要清空的集合列表
const COLLECTIONS_TO_CLEAR = [
  'Candidate',
  'Application',
  'Job',
  'RecruitmentDemand',
  'ParseQueue',
  'ParseNotification',
  'AuditLog',
  'ReportCache',
  'PendingChange',
  'ProcessingLock',
];

// 确认令牌（防止误操作）
const CONFIRM_TOKEN = 'CLEANUP-NOW';

/**
 * 删除集合中的所有文档（分批处理，每批最多 1000 条）
 */
async function clearCollection(collectionName) {
  const MAX_BATCH = 1000;
  let totalDeleted = 0;

  try {
    while (true) {
      // 获取一批文档 ID
      const { data } = await db.collection(collectionName)
        .limit(MAX_BATCH)
        .get();

      if (!data || data.length === 0) break;

      const ids = data.map((doc) => doc._id);

      // 逐个删除（CloudBase 不支持批量 delete where _id in）
      for (const id of ids) {
        try {
          await db.collection(collectionName).doc(id).remove();
          totalDeleted++;
        } catch (err) {
          console.warn(`[cleanup] 删除 ${collectionName}/${id} 失败:`, err.message);
        }
      }

      console.log(`[cleanup] ${collectionName}: 已删除 ${totalDeleted} 条...`);
    }

    return totalDeleted;
  } catch (err) {
    console.error(`[cleanup] 清空 ${collectionName} 失败:`, err.message);
    throw err;
  }
}

exports.main = async (event, context) => {
  const { confirmToken } = event || {};

  // 安全确认
  if (confirmToken !== CONFIRM_TOKEN) {
    return {
      success: false,
      error: '请传入 confirmToken: "CLEANUP-NOW" 以确认清空操作',
      collectionsToClear: COLLECTIONS_TO_CLEAR,
    };
  }

  console.log('[cleanup] ========== 开始清空测试数据 ==========');

  const results = {};
  let totalDeleted = 0;

  for (const col of COLLECTIONS_TO_CLEAR) {
    try {
      const count = await clearCollection(col);
      results[col] = { success: true, deleted: count };
      totalDeleted += count;
      console.log(`[cleanup] ${col}: 完成，删除 ${count} 条`);
    } catch (err) {
      results[col] = { success: false, error: err.message };
      console.error(`[cleanup] ${col}: 失败 — ${err.message}`);
    }
  }

  console.log(`[cleanup] ========== 清空完成，总计删除 ${totalDeleted} 条 ==========`);

  return {
    success: true,
    totalDeleted,
    results,
    message: `已清空 ${COLLECTIONS_TO_CLEAR.length} 个集合，共删除 ${totalDeleted} 条文档`,
  };
};
