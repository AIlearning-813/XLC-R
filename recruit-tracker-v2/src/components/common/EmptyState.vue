<script setup>
/**
 * EmptyState — 空状态占位组件
 *
 * 统一项目中"暂无数据"的展示风格。
 *
 * Props:
 *   icon    — 大图标（emoji 或文本）
 *   title   — 主提示文字
 *   desc    — 副描述文字
 *   action  — 操作按钮文字（可选）
 */
defineProps({
  icon: { type: String, default: '📋' },
  title: { type: String, default: '暂无数据' },
  desc: { type: String, default: '' },
  action: { type: String, default: '' },
});
defineEmits(['action']);
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">{{ icon }}</div>
    <h3 class="empty-title">{{ title }}</h3>
    <p v-if="desc" class="empty-desc">{{ desc }}</p>
    <button v-if="action" class="btn btn-sm btn-primary" @click="$emit('action')">
      {{ action }}
    </button>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-3xl) var(--spacing-lg);
  text-align: center;
}
.empty-icon { font-size: 48px; margin-bottom: var(--spacing-md); opacity: 0.7; }
.empty-title { font-size: var(--font-size-md); font-weight: 600; color: var(--gray-500); margin: 0 0 var(--spacing-xs); }
.empty-desc { font-size: var(--font-size-sm); color: var(--gray-400); margin: 0 0 var(--spacing-md); max-width: 320px; }
</style>
