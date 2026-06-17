<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人列表表格 */

import { computed } from 'vue';
import { FUNNEL_STAGES } from '../../config/constants';

const props = defineProps({
  candidates: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedIds: { type: Set, default: () => new Set() },
});

const emit = defineEmits(['row-click', 'toggle-select', 'select-all']);

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
          <th class="col-date">更新时间</th>
        </tr>
      </thead>

      <tbody>
        <!-- 加载中 -->
        <tr v-if="loading">
          <td colspan="6" class="table-empty">
            <span class="spinner"></span>
          </td>
        </tr>

        <!-- 无数据 -->
        <tr v-else-if="candidates.length === 0">
          <td colspan="6" class="table-empty">
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
          <td class="col-date">
            <span class="date-text">{{ formatDate(row.updatedAt || row.createdAt) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
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
.col-date { min-width: 90px; }

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
