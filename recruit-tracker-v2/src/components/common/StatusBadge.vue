<script setup>
/**
 * StatusBadge — 通用状态徽章组件
 *
 * 统一项目中的状态标签展示风格，支持多种颜色主题。
 *
 * Props:
 *   label   — 显示文本
 *   variant — 'default' | 'success' | 'warning' | 'danger' | 'info' | 'admin'
 *   size    — 'sm' | 'md'
 */
defineProps({
  label: { type: String, required: true },
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'md' },
});
</script>

<template>
  <span class="status-badge" :class="[`badge-${variant}`, `badge-${size}`]">
    {{ label }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-weight: 600;
  white-space: nowrap;
  font-family: inherit;
}

.badge-sm { font-size: 11px; padding: 2px 8px; }
.badge-md { font-size: var(--font-size-xs); }

.badge-default  { background: var(--gray-50); color: var(--gray-500); }
.badge-success  { background: #e6f7ed; color: #1a7d4c; }
.badge-warning  { background: #fff7e6; color: #b8860b; }
.badge-danger   { background: #fde8e8; color: #c25450; }
.badge-info     { background: #e6f0ff; color: #2a6496; }
.badge-admin    { background: var(--primary-bg); color: var(--primary); }
</style>
