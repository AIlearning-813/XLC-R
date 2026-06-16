/**
 * write-audit-log — 审计日志写入云函数
 *
 * 前端无法直接写 AuditLog（CloudBase 安全规则限制），
 * 通过云函数以服务端权限写入，确保审计日志不丢失。
 */
const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

exports.main = async (event, context) => {
  const { action, entityType, entityIds, detail, operator } = event;

  if (!action || !entityType) {
    return { success: false, error: 'action 和 entityType 为必填项' };
  }

  try {
    const result = await db.collection('AuditLog').add({
      action,
      entityType,
      entityIds: entityIds || [],
      detail: detail || {},
      operator: operator || '',
      timestamp: new Date(),
    });

    return { success: true, id: result.id };
  } catch (err) {
    console.error('[write-audit-log] 写入失败:', err.message);
    return { success: false, error: err.message };
  }
};
