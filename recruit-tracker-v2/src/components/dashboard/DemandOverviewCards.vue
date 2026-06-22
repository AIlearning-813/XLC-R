<script setup>
/* 需求概览卡片 — 进行中/已逾期/缺口/完成率 */

defineProps({
  stats: {
    type: Object,
    default: () => ({
      recruiting: 0,
      overdue: 0,
      gap: 0,
      completionRate: 0,
    }),
  },
});
</script>

<template>
  <div class="doc">
    <h3 class="section-title">📋 招聘需求概览</h3>
    <div class="doc-grid">
      <div class="card doc-card">
        <div class="doc-num primary">{{ stats.recruiting }}</div>
        <div class="doc-label">进行中</div>
      </div>
      <div class="card doc-card" :class="{ 'doc-alert': stats.overdue > 0 }">
        <div class="doc-num danger">{{ stats.overdue }}</div>
        <div class="doc-label">已逾期</div>
      </div>
      <div class="card doc-card">
        <div class="doc-num warning">{{ stats.gap }}</div>
        <div class="doc-label">缺口人数</div>
      </div>
      <div class="card doc-card">
        <div class="doc-num" :class="stats.completionRate >= 80 ? 'success' : 'accent'">{{ stats.completionRate }}%</div>
        <div class="doc-label">招聘完成率</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc { margin-bottom: var(--spacing-xl); }
.section-title { font-size: var(--font-size-md); font-weight: 600; color: var(--gray-700); margin: 0 0 var(--spacing-md); }
.doc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--spacing-md); }
.doc-card { padding: var(--spacing-lg); text-align: center; }
.doc-alert { border-left: 3px solid var(--danger); }
.doc-num { font-size: 28px; font-weight: 700; line-height: 1.2; }
.doc-num.primary { color: var(--primary); }
.doc-num.success { color: var(--success); }
.doc-num.warning { color: var(--warning); }
.doc-num.danger { color: var(--danger); }
.doc-num.accent { color: #7C3AED; }
.doc-label { font-size: var(--font-size-xs); color: var(--gray-400); margin-top: var(--spacing-xs); }
@media (max-width: 768px) { .doc-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
