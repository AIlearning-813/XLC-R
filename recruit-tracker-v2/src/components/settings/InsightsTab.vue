<script setup>
/**
 * InsightsTab.vue — 历史洞察 Tab（阶段 6.4 完整实现）
 *
 * 按岗位类型展示 RecruitmentInsight 自动计算的分析结果：
 * 平均招聘周期、薪资范围、录用画像、常见淘汰原因等。
 */
import { ref } from 'vue';

// 骨架占位
const implemented = ref(false);
</script>

<template>
  <div class="insights-tab">
    <div v-if="!implemented" class="card empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">历史洞察</div>
      <p class="text-muted">阶段 6.4 实现 — 基于历史招聘数据自动生成岗位洞察</p>
      <p class="text-muted">平均招聘周期 | 薪资范围 | 录用画像 | 常见淘汰原因</p>
    </div>
  </div>
</template>

<style scoped>
.insights-tab { max-width: 900px; }
</style>
