<script setup>
/* 新励成招聘管理系统 V2.0 — 登录页 */

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
    error.value = auth.loginError || 'CloudBase 连接失败，请检查网络或配置';
    loading.value = false;
    return;
  }

  auth.selectRole(selectedRole.value, displayName.value || undefined);
  loading.value = false;
}
</script>

<template>
  <div class="login-page">
    <!-- 左侧品牌区 -->
    <div class="login-hero">
      <div class="hero-content">
        <div class="hero-badge">V2.0</div>
        <h1 class="hero-title">新励成<br>招聘管理系统</h1>
        <p class="hero-desc">
          高效管理招聘全流程，从简历入库到入职<br>
          看板式管道流转，一目了然
        </p>
        <div class="hero-stats">
          <div class="hero-stat">
            <span class="hero-stat-num">12</span>
            <span class="hero-stat-label">步标准化漏斗</span>
          </div>
          <div class="hero-stat">
            <span class="hero-stat-num">15</span>
            <span class="hero-stat-label">种简历格式支持</span>
          </div>
          <div class="hero-stat">
            <span class="hero-stat-num">AI</span>
            <span class="hero-stat-label">智能简历解析</span>
          </div>
        </div>
      </div>
      <div class="hero-footer">
        <span>CloudBase · DeepSeek · 腾讯云OCR</span>
      </div>
    </div>

    <!-- 右侧登录区 -->
    <div class="login-main">
      <div class="login-form-card">
        <div class="login-form-header">
          <h2>选择角色进入</h2>
          <p>请选择您的身份以开始使用系统</p>
        </div>

        <div class="role-options">
          <button
            class="role-card"
            :class="{ selected: selectedRole === 'admin' }"
            @click="selectedRole = 'admin'"
          >
            <div class="role-icon-wrap">
              <svg class="role-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 15v3m0 0v3m0-3h3m-3 0H9m6-9a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path d="M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2"/>
              </svg>
            </div>
            <div class="role-text">
              <span class="role-title">管理员</span>
              <span class="role-desc">全部数据可见 · 审批变更 · 系统配置</span>
            </div>
            <div class="role-check" v-if="selectedRole === 'admin'">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </div>
          </button>

          <button
            class="role-card"
            :class="{ selected: selectedRole === 'recruiter' }"
            @click="selectedRole = 'recruiter'"
          >
            <div class="role-icon-wrap">
              <svg class="role-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                <path d="M12 14c-4.418 0-8 1.79-8 4v2h16v-2c0-2.21-3.582-4-8-4z"/>
              </svg>
            </div>
            <div class="role-text">
              <span class="role-title">招聘专员</span>
              <span class="role-desc">管理候选人 · 看板流转 · 邮箱配置</span>
            </div>
            <div class="role-check" v-if="selectedRole === 'recruiter'">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </div>
          </button>
        </div>

        <div class="login-name-input" v-if="selectedRole">
          <label class="form-label">显示名称</label>
          <input
            type="text"
            class="form-input"
            v-model="displayName"
            :placeholder="selectedRole === 'admin' ? '例如：张经理' : '例如：李专员'"
            @keyup.enter="handleLogin"
          />
          <span class="input-hint">选填，用于在系统中标识您的身份</span>
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
          {{ loading ? '正在进入...' : '进入系统' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
}

/* === 左侧品牌区 === */
.login-hero {
  flex: 0 0 480px;
  background: linear-gradient(160deg, #3A4B63 0%, #4C5F7A 40%, #5B7B9A 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: var(--spacing-3xl);
  position: relative;
  overflow: hidden;
}

/* 背景纹理 */
.login-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 20% 80%, rgba(196, 134, 90, 0.15) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 20%, rgba(255, 255, 255, 0.05) 0%, transparent 40%);
  pointer-events: none;
}

.hero-content {
  position: relative;
  z-index: 1;
  max-width: 380px;
}

.hero-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.12);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-bottom: var(--spacing-lg);
}

.hero-title {
  font-size: 36px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.02em;
  margin-bottom: var(--spacing-md);
}

.hero-desc {
  font-size: var(--font-size-base);
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.7;
  margin-bottom: var(--spacing-2xl);
}

.hero-stats {
  display: flex;
  gap: var(--spacing-xl);
}

.hero-stat {
  display: flex;
  flex-direction: column;
}

.hero-stat-num {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.hero-stat-label {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
}

.hero-footer {
  position: relative;
  z-index: 1;
  margin-top: auto;
  padding-top: var(--spacing-2xl);
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.3);
}

/* === 右侧登录区 === */
.login-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
}

.login-form-card {
  width: 100%;
  max-width: 420px;
}

.login-form-header {
  margin-bottom: var(--spacing-lg);
}

.login-form-header h2 {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
  letter-spacing: -0.02em;
}

.login-form-header p {
  font-size: var(--font-size-base);
  color: var(--gray-400);
  margin-top: var(--spacing-xs);
}

/* === 角色卡片 === */
.role-options {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
}

.role-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border: 2px solid var(--gray-100);
  border-radius: var(--radius);
  background: #fff;
  cursor: pointer;
  transition: all var(--transition);
  text-align: left;
  width: 100%;
  font-family: inherit;
}

.role-card:hover {
  border-color: var(--gray-200);
  box-shadow: var(--shadow);
}

.role-card.selected {
  border-color: var(--primary);
  background: var(--primary-bg);
}

.role-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: var(--gray-50);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--gray-400);
  transition: all var(--transition);
}

.role-card.selected .role-icon-wrap {
  background: var(--primary);
  color: #fff;
}

.role-icon-svg {
  width: 22px;
  height: 22px;
}

.role-text {
  flex: 1;
  min-width: 0;
}

.role-title {
  display: block;
  font-weight: 600;
  font-size: var(--font-size-base);
  color: var(--gray-700);
}

.role-desc {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  margin-top: 2px;
}

.role-check {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.role-check svg {
  width: 16px;
  height: 16px;
}

/* === 名称输入 === */
.login-name-input {
  margin-bottom: var(--spacing-lg);
}

.input-hint {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  margin-top: 4px;
}

/* === 错误提示 === */
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

/* === 移动端适配 === */
@media (max-width: 768px) {
  .login-page {
    flex-direction: column;
  }

  .login-hero {
    flex: 0 0 auto;
    padding: var(--spacing-xl) var(--spacing-lg);
  }

  .hero-title {
    font-size: 28px;
  }

  .hero-stats {
    display: none;
  }

  .login-main {
    padding: var(--spacing-lg);
  }
}
</style>
