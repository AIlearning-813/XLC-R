<script setup>
/* 新励成招聘管理系统 V2.0 — 招聘看板（阶段 4 实现） */
</script>

<template>
  <div class="pipeline-page">
    <h2 class="page-title">招聘看板</h2>
    <p class="page-desc">拖拽式管道管理，按岗位切换视图</p>

    <div class="card card-solid empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-text">看板管道</div>
      <p class="text-muted">阶段 4 实现 — SortableJS 拖拽 + 12 步漏斗 + 自动回填</p>
    </div>
  </div>
</template>

<style scoped>
.pipeline-page {
  max-width: 100%;
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
</style>
