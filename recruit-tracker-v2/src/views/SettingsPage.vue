<script setup>
/**
 * SettingsPage.vue — 系统设置（Tab 布局）
 *
 * 包含：
 *   - 邮箱配置：IMAP 自动归集
 *   - 公司信息：CompanyProfile 编辑
 *   - 知识库：KnowledgeBase 管理
 *   - 历史洞察：RecruitmentInsight 展示
 *   - 系统配置：部门/城市/岗位类型/告警阈值管理
 */
import { ref } from 'vue';
import EmailConfigPage from './EmailConfigPage.vue';
import CompanyInfoTab from '../components/settings/CompanyInfoTab.vue';
import KnowledgeBaseTab from '../components/settings/KnowledgeBaseTab.vue';
import InsightsTab from '../components/settings/InsightsTab.vue';
import SystemConfigTab from '../components/settings/SystemConfigTab.vue';
import DepartmentManageTab from '../components/settings/DepartmentManageTab.vue';
import JobTypeManageTab from '../components/settings/JobTypeManageTab.vue';

const activeTab = ref('email');

const tabs = [
  { key: 'email', label: '邮箱配置', icon: '📧' },
  { key: 'company', label: '公司信息', icon: '🏢' },
  { key: 'knowledge', label: '知识库', icon: '📚' },
  { key: 'insights', label: '历史洞察', icon: '📊' },
  { key: 'dept', label: '部门管理', icon: '🏗️' },
  { key: 'jobtype', label: '岗位配置', icon: '💼' },
  { key: 'system', label: '系统配置', icon: '⚙️' },
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
      <CompanyInfoTab v-else-if="activeTab === 'company'" />
      <KnowledgeBaseTab v-else-if="activeTab === 'knowledge'" />
      <InsightsTab v-else-if="activeTab === 'insights'" />
      <DepartmentManageTab v-else-if="activeTab === 'dept'" />
      <JobTypeManageTab v-else-if="activeTab === 'jobtype'" />
      <SystemConfigTab v-else-if="activeTab === 'system'" />
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
