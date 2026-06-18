<!-- 新励成招聘管理系统 V2.0 — 离线提示横幅 -->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const isOffline = ref(false);
const showRestored = ref(false);

let restoreTimer = null;

function handleOnline() {
  // 从离线恢复
  if (isOffline.value) {
    isOffline.value = false;
    showRestored.value = true;
    // 3 秒后自动隐藏"已恢复"提示
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      showRestored.value = false;
    }, 3000);
  }
}

function handleOffline() {
  isOffline.value = true;
  showRestored.value = false;
  clearTimeout(restoreTimer);
}

onMounted(() => {
  // 初始状态检查
  isOffline.value = navigator.onLine === false;

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
});

onUnmounted(() => {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  clearTimeout(restoreTimer);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="banner-slide">
      <!-- 离线状态 -->
      <div v-if="isOffline" class="offline-banner offline-warning">
        <div class="banner-inner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 015.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0122.2 9"/>
            <path d="M1.8 9a16 16 0 017.34-3.77"/>
            <path d="M9 17.76v.24"/>
            <path d="M15 17.76v.24"/>
          </svg>
          <span>网络连接已断开，部分操作可能不可用</span>
        </div>
      </div>

      <!-- 已恢复提示 -->
      <div v-else-if="showRestored" class="offline-banner offline-restored">
        <div class="banner-inner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1.8 9a16 16 0 0115.4-3.65"/>
            <path d="M5 12.55a11 11 0 0113.08-.35"/>
            <path d="M9 17.76v.24"/>
            <path d="M12 20.76v.24"/>
            <path d="M15 17.76v.24"/>
          </svg>
          <span>网络已恢复</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  padding: 10px 0;
  text-align: center;
}

.banner-inner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.offline-warning .banner-inner {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffc107;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.offline-restored .banner-inner {
  background: #d4edda;
  color: #155724;
  border: 1px solid #28a745;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

/* 动画 */
.banner-slide-enter-active {
  transition: all 0.3s ease;
}
.banner-slide-leave-active {
  transition: all 0.3s ease;
}
.banner-slide-enter-from,
.banner-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
</style>
