<script setup>
/* 新励成招聘管理系统 V2.0 — 侧边栏导航 */

import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/useAuthStore';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

/* SVG 图标（内联） */
const icons = {
  dashboard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  pipeline: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="5" rx="1.5"/><rect x="3" y="10" width="18" height="5" rx="1.5"/><rect x="3" y="17" width="18" height="5" rx="1.5"/></svg>',
  candidates: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><circle cx="17" cy="9" r="3"/><path d="M18 21v-2a3 3 0 00-3-3h-1"/></svg>',
  reports: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  review: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  ai: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>',
  import: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4"/></svg>',
};

function getIcon(name) {
  return icons[name] || '';
}

const menuItems = computed(() => {
  const items = [
    { path: '/dashboard', title: '工作台', icon: 'dashboard' },
    { path: '/import/resume', title: '录入简历', icon: 'import' },
    { path: '/pipeline', title: '招聘看板', icon: 'pipeline' },
    { path: '/candidates', title: '候选人', icon: 'candidates' },
    { path: '/reports', title: '数据分析', icon: 'reports' },
    { path: '/ai-chat', title: 'AI助手', icon: 'ai' },
    { path: '/settings', title: '系统设置', icon: 'settings' },
  ];

  if (auth.isAdmin) {
    items.push(
      { path: '/admin-review', title: '变更审核', icon: 'review' },
      { path: '/import', title: '历史导入', icon: 'import' },
    );
  }

  return items;
});

function navigate(path) {
  router.push(path);
}

function isActive(path) {
  if (route.path === path) return true;
  if (path === '/import' && route.path.startsWith('/import/')) return false;
  return route.path.startsWith(path + '/');
}
</script>

<template>
  <aside class="sidebar" role="complementary" aria-label="主导航侧边栏">
    <!-- Logo -->
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <svg viewBox="0 0 36 36" fill="none">
          <rect width="36" height="36" rx="10" fill="currentColor" fill-opacity="0.15"/>
          <text x="18" y="24" text-anchor="middle" fill="currentColor" font-size="17" font-weight="700" letter-spacing="-0.5">XL</text>
        </svg>
      </div>
      <div class="sidebar-brand">
        <span class="sidebar-brand-name">新励成招聘</span>
        <span class="sidebar-brand-version">V2.0</span>
      </div>
    </div>

    <!-- 导航 -->
    <nav class="sidebar-nav" role="navigation" aria-label="主导航">
      <button
        v-for="item in menuItems"
        :key="item.path"
        class="sidebar-item"
        :class="{ active: isActive(item.path) }"
        :aria-label="item.title"
        :aria-current="isActive(item.path) ? 'page' : undefined"
        @click="navigate(item.path)"
      >
        <span class="sidebar-item-icon" v-html="getIcon(item.icon)"></span>
        <span class="sidebar-item-title">{{ item.title }}</span>
      </button>
    </nav>

    <!-- 底部用户 -->
    <div class="sidebar-footer">
      <div class="sidebar-divider"></div>
      <div class="sidebar-user-card">
        <div class="sidebar-user-avatar">
          {{ auth.userName.charAt(0) || '?' }}
        </div>
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">{{ auth.userName }}</span>
          <span class="sidebar-user-role">{{ auth.isAdmin ? '管理员' : '招聘专员' }}</span>
        </div>
        <button class="sidebar-logout" @click="auth.logout()" title="退出登录" aria-label="退出登录">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9"/>
          </svg>
        </button>
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
  background: var(--sidebar-bg);
  display: flex;
  flex-direction: column;
  z-index: 200;
}

/* === Logo === */
.sidebar-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 20px var(--spacing-md);
}

.sidebar-logo {
  width: 36px;
  height: 36px;
  color: var(--sidebar-logo-color);
  flex-shrink: 0;
}

.sidebar-logo svg {
  width: 100%;
  height: 100%;
}

.sidebar-brand {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.sidebar-brand-name {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--sidebar-text-active);
  letter-spacing: -0.01em;
}

.sidebar-brand-version {
  font-size: 11px;
  color: var(--sidebar-text-muted);
  font-weight: 500;
}

/* === 导航 === */
.sidebar-nav {
  flex: 1;
  padding: var(--spacing-sm) 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--sidebar-text);
  font-size: var(--font-size-base);
  font-weight: 500;
  text-align: left;
  transition: all var(--transition);
  cursor: pointer;
  width: 100%;
  font-family: inherit;
  position: relative;
}

.sidebar-item:hover {
  background: var(--sidebar-bg-hover);
  color: var(--sidebar-text-active);
}

.sidebar-item.active {
  background: var(--sidebar-bg-active);
  color: var(--sidebar-text-active);
  font-weight: 600;
}

/* 激活态左侧竖线 */
.sidebar-item.active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--sidebar-active-bar);
  border-radius: 0 2px 2px 0;
}

.sidebar-item-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--sidebar-icon);
  transition: color var(--transition);
}

.sidebar-item.active .sidebar-item-icon {
  color: var(--sidebar-icon-active);
}

.sidebar-item:hover .sidebar-item-icon {
  color: var(--sidebar-icon-active);
}

.sidebar-item-icon :deep(svg) {
  display: block;
}

/* === 底部 === */
.sidebar-footer {
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-md);
}

.sidebar-divider {
  height: 1px;
  background: var(--sidebar-divider);
  margin-bottom: var(--spacing-sm);
}

.sidebar-user-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--radius-sm);
}

.sidebar-user-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--sidebar-logo-bg);
  color: var(--sidebar-logo-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: var(--font-size-sm);
  flex-shrink: 0;
}

.sidebar-user-info {
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}

.sidebar-user-name {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--sidebar-text-active);
}

.sidebar-user-role {
  font-size: 11px;
  color: var(--sidebar-text-muted);
}

.sidebar-logout {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--sidebar-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition);
}

.sidebar-logout:hover {
  background: rgba(194, 84, 80, 0.15);
  color: var(--danger-light);
}
</style>
