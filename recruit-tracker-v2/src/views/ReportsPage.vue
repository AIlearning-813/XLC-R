<script setup>
/* 新励成招聘管理系统 V2.0 — 数据分析（阶段 5 实现） */
</script>

<template>
  <div class="reports-page">
    <h2 class="page-title">数据分析</h2>
    <p class="page-desc">漏斗转化率、趋势图、报表导出</p>

    <div class="card card-solid empty-state">
      <div class="empty-state-icon">📈</div>
      <div class="empty-state-text">报表中心</div>
      <p class="text-muted">阶段 5 实现 — 云函数聚合 + 12 节点漏斗图 + 趋势分析</p>
    </div>
  </div>
</template>

<style scoped>
.reports-page { max-width: 1200px; }
.page-title { font-size: var(--font-size-2xl); font-weight: 700; color: var(--gray-700); margin-bottom: var(--spacing-xs); }
.page-desc { color: var(--gray-400); margin-bottom: var(--spacing-lg); }
</style>
