<script setup>
/* 新励成招聘管理系统 V2.0 — 主布局壳 */

import Sidebar from './Sidebar.vue';
import { useAuthStore } from '../../stores/useAuthStore';

const auth = useAuthStore();
</script>

<template>
  <div class="app-layout">
    <Sidebar />
    <main class="app-main">
      <header class="app-topbar">
        <div class="topbar-breadcrumb">
          <span class="topbar-title">{{ $route.meta.title || '工作台' }}</span>
        </div>
        <div class="topbar-actions">
          <span class="topbar-role-badge" :class="auth.isAdmin ? 'badge-info' : ''">
            {{ auth.isAdmin ? '管理员' : '招聘专员' }}
          </span>
          <span class="topbar-user">{{ auth.userName }}</span>
          <button class="btn btn-ghost btn-sm" @click="auth.logout()">退出</button>
        </div>
      </header>
      <div class="app-content">
        <router-view />
      </div>
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

.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px var(--spacing-lg);
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.6);
  position: sticky;
  top: 0;
  z-index: 100;
}

.topbar-breadcrumb {
  display: flex;
  align-items: center;
}

.topbar-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--gray-700);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.topbar-role-badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: var(--gray-100);
  color: var(--gray-500);
}

.topbar-user {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
}

.app-content {
  flex: 1;
  padding: var(--spacing-lg);
  overflow-y: auto;
}
</style>
