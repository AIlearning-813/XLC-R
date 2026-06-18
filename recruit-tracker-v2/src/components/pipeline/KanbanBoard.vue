<script setup>
/* 新励成招聘管理系统 V2.0 — 看板容器（紧凑卡片式 + flex-wrap 换行） */

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

function getStageFromEl(el) {
  const stageEl = el?.closest?.('[data-stage]');
  return stageEl?.dataset?.stage || null;
}

function initSortable() {
  destroySortable();
  if (!boardRef.value) return;

  const containers = boardRef.value.querySelectorAll('.col-body');
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
      filter: '.col-empty, .col-loading, .col-more, .skeleton-line',
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
        emit('card-move', { applicationId: appId, fromStage, toStage });
      },
    });
    sortables.push(instance);
  });
}

function destroySortable() {
  for (const s of sortables) s.destroy();
  sortables.length = 0;
}

watch([() => props.applications, () => props.stages], () => {
  nextTick(() => initSortable());
}, { deep: true });

onMounted(() => nextTick(() => initSortable()));
onUnmounted(() => destroySortable());

function onCardClick(payload) {
  emit('card-click', payload);
}
function onCardQuickMove(payload) {
  emit('card-quick-move', payload);
}
</script>

<template>
  <div class="kanban-board" ref="boardRef">
    <!-- 紧凑卡片网格（flex-wrap 自动换行，无需横向滚动） -->
    <div class="kanban-grid">
      <KanbanColumn
        v-for="stage in stages"
        :key="stage.key"
        :stage="stage"
        :applications="applicationsByStage[stage.key] || []"
        :candidates-map="candidatesMap"
        :job="job"
        :loading="loading"
        :compact="true"
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
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

.kanban-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 2px var(--spacing-lg);
  align-content: flex-start;
}

/* === 空状态 === */
.board-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-3xl);
  min-width: 300px;
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
