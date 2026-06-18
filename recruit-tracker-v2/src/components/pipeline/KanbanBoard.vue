<script setup>
/* 新励成招聘管理系统 V2.0 — 看板容器（SortableJS 跨列拖拽 + 左侧投放区） */

import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Sortable } from 'sortablejs';
import KanbanColumn from './KanbanColumn.vue';

const props = defineProps({
  stages: { type: Array, required: true },
  applications: { type: Array, default: () => [] },
  candidatesMap: { type: Object, default: () => ({}) },
  job: { type: Object, default: null },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['card-move', 'card-click', 'card-quick-move']);

// ===== 按阶段分组 =====
const applicationsByStage = computed(() => {
  const map = {};
  for (const stage of props.stages) {
    map[stage.key] = [];
  }
  for (const app of props.applications) {
    const stage = app.stage || 'resume';
    if (map[stage]) {
      map[stage].push(app);
    }
  }
  return map;
});

// ===== SortableJS =====
const boardRef = ref(null);
const sortables = [];

/** 从元素向上查找 data-stage */
function getStageFromEl(el) {
  const stageEl = el?.closest?.('[data-stage]');
  return stageEl?.dataset?.stage || null;
}

function initSortable() {
  destroySortable();

  if (!boardRef.value) return;

  // ⚠️ 关键：TransitionGroup 不设 tag → 卡片是 .col-body 的直系子元素 → 独立可拖
  // .end-drop-zone 是左侧紧凑投放区（淘汰/放弃）
  const containers = boardRef.value.querySelectorAll('.col-body, .end-drop-zone');
  containers.forEach((container) => {
    const instance = Sortable.create(container, {
      group: 'pipeline',
      animation: 200,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      chosenClass: 'sortable-chosen',
      delay: 100,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,

      // 过滤非卡片元素（空状态、加载骨架等）
      filter: '.col-empty, .col-loading, .skeleton-card',

      // 拖拽时自动滚动看板
      scroll: true,
      scrollSensitivity: 80,
      scrollSpeed: 15,
      bubbleScroll: true,

      onStart: (evt) => {
        evt.item.classList.add('is-dragging');
      },

      onEnd: (evt) => {
        evt.item.classList.remove('is-dragging');

        const appId = evt.item?.dataset?.id;
        const fromStage = getStageFromEl(evt.from);
        const toStage = getStageFromEl(evt.to);

        if (!appId || !fromStage || !toStage) return;
        if (fromStage === toStage) return;

        emit('card-move', {
          applicationId: appId,
          fromStage,
          toStage,
        });
      },
    });
    sortables.push(instance);
  });
}

function destroySortable() {
  for (const s of sortables) {
    s.destroy();
  }
  sortables.length = 0;
}

watch([() => props.applications, () => props.stages], () => {
  nextTick(() => initSortable());
}, { deep: true });

onMounted(() => {
  nextTick(() => initSortable());
});

onUnmounted(() => {
  destroySortable();
});

// ===== 事件 =====
function onCardClick(payload) {
  emit('card-click', payload);
}

function onCardQuickMove(payload) {
  emit('card-quick-move', payload);
}

const stageCount = computed(() => props.stages.length);
</script>

<template>
  <div class="kanban-board" ref="boardRef">
    <div class="kanban-scroll" :style="{ '--col-count': stageCount }">
      <!-- 左侧紧凑投放区：淘汰 / 放弃（始终可见，无需滚动） -->
      <div class="end-zone-drops">
        <div class="end-drop-wrap">
          <div
            class="end-drop-zone"
            data-stage="rejected"
            data-drop-label="淘汰"
          >
            <div class="end-drop-icon">🗑️</div>
            <div class="end-drop-label">淘汰</div>
            <div class="end-drop-hint">拖拽到此</div>
          </div>
        </div>
        <div class="end-drop-wrap">
          <div
            class="end-drop-zone"
            data-stage="withdrawn"
            data-drop-label="放弃"
          >
            <div class="end-drop-icon">🚫</div>
            <div class="end-drop-label">放弃</div>
            <div class="end-drop-hint">拖拽到此</div>
          </div>
        </div>
      </div>

      <!-- 分隔线 -->
      <div class="drop-divider"></div>

      <!-- 漏斗阶段列 -->
      <KanbanColumn
        v-for="stage in stages"
        :key="stage.key"
        :stage="stage"
        :applications="applicationsByStage[stage.key] || []"
        :candidates-map="candidatesMap"
        :job="job"
        :loading="loading"
        @card-click="onCardClick"
        @card-quick-move="onCardQuickMove"
      />

      <!-- 空状态 -->
      <div v-if="!loading && applications.length === 0" class="board-empty">
        <div class="board-empty-icon">📋</div>
        <p class="board-empty-text">该岗位暂无候选人</p>
        <p class="board-empty-hint">候选人将通过邮箱自动归集或手动录入进入看板</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-board {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.kanban-scroll {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 2px var(--spacing-lg);
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--gray-200) transparent;
}

.kanban-scroll::-webkit-scrollbar {
  height: 6px;
}

.kanban-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.kanban-scroll::-webkit-scrollbar-thumb {
  background: var(--gray-200);
  border-radius: 3px;
}

.kanban-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--gray-300);
}

/* === 左侧投放区 === */
.end-zone-drops {
  display: flex;
  gap: var(--spacing-sm);
  flex-shrink: 0;
  align-items: flex-start;
  padding-top: 0;
}

.end-drop-wrap {
  flex-shrink: 0;
}

.end-drop-zone {
  width: 80px;
  min-height: 160px;
  border: 2px dashed var(--gray-300);
  border-radius: var(--radius);
  background: var(--gray-25);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: default;
  transition: all var(--transition);
  user-select: none;
}

.end-drop-zone:hover {
  border-color: var(--danger);
  background: var(--danger-bg);
}

.end-drop-zone[data-stage="rejected"]:hover {
  border-color: #DC4C4C;
  background: #FEF2F2;
}

.end-drop-zone[data-stage="withdrawn"]:hover {
  border-color: #9B8B7C;
  background: #FAFAF8;
}

/* 有卡片拖入时的高亮 */
.end-drop-zone:has(.sortable-ghost),
.end-drop-zone.sortable-highlight {
  border-color: var(--danger) !important;
  background: var(--danger-bg) !important;
  border-style: solid !important;
  transform: scale(1.05);
}

.end-drop-icon {
  font-size: 28px;
  line-height: 1;
}

.end-drop-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--gray-500);
}

.end-drop-hint {
  font-size: 10px;
  color: var(--gray-300);
}

/* 分隔线 */
.drop-divider {
  width: 1px;
  background: var(--gray-200);
  flex-shrink: 0;
  align-self: stretch;
  margin: 0 2px;
}

/* === 空状态 === */
.board-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-3xl);
  min-width: 400px;
}

.board-empty-icon {
  font-size: 48px;
  margin-bottom: var(--spacing-md);
  opacity: 0.5;
}

.board-empty-text {
  font-size: var(--font-size-md);
  font-weight: 500;
  color: var(--gray-400);
  margin: 0 0 var(--spacing-xs);
}

.board-empty-hint {
  font-size: var(--font-size-sm);
  color: var(--gray-300);
  margin: 0;
}

/* === 全局拖拽样式 === */
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

:deep(.sortable-chosen) {
  opacity: 0.5;
}

:deep(.is-dragging) {
  cursor: grabbing !important;
}
</style>
