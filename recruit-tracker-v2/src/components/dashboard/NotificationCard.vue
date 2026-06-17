<script setup>
/**
 * NotificationCard.vue — Dashboard 解析通知卡片
 *
 * 展示最近 3 条未读解析通知，含红点徽章和跳转链接
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationStore } from '../../stores/useNotificationStore';

const router = useRouter();
const store = useNotificationStore();

const unreadNotifications = computed(() =>
  store.notifications.filter((n) => n.status === 'unread').slice(0, 3)
);

const hasNotifications = computed(() => store.notifications.length > 0);

function getTypeIcon(type) {
  switch (type) {
    case 'parse_success': return '📄';
    case 'parse_failed': return '⚠️';
    case 'parse_duplicate': return '🔄';
    default: return '📬';
  }
}

function handleClick(notification) {
  store.markAsRead(notification._id);
  if (notification.candidateId) {
    router.push(`/candidates/${notification.candidateId}`);
  }
}

function formatTime(date) {
  if (!date) return '';
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  return new Date(date).toLocaleDateString('zh-CN');
}
</script>

<template>
  <div class="card notification-card">
    <div class="card-header">
      <div class="card-header-left">
        <h4>解析通知</h4>
        <span v-if="store.unreadCount > 0" class="badge badge-danger notification-badge">
          {{ store.unreadCount }}
        </span>
      </div>
      <button
        v-if="store.unreadCount > 0"
        class="btn-ghost-link"
        @click="store.markAllAsRead()"
      >
        全部已读
      </button>
    </div>

    <div v-if="store.loading" class="card-body loading-hint">
      <div class="spinner"></div>
    </div>

    <div v-else-if="!hasNotifications" class="card-body empty-hint">
      <span class="empty-icon">📭</span>
      <span class="empty-text">暂无通知</span>
      <span class="empty-sub">邮箱收取的简历解析结果将出现在这里</span>
    </div>

    <div v-else class="notification-list">
      <div
        v-for="notif in unreadNotifications"
        :key="notif._id"
        class="notification-item"
        :class="{ unread: notif.status === 'unread' }"
        @click="handleClick(notif)"
      >
        <span class="notif-icon">{{ getTypeIcon(notif.type) }}</span>
        <div class="notif-content">
          <span class="notif-title">{{ notif.title }}</span>
          <span class="notif-detail">
            {{ notif.detail?.source ? `来自 ${notif.detail.source}` : '' }}
            {{ notif.detail?.fileName ? `· ${notif.detail.fileName}` : '' }}
          </span>
        </div>
        <span class="notif-time">{{ formatTime(notif.createdAt) }}</span>
      </div>
    </div>

    <!-- 更多链接 -->
    <div v-if="store.notifications.length > 3" class="card-footer">
      <span class="more-hint">共 {{ store.notifications.length }} 条通知</span>
    </div>
  </div>
</template>

<style scoped>
.notification-card {
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--gray-100);
}

.card-header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.card-header h4 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--gray-700);
}

.notification-badge {
  font-size: 11px;
  min-width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-ghost-link {
  background: none;
  border: none;
  color: var(--primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}

.btn-ghost-link:hover {
  background: var(--primary-bg);
}

/* 通知列表 */
.notification-list {
  display: flex;
  flex-direction: column;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-lg);
  cursor: pointer;
  transition: background var(--transition);
}

.notification-item:hover {
  background: var(--gray-50);
}

.notification-item.unread {
  background: var(--primary-bg);
}

.notif-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.notif-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.notif-title {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--gray-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-detail {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-time {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 2px;
}

/* 空状态 */
.loading-hint,
.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl);
  gap: var(--spacing-xs);
}

.empty-icon {
  font-size: 28px;
  margin-bottom: var(--spacing-xs);
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  font-weight: 500;
}

.empty-sub {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
}

.card-footer {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-top: 1px solid var(--gray-100);
  text-align: center;
}

.more-hint {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
}
</style>
