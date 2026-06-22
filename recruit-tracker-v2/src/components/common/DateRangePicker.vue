<script setup>
/* 新励成招聘管理系统 V2.0 — 时间段选择器
 *
 * 预设按钮 + 日历选择器，v-model 输出 { start: Date, end: Date }
 * 使用方式：<DateRangePicker v-model="dateRange" />
 */

import { ref, computed, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Object, default: () => ({ start: new Date(), end: new Date() }) },
});

const emit = defineEmits(['update:modelValue']);

// ===== 辅助函数 =====
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function daysAgo(n) { const d = today(); d.setDate(d.getDate() - n); return d; }
function fmtDate(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : ''; }
function parseDate(s) { if (!s) return null; const d = new Date(s + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; }
function startOfWeek() { const d = today(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); d.setDate(diff); return d; }
function startOfMonth() { const d = today(); d.setDate(1); return d; }

// ===== 预设按钮 =====
const presets = [
  { key: 'week', label: '本周', get: () => ({ start: startOfWeek(), end: today() }) },
  { key: 'month', label: '本月', get: () => ({ start: startOfMonth(), end: today() }) },
  { key: '30d', label: '近30天', get: () => ({ start: daysAgo(29), end: today() }) },
  { key: '90d', label: '近90天', get: () => ({ start: daysAgo(89), end: today() }) },
];

const activePreset = ref('month'); // 默认本月

// ===== 自定义日期 =====
const showCustom = ref(false);
const customStart = ref(fmtDate(today()));
const customEnd = ref(fmtDate(today()));

// ===== 计算当前值 =====
const currentStart = computed(() => fmtDate(props.modelValue?.start));
const currentEnd = computed(() => fmtDate(props.modelValue?.end));

// ===== 选择预设 =====
function selectPreset(key) {
  activePreset.value = key;
  showCustom.value = false;
  const preset = presets.find(p => p.key === key);
  if (preset) {
    emit('update:modelValue', preset.get());
  }
}

// ===== 自定义确认 =====
function applyCustom() {
  const s = parseDate(customStart.value);
  const e = parseDate(customEnd.value);
  if (!s || !e) return;
  if (s > e) { alert('开始日期不能晚于结束日期'); return; }
  activePreset.value = '';
  showCustom.value = false;
  emit('update:modelValue', { start: s, end: e });
}

function toggleCustom() {
  showCustom.value = !showCustom.value;
  if (showCustom.value) {
    customStart.value = currentStart.value;
    customEnd.value = currentEnd.value;
  }
}

// ===== 初始化 =====
watch(() => props.modelValue, (val) => {
  if (!val) return;
  // 检查是否匹配某个预设
  const matched = presets.find(p => {
    const r = p.get();
    return fmtDate(r.start) === fmtDate(val.start) && fmtDate(r.end) === fmtDate(val.end);
  });
  activePreset.value = matched ? matched.key : '';
}, { immediate: true });
</script>

<template>
  <div class="drp">
    <div class="drp-presets">
      <button
        v-for="p in presets" :key="p.key"
        class="drp-btn"
        :class="{ active: activePreset === p.key }"
        @click="selectPreset(p.key)"
      >{{ p.label }}</button>
      <button
        class="drp-btn"
        :class="{ active: showCustom || (!activePreset && !showCustom) }"
        @click="toggleCustom"
      >自定义</button>
    </div>
    <div v-if="showCustom" class="drp-custom">
      <input type="date" v-model="customStart" class="drp-input" />
      <span class="drp-sep">至</span>
      <input type="date" v-model="customEnd" class="drp-input" />
      <button class="drp-apply" @click="applyCustom">确定</button>
      <button class="drp-cancel" @click="showCustom = false">取消</button>
    </div>
  </div>
</template>

<style scoped>
.drp {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
}

.drp-presets {
  display: flex;
  gap: 4px;
}

.drp-btn {
  padding: 5px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  background: #fff;
  font-size: var(--font-size-xs);
  color: var(--gray-600);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  white-space: nowrap;
}

.drp-btn:hover { border-color: var(--primary); color: var(--primary); }
.drp-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }

.drp-custom {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-basis: 100%;
  margin-top: 4px;
}

.drp-input {
  padding: 4px 8px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: inherit;
  color: var(--gray-700);
  outline: none;
}
.drp-input:focus { border-color: var(--primary); }

.drp-sep {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.drp-apply {
  padding: 4px 12px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  cursor: pointer;
  font-family: inherit;
}

.drp-cancel {
  padding: 4px 8px;
  background: none;
  border: none;
  color: var(--gray-400);
  font-size: var(--font-size-xs);
  cursor: pointer;
  font-family: inherit;
}
</style>
