<script setup>
/* 新励成招聘管理系统 V2.0 — 登录页（角色选择） */

import { ref } from 'vue';
import { useAuthStore } from '../stores/useAuthStore';

const auth = useAuthStore();
const selectedRole = ref(null);
const displayName = ref('');
const loading = ref(false);
const error = ref('');

async function handleLogin() {
  if (!selectedRole.value) return;

  loading.value = true;
  error.value = '';

  const ok = await auth.initAuth();
  if (!ok) {
    error.value = 'CloudBase 连接失败，请检查网络或配置';
    loading.value = false;
    return;
  }

  auth.selectRole(selectedRole.value, displayName.value || undefined);
  loading.value = false;
}
</script>

<template>
  <div class="login-page">
    <div class="login-card card card-solid">
      <div class="login-header">
        <div class="login-logo">XL</div>
        <h1 class="login-title">新励成招聘管理系统</h1>
        <p class="login-version">V2.0</p>
      </div>

      <div class="login-body">
        <h2 class="login-prompt">选择登录角色</h2>

        <div class="role-options">
          <label
            class="role-card"
            :class="{ selected: selectedRole === 'admin' }"
          >
            <input
              type="radio"
              value="admin"
              v-model="selectedRole"
              class="role-radio"
            />
            <span class="role-icon">🔑</span>
            <span class="role-title">管理员</span>
            <span class="role-desc">全部数据可见 · 审批变更 · 系统配置</span>
          </label>

          <label
            class="role-card"
            :class="{ selected: selectedRole === 'recruiter' }"
          >
            <input
              type="radio"
              value="recruiter"
              v-model="selectedRole"
              class="role-radio"
            />
            <span class="role-icon">👤</span>
            <span class="role-title">招聘专员</span>
            <span class="role-desc">管理自己的候选人 · 看板流转 · 邮箱配置</span>
          </label>
        </div>

        <div class="login-name-input" v-if="selectedRole">
          <label class="form-label">显示名称（选填）</label>
          <input
            type="text"
            class="form-input"
            v-model="displayName"
            :placeholder="selectedRole === 'admin' ? '例如：张经理' : '例如：李专员'"
            @keyup.enter="handleLogin"
          />
        </div>

        <div v-if="error" class="login-error">
          {{ error }}
        </div>

        <button
          class="btn btn-primary btn-lg login-btn"
          :disabled="!selectedRole || loading"
          @click="handleLogin"
        >
          <span v-if="loading" class="spinner"></span>
          {{ loading ? '登录中...' : '进入系统' }}
        </button>
      </div>

      <div class="login-footer">
        <span>基于 CloudBase + DeepSeek 构建</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
}

.login-card {
  width: 100%;
  max-width: 420px;
  overflow: hidden;
}

.login-header {
  text-align: center;
  padding: var(--spacing-xl) var(--spacing-lg) var(--spacing-md);
}

.login-logo {
  width: 56px;
  height: 56px;
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xl);
  font-weight: 700;
  margin-bottom: var(--spacing-md);
}

.login-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
}

.login-version {
  font-size: var(--font-size-sm);
  color: var(--gray-300);
  margin-top: var(--spacing-xs);
}

.login-body {
  padding: var(--spacing-md) var(--spacing-lg) var(--spacing-lg);
}

.login-prompt {
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--gray-600);
  text-align: center;
  margin-bottom: var(--spacing-md);
}

.role-options {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.role-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border: 2px solid var(--gray-100);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all var(--transition);
}

.role-card:hover {
  border-color: var(--gray-200);
  background: var(--gray-50);
}

.role-card.selected {
  border-color: var(--primary);
  background: var(--primary-bg);
}

.role-radio {
  display: none;
}

.role-icon {
  font-size: 28px;
  flex-shrink: 0;
}

.role-title {
  font-weight: 600;
  color: var(--gray-700);
  margin-bottom: 2px;
}

.role-desc {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.role-card.selected .role-title {
  color: var(--primary);
}

/* 每张角色卡内部用 flex column 排列文字 */
.role-card {
  display: flex;
  align-items: center;
}

.role-card .role-title,
.role-card .role-desc {
  display: block;
}

.role-card .role-text {
  display: flex;
  flex-direction: column;
}

.login-name-input {
  margin-bottom: var(--spacing-md);
}

.login-error {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}

.login-btn {
  width: 100%;
}

.login-footer {
  text-align: center;
  padding: var(--spacing-md);
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  border-top: 1px solid var(--gray-50);
}
</style>
