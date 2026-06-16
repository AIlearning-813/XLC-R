<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人列表（阶段 4 实现） */
</script>

<template>
  <div class="candidates-page">
    <h2 class="page-title">候选人</h2>
    <p class="page-desc">搜索、筛选、批量操作候选人档案</p>

    <div class="card card-solid empty-state">
      <div class="empty-state-icon">👤</div>
      <div class="empty-state-text">候选人列表</div>
      <p class="text-muted">阶段 4 实现 — 搜索筛选 + 详情页 + 沟通记录</p>
    </div>
  </div>
</template>

<style scoped>
.candidates-page {
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
</style>
