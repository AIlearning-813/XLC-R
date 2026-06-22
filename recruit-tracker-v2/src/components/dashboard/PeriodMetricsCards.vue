<script setup>
/* 周期指标卡片 — 工作台中按时间段显示的关键指标 */

defineProps({
  metrics: {
    type: Object,
    default: () => ({
      demandCount: 0,
      onboardCount: 0,
      offerPending: 0,
      alreadyOnboarded: 0,
    }),
  },
});
</script>

<template>
  <div class="pmc">
    <h3 class="section-title">周期内数据（{{ metrics.rangeLabel || '—' }}）</h3>
    <div class="pmc-grid">
      <div class="card pmc-card">
        <div class="pmc-num primary">{{ metrics.demandCount }}</div>
        <div class="pmc-label">招聘需求数</div>
      </div>
      <div class="card pmc-card">
        <div class="pmc-num success">{{ metrics.onboardCount }}</div>
        <div class="pmc-label">招聘入职</div>
      </div>
      <div class="card pmc-card">
        <div class="pmc-num warning">{{ metrics.offerPending }}</div>
        <div class="pmc-label">Offer/待入职</div>
      </div>
      <div class="card pmc-card">
        <div class="pmc-num accent">{{ metrics.alreadyOnboarded }}</div>
        <div class="pmc-label">已入职人数</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pmc { margin-bottom: var(--spacing-xl); }
.section-title { font-size: var(--font-size-md); font-weight: 600; color: var(--gray-700); margin: 0 0 var(--spacing-md); }
.pmc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--spacing-md); }
.pmc-card { padding: var(--spacing-lg); text-align: center; }
.pmc-num { font-size: 28px; font-weight: 700; line-height: 1.2; }
.pmc-num.primary { color: var(--primary); }
.pmc-num.success { color: var(--success); }
.pmc-num.warning { color: var(--warning); }
.pmc-num.accent { color: #7C3AED; }
.pmc-label { font-size: var(--font-size-xs); color: var(--gray-400); margin-top: var(--spacing-xs); }
@media (max-width: 768px) { .pmc-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
