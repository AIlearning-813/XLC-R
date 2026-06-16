<script setup>
/* 新励成招聘管理系统 V2.0 — 主布局壳 */

import Sidebar from './Sidebar.vue';
import ToastContainer from '../common/ToastContainer.vue';
import { useAuthStore } from '../../stores/useAuthStore';

const auth = useAuthStore();
</script>

<template>
  <div class="app-layout">
    <Sidebar />
    <main class="app-main">
      <header class="app-topbar">
        <div class="topbar-left">
          <span class="topbar-title">{{ $route.meta.title || '工作台' }}</span>
        </div>
        <div class="topbar-right">
          <span class="topbar-role-badge" :class="{ admin: auth.isAdmin }">
            {{ auth.isAdmin ? '管理员' : '专员' }}
          </span>
        </div>
      </header>
      <div class="app-content">
        <router-view />
      </div>
      <ToastContainer />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
}

.app-main {
  flex: 1;
  margin-left: var(--sidebar-w);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* === 顶栏 === */
.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px var(--spacing-xl);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--gray-100);
  position: sticky;
  top: 0;
  z-index: 100;
}

.topbar-left {
  display: flex;
  align-items: center;
}

.topbar-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--gray-700);
  letter-spacing: -0.01em;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.topbar-role-badge {
  padding: 4px 12px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: var(--gray-50);
  color: var(--gray-500);
}

.topbar-role-badge.admin {
  background: var(--primary-bg);
  color: var(--primary);
}

/* === 内容区 === */
.app-content {
  flex: 1;
  padding: var(--spacing-xl);
}
</style>
