<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人列表表格（含行内操作菜单+右键菜单） */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { FUNNEL_STAGES } from '../../config/constants';

const props = defineProps({
  candidates: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedIds: { type: Set, default: () => new Set() },
  activeTab: { type: String, default: 'active' },
});

const emit = defineEmits(['row-click', 'toggle-select', 'select-all', 'action']);

const stageLabelMap = computed(() => {
  const map = {};
  for (const s of FUNNEL_STAGES) {
    map[s.key] = s.label;
  }
  return map;
});

const allSelected = computed(() => {
  if (props.candidates.length === 0) return false;
  return props.candidates.every((c) => props.selectedIds.has(c._id));
});

// ===== 行内下拉菜单状态 =====
const openMenuId = ref(null);
const openSubmenuId = ref(null); // 阶段推进子菜单

function toggleMenu(rowId, event) {
  event.stopPropagation();
  openMenuId.value = openMenuId.value === rowId ? null : rowId;
  openSubmenuId.value = null;
}

function toggleSubmenu(rowId, event) {
  event.stopPropagation();
  openSubmenuId.value = openSubmenuId.value === rowId ? null : rowId;
}

function closeMenus() {
  openMenuId.value = null;
  openSubmenuId.value = null;
}

function handleAction(action, row, event) {
  event.stopPropagation();
  closeMenus();
  emit('action', { action, row });
}

// ===== 右键菜单状态 =====
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  row: null,
});

function showContextMenu(event, row) {
  event.preventDefault();
  event.stopPropagation();
  // 确保菜单不超出视口
  const x = Math.min(event.clientX, window.innerWidth - 200);
  const y = Math.min(event.clientY, window.innerHeight - 300);
  contextMenu.value = { visible: true, x, y, row };
  closeMenus();
}

function hideContextMenu() {
  contextMenu.value = { visible: false, x: 0, y: 0, row: null };
}

function handleContextAction(action) {
  if (contextMenu.value.row) {
    emit('action', { action, row: contextMenu.value.row });
  }
  hideContextMenu();
}

// 全局点击关闭菜单
function onGlobalClick() {
  closeMenus();
  hideContextMenu();
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick);
});

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick);
});

// ===== 工具函数 =====
function getStageLabel(stage) {
  return stageLabelMap.value[stage] || stage || '未知';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function sourceLabel(source) {
  const map = { email: '邮箱', manual: '手动', import: '导入' };
  return map[source] || source || '';
}

function onToggleAll() {
  emit('select-all', !allSelected.value);
}

// 判断当前阶段在漏斗中的位置，阶段推进只显示后续阶段
const stageOrderMap = computed(() => {
  const map = {};
  FUNNEL_STAGES.forEach((s, i) => { map[s.key] = i; });
  return map;
});

function getAvailableStages(row) {
  const currentOrder = stageOrderMap.value[row.stage] ?? -1;
  return FUNNEL_STAGES.filter((s) => {
    const order = stageOrderMap.value[s.key] ?? -1;
    return order > currentOrder;
  });
}
</script>

<template>
  <div class="candidate-table-wrap">
    <table class="candidate-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              :checked="allSelected"
              @change="onToggleAll"
            />
          </th>
          <th class="col-name">姓名</th>
          <th class="col-position">岗位</th>
          <th class="col-stage">当前阶段</th>
          <th class="col-source">来源</th>
          <th class="col-recorder">录入人</th>
          <th class="col-date">更新时间</th>
          <th class="col-actions">操作</th>
        </tr>
      </thead>

      <tbody>
        <!-- 加载中 -->
        <tr v-if="loading">
          <td colspan="8" class="table-empty">
            <span class="spinner"></span>
          </td>
        </tr>

        <!-- 无数据 -->
        <tr v-else-if="candidates.length === 0">
          <td colspan="8" class="table-empty">
            <div class="empty-inline">
              <span class="empty-inline-icon">👤</span>
              <span>暂无候选人</span>
            </div>
          </td>
        </tr>

        <!-- 行 -->
        <tr
          v-for="row in candidates"
          :key="row._id"
          class="candidate-row"
          :class="{ selected: selectedIds.has(row._id) }"
          @click="emit('row-click', row)"
          @contextmenu="showContextMenu($event, row)"
        >
          <td class="col-check" @click.stop>
            <input
              type="checkbox"
              :checked="selectedIds.has(row._id)"
              @change="emit('toggle-select', row._id)"
            />
          </td>
          <td class="col-name">
            <div class="name-cell">
              <span class="name-text">{{ row.name || '未命名' }}</span>
              <span class="name-phone" v-if="row.phone">{{ row.phone }}</span>
            </div>
          </td>
          <td class="col-position">
            <span class="pos-text">{{ row.jobTitle || row.jobName || row.expectedPosition || '—' }}</span>
          </td>
          <td class="col-stage">
            <span
              class="stage-badge"
              :class="'stage-' + (row.stage || 'resume')"
            >{{ getStageLabel(row.stage) }}</span>
          </td>
          <td class="col-source">
            <span class="source-text">{{ sourceLabel(row.source) }}</span>
          </td>
          <td class="col-recorder">
            <span class="recorder-text">{{ row.ownerId || row.createdBy || '—' }}</span>
          </td>
          <td class="col-date">
            <span class="date-text">{{ formatDate(row.updatedAt || row.createdAt) }}</span>
          </td>
          <td class="col-actions" @click.stop>
            <div class="action-menu-wrap">
              <button
                class="action-trigger"
                :class="{ active: openMenuId === row._id }"
                @click="toggleMenu(row._id, $event)"
                title="更多操作"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2"/>
                  <circle cx="12" cy="12" r="2"/>
                  <circle cx="12" cy="19" r="2"/>
                </svg>
              </button>

              <!-- 下拉菜单 -->
              <Transition name="menu-drop">
                <div v-if="openMenuId === row._id" class="action-dropdown">
                  <!-- 编辑 -->
                  <button
                    class="dropdown-item"
                    @click="handleAction('edit', row, $event)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <span>编辑信息</span>
                  </button>

                  <!-- 关联需求 -->
                  <button
                    class="dropdown-item"
                    @click="handleAction('assignDemand', row, $event)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                    <span>关联需求</span>
                  </button>

                  <!-- 阶段推进（子菜单） -->
                  <div class="dropdown-item has-submenu" @click="toggleSubmenu(row._id, $event)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
                    <span>阶段推进 ▸</span>
                  </div>
                  <!-- 子菜单 -->
                  <Transition name="menu-drop">
                    <div v-if="openSubmenuId === row._id" class="submenu">
                      <button
                        v-for="s in getAvailableStages(row)"
                        :key="s.key"
                        class="dropdown-item submenu-item"
                        @click="handleAction('moveStage', { ...row, toStage: s.key }, $event)"
                      >
                        {{ s.label }}
                      </button>
                      <div v-if="getAvailableStages(row).length === 0" class="submenu-empty">
                        已是最后阶段
                      </div>
                    </div>
                  </Transition>

                  <div class="dropdown-divider"></div>

                  <!-- 已结束 Tab：重新激活 -->
                  <template v-if="activeTab === 'ended'">
                    <button
                      class="dropdown-item item-activate"
                      @click="handleAction('reactivate', row, $event)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                      <span>重新激活</span>
                    </button>
                  </template>

                  <!-- 活跃 Tab：淘汰/放弃 -->
                  <template v-else>
                    <button
                      class="dropdown-item item-danger"
                      @click="handleAction('reject', row, $event)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <span>淘汰</span>
                    </button>

                    <button
                      class="dropdown-item item-danger"
                      @click="handleAction('withdraw', row, $event)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      <span>放弃</span>
                    </button>

                    <div class="dropdown-divider"></div>
                    <!-- 删除简历 -->
                    <button
                      class="dropdown-item item-danger"
                      @click="handleAction('deleteResume', row, $event)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      <span>删除简历</span>
                    </button>
                  </template>
                </div>
              </Transition>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 右键菜单（Teleport 到 body 避免裁剪） -->
    <Teleport to="body">
      <Transition name="menu-drop">
        <div
          v-if="contextMenu.visible"
          class="context-menu"
          :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        >
          <button class="dropdown-item" @click="handleContextAction('edit')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>编辑信息</span>
          </button>
          <button class="dropdown-item" @click="handleContextAction('assignDemand')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            <span>关联需求</span>
          </button>
          <div class="dropdown-divider"></div>
          <!-- 已结束：重新激活 -->
          <button v-if="activeTab === 'ended'" class="dropdown-item item-activate" @click="handleContextAction('reactivate')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            <span>重新激活</span>
          </button>
          <!-- 活跃：淘汰/放弃 -->
          <template v-else>
            <button class="dropdown-item item-danger" @click="handleContextAction('reject')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <span>淘汰</span>
            </button>
            <button class="dropdown-item item-danger" @click="handleContextAction('withdraw')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>放弃</span>
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.candidate-table-wrap {
  overflow-x: auto;
}

.candidate-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-base);
}

/* === 表头 === */
thead th {
  padding: 10px 14px;
  text-align: left;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--gray-100);
  white-space: nowrap;
  background: var(--gray-50);
}

.col-check {
  width: 40px;
  text-align: center;
}

.col-name { min-width: 140px; }
.col-position { min-width: 120px; }
.col-stage { min-width: 100px; }
.col-source { min-width: 80px; }
.col-recorder { min-width: 70px; }
.recorder-text { font-size: var(--font-size-sm); color: var(--gray-500); }
.col-date { min-width: 90px; }
.col-actions { width: 60px; text-align: center; }

/* === 行 === */
.candidate-row {
  cursor: pointer;
  transition: background var(--transition);
  border-bottom: 1px solid var(--gray-50);
}

.candidate-row:hover {
  background: var(--primary-bg);
}

.candidate-row.selected {
  background: var(--primary-bg);
}

tbody td {
  padding: 12px 14px;
  vertical-align: middle;
}

/* === 单元格 === */
.name-cell {
  display: flex;
  flex-direction: column;
}

.name-text {
  font-weight: 500;
  color: var(--gray-700);
}

.name-phone {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  margin-top: 1px;
}

.pos-text {
  color: var(--gray-600);
}

.source-text {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.date-text {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

/* === 操作按钮 === */
.action-menu-wrap {
  position: relative;
  display: inline-block;
}

.action-trigger {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--gray-400);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
}

.action-trigger:hover,
.action-trigger.active {
  background: var(--gray-100);
  color: var(--gray-600);
}

/* === 下拉菜单 === */
.action-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 100;
  min-width: 160px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  margin-top: 4px;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--gray-600);
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: all var(--transition);
  font-family: inherit;
}

.dropdown-item:hover {
  background: var(--gray-50);
  color: var(--gray-800);
}

.dropdown-item.item-danger {
  color: var(--danger);
}

.dropdown-item.item-danger:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

.dropdown-item.item-activate {
  color: var(--success);
}

.dropdown-item.item-activate:hover {
  background: var(--success-bg);
  color: var(--success);
}

.has-submenu {
  position: relative;
}

.dropdown-divider {
  height: 1px;
  background: var(--gray-100);
  margin: 4px 0;
}

/* === 子菜单 === */
.submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  margin-left: 4px;
  min-width: 120px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  max-height: 280px;
  overflow-y: auto;
}

.submenu-item {
  padding: 6px 12px;
  font-size: var(--font-size-xs);
}

.submenu-empty {
  padding: 12px;
  text-align: center;
  color: var(--gray-400);
  font-size: var(--font-size-xs);
}

/* === 右键菜单 === */
.context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 160px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 4px;
}

/* === 菜单动画 === */
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

/* === 阶段徽章 === */
.stage-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.stage-resume { background: var(--gray-100); color: var(--gray-500); }
.stage-valid_resume { background: var(--info-bg); color: var(--info); }
.stage-invite { background: var(--warning-bg); color: var(--warning); }
.stage-invite_confirmed { background: var(--accent-bg); color: var(--accent); }
.stage-first_interview { background: var(--primary-bg); color: var(--primary); }
.stage-first_pass { background: var(--success-bg); color: var(--success); }
.stage-second_interview { background: var(--primary-bg); color: var(--primary-light); }
.stage-second_pass { background: var(--success-bg); color: var(--success-light); }
.stage-final_interview { background: var(--primary-bg); color: var(--primary-dark); }
.stage-final_pass { background: var(--success-bg); color: var(--success); }
.stage-offer { background: var(--accent-bg); color: var(--accent-dark); }
.stage-onboard { background: var(--success-bg); color: var(--success); }

/* === 空状态 === */
.table-empty {
  text-align: center;
  padding: var(--spacing-2xl) !important;
}

.empty-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  color: var(--gray-400);
}

.empty-inline-icon {
  font-size: 18px;
}
</style>
