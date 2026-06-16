/**
 * write-audit-log — 审计日志写入云函数
 *
 * 前端无法直接写 AuditLog（CloudBase 安全规则限制），
 * 通过云函数以服务端权限写入，确保审计日志不丢失。
 *
 * 安全机制：
 *   - 验证 operator 必须与调用者的 auth.uid 一致，防止审计日志伪造
 *   - 拒绝未认证的调用
 */
const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

exports.main = async (event, context) => {
  const { action, entityType, entityIds, detail, operator } = event;

  // 参数校验
  if (!action || !entityType) {
    return { success: false, error: 'action 和 entityType 为必填项' };
  }

  // 🆕 调用者身份验证：防止审计日志伪造
  // CloudBase 云函数上下文中包含调用者的 auth 信息
  const callerUid = context.auth?.uid || '';
  if (!callerUid) {
    console.warn('[write-audit-log] 拒绝未认证的调用');
    return { success: false, error: '未认证的调用，审计日志写入被拒绝' };
  }

  // operator 必须与调用者 uid 一致（前端不可伪造 callerUid）
  const effectiveOperator = operator || callerUid;
  if (operator && operator !== callerUid) {
    console.warn(`[write-audit-log] operator 不匹配: 传入=${operator}, 实际=${callerUid}`);
    return { success: false, error: '操作者身份与调用者不一致，审计日志写入被拒绝' };
  }

  try {
    const result = await db.collection('AuditLog').add({
      action,
      entityType,
      entityIds: entityIds || [],
      detail: detail || {},
      operator: effectiveOperator,
      timestamp: new Date(),
    });

    return { success: true, id: result.id };
  } catch (err) {
    console.error('[write-audit-log] 写入失败:', err.message);
    return { success: false, error: err.message };
  }
};
