<script setup>
/* 新励成招聘管理系统 V2.0 — 根组件 */

import { useAuthStore } from './stores/useAuthStore';
import { useToast } from './composables/useToast';
import { registerErrorCallback } from './services/error-notification';
import AppLayout from './components/layout/AppLayout.vue';
import LoginPage from './views/LoginPage.vue';
import OfflineBanner from './components/common/OfflineBanner.vue';

const auth = useAuthStore();
const toast = useToast();

// 注册全局错误通知回调（供 Store/Service 层使用）
registerErrorCallback((msg) => toast.error(msg));
</script>

<template>
  <!-- 离线提示（全局，与登录状态无关） -->
  <OfflineBanner />
  <LoginPage v-if="!auth.isLoggedIn" />
  <AppLayout v-else />
</template>

<style>
/* 全局样式已通过 main.js 导入 base.css + components.css */
</style>
