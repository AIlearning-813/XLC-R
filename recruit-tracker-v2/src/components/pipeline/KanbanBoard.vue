<script setup>
/* 新励成招聘管理系统 V2.0 — 看板容器（SortableJS 跨列拖拽） */

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

// ===== SortableJS 实例管理 =====
const boardRef = ref(null);
const sortables = [];

/** 从元素向上查找 data-stage 属性 */
function getStageFromEl(el) {
  const stageEl = el?.closest?.('[data-stage]');
  return stageEl?.dataset?.stage || null;
}

function initSortable() {
  destroySortable();

  if (!boardRef.value) return;

  // ⚠️ 关键修复：SortableJS 必须挂在 .card-list 上，不是 .col-body
  // 因为 TransitionGroup 把所有卡片包在 .card-list 里，.col-body 的直接子元素只有 .card-list 一个
  const cardLists = boardRef.value.querySelectorAll('.card-list');
  cardLists.forEach((listEl) => {
    const instance = Sortable.create(listEl, {
      group: 'pipeline',
      animation: 200,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      chosenClass: 'sortable-chosen',
      delay: 100,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,

      // 拖拽时自动滚动看板（解决页面太长的问题）
      scroll: true,
      scrollSensitivity: 80,
      scrollSpeed: 15,
      bubbleScroll: true,

      // 空列表也能放入
      emptyInsertThreshold: 5,

      onStart: (evt) => {
        // 拖拽开始时给卡片加样式
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

// 当 applications 或 stages 变化时重新初始化
watch([() => props.applications, () => props.stages], () => {
  nextTick(() => {
    initSortable();
  });
}, { deep: true });

onMounted(() => {
  nextTick(() => {
    initSortable();
  });
});

onUnmounted(() => {
  destroySortable();
});

// ===== 事件处理 =====
function onCardClick(payload) {
  emit('card-click', payload);
}

function onCardQuickMove(payload) {
  emit('card-quick-move', payload);
}

// ===== 计算看板列数 =====
const stageCount = computed(() => props.stages.length);
</script>

<template>
  <div class="kanban-board" ref="boardRef">
    <div
      class="kanban-scroll"
      :style="{ '--col-count': stageCount }"
    >
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

/* === 拖拽全身样式（:deep 穿透到子组件） === */
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
