/**
 * useNotificationStore.js — ParseNotification 通知状态管理
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';

const db = cloudbase.db;

export const useNotificationStore = defineStore('notification', () => {
  // 状态
  const notifications = ref([]);
  const loading = ref(false);
  const error = ref('');

  // 计算
  const unreadCount = computed(() =>
    notifications.value.filter((n) => n.status === 'unread').length
  );
  const recentNotifications = computed(() =>
    notifications.value.slice(0, 5)
  );
  const hasUnread = computed(() => unreadCount.value > 0);

  // 操作
  async function fetchNotifications(userId) {
    if (!userId) return;

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

  async function markAsRead(notificationId) {
    try {
      await db().collection('ParseNotification').doc(notificationId).update({
        status: 'read',
      });

      // 更新本地状态
      const notif = notifications.value.find((n) => n._id === notificationId);
      if (notif) {
        notif.status = 'read';
      }
    } catch (err) {
      console.error('[NotificationStore] 标记已读失败:', err.message);
    }
  }

  async function markAllAsRead(userId) {
    try {
      const unreadIds = notifications.value
        .filter((n) => n.status === 'unread')
        .map((n) => n._id);

      for (const id of unreadIds) {
        await db().collection('ParseNotification').doc(id).update({
          status: 'read',
        });
      }

      // 更新本地状态
      notifications.value.forEach((n) => {
        n.status = 'read';
      });
    } catch (err) {
      console.error('[NotificationStore] 全部已读失败:', err.message);
    }
  }

  return {
    notifications,
    loading,
    error,
    unreadCount,
    recentNotifications,
    hasUnread,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  };
});
