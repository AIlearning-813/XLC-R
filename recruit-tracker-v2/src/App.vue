<script setup>
/* 新励成招聘管理系统 V2.0 — 根组件 */

import { useAuthStore } from './stores/useAuthStore';
import AppLayout from './components/layout/AppLayout.vue';
import LoginPage from './views/LoginPage.vue';

const auth = useAuthStore();
</script>

<template>
  <LoginPage v-if="!auth.isLoggedIn" />
  <AppLayout v-else />
</template>

<style>
/* 全局样式已通过 main.js 导入 base.css + components.css */
</style>
