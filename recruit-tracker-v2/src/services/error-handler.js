/* 新励成招聘管理系统 V2.0 — 统一错误处理
 *
 * P2-7：将分散的 console.error-only catch 块统一为"调试日志 + 用户提示"。
 * 防止静默失败——用户应总是收到有意义的错误反馈。
 *
 * 使用方式：
 *   import { handleError } from '../services/error-handler';
 *   try { ... } catch (err) {
 *     handleError(err, { context: '保存候选人', toast });
 *   }
 */

import { safeErrorMsg } from './error-messages';

/**
 * 统一错误处理：日志 + Toast 通知
 *
 * @param {Error|string} err - 错误对象或消息
 * @param {Object} options
 * @param {string} options.context - 错误发生的上下文（如 "保存候选人"）
 * @param {Object} options.toast - useToast() 实例（可选，传入则自动弹出通知）
 * @param {Function} options.onConflict - 版本冲突回调（可选）
 * @param {boolean} options.silent - 是否只记日志不弹通知
 */
export function handleError(err, options = {}) {
  const { context = '操作', toast = null, onConflict = null, silent = false } = options;
  const message = safeErrorMsg(err);

  // 总是输出调试日志
  console.error(`[${context}] 失败:`, err);

  // 用户提示（除非静默模式）
  if (toast && !silent) {
    toast.error(`${context}失败：${message}`);
  }

  // 版本冲突特殊处理
  if (onConflict && err?.name === 'VersionConflictError') {
    onConflict(err);
  }

  return message;
}

/**
 * 捕获异步错误并统一处理（用于事件处理函数）
 *
 * @param {Function} fn - 异步函数
 * @param {Object} options - 同 handleError
 * @returns {Function} 包装后的函数
 */
export function withErrorHandler(fn, options = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      handleError(err, options);
      return null;
    }
  };
}
