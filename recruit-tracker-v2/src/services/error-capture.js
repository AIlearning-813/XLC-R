/* 新励成招聘管理系统 V2.0 — 全局错误捕获 */

// 错误日志缓冲（避免频繁写数据库）
let errorBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL = 5000; // 5 秒合并写入
const MAX_BUFFER = 20;

function flushErrors() {
  if (errorBuffer.length === 0) return;

  const errors = errorBuffer.splice(0);
  // TODO: 阶段 1 后续 → 写入 CloudBase ErrorLog 集合
  // 当前阶段仅控制台输出，不阻塞 UI
  errors.forEach((e) => {
    console.error('[ErrorCapture]', e.type, e.message, e.context);
  });
}

export function setupErrorCapture(app) {
  // Vue 错误处理器
  app.config.errorHandler = (err, instance, info) => {
    captureError('vue', err.message, {
      stack: err.stack,
      component: instance?.$options?.name || instance?.type?.name || 'unknown',
      info,
    });
  };

  // Vue 警告（仅记录警告级别）
  app.config.warnHandler = (msg, instance, trace) => {
    if (msg.includes('TODO') || msg.includes('FIXME')) return;
    captureError('vue_warning', msg, {
      component: instance?.$options?.name || 'unknown',
      trace,
    });
  };

  // 全局未捕获 Promise 错误
  window.addEventListener('unhandledrejection', (event) => {
    captureError('unhandled_promise', event.reason?.message || String(event.reason), {
      stack: event.reason?.stack,
    });
    event.preventDefault(); // 阻止默认控制台错误
  });

  // 全局 JS 错误
  window.addEventListener('error', (event) => {
    // 跳过资源加载错误（如图片 404）
    if (event.target !== window) return;
    captureError('global_js', event.message, {
      stack: event.error?.stack,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });
}

function captureError(type, message, context = {}) {
  errorBuffer.push({
    type,
    message,
    context,
    timestamp: new Date().toISOString(),
  });

  // 缓冲区达到上限立即刷新
  if (errorBuffer.length >= MAX_BUFFER) {
    clearTimeout(flushTimer);
    flushErrors();
    return;
  }

  // 定期刷新
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushErrors();
    }, FLUSH_INTERVAL);
  }
}
