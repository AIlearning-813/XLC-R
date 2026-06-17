<script setup>
/**
 * SettingsPage.vue — 系统设置（Tab 布局）
 *
 * 包含：
 *   - 邮箱配置：IMAP 自动归集
 *   - 系统设置：岗位管理等（阶段 6 实现）
 */
import { ref } from 'vue';
import EmailConfigPage from './EmailConfigPage.vue';

const activeTab = ref('email');

const tabs = [
  { key: 'email', label: '邮箱配置', icon: '📧' },
  { key: 'system', label: '系统设置', icon: '⚙️' },
];
</script>

<template>
  <div class="settings-page">
    <div class="page-header">
      <h2 class="page-title">系统设置</h2>
      <p class="page-desc">邮箱自动归集、岗位管理、知识库、系统配置</p>
    </div>

    <!-- Tab 导航 -->
    <div class="tab-nav">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <span class="tab-icon">{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- Tab 内容 -->
    <div class="tab-content">
      <EmailConfigPage v-if="activeTab === 'email'" />
      <div v-else class="card empty-state">
        <div class="empty-state-icon">⚙️</div>
        <div class="empty-state-text">系统设置</div>
        <p class="text-muted">阶段 6 实现 — 岗位/部门/城市管理 + 知识库 + 权限管理 + 公司信息</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 1100px;
}

.page-header {
  margin-bottom: var(--spacing-lg);
}

.page-title {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--gray-800);
  letter-spacing: -0.02em;
}

.page-desc {
  font-size: var(--font-size-base);
  color: var(--gray-400);
  margin-top: 2px;
}

/* Tab 导航 */
.tab-nav {
  display: flex;
  gap: 0;
  margin-bottom: var(--spacing-lg);
  border-bottom: 2px solid var(--gray-100);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-lg);
  border: none;
  background: none;
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--gray-400);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all var(--transition);
  font-family: inherit;
}

.tab-btn:hover {
  color: var(--gray-600);
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.tab-icon {
  font-size: 16px;
}

/* Tab 内容 */
.tab-content {
  min-height: 300px;
}
</style>
