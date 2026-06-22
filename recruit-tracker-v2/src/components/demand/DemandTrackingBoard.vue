<script setup>
/* 招聘需求跟踪看板 — 卡片墙布局 */

import { useRouter } from 'vue-router';

const props = defineProps({
  demands: { type: Array, default: () => [] },
});

const router = useRouter();

function goDetail(id) {
  router.push(`/demands/${id}`);
}

function deadlineLabel(d) {
  if (!d.deadline) return '未设置周期';
  if (d.isOverdue) return `已逾期 ${Math.abs(d.remainingDays)} 天`;
  if (d.remainingDays === 0) return '今日截止';
  return `剩余 ${d.remainingDays} 天`;
}
</script>

<template>
  <div class="dtb">
    <div v-if="!demands.length" class="text-muted" style="padding: var(--spacing-xl); text-align: center;">
      暂无招聘中的需求
    </div>
    <div v-else class="dtb-grid">
      <div
        v-for="d in demands" :key="d.id"
        class="dtb-card"
        :class="{
          'dtb-overdue': d.isOverdue,
          'dtb-near': d.isNearDeadline && !d.isOverdue,
        }"
        @click="goDetail(d.id)"
      >
        <div class="dtb-header">
          <span class="dtb-title">{{ d.title }}</span>
          <span class="dtb-deadline" :class="{ 'text-danger': d.isOverdue, 'text-warning': d.isNearDeadline && !d.isOverdue }">{{ deadlineLabel(d) }}</span>
        </div>
        <div class="dtb-body">
          <div class="dtb-meta">
            <span>{{ d.department }}</span>
            <span v-if="d.jobTitle" class="text-muted"> · {{ d.jobTitle }}</span>
          </div>
          <div class="dtb-progress">
            <div class="dtb-bar-bg">
              <div class="dtb-bar-fill" :style="{ width: Math.min(d.completionRate, 100) + '%' }" :class="{ 'fill-low': d.completionRate < 30, 'fill-mid': d.completionRate >= 30 && d.completionRate < 70, 'fill-high': d.completionRate >= 70 }"></div>
            </div>
            <span class="dtb-pct">{{ d.completionRate }}%</span>
          </div>
        </div>
        <div class="dtb-footer">
          <span>已入职 <strong>{{ d.onboarded }}</strong> / {{ d.headcount }}</span>
          <span>缺口 <strong :class="{ 'text-danger': d.gap > d.headcount * 0.5 }">{{ d.gap }}</strong> 人</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dtb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--spacing-md); }
.dtb-card {
  background: #fff;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  cursor: pointer;
  transition: all 0.2s;
}
.dtb-card:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(74,108,247,0.1); }
.dtb-card.dtb-overdue { border-left: 3px solid var(--danger); background: rgba(229,62,62,0.02); }
.dtb-card.dtb-near { border-left: 3px solid var(--warning); }
.dtb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm); }
.dtb-title { font-weight: 600; font-size: var(--font-size-sm); color: var(--gray-700); }
.dtb-deadline { font-size: var(--font-size-xs); white-space: nowrap; }
.text-danger { color: var(--danger) !important; font-weight: 600; }
.text-warning { color: #B8860B !important; font-weight: 600; }
.dtb-body { margin-bottom: var(--spacing-sm); }
.dtb-meta { font-size: var(--font-size-xs); color: var(--gray-500); margin-bottom: 8px; }
.text-muted { color: var(--gray-400); }
.dtb-progress { display: flex; align-items: center; gap: var(--spacing-sm); }
.dtb-bar-bg { flex: 1; height: 6px; background: var(--gray-100); border-radius: 3px; overflow: hidden; }
.dtb-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; background: var(--primary); }
.dtb-bar-fill.fill-low { background: var(--danger); }
.dtb-bar-fill.fill-mid { background: var(--warning); }
.dtb-bar-fill.fill-high { background: var(--success); }
.dtb-pct { font-size: var(--font-size-xs); font-weight: 600; color: var(--gray-600); min-width: 36px; text-align: right; }
.dtb-footer { display: flex; justify-content: space-between; font-size: var(--font-size-xs); color: var(--gray-500); }
.dtb-footer strong { color: var(--gray-700); }
</style>
