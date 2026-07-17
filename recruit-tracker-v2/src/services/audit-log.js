/* 新励成招聘管理系统 V2.0 — 审计日志工具
 *
 * 消除 5 个 Store 中重复的 try/catch + callFunction('write-audit-log') 样板代码。
 *
 * 使用方式：
 *   import { writeAuditLog } from '../services/audit-log';
 *   await writeAuditLog('application_store', 'move_stage', 'Application', [appId], { fromStage, toStage }, operatorId);
 */

import cloudbase from './cloudbase';
import { captureError } from './error-capture';

/**
 * 写入审计日志（异步，不阻塞主流程）
 * @param {string} storeName - Store 名称标识（如 'application_store'）
 * @param {string} action - 操作类型（如 'move_stage', 'job_created'）
 * @param {string} entityType - 实体类型（如 'Application', 'Job'）
 * @param {string[]} entityIds - 实体 ID 列表
 * @param {Object} detail - 操作详情
 * @param {string} [operatorId='system'] - 操作者
 */
export async function writeAuditLog(storeName, action, entityType, entityIds, detail = {}, operatorId = 'system') {
  try {
    await cloudbase.callFunction('write-audit-log', {
      action,
      entityType,
      entityIds,
      detail,
      operator: operatorId,
    });
  } catch (err) {
    console.warn(`[${storeName}] 审计日志写入失败:`, err.message);
    captureError(storeName, '审计日志写入失败', {
      message: err.message,
      context: action,
    });
  }
}
