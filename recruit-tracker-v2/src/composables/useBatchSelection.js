/* 新励成招聘管理系统 V2.0 — 批量选择状态管理 */

import { ref, computed } from 'vue';

/** 全局批量选择状态（单例） */
const selectedIds = ref(new Set());
const selectionMode = ref(false);

export function useBatchSelection() {
  const count = computed(() => selectedIds.value.size);

  function isSelected(id) {
    return selectedIds.value.has(id);
  }

  function toggle(id) {
    const next = new Set(selectedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds.value = next;
    selectionMode.value = next.size > 0;
  }

  function selectAll(ids) {
    selectedIds.value = new Set(ids);
    selectionMode.value = ids.length > 0;
  }

  function clear() {
    selectedIds.value = new Set();
    selectionMode.value = false;
  }

  function getSelectedList(allItems) {
    const idSet = selectedIds.value;
    return allItems.filter((item) => idSet.has(item._id));
  }

  return {
    selectedIds,
    selectionMode,
    count,
    isSelected,
    toggle,
    selectAll,
    clear,
    getSelectedList,
  };
}
