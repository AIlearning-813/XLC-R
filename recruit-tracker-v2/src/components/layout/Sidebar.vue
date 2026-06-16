<script setup>
/* 新励成招聘管理系统 V2.0 — 侧边栏导航 */

import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/useAuthStore';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

// 导航菜单项
const menuItems = computed(() => {
  const items = [
    { path: '/dashboard', title: '工作台', icon: '📊' },
    { path: '/pipeline', title: '招聘看板', icon: '📋' },
    { path: '/candidates', title: '候选人', icon: '👤' },
    { path: '/reports', title: '数据分析', icon: '📈' },
  ];

  if (auth.isAdmin) {
    items.push(
      { path: '/admin-review', title: '变更审核', icon: '✅' },
      { path: '/import', title: '数据导入', icon: '📥' },
      { path: '/settings', title: '系统设置', icon: '⚙️' },
    );
  }

  return items;
});

function navigate(path) {
  router.push(path);
}

function isActive(path) {
  return route.path.startsWith(path);
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">XL</div>
      <div class="sidebar-brand">
        <span class="sidebar-brand-name">新励成招聘</span>
        <span class="sidebar-brand-version">V2.0</span>
      </div>
    </div>

    <nav class="sidebar-nav">
      <button
        v-for="item in menuItems"
        :key="item.path"
        class="sidebar-item"
        :class="{ active: isActive(item.path) }"
        @click="navigate(item.path)"
      >
        <span class="sidebar-item-icon">{{ item.icon }}</span>
        <span class="sidebar-item-title">{{ item.title }}</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-user-card">
        <div class="sidebar-user-avatar">
          {{ auth.userName.charAt(0) || '?' }}
        </div>
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">{{ auth.userName }}</span>
          <span class="sidebar-user-role">{{ auth.isAdmin ? '管理员' : '专员' }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  width: var(--sidebar-w);
  height: 100vh;
  background: var(--gray-800);
  color: #fff;
  display: flex;
  flex-direction: column;
  z-index: 200;
  overflow-y: auto;
}

/* 头部 */
.sidebar-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-lg) var(--spacing-md);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.sidebar-logo {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: var(--font-size-md);
  flex-shrink: 0;
}

.sidebar-brand {
  display: flex;
  flex-direction: column;
}

.sidebar-brand-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.sidebar-brand-version {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

/* 导航 */
.sidebar-nav {
  flex: 1;
  padding: var(--spacing-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 10px var(--spacing-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  font-size: var(--font-size-base);
  text-align: left;
  transition: all var(--transition);
  cursor: pointer;
  width: 100%;
}

.sidebar-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.sidebar-item.active {
  background: var(--primary);
  color: #fff;
}

.sidebar-item-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.sidebar-item-title {
  font-weight: 500;
}

/* 底部用户 */
.sidebar-footer {
  padding: var(--spacing-md);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.sidebar-user-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.05);
}

.sidebar-user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: var(--font-size-sm);
  flex-shrink: 0;
}

.sidebar-user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar-user-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-user-role {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}
</style>
