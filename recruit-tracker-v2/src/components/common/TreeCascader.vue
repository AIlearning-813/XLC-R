<script setup>
/**
 * TreeCascader — 四级部门渐进式下拉选择器
 *
 * 平铺展示：依次选择一级→二级→三级→四级，
 * 只有选了上一级，下一级下拉框才出现。
 * v-model 输出: { level1, level2, level3, level4, displayName }
 */
import { ref, computed, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  tree: { type: Array, default: () => [] },
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
  if (v) {
    selected.value = {
      level1: v.level1 || '',
      level2: v.level2 || '',
      level3: v.level3 || '',
      level4: v.level4 || '',
    };
  }
}, { deep: true });

// 一级选项
const level1Options = computed(() => props.tree);

// 二级选项：根据一级过滤
const level2Options = computed(() => {
  if (!selected.value.level1) return [];
  const l1 = props.tree.find(n => n.name === selected.value.level1);
  return l1?.children || [];
});

// 三级选项：根据二级过滤
const level3Options = computed(() => {
  if (!selected.value.level2) return [];
  const l2 = level2Options.value.find(n => n.name === selected.value.level2);
  return l2?.children || [];
});

// 四级选项：根据三级过滤
const level4Options = computed(() => {
  if (!selected.value.level3) return [];
  const l3 = level3Options.value.find(n => n.name === selected.value.level3);
  return l3?.children || [];
});

function emitChange() {
  const parts = [
    selected.value.level1,
    selected.value.level2,
    selected.value.level3,
    selected.value.level4,
  ].filter(Boolean);
  emit('update:modelValue', {
    level1: selected.value.level1 || '',
    level2: selected.value.level2 || '',
    level3: selected.value.level3 || '',
    level4: selected.value.level4 || '',
    displayName: parts.join(' / '),
  });
}

function onLevel1Change(e) {
  selected.value.level1 = e.target.value;
  selected.value.level2 = '';
  selected.value.level3 = '';
  selected.value.level4 = '';
  emitChange();
}
function onLevel2Change(e) {
  selected.value.level2 = e.target.value;
  selected.value.level3 = '';
  selected.value.level4 = '';
  emitChange();
}
function onLevel3Change(e) {
  selected.value.level3 = e.target.value;
  selected.value.level4 = '';
  emitChange();
}
function onLevel4Change(e) {
  selected.value.level4 = e.target.value;
  emitChange();
}

const display = computed(() => props.modelValue?.displayName || props.placeholder);

// 是否有下一级可选（且非叶子节点）
const hasL2 = computed(() => level2Options.value.length > 0);
const hasL3 = computed(() => level3Options.value.length > 0);
const hasL4 = computed(() => level4Options.value.length > 0);
</script>

<template>
  <div class="cascader">
    <div class="cascader-display">{{ display }}</div>
    <div class="cascader-row">
      <!-- 一级 -->
      <select
        class="cascader-select"
        :value="selected.level1"
        @change="onLevel1Change"
      >
        <option value="">-- 一级部门 --</option>
        <option v-for="n in level1Options" :key="n.id" :value="n.name">{{ n.name }}</option>
      </select>

      <!-- 二级（一级有值且存在子节点时才显示） -->
      <select
        v-if="selected.level1 && hasL2"
        class="cascader-select"
        :value="selected.level2"
        @change="onLevel2Change"
      >
        <option value="">-- 二级部门 --</option>
        <option v-for="n in level2Options" :key="n.id" :value="n.name">{{ n.name }}</option>
      </select>

      <!-- 三级 -->
      <select
        v-if="selected.level2 && hasL3"
        class="cascader-select"
        :value="selected.level3"
        @change="onLevel3Change"
      >
        <option value="">-- 三级部门 --</option>
        <option v-for="n in level3Options" :key="n.id" :value="n.name">{{ n.name }}</option>
      </select>

      <!-- 四级 -->
      <select
        v-if="selected.level3 && hasL4"
        class="cascader-select"
        :value="selected.level4"
        @change="onLevel4Change"
      >
        <option value="">-- 四级部门（校区） --</option>
        <option v-for="n in level4Options" :key="n.id" :value="n.name">{{ n.name }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.cascader {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cascader-display {
  padding: 8px 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--gray-700);
  background: var(--gray-25);
  min-width: 260px;
}

.cascader-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cascader-select {
  padding: 7px 10px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--gray-700);
  background: #fff;
  outline: none;
  cursor: pointer;
  font-family: inherit;
  min-width: 150px;
  transition: border-color 0.15s;
}

.cascader-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 74, 108, 247), 0.12);
}

.cascader-select option {
  padding: 6px;
}
</style>
