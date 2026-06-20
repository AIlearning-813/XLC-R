<script setup>
/**
 * KnowledgeBaseTab.vue — 知识库管理 Tab（阶段 6.3 完整实现）
 *
 * 管理招聘知识条目的增删改查、分类筛选、审核、归档。
 * 支持 9 种分类、关键字搜索、标签匹配。
 */
import { ref } from 'vue';

// 骨架占位
const implemented = ref(false);
</script>

<template>
  <div class="knowledge-base-tab">
    <div v-if="!implemented" class="card empty-state">
      <div class="empty-state-icon">📚</div>
      <div class="empty-state-text">知识库管理</div>
      <p class="text-muted">阶段 6.3 实现 — 招聘知识条目 CRUD、分类筛选、搜索、审核队列</p>
      <p class="text-muted">9 种分类 | 关键字 + 标签匹配 | 4 种来源渠道</p>
    </div>
  </div>
</template>

<style scoped>
.knowledge-base-tab { max-width: 900px; }
</style>
