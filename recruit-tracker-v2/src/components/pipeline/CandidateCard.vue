<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人卡片（看板用，含快速流转按钮） */

import { ref, computed } from 'vue';
import { FUNNEL_STAGES } from '../../config/constants';

const props = defineProps({
  candidate: { type: Object, required: true },
  application: { type: Object, required: true },
  job: { type: Object, default: null },
  compact: { type: Boolean, default: false },
});

const emit = defineEmits(['click', 'quick-move']);

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

// 停留天数
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

// ===== 快速流转下拉菜单 =====
const menuOpen = ref(false);

// 漏斗阶段顺序
const stageOrderMap = computed(() => {
  const map = {};
  FUNNEL_STAGES.forEach((s, i) => { map[s.key] = i; });
  return map;
});

// 当前阶段之后的可用阶段
const availableStages = computed(() => {
  const currentStage = props.application?.stage || 'resume';
  const currentOrder = stageOrderMap.value[currentStage] ?? -1;
  return FUNNEL_STAGES.filter((s) => {
    const order = stageOrderMap.value[s.key] ?? -1;
    return order > currentOrder;
  });
});

function toggleMenu(event) {
  event.stopPropagation();
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function quickMove(toStage, event) {
  event.stopPropagation();
  menuOpen.value = false;
  emit('quick-move', {
    applicationId: props.application._id,
    candidate: props.candidate,
    application: props.application,
    fromStage: props.application?.stage || 'resume',
    toStage,
  });
}

function handleClick() {
  emit('click', { candidate: props.candidate, application: props.application });
}
</script>

<template>
  <!-- 紧凑模式：迷你单行卡片 -->
  <div
    v-if="compact"
    class="candidate-card-compact"
    :data-id="application._id"
    @click="handleClick"
    title="点击查看详情"
  >
    <span class="compact-name">{{ name }}</span>
    <span class="compact-badge badge" :class="sourceBadgeClass">{{ sourceLabel }}</span>
  </div>

  <!-- 完整模式 -->
  <div
    v-else
    class="candidate-card"
    :class="{ stale: isStale }"
    :data-id="application._id"
    @click="handleClick"
    @mouseleave="closeMenu"
  >
    <div class="card-top">
      <span class="card-name">{{ name }}</span>
      <div class="card-top-right">
        <span class="card-source badge" :class="sourceBadgeClass">{{ sourceLabel }}</span>
        <div class="quick-move-wrap" @click.stop>
          <button class="quick-move-btn" :class="{ active: menuOpen }" @click="toggleMenu" title="快速流转">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <Transition name="menu-drop">
            <div v-if="menuOpen" class="quick-move-menu">
              <div class="menu-label">阶段推进</div>
              <button v-for="s in availableStages" :key="s.key" class="menu-item" @click="quickMove(s.key, $event)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
                {{ s.label }}
              </button>
              <div v-if="availableStages.length === 0" class="menu-empty">已是最后阶段</div>
              <div class="menu-divider"></div>
              <button class="menu-item menu-danger" @click="quickMove('rejected', $event)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                淘汰
              </button>
              <button class="menu-item menu-danger" @click="quickMove('withdrawn', $event)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                放弃
              </button>
            </div>
          </Transition>
        </div>
      </div>
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
/* === 紧凑模式迷你卡片 === */
.candidate-card-compact {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: #fff;
  border: 1px solid var(--gray-100);
  border-radius: 4px;
  cursor: pointer;
  transition: all var(--transition);
  user-select: none;
  font-size: 12px;
}

.candidate-card-compact:hover {
  border-color: var(--gray-200);
  background: var(--gray-25);
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}

.compact-name {
  font-weight: 500;
  color: var(--gray-700);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact-badge {
  font-size: 9px;
  padding: 1px 5px;
  flex-shrink: 0;
}

/* === 完整模式 === */
.candidate-card {
  background: #fff;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  cursor: grab;
  transition: all var(--transition);
  user-select: none;
  position: relative;
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
  margin-bottom: 2px;
}

.card-name {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--gray-700);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-top-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.card-source {
  font-size: 10px;
  padding: 1px 6px;
}

/* === 快速流转按钮 === */
.quick-move-wrap {
  position: relative;
}

.quick-move-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gray-300);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
  opacity: 0;
}

.candidate-card:hover .quick-move-btn {
  opacity: 1;
}

.quick-move-btn:hover,
.quick-move-btn.active {
  background: var(--gray-100);
  color: var(--primary);
}

.quick-move-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 100;
  min-width: 130px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  margin-top: 4px;
}

.menu-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--gray-400);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 10px 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gray-600);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: all var(--transition);
  font-family: inherit;
}

.menu-item:hover {
  background: var(--gray-50);
  color: var(--gray-800);
}

.menu-item.menu-danger {
  color: var(--danger);
}

.menu-item.menu-danger:hover {
  background: var(--danger-bg);
}

.menu-empty {
  padding: 8px 10px;
  color: var(--gray-300);
  font-size: 11px;
  text-align: center;
}

.menu-divider {
  height: 1px;
  background: var(--gray-100);
  margin: 2px 0;
}

/* 动画 */
.menu-drop-enter-active {
  transition: all 0.15s ease;
}
.menu-drop-leave-active {
  transition: all 0.1s ease;
}
.menu-drop-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.95);
}
.menu-drop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.95);
}

.card-position {
  font-size: 11px;
  color: var(--gray-400);
  margin-bottom: 6px;
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
  font-size: 10px;
  color: var(--gray-400);
}

.card-stay svg {
  flex-shrink: 0;
}

.card-stay.stay-warn {
  color: var(--warning);
}

.card-phone {
  font-size: 10px;
  color: var(--gray-300);
}
</style>
