<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人卡片（看板用） */

import { computed } from 'vue';

const props = defineProps({
  candidate: { type: Object, required: true },
  application: { type: Object, required: true },
  job: { type: Object, default: null },
});

const emit = defineEmits(['click']);

const name = computed(() => props.candidate?.name || '未命名');
const position = computed(() => {
  return props.candidate?.expectedPosition
    || props.job?.title
    || props.job?.name
    || '未知岗位';
});

const sourceLabel = computed(() => {
  const src = props.application?.funnelMeta?.entrySource || props.candidate?.source;
  const map = { email: '邮箱', manual: '手动', import: '导入' };
  return map[src] || src || '未知';
});

const sourceBadgeClass = computed(() => {
  const src = props.application?.funnelMeta?.entrySource || props.candidate?.source;
  if (src === 'email') return 'badge-info';
  if (src === 'manual') return 'badge-success';
  if (src === 'import') return 'badge-warning';
  return 'badge-info';
});

// 在当前阶段的停留天数
const stayDays = computed(() => {
  const entered = props.application?.stageEnteredAt;
  if (!entered) return 0;
  const diff = Date.now() - new Date(entered).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
});

const stayLabel = computed(() => {
  if (stayDays.value === 0) return '今天进入';
  if (stayDays.value === 1) return '1 天';
  return `${stayDays.value} 天`;
});

const isStale = computed(() => stayDays.value > 7);

function handleClick() {
  emit('click', { candidate: props.candidate, application: props.application });
}
</script>

<template>
  <div
    class="candidate-card"
    :class="{ stale: isStale }"
    :data-id="application._id"
    @click="handleClick"
  >
    <div class="card-top">
      <span class="card-name">{{ name }}</span>
      <span class="card-source badge" :class="sourceBadgeClass">{{ sourceLabel }}</span>
    </div>
    <div class="card-position">{{ position }}</div>
    <div class="card-meta">
      <span class="card-stay" :class="{ 'stay-warn': isStale }">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        {{ stayLabel }}
      </span>
      <span class="card-phone" v-if="candidate?.phone">{{ candidate.phone }}</span>
    </div>
  </div>
</template>

<style scoped>
.candidate-card {
  background: #fff;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  cursor: grab;
  transition: all var(--transition);
  user-select: none;
}

.candidate-card:hover {
  border-color: var(--gray-200);
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}

.candidate-card:active {
  cursor: grabbing;
}

.candidate-card.stale {
  border-left: 3px solid var(--warning);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.card-name {
  font-weight: 600;
  font-size: var(--font-size-base);
  color: var(--gray-700);
}

.card-source {
  font-size: 10px;
  padding: 1px 8px;
}

.card-position {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.card-stay {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--gray-400);
}

.card-stay svg {
  flex-shrink: 0;
}

.card-stay.stay-warn {
  color: var(--warning);
}

.card-phone {
  font-size: 11px;
  color: var(--gray-300);
}
</style>
