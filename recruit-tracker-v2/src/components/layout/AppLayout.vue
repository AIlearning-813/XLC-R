<script setup>
/* 新励成招聘管理系统 V2.0 — 主布局壳 */

import { ref } from 'vue';
import Sidebar from './Sidebar.vue';
import ToastContainer from '../common/ToastContainer.vue';
import OfflineBanner from '../common/OfflineBanner.vue';
import { useAuthStore } from '../../stores/useAuthStore';

const auth = useAuthStore();
const sidebarOpen = ref(false);

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}
</script>

<template>
  <div class="app-layout" :class="{ 'sidebar-open': sidebarOpen }">
    <Sidebar :mobile-open="sidebarOpen" @close="sidebarOpen = false" />
    <!-- 移动端：侧边栏打开时的遮罩 -->
    <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
    <main class="app-main">
      <header class="app-topbar">
        <div class="topbar-left">
          <!-- 移动端汉堡菜单按钮 -->
          <button class="hamburger-btn" @click="toggleSidebar" aria-label="菜单">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span class="topbar-title">{{ $route.meta.title || '工作台' }}</span>
        </div>
        <div class="topbar-right">
          <span class="topbar-role-badge" :class="{ admin: auth.isAdmin }">
            {{ auth.isAdmin ? '管理员' : '专员' }}
          </span>
        </div>
      </header>
      <OfflineBanner />
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
  background: var(--bg-page-gradient);
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
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  position: sticky;
  top: 0;
  z-index: 100;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.topbar-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--gray-700);
  letter-spacing: -0.01em;
}

/* 汉堡菜单按钮（默认隐藏，移动端显示） */
.hamburger-btn {
  display: none;
  width: 36px; height: 36px;
  border: none; border-radius: var(--radius-sm);
  background: transparent;
  color: var(--gray-600);
  align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--transition);
}
.hamburger-btn:hover { background: var(--gray-50); }

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

/* 移动端侧边栏遮罩 */
.sidebar-overlay {
  display: none;
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.3);
  z-index: 190;
}

/* === 内容区 === */
.app-content {
  flex: 1;
  padding: var(--spacing-xl);
}

/* === 移动端响应式 === */
@media (max-width: 768px) {
  .app-main {
    margin-left: 0;
  }

  .hamburger-btn {
    display: flex;
  }

  .sidebar-open .sidebar-overlay {
    display: block;
  }

  .app-topbar {
    padding: 10px var(--spacing-md);
  }

  .app-content {
    padding: var(--spacing-md);
  }
}
</style>
