<script setup>
/* 新励成招聘管理系统 V2.0 — 工作台 */

import { useAuthStore } from '../stores/useAuthStore';
const auth = useAuthStore();
</script>

<template>
  <div class="dashboard-page">
    <h2 class="page-title">工作台</h2>
    <p class="page-desc">欢迎回来，{{ auth.userName }}</p>

    <div class="dashboard-grid">
      <div class="card card-solid empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-text">统计卡片</div>
        <p class="text-muted">阶段 5 实现 — 今日/本周/本月数据概览</p>
      </div>
      <div class="card card-solid empty-state">
        <div class="empty-state-icon">🔔</div>
        <div class="empty-state-text">待跟进提醒</div>
        <p class="text-muted">阶段 5 实现 — 超期未跟进候选人自动提醒</p>
      </div>
      <div class="card card-solid empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">最近活动</div>
        <p class="text-muted">阶段 5 实现 — 候选人状态变更时间线</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  max-width: 1200px;
}

.page-title {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--gray-700);
  margin-bottom: var(--spacing-xs);
}

.page-desc {
  color: var(--gray-400);
  margin-bottom: var(--spacing-lg);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--spacing-lg);
}
</style>
