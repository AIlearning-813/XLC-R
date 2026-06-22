<script setup>
/* 渠道入职看板 — 按渠道分组统计入职数据 */

defineProps({
  sourceData: { type: Array, default: () => [] },
});
</script>

<template>
  <div class="sob">
    <h3 class="card-title">📥 渠道入职数据</h3>
    <div v-if="!sourceData.length" class="text-muted">暂无数据</div>
    <div v-else class="sob-grid">
      <div v-for="s in sourceData" :key="s.source" class="sob-card">
        <div class="sob-source">{{ s.source }}</div>
        <div class="sob-numbers">
          <div class="sob-num">
            <span class="sob-num-val">{{ s.onboardCount }}</span>
            <span class="sob-num-label">入职</span>
          </div>
          <div class="sob-num">
            <span class="sob-num-val">{{ s.totalCount }}</span>
            <span class="sob-num-label">总数</span>
          </div>
          <div class="sob-num">
            <span class="sob-num-val" :class="{ 'rate-high': s.rate >= 30, 'rate-low': s.rate < 10 }">{{ s.rate }}%</span>
            <span class="sob-num-label">转化率</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sob { margin-bottom: var(--spacing-lg); }
.card-title { margin: 0 0 var(--spacing-md); font-size: var(--font-size-lg); font-weight: 600; color: var(--gray-700); }
.sob-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--spacing-sm); }
.sob-card {
  background: var(--gray-25);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}
.sob-source { font-weight: 600; color: var(--gray-700); font-size: var(--font-size-sm); margin-bottom: var(--spacing-sm); }
.sob-numbers { display: flex; gap: var(--spacing-md); }
.sob-num { text-align: center; }
.sob-num-val { display: block; font-size: var(--font-size-lg); font-weight: 700; color: var(--gray-800); }
.sob-num-label { display: block; font-size: var(--font-size-xs); color: var(--gray-400); margin-top: 2px; }
.rate-high { color: var(--success); }
.rate-low { color: var(--danger); }
.text-muted { color: var(--gray-400); font-size: var(--font-size-sm); padding: var(--spacing-md); }
</style>
