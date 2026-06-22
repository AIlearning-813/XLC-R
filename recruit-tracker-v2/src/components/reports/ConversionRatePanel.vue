<script setup>
/* 转化率面板 — 展示各环节转化率 */

defineProps({
  rates: { type: Array, default: () => [] },
  overallRate: { type: Number, default: 0 },
});
</script>

<template>
  <div class="crp">
    <h3 class="card-title">📊 各环节转化率</h3>
    <div class="crp-grid">
      <div v-for="r in rates" :key="r.label" class="crp-card">
        <div class="crp-label">{{ r.label }}</div>
        <div class="crp-rate">{{ r.rate }}%</div>
        <div class="crp-detail">{{ r.numerator }} / {{ r.denominator }}</div>
      </div>
      <div class="crp-card crp-overall">
        <div class="crp-label">整体转化率</div>
        <div class="crp-rate">{{ overallRate }}%</div>
        <div class="crp-detail">简历 → 入职</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crp { margin-bottom: var(--spacing-lg); }
.card-title { margin: 0 0 var(--spacing-md); font-size: var(--font-size-lg); font-weight: 600; color: var(--gray-700); }
.crp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--spacing-sm); }
.crp-card {
  background: var(--gray-25);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  text-align: center;
}
.crp-card.crp-overall { background: rgba(74,108,247,0.06); border: 1px solid rgba(74,108,247,0.15); }
.crp-label { font-size: var(--font-size-xs); color: var(--gray-500); margin-bottom: 4px; }
.crp-rate { font-size: 24px; font-weight: 700; color: var(--gray-800); }
.crp-overall .crp-rate { color: var(--primary); }
.crp-detail { font-size: var(--font-size-xs); color: var(--gray-400); margin-top: 2px; }
</style>
