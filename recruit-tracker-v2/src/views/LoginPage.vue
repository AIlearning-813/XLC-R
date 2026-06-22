<script setup>
/* 新励成招聘管理系统 V2.0 — 登录页（账号密码认证） */

import { ref, onMounted } from 'vue';
import { useAuthStore } from '../stores/useAuthStore';

const auth = useAuthStore();
const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const restoring = ref(true);  // 正在尝试恢复登录态

// 🆕 页面加载时自动初始化 SDK 并尝试恢复登录态
onMounted(async () => {
  try {
    await auth.initSDK();
    // 如果 restoreSession 恢复了用户身份，isLoggedIn 会变成 true，
    // App.vue 会自动从 LoginPage 切换到主界面
  } catch (e) {
    // SDK 初始化失败（如网络不通），静默处理，用户仍可手动登录
    console.warn('[LoginPage] 自动恢复登录态失败:', e.message);
  } finally {
    restoring.value = false;
  }
});

// 错误信息映射
function mapLoginError(rawError) {
  const msg = (rawError || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return '连接超时，请检查网络后重试';
  if (msg.includes('network') || msg.includes('fetch')) return '网络异常，请检查网络连接后重试';
  if (msg.includes('env') || msg.includes('not found')) return '环境配置错误，请联系管理员检查 CloudBase 环境 ID';
  if (msg.includes('permission') || msg.includes('unauthorized')) return '访问被拒绝，请确认已加入系统';
  if (msg.includes('账号不存在')) return '账号不存在，请检查账号名是否正确';
  if (msg.includes('密码错误')) return '密码错误，请重试';
  return rawError || '连接失败，请检查网络或配置';
}

async function handleLogin() {
  const u = username.value.trim();
  const p = password.value;
  if (!u || !p) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  error.value = '';

  try {
    const ok = await auth.login(u, p);
    if (!ok) {
      error.value = mapLoginError(auth.loginError);
    }
  } catch (err) {
    error.value = mapLoginError(err.message || '登录过程中发生未知错误');
  } finally {
    loading.value = false;
  }
}

// 首次初始化：创建默认账号（仅 Users 集合为空时生效）
const initLoading = ref(false);
const initMsg = ref('');
async function handleInitSystem() {
  if (!confirm('将创建 1 个管理员账号（admin）和 8 个招聘专员账号，密码均为 xlc2026。\n\n仅首次初始化时需要，已有账号则跳过。确定继续？')) return;
  initLoading.value = true;
  initMsg.value = '';
  try {
    // 先初始化 SDK 连接
    await auth.initSDK();
    const result = await auth.seedDefaultUsers();
    if (result.skipped) {
      initMsg.value = '账号已存在，无需初始化。请使用已有账号登录。';
    } else {
      initMsg.value = result.message + '。请使用 admin / xlc2026 登录。';
    }
  } catch (err) {
    initMsg.value = `初始化失败：${err.message}`;
  } finally {
    initLoading.value = false;
  }
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
        <span>新励成招聘管理系统</span>
      </div>
    </div>

    <!-- 右侧登录区 -->
    <div class="login-main">
      <!-- 恢复登录态中 -->
      <div v-if="restoring" class="restoring-hint">
        <span class="spinner"></span>
        <span>正在恢复登录态…</span>
      </div>

      <div v-else class="login-form-card">
        <div class="login-form-header">
          <h2>登录系统</h2>
          <p>请输入您的账号和密码</p>
        </div>

        <div class="login-fields">
          <div class="field-group">
            <label class="form-label">账号</label>
            <input
              type="text"
              class="form-input"
              v-model="username"
              placeholder="请输入账号"
              @keyup.enter="handleLogin"
              autocomplete="username"
            />
          </div>
          <div class="field-group">
            <label class="form-label">密码</label>
            <input
              type="password"
              class="form-input"
              v-model="password"
              placeholder="请输入密码"
              @keyup.enter="handleLogin"
              autocomplete="current-password"
            />
          </div>
        </div>

        <div v-if="error" class="login-error">
          {{ error }}
        </div>

        <button
          class="btn btn-primary btn-lg login-btn"
          :disabled="!username.trim() || !password || loading"
          @click="handleLogin"
        >
          <span v-if="loading" class="spinner"></span>
          {{ loading ? '正在登录…' : '登 录' }}
        </button>

        <div class="init-section">
          <div class="init-divider"><span>首次使用？</span></div>
          <button
            class="btn btn-sm btn-outline init-btn"
            :disabled="initLoading"
            @click="handleInitSystem"
          >
            {{ initLoading ? '初始化中…' : '⚡ 初始化系统账号' }}
          </button>
          <p v-if="initMsg" class="init-msg">{{ initMsg }}</p>
        </div>
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

.restoring-hint {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--gray-400);
  font-size: var(--font-size-sm);
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

/* === 登录表单 === */
.login-fields {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--gray-600);
}

.form-input {
  padding: 10px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  color: var(--gray-700);
  transition: border-color var(--transition);
  outline: none;
  box-sizing: border-box;
  width: 100%;
}

.form-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-bg);
}

.form-input::placeholder {
  color: var(--gray-300);
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

/* === 初始化 === */
.init-section {
  margin-top: var(--spacing-lg);
  text-align: center;
}

.init-divider {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
  color: var(--gray-300);
  font-size: var(--font-size-xs);
}

.init-divider::before,
.init-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--gray-100);
}

.btn-outline {
  border: 1px solid var(--gray-200);
  background: #fff;
  color: var(--gray-500);
  cursor: pointer;
  font-family: inherit;
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  transition: all var(--transition);
}

.btn-outline:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.init-msg {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--success);
  padding: var(--spacing-sm);
  background: var(--success-bg);
  border-radius: var(--radius-sm);
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
