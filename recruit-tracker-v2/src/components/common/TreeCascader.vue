<script setup>
/**
 * TreeCascader — 四级部门联动选择器
 *
 * 用于 Job 表单和招聘需求表单中的部门选择。
 * 输出 v-model: { level1, level2, level3, level4, displayName }
 */
import { ref, computed, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  tree: { type: Array, default: () => [] },     // 部门树
  placeholder: { type: String, default: '请选择部门' },
});

const emit = defineEmits(['update:modelValue']);

const selected = ref({
  level1: props.modelValue?.level1 || '',
  level2: props.modelValue?.level2 || '',
  level3: props.modelValue?.level3 || '',
  level4: props.modelValue?.level4 || '',
});

watch(() => props.modelValue, (v) => {
  if (v) selected.value = { level1: v.level1 || '', level2: v.level2 || '', level3: v.level3 || '', level4: v.level4 || '' };
}, { deep: true });

const level2Options = computed(() => {
  const l1 = props.tree.find(n => n.name === selected.value.level1);
  return l1?.children || [];
});
const level3Options = computed(() => {
  const l2 = level2Options.value.find(n => n.name === selected.value.level2);
  return l2?.children || [];
});
const level4Options = computed(() => {
  const l3 = level3Options.value.find(n => n.name === selected.value.level3);
  return l3?.children || [];
});

function emitChange() {
  const parts = [selected.value.level1, selected.value.level2, selected.value.level3, selected.value.level4].filter(Boolean);
  emit('update:modelValue', {
    level1: selected.value.level1 || '',
    level2: selected.value.level2 || '',
    level3: selected.value.level3 || '',
    level4: selected.value.level4 || '',
    displayName: parts.join(' / '),
  });
}

function onLevel1Change() { selected.value.level2 = ''; selected.value.level3 = ''; selected.value.level4 = ''; emitChange(); }
function onLevel2Change() { selected.value.level3 = ''; selected.value.level4 = ''; emitChange(); }
function onLevel3Change() { selected.value.level4 = ''; emitChange(); }
function onLevel4Change() { emitChange(); }

const display = computed(() => props.modelValue?.displayName || props.placeholder);
</script>

<template>
  <div class="cascader">
    <div class="cascader-trigger">{{ display }}</div>
    <div class="cascader-panel">
      <select class="cascader-col" :value="selected.level1" @change="onLevel1Change">
        <option value="">一级部门</option>
        <option v-for="n in tree" :key="n.name" :value="n.name">{{ n.name }}</option>
      </select>
      <select class="cascader-col" v-if="level2Options.length" :value="selected.level2" @change="onLevel2Change">
        <option value="">二级部门</option>
        <option v-for="n in level2Options" :key="n.name" :value="n.name">{{ n.name }}</option>
      </select>
      <select class="cascader-col" v-if="level3Options.length" :value="selected.level3" @change="onLevel3Change">
        <option value="">三级部门</option>
        <option v-for="n in level3Options" :key="n.name" :value="n.name">{{ n.name }}</option>
      </select>
      <select class="cascader-col" v-if="level4Options.length" :value="selected.level4" @change="onLevel4Change">
        <option value="">四级部门</option>
        <option v-for="n in level4Options" :key="n.name" :value="n.name">{{ n.name }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.cascader { display: inline-flex; flex-direction: column; gap: 4px; }
.cascader-trigger {
  padding: 8px 12px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm);
  font-size: var(--font-size-sm); color: var(--gray-600); background: #fff;
  min-width: 200px; cursor: default;
}
.cascader-panel { display: flex; gap: 4px; }
.cascader-col {
  padding: 6px 8px; border: 1px solid var(--gray-100); border-radius: var(--radius-sm);
  font-size: var(--font-size-xs); color: var(--gray-600); background: var(--gray-25);
  min-width: 120px; outline: none; font-family: inherit;
}
.cascader-col:focus { border-color: var(--primary); }
</style>
