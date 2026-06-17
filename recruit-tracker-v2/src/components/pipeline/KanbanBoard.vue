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

const emit = defineEmits(['card-move', 'card-click']);

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

function initSortable() {
  destroySortable();

  if (!boardRef.value) return;

  const columns = boardRef.value.querySelectorAll('.col-body');
  columns.forEach((colEl) => {
    const instance = Sortable.create(colEl, {
      group: 'pipeline',
      animation: 200,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      delay: 100, // 防止误触
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      onEnd: (evt) => {
        // 提取 application ID 和新旧阶段
        const itemEl = evt.item;
        const appId = itemEl?.dataset?.id;
        const fromStage = evt.from?.dataset?.stage;
        const toStage = evt.to?.dataset?.stage;

        if (!appId || !fromStage || !toStage) return;
        if (fromStage === toStage) return;

        // 如果用户拖到列容器但不是卡片列表（空列拖放），SortableJS 已经处理了 DOM
        // 我们触发事件让 PipelinePage 处理确认和数据库更新
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

// 当 applications 变化时重新初始化（因为列内卡片数量变化）
watch(() => props.applications, () => {
  nextTick(() => {
    initSortable();
  });
}, { deep: true });

watch(() => props.stages, () => {
  nextTick(() => {
    initSortable();
  });
});

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

// ===== 计算看板横向滚动 =====
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
      />

      <!-- 空状态 -->
      <div v-if="!loading && applications.length === 0" class="board-empty">
        <div class="board-empty-icon">📋</div>
        <p class="board-empty-text">
          该岗位暂无候选人
        </p>
        <p class="board-empty-hint">
          候选人将通过邮箱自动归集或手动录入进入看板
        </p>
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
  /* 横向滚动条美化 */
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
</style>
