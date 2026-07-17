<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人卡片（看板用，含快速流转按钮） */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { FUNNEL_STAGES } from '../../config/constants';

const props = defineProps({
  candidate: { type: Object, required: true },
  application: { type: Object, required: true },
  job: { type: Object, default: null },
  compact: { type: Boolean, default: false },
  selectionMode: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
});

const emit = defineEmits(['click', 'quick-move', 'toggle-select']);

const name = computed(() => props.candidate?.name || '未命名');

// 邮箱来源的邮件标题（作为备注显示在名字下方）
const emailSubject = computed(() => {
  const subject = props.candidate?.sourceEmailSubject;
  if (!subject) return '';
  // 截断过长标题，保留前 50 字
  return subject.length > 50 ? subject.slice(0, 50) + '...' : subject;
});

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

// 结束状态信息（淘汰/放弃时显示具体轮次）
const stageLabelMap = computed(() => {
  const map = {};
  for (const s of FUNNEL_STAGES) map[s.key] = s.label;
  return map;
});

const endInfo = computed(() => {
  const app = props.application;
  if (!app || (app.status !== 'rejected' && app.status !== 'withdrawn')) return null;
  const stageLabel = stageLabelMap.value[app.endStage] || app.endStage || '未知阶段';
  const typeLabel = app.status === 'rejected' ? '淘汰' : '放弃';
  return { typeLabel, stageLabel };
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
const menuTrigger = ref(null);

// Teleport 到 body 后的定位样式（避免被看板 overflow:hidden 裁剪）
const menuStyle = computed(() => {
  if (!menuTrigger.value) return {};
  const rect = menuTrigger.value.getBoundingClientRect();
  return {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
    zIndex: 9999,
  };
});

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

// 淘汰阶段选项（细分：简历筛选/初试/复试/终试）
const rejectStageOptions = [
  { key: 'resume', label: '简历筛选淘汰', icon: '📋' },
  { key: 'first_interview', label: '初试淘汰', icon: '🗣️' },
  { key: 'second_interview', label: '复试淘汰', icon: '👥' },
  { key: 'final_interview', label: '终试淘汰', icon: '🏁' },
];

function toggleMenu(event) {
  event.stopPropagation();
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

// 点击菜单外部时关闭（菜单通过 Teleport 挂在 body 下，不能用 mouseleave）
function onDocumentClick(event) {
  if (!menuOpen.value) return;
  // 检查点击是否在触发按钮或菜单内部
  const clickedTrigger = menuTrigger.value && menuTrigger.value.contains(event.target);
  const clickedMenu = event.target.closest('.quick-move-menu');
  if (!clickedTrigger && !clickedMenu) {
    menuOpen.value = false;
  }
}

function onEscape(event) {
  if (event.key === 'Escape' && menuOpen.value) {
    menuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('keydown', onEscape);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick, true);
  document.removeEventListener('keydown', onEscape);
});

function quickMove(toStage, event, extra = {}) {
  event.stopPropagation();
  menuOpen.value = false;
  emit('quick-move', {
    applicationId: props.application._id,
    candidate: props.candidate,
    application: props.application,
    fromStage: props.application?.stage || 'resume',
    toStage,
    ...extra,
  });
}

function handleClick() {
  if (props.selectionMode) {
    emit('toggle-select', props.application._id);
    return;
  }
  emit('click', { candidate: props.candidate, application: props.application });
}

function handleToggleSelect(event) {
  event.stopPropagation();
  emit('toggle-select', props.application._id);
}
</script>

<template>
  <!-- 紧凑模式 -->
  <div
    v-if="compact"
    class="candidate-card-compact"
    :class="{ 'is-ended': endInfo, 'is-selected': selected, 'selection-mode': selectionMode }"
    :data-id="application._id"
    @click="handleClick"
    :title="endInfo ? `${endInfo.typeLabel}于 ${endInfo.stageLabel}` : '点击查看详情'"
  >
    <button
      v-if="selectionMode"
      class="compact-check"
      :class="{ checked: selected }"
      @click="handleToggleSelect"
    >
      <svg v-if="selected" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </button>
    <div class="compact-name-wrap">
      <span class="compact-name">{{ name }}</span>
      <span v-if="emailSubject" class="compact-email-subject" :title="candidate.sourceEmailSubject">{{ emailSubject }}</span>
    </div>
    <span v-if="endInfo" class="compact-end-badge" :class="application.status === 'rejected' ? 'end-reject' : 'end-withdraw'">
      {{ endInfo.typeLabel }}于 {{ endInfo.stageLabel }}
    </span>
    <template v-else>
      <span class="compact-badge badge" :class="sourceBadgeClass">{{ sourceLabel }}</span>
      <span class="compact-recorder" :title="'录入人: ' + (candidate.ownerId || candidate.createdBy || '未知')">
        {{ candidate.ownerId || candidate.createdBy || '—' }}
      </span>
    </template>
  </div>

  <!-- 完整模式 -->
  <div
    v-else
    class="candidate-card"
    :class="{ stale: isStale }"
    :data-id="application._id"
    @click="handleClick"
  >
    <div class="card-top">
      <div class="card-name-wrap">
        <span class="card-name">{{ name }}</span>
        <span v-if="emailSubject" class="card-email-subject" :title="candidate.sourceEmailSubject">{{ emailSubject }}</span>
      </div>
      <div class="card-top-right">
        <span class="card-source badge" :class="sourceBadgeClass">{{ sourceLabel }}</span>
        <div class="quick-move-wrap" @click.stop>
          <button ref="menuTrigger" class="quick-move-btn" :class="{ active: menuOpen }" @click="toggleMenu" title="快速流转" aria-label="快速流转选项" aria-expanded="false">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <Teleport to="body">
            <Transition name="menu-drop">
              <div v-if="menuOpen" class="quick-move-menu" :style="menuStyle">
                <div class="menu-label">阶段推进</div>
                <button v-for="s in availableStages" :key="s.key" class="menu-item" @click="quickMove(s.key, $event)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                  {{ s.label }}
                </button>
                <div v-if="availableStages.length === 0" class="menu-empty">已是最后阶段</div>
                <div class="menu-divider"></div>
                <div class="menu-label">淘汰（选择阶段）</div>
                <button
                  v-for="opt in rejectStageOptions"
                  :key="opt.key"
                  class="menu-item menu-danger"
                  @click="quickMove('rejected', $event, { endStage: opt.key })"
                >
                  <span class="menu-item-icon">{{ opt.icon }}</span>
                  {{ opt.label }}
                </button>
                <button class="menu-item menu-danger" @click="quickMove('withdrawn', $event)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  放弃
                </button>
              </div>
            </Transition>
          </Teleport>
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
      <span class="card-recorder">
        {{ candidate.ownerId || candidate.createdBy || '—' }}
      </span>
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

.compact-name-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.compact-name {
  font-weight: 500;
  color: var(--gray-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact-email-subject {
  font-size: 9px;
  color: var(--gray-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.compact-badge {
  font-size: 9px;
  padding: 1px 5px;
  flex-shrink: 0;
}

.compact-recorder {
  font-size: 9px;
  color: var(--gray-400);
  flex-shrink: 0;
  margin-left: 2px;
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact-end-badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  white-space: nowrap;
}

.compact-end-badge.end-reject {
  background: var(--danger-bg);
  color: var(--danger);
  border: 1px solid #FECACA;
}

.compact-end-badge.end-withdraw {
  background: var(--gray-50);
  color: #9B8B7C;
  border: 1px solid var(--gray-200);
}

.candidate-card-compact.is-ended {
  opacity: 0.75;
  border-left: 2px solid var(--gray-300);
}

.candidate-card-compact.selection-mode {
  padding-left: 4px;
}

.candidate-card-compact.is-selected {
  border-color: var(--primary);
  background: var(--primary-bg);
  box-shadow: 0 0 0 2px var(--primary-bg);
}

.compact-check {
  width: 18px;
  height: 18px;
  border: 2px solid var(--gray-300);
  border-radius: 3px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: all var(--transition);
  color: transparent;
}

.compact-check:hover {
  border-color: var(--primary);
}

.compact-check.checked {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
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

.card-name-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.card-name {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--gray-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-email-subject {
  font-size: 10px;
  color: var(--gray-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
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
.card-recorder {
  font-size: 10px;
  color: var(--gray-400);
  margin-left: auto;
}
</style>
