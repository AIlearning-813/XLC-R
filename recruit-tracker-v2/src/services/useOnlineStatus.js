/* 新励成招聘管理系统 V2.0 — 网络状态检测工具
 *
 * 提供离线状态查询，供页面/Store 在执行关键操作前检查网络。
 * OfflineBanner 组件负责 UI 层面的离线提示，无需再手动显示。
 *
 * 使用方式：
 *   import { isOnline, checkConnection } from '../services/useOnlineStatus';
 *   if (!isOnline.value) alert('网络已断开，请检查连接');
 */

import { ref } from 'vue';

/** 当前是否在线（响应式） */
export const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);

// 监听浏览器网络事件
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline.value = true;
  });
  window.addEventListener('offline', () => {
    isOnline.value = false;
  });
}

/**
 * 主动检查 CloudBase 连接是否可用
 * @returns {Promise<boolean>}
 */
export async function checkConnection() {
  try {
    if (!navigator.onLine) {
      isOnline.value = false;
      return false;
    }
    const { default: cloudbase } = await import('./cloudbase');
    const db = cloudbase.db();
    if (!db) {
      isOnline.value = false;
      return false;
    }
    // 轻量查询验证
    await db().collection('Job').limit(1).get();
    isOnline.value = true;
    return true;
  } catch {
    isOnline.value = false;
    return false;
  }
}
