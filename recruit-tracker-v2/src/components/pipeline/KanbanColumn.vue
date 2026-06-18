<script setup>
/* 新励成招聘管理系统 V2.0 — 看板阶段列（支持完整/紧凑双模式） */

import { ref, computed } from 'vue';
import CandidateCard from './CandidateCard.vue';

const props = defineProps({
  stage: { type: Object, required: true },
  applications: { type: Array, default: () => [] },
  candidatesMap: { type: Object, default: () => ({}) },
  job: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  selectionMode: { type: Boolean, default: false },
  selectedIds: { type: Set, default: () => new Set() },
});

const emit = defineEmits(['card-click', 'card-quick-move', 'toggle-select']);

const stageLabel = computed(() => props.stage?.label || '');
const stageKey = computed(() => props.stage?.key || '');
const isOptional = computed(() => props.stage?.optional === true);
const isEndZone = computed(() => props.stage?.isEnd === true);
const count = computed(() => props.applications?.length || 0);

// 紧凑模式下默认折叠，可展开
const MAX_VISIBLE = 5;
const expanded = ref(false);

const visibleApps = computed(() => {
  if (expanded.value || !props.compact) return props.applications;
  return props.applications.slice(0, MAX_VISIBLE);
});
const hiddenCount = computed(() => Math.max(0, props.applications.length - MAX_VISIBLE));

function toggleExpand() {
  expanded.value = !expanded.value;
}

const columnStyle = computed(() => {
  const colorMap = {
    resume: '#8B8F97',
    valid_resume: '#5B8CB8',
    invite: '#D4A24E',
    invite_confirmed: '#D4875E',
    first_interview: '#3B4F8C',
    first_pass: '#4A9C7C',
    second_interview: '#5B6FAC',
    second_pass: '#5FB896',
    final_interview: '#2D3F70',
    final_pass: '#4A9C7C',
    offer: '#D4875E',
    onboard: '#3B4F8C',
    rejected: '#DC4C4C',
    withdrawn: '#9B8B7C',
  };
  return { '--col-accent': colorMap[stageKey.value] || '#8B8F97' };
});

function onCardClick(payload) {
  emit('card-click', payload);
}

function onCardQuickMove(payload) {
  emit('card-quick-move', payload);
}
</script>

<template>
  <div
    class="kanban-column"
    :class="{ optional: isOptional, 'end-zone': isEndZone, 'compact-mode': compact, expanded: expanded }"
    :style="columnStyle"
    :data-stage="stageKey"
  >
    <!-- 列头 -->
    <div class="col-header">
      <div class="col-title-row">
        <h3 class="col-title">{{ stageLabel }}</h3>
        <span class="col-count">{{ count }}</span>
      </div>
      <div class="col-accent-bar"></div>
    </div>

    <!-- 卡片列表：TransitionGroup Fragment 渲染 → 卡片是 .col-body 直系子元素 → SortableJS 独立拖拽 -->
    <div class="col-body" :data-stage="stageKey">
      <TransitionGroup name="card-list">
        <CandidateCard
          v-for="app in visibleApps"
          :key="app._id"
          :candidate="candidatesMap[app.candidateId] || {}"
          :application="app"
          :job="job"
          :compact="compact"
          :selection-mode="selectionMode"
          :selected="selectedIds.has(app._id)"
          @click="onCardClick"
          @quick-move="onCardQuickMove"
          @toggle-select="(id) => emit('toggle-select', id)"
        />
      </TransitionGroup>

      <!-- 展开更多按钮 -->
      <button
        v-if="hiddenCount > 0 && !expanded"
        class="col-more"
        @click="toggleExpand"
        title="点击展开查看全部候选人"
      >
        + 还有 {{ hiddenCount }} 位
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <!-- 收起按钮 -->
      <button
        v-if="expanded"
        class="col-more col-more-expanded"
        @click="toggleExpand"
        title="点击收起"
      >
        收起列表
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>

      <!-- 空状态 -->
      <div v-if="!loading && count === 0" class="col-empty">
        <span class="col-empty-icon">{{ isEndZone ? '📥' : '—' }}</span>
        <span class="col-empty-text">{{ isEndZone ? '拖拽到此' : '暂无候选人' }}</span>
      </div>

      <!-- 加载骨架 -->
      <div v-if="loading" class="col-loading">
        <div class="skeleton-line" v-for="i in 2" :key="i"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* === 列容器 === */
.kanban-column {
  flex: 0 0 260px;
  min-width: 260px;
  background: var(--gray-50);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 180px);
  transition: all var(--transition);
}

/* 紧凑模式 */
.kanban-column.compact-mode {
  flex: 0 0 175px;
  min-width: 175px;
  max-height: 300px;
}

/* 展开后解除高度限制，允许列自然撑高 */
.kanban-column.compact-mode.expanded {
  max-height: none;
  flex: 0 0 240px;
  min-width: 240px;
}

.kanban-column.optional {
  opacity: 0.7;
}

/* === 列头 === */
.col-header {
  padding: var(--spacing-sm) var(--spacing-md);
  flex-shrink: 0;
}

.compact-mode .col-header {
  padding: 8px 10px;
}

.col-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.col-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--gray-600);
  margin: 0;
  letter-spacing: -0.01em;
}

.compact-mode .col-title {
  font-size: 12px;
}

.col-count {
  font-size: 11px;
  font-weight: 700;
  color: var(--gray-400);
  background: var(--gray-200);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  min-width: 22px;
  text-align: center;
}

.compact-mode .col-count {
  font-size: 10px;
  padding: 1px 6px;
}

.col-accent-bar {
  height: 3px;
  background: var(--col-accent);
  border-radius: 2px;
  margin-top: 8px;
  opacity: 0.6;
}

.compact-mode .col-accent-bar {
  height: 2px;
  margin-top: 6px;
}

/* === 卡片容器 === */
.col-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--spacing-sm) var(--spacing-sm);
  min-height: 120px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.compact-mode .col-body {
  padding: 0 6px 6px;
  min-height: 60px;
  gap: 3px;
}

/* === TransitionGroup 动画 === */
:deep(.card-list-enter-active),
:deep(.card-list-leave-active) {
  transition: all 0.25s ease;
}

:deep(.card-list-enter-from) {
  opacity: 0;
  transform: translateY(-4px);
}

:deep(.card-list-leave-to) {
  opacity: 0;
  transform: translateY(4px);
}

:deep(.card-list-move) {
  transition: transform 0.25s ease;
}

/* === 更多提示（可点击展开/收起）=== */
.col-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  text-align: center;
  font-size: 11px;
  color: var(--primary);
  background: var(--primary-bg);
  border: 1px dashed var(--primary);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition);
}

.col-more:hover {
  background: var(--primary);
  color: #fff;
  border-style: solid;
}

.col-more-expanded {
  color: var(--gray-500);
  background: var(--gray-50);
  border-color: var(--gray-200);
}

.col-more-expanded:hover {
  background: var(--gray-100);
  color: var(--gray-600);
  border-color: var(--gray-300);
}

/* === 空状态 === */
.col-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-md);
  color: var(--gray-300);
  flex: 1;
}

.compact-mode .col-empty {
  padding: var(--spacing-sm);
}

.col-empty-icon {
  font-size: 18px;
  margin-bottom: 2px;
}

.compact-mode .col-empty-icon {
  font-size: 16px;
}

.col-empty-text {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
}

/* === 加载 === */
.col-loading {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}

.skeleton-line {
  height: 8px;
  background: var(--gray-100);
  border-radius: 4px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* === 拖拽样式 === */
:deep(.sortable-ghost) {
  opacity: 0.35;
  background: var(--primary-bg) !important;
  border: 2px dashed var(--primary) !important;
  border-radius: var(--radius-sm);
}

:deep(.sortable-drag) {
  opacity: 0.95;
  transform: rotate(2deg) scale(1.03);
  box-shadow: var(--shadow-lg) !important;
  z-index: 9999;
}

:deep(.is-dragging) {
  cursor: grabbing !important;
}

/* === 结束区域 === */
.kanban-column.end-zone {
  opacity: 0.85;
  border: 2px dashed var(--gray-300);
  background: var(--gray-25);
}

.kanban-column.end-zone .col-title {
  color: var(--gray-500);
}
</style>
