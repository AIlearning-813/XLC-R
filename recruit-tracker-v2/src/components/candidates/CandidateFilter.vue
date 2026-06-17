<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人搜索筛选栏 */

import { ref, computed } from 'vue';
import { FUNNEL_STAGES } from '../../config/constants';

const props = defineProps({
  jobs: { type: Array, default: () => [] },
});

const emit = defineEmits(['filter', 'reset']);

// 搜索框
const searchQuery = ref('');

// 筛选条件
const filterStage = ref('');
const filterJob = ref('');
const filterSource = ref('');
const filterDateFrom = ref('');
const filterDateTo = ref('');

const sourceOptions = [
  { value: 'email', label: '邮箱归集' },
  { value: 'manual', label: '手动录入' },
  { value: 'import', label: '历史导入' },
];

const hasFilters = computed(() => {
  return filterStage.value || filterJob.value || filterSource.value
    || filterDateFrom.value || filterDateTo.value;
});

function applyFilters() {
  emit('filter', {
    search: searchQuery.value.trim(),
    stage: filterStage.value,
    jobId: filterJob.value,
    source: filterSource.value,
    dateFrom: filterDateFrom.value,
    dateTo: filterDateTo.value,
  });
}

function resetFilters() {
  searchQuery.value = '';
  filterStage.value = '';
  filterJob.value = '';
  filterSource.value = '';
  filterDateFrom.value = '';
  filterDateTo.value = '';
  emit('reset');
}

// 搜索回车触发
function onSearchEnter() {
  applyFilters();
}
</script>

<template>
  <div class="candidate-filter">
    <!-- 搜索框 -->
    <div class="filter-search">
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索姓名、手机、邮箱..."
        @keyup.enter="onSearchEnter"
        @blur="applyFilters"
      />
    </div>

    <!-- 筛选条件 -->
    <div class="filter-controls">
      <!-- 阶段 -->
      <select v-model="filterStage" class="form-select filter-select" @change="applyFilters">
        <option value="">全部阶段</option>
        <option v-for="s in FUNNEL_STAGES" :key="s.key" :value="s.key">{{ s.label }}</option>
      </select>

      <!-- 岗位 -->
      <select v-model="filterJob" class="form-select filter-select" @change="applyFilters">
        <option value="">全部岗位</option>
        <option v-for="job in jobs" :key="job._id" :value="job._id">
          {{ job.title || job.name }}
        </option>
      </select>

      <!-- 来源 -->
      <select v-model="filterSource" class="form-select filter-select" @change="applyFilters">
        <option value="">全部来源</option>
        <option v-for="s in sourceOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>

      <!-- 日期 -->
      <input
        v-model="filterDateFrom"
        type="date"
        class="form-input filter-date"
        @change="applyFilters"
        placeholder="开始日期"
      />
      <span class="filter-date-sep">至</span>
      <input
        v-model="filterDateTo"
        type="date"
        class="form-input filter-date"
        @change="applyFilters"
        placeholder="结束日期"
      />

      <!-- 重置 -->
      <button
        v-if="hasFilters"
        class="btn btn-sm btn-ghost filter-reset"
        @click="resetFilters"
      >
        清除筛选
      </button>
    </div>
  </div>
</template>

<style scoped>
.candidate-filter {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

/* === 搜索框 === */
.filter-search {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--gray-300);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 10px 14px 10px 38px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--gray-700);
  font-size: var(--font-size-base);
  transition: border-color var(--transition), box-shadow var(--transition);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-bg);
}

.search-input::placeholder {
  color: var(--gray-300);
}

/* === 筛选行 === */
.filter-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.filter-select {
  width: auto;
  min-width: 120px;
}

.filter-date {
  width: 140px;
}

.filter-date-sep {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.filter-reset {
  color: var(--gray-400);
}
</style>
