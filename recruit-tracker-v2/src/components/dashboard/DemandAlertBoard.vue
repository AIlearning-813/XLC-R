<script setup>
/* 预警观察板 — 已逾期/临近截止/高缺口需求 */

defineProps({
  alerts: { type: Array, default: () => [] },
});

const severityLabel = { overdue: '已逾期', nearDeadline: '临近截止', highGap: '高缺口' };
const severityColor = { overdue: 'danger', nearDeadline: 'warning', highGap: 'accent' };
</script>

<template>
  <div class="dab">
    <h3 class="section-title">⚠️ 招聘需求预警</h3>
    <div v-if="!alerts.length" class="text-muted" style="padding: var(--spacing-md);">暂无预警，一切正常 👏</div>
    <div v-else class="dab-list">
      <div
        v-for="a in alerts" :key="a.id"
        class="dab-item"
        :class="'dab-' + (severityColor[a.severity] || 'warning')"
      >
        <div class="dab-main">
          <span class="dab-tag" :class="'tag-' + (severityColor[a.severity] || 'warning')">
            {{ severityLabel[a.severity] || a.severity }}
          </span>
          <span class="dab-title">{{ a.title }}</span>
        </div>
        <div class="dab-meta">
          <span>{{ a.department }}</span>
          <span class="dab-dot">·</span>
          <span v-if="a.remainingDays !== null && !a.isOverdue">剩余 {{ a.remainingDays }} 天</span>
          <span v-else-if="a.isOverdue" class="text-danger">已逾期 {{ Math.abs(a.remainingDays) }} 天</span>
          <span class="dab-dot">·</span>
          <span>缺口 {{ a.gap }} 人</span>
          <span class="dab-dot">·</span>
          <span>完成 {{ a.completionRate }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dab { margin-bottom: var(--spacing-xl); }
.section-title { font-size: var(--font-size-md); font-weight: 600; color: var(--gray-700); margin: 0 0 var(--spacing-md); }
.dab-list { display: flex; flex-direction: column; gap: var(--spacing-xs); }
.dab-item { padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-md); background: var(--gray-25); border-left: 3px solid var(--gray-200); }
.dab-item.dab-danger { border-left-color: var(--danger); background: rgba(229,62,62,0.04); }
.dab-item.dab-warning { border-left-color: var(--warning); background: rgba(240,184,40,0.04); }
.dab-item.dab-accent { border-left-color: #7C3AED; }
.dab-main { display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: 4px; }
.dab-tag { font-size: 10px; padding: 1px 8px; border-radius: var(--radius-full); font-weight: 600; }
.tag-danger { background: rgba(229,62,62,0.1); color: var(--danger); }
.tag-warning { background: rgba(240,184,40,0.1); color: #B8860B; }
.tag-accent { background: rgba(124,58,237,0.1); color: #7C3AED; }
.dab-title { font-weight: 600; font-size: var(--font-size-sm); color: var(--gray-700); }
.dab-meta { font-size: var(--font-size-xs); color: var(--gray-400); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dab-dot { color: var(--gray-300); }
.text-danger { color: var(--danger); font-weight: 600; }
.text-muted { color: var(--gray-400); font-size: var(--font-size-sm); }
</style>
