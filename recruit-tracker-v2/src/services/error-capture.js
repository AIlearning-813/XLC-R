/* 新励成招聘管理系统 V2.0 — 全局错误捕获 */

import cloudbase from './cloudbase';

// 错误日志缓冲（避免频繁写数据库）
let errorBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL = 5000; // 5 秒合并写入
const MAX_BUFFER = 20;

async function flushErrors() {
  if (errorBuffer.length === 0) return;

  const errors = errorBuffer.splice(0);

  // 控制台输出（开发调试）
  errors.forEach((e) => {
    console.error('[ErrorCapture]', e.type, e.message, e.context);
  });

  // 写入 CloudBase ErrorLog 集合
  try {
    const db = cloudbase.db();
    if (!db) return; // CloudBase 未初始化时跳过

    const collection = db.collection('ErrorLog');
    // CloudBase SDK 不支持批量 add，逐条写入（非阻塞）
    for (const e of errors) {
      collection.add({
        type: 'client',
        source: 'frontend',
        message: e.message,
        stack: e.context?.stack || null,
        context: {
          ...e.context,
          url: window.location.href,
          userAgent: navigator.userAgent,
        },
        severity: 'warning',
        createdAt: new Date(),
      }).catch(() => {
        // 写入失败静默忽略，避免无限递归
      });
    }
  } catch {
    // CloudBase 写入失败静默忽略
  }
}

export function setupErrorCapture(app) {
  // Vue 错误处理器
  app.config.errorHandler = (err, instance, info) => {
    captureError('vue', err.message, {
      stack: err.stack,
      component: instance?.$options?.name || instance?.type?.name || '未知',
      info,
    });
  };

  // Vue 警告（仅记录警告级别）
  app.config.warnHandler = (msg, instance, trace) => {
    if (msg.includes('TODO') || msg.includes('FIXME')) return;
    captureError('vue_warning', msg, {
      component: instance?.$options?.name || '未知',
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
