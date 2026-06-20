<script setup>
/**
 * CompanyInfoTab.vue — 公司信息编辑 Tab（阶段 6.3 完整实现）
 *
 * 编辑 CompanyProfile 单例文档：基本信息、办公地点、文化标签、福利标签等。
 * 保存时自动追加 changeLog 历史记录。
 */
import { ref } from 'vue';

// 骨架占位
const implemented = ref(false);
</script>

<template>
  <div class="company-info-tab">
    <div v-if="!implemented" class="card empty-state">
      <div class="empty-state-icon">🏢</div>
      <div class="empty-state-text">公司信息编辑</div>
      <p class="text-muted">阶段 6.3 实现 — 公司基本信息、办公地点、文化标签、福利标签、招聘理念、雇主品牌</p>
      <p class="text-muted">保存时自动记录变更历史 (changeLog)</p>
    </div>
  </div>
</template>

<style scoped>
.company-info-tab { max-width: 800px; }
</style>
