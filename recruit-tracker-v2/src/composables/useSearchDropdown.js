/* 新励成招聘管理系统 V2.0 — 搜索下拉 composable
 *
 * 统一的搜索下拉交互逻辑，支持：
 *   - 关键词搜索 + 下拉展示匹配结果
 *   - 键盘导航（↑↓ Enter Esc）
 *   - 异步数据源（函数/数组/固定列表）
 *   - 防抖输入
 *   - 选中回调 + 清除
 *
 * 用法：
 *   const search = useSearchDropdown({
 *     source: async (q) => [{ id, label }],
 *     onSelect: (item) => { ... },
 *   });
 *   // 模板中绑定 search.query, search.results, search.isOpen 等
 */

import { ref, computed, readonly } from 'vue';

/**
 * @param {Object} options
 * @param {Function|Object[]} options.source - 数据源（数组或 async (query) => results 函数）
 * @param {Function} [options.onSelect] - 选中回调 (item) => void
 * @param {number} [options.debounce=300] - 防抖毫秒数
 * @param {number} [options.minQueryLength=1] - 最小搜索字符数
 * @param {number} [options.maxResults=20] - 最多显示结果数
 * @param {Function} [options.filter] - 本地过滤函数 (item, query) => boolean
 * @returns {SearchDropdown}
 */
export function useSearchDropdown(options = {}) {
  const {
    source = [],
    onSelect,
    debounce = 300,
    minQueryLength = 1,
    maxResults = 20,
    filter,
  } = options;

  const query = ref('');
  const results = ref([]);
  const isOpen = ref(false);
  const isLoading = ref(false);
  const selectedItem = ref(null);
  const highlightedIndex = ref(-1);

  let debounceTimer = null;
  let searchId = 0;

  // 是否有搜索结果
  const hasResults = computed(() => results.value.length > 0);

  // 是否正在搜索
  const isSearching = computed(() => isLoading.value);

  /**
   * 执行搜索
   * @param {string} [q] - 搜索关键词（不传则使用当前 query 值）
   */
  async function search(q) {
    const searchQuery = q ?? query.value;
    query.value = searchQuery;

    // 清除之前的防抖
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // 关闭防抖
    if (debounce > 0) {
      debounceTimer = setTimeout(() => doSearch(searchQuery), debounce);
    } else {
      await doSearch(searchQuery);
    }
  }

  async function doSearch(searchQuery) {
    // 清空
    if (!searchQuery || searchQuery.length < minQueryLength) {
      results.value = [];
      isOpen.value = false;
      return;
    }

    const currentId = ++searchId;
    isLoading.value = true;

    try {
      let data;

      if (typeof source === 'function') {
        // 异步数据源
        data = await source(searchQuery);
      } else {
        // 静态数组
        data = source;
      }

      // 防止过期结果覆盖
      if (currentId !== searchId) return;

      // 应用过滤
      if (filter) {
        data = data.filter(item => filter(item, searchQuery));
      } else if (typeof source !== 'function') {
        // 本地过滤：按 label 字段模糊匹配
        const qLower = searchQuery.toLowerCase();
        data = data.filter(item => {
          const label = item.label || item.title || item.name || '';
          return label.toLowerCase().includes(qLower);
        });
      }

      // 限制数量
      data = data.slice(0, maxResults);

      results.value = data;
      isOpen.value = data.length > 0;
      highlightedIndex.value = data.length > 0 ? 0 : -1;
    } catch (err) {
      console.error('[useSearchDropdown] 搜索失败:', err);
      results.value = [];
      isOpen.value = false;
    } finally {
      if (currentId === searchId) {
        isLoading.value = false;
      }
    }
  }

  /** 选中结果 */
  function select(item) {
    selectedItem.value = item;
    query.value = item.label || item.title || item.name || '';
    results.value = [];
    isOpen.value = false;
    highlightedIndex.value = -1;
    if (onSelect) onSelect(item);
  }

  /** 清除选择 */
  function clear() {
    query.value = '';
    results.value = [];
    isOpen.value = false;
    selectedItem.value = null;
    highlightedIndex.value = -1;
    if (onSelect) onSelect(null);
  }

  /** 键盘导航 */
  function handleKeydown(e) {
    if (!isOpen.value) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        highlightedIndex.value = Math.min(highlightedIndex.value + 1, results.value.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex.value >= 0 && highlightedIndex.value < results.value.length) {
          select(results.value[highlightedIndex.value]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        isOpen.value = false;
        highlightedIndex.value = -1;
        break;
    }
  }

  /** 关闭下拉 */
  function close() {
    isOpen.value = false;
    highlightedIndex.value = -1;
  }

  /** 强制打开下拉（用于获得焦点时展示已有结果） */
  function open() {
    if (results.value.length > 0) {
      isOpen.value = true;
    }
  }

  return {
    // 状态
    query: readonly(query),
    results: readonly(results),
    isOpen: readonly(isOpen),
    isLoading: readonly(isLoading),
    selectedItem: readonly(selectedItem),
    highlightedIndex: readonly(highlightedIndex),
    hasResults,

    // 操作
    search,
    select,
    clear,
    handleKeydown,
    close,
    open,
  };
}
