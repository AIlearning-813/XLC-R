<script setup>
/* 部门入职数据概览 — 可筛选部门 */

import { computed } from 'vue';

const props = defineProps({
  deptData: { type: Object, default: null },
  departments: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const filteredData = computed(() => {
  if (!props.deptData?.data) return [];
  if (!props.modelValue) return props.deptData.data;
  return props.deptData.data.filter(d => d.department === props.modelValue);
});

function onDeptChange(e) {
  emit('update:modelValue', e.target.value);
}
</script>

<template>
  <div class="doo">
    <div class="doo-header">
      <h3 class="card-title">🏢 部门入职数据概览</h3>
      <select class="select-sm" :value="modelValue" @change="onDeptChange">
        <option value="">全部部门</option>
        <option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
      </select>
    </div>
    <div v-if="!filteredData.length" class="text-muted">暂无数据</div>
    <table v-else class="doo-table">
      <thead>
        <tr>
          <th>部门</th>
          <th class="num">岗位数</th>
          <th class="num">本月入职</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredData" :key="row.department">
          <td>{{ row.department }}</td>
          <td class="num">{{ row.jobCount }}</td>
          <td class="num">{{ row.onboardCount }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.doo { margin-bottom: var(--spacing-lg); }
.doo-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--spacing-md); }
.card-title { margin: 0; font-size: var(--font-size-lg); font-weight: 600; color: var(--gray-700); }
.select-sm { padding: 5px 10px; font-size: var(--font-size-xs); border: 1px solid var(--gray-200); border-radius: var(--radius-sm); background: #fff; color: var(--gray-600); font-family: inherit; }
.doo-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.doo-table th { text-align: left; padding: 8px 12px; background: var(--gray-25); color: var(--gray-500); font-weight: 500; font-size: var(--font-size-xs); }
.doo-table td { padding: 8px 12px; color: var(--gray-600); border-top: 1px solid var(--gray-100); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.text-muted { color: var(--gray-400); font-size: var(--font-size-sm); padding: var(--spacing-md); }
</style>
