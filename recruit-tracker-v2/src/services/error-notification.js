/* 新励成招聘管理系统 V2.0 — 全局错误通知通道
 *
 * 解决 Pinia Store 无法直接使用 useToast() composable 的问题。
 * Store/Services 层通过此模块发送错误通知，App.vue 中注册 toast 回调。
 *
 * 使用方式：
 *   App.vue: registerErrorCallback((msg) => toast.error(msg))
 *   Store:   handleError(err, { context: '操作' })  // 无需手动传 toast
 */

let _callback = null;

/**
 * 注册全局错误回调（由 App.vue 在 setup 中调用）
 * @param {(msg: string) => void} fn — 错误通知回调
 */
export function registerErrorCallback(fn) {
  _callback = fn;
}

/**
 * 发送错误通知（由 error-handler 内部调用）
 * @param {string} msg — 用户友好的错误消息
 */
export function notifyError(msg) {
  if (_callback) {
    _callback(msg);
  }
}
