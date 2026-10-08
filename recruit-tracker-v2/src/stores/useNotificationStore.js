/**
 * useNotificationStore.js — ParseNotification 通知状态管理
 *
 * ⚠️ 为什么已读状态记录在本地（2026-10-08 修复）：
 *   ParseNotification 的集合权限是「所有用户可读，**仅管理端可写**」（ADMINWRITE），
 *   所以原实现「客户端直接改 status='read'」**必然被权限拒绝**。
 *   线上实测：5000 条通知全部为 unread，历史上没有一条被标记过已读
 *   —— 表现为「工作台的未读角标永远消不掉」。
 *   改集合权限属于安全加固范畴（业主已明确暂缓），新增云函数接口成本更高，
 *   因此改为：已读状态在本地记录（按账号隔离），角标行为恢复正常；
 *   同时**保留**原来的写库调用（best-effort）——将来权限若放开，服务端也会同步。
 *   局限：已读状态不跨设备同步（同账号换设备后会重新显示未读）。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';

const db = cloudbase.db;

/** 本地已读记录按账号隔离（多人共用一台电脑时互不影响） */
const READ_KEY_PREFIX = 'xlc_notif_read_';
const MAX_LOCAL_READ = 500;

function loadReadIds(userId) {
  try {
    const raw = localStorage.getItem(READ_KEY_PREFIX + (userId || 'anonymous'));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistReadIds(userId, ids) {
  try {
    const arr = [...ids].slice(-MAX_LOCAL_READ);
    localStorage.setItem(READ_KEY_PREFIX + (userId || 'anonymous'), JSON.stringify(arr));
  } catch {
    /* 存储不可用时静默降级（角标会恢复为未读），不影响主流程 */
  }
}

export const useNotificationStore = defineStore('notification', () => {
  // 状态
  const notifications = ref([]);
  const loading = ref(false);
  const error = ref('');
  const currentUserId = ref('');
  const readIds = ref(new Set());

  // 计算
  const isUnread = (n) => n.status === 'unread' && !readIds.value.has(n._id);
  const unreadCount = computed(() => notifications.value.filter(isUnread).length);
  const recentNotifications = computed(() => notifications.value.slice(0, 5));
  const hasUnread = computed(() => unreadCount.value > 0);

  // 操作
  async function fetchNotifications(userId) {
    if (!userId) return;

    currentUserId.value = userId;
    readIds.value = loadReadIds(userId);

    loading.value = true;
    error.value = '';
    try {
      const result = await db()
        .collection('ParseNotification')
        .where({ userId })
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get();

      notifications.value = result.data || [];
    } catch (err) {
      error.value = err.message || '获取通知失败';
      console.error('[NotificationStore] 获取通知失败:', err.message);
    } finally {
      loading.value = false;
    }
  }

  /** 本地记为已读（立即生效，无需服务端）*/
  function markLocalRead(ids) {
    const next = new Set(readIds.value);
    for (const id of ids) {
      if (id) next.add(id);
    }
    readIds.value = next;
    persistReadIds(currentUserId.value, next);
    // 同步更新内存中的对象状态：与旧实现表现一致（有调用方依赖 notif.status），
    // 且刷新后即使服务端仍返回 unread，也会被 readIds 过滤掉。
    for (const n of notifications.value) {
      if (next.has(n._id)) n.status = 'read';
    }
  }

  async function markAsRead(notificationId) {
    // 本地先记：即使服务端拒绝，角标也能立刻消掉
    markLocalRead([notificationId]);
    try {
      await db().collection('ParseNotification').doc(notificationId).update({
        status: 'read',
      });
    } catch (err) {
      // 「仅管理端可写」时这里必然失败，属预期；本地已读已生效
      console.error('[NotificationStore] 服务端标记已读未生效（集合仅管理端可写），已按本地记录处理:', err.message);
    }
  }

  async function markAllAsRead() {
    const ids = notifications.value.filter(isUnread).map((n) => n._id);
    markLocalRead(ids);
    for (const id of ids) {
      try {
        await db().collection('ParseNotification').doc(id).update({
          status: 'read',
        });
      } catch (err) {
        console.error('[NotificationStore] 服务端标记已读未生效（集合仅管理端可写），已按本地记录处理:', err.message);
        break; // 权限一致，无需逐条重试
      }
    }
  }

  return {
    notifications,
    loading,
    error,
    readIds,
    unreadCount,
    recentNotifications,
    hasUnread,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  };
});