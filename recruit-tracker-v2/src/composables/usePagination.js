/* 新励成招聘管理系统 V2.0 — 分页 composable
 *
 * 统一的分页逻辑，支持：
 *   - 前端分页（数据已全部加载）
 *   - 后端分页（逐页请求）
 *   - 页码/每页条数/跳页/总数显示
 *
 * 用法：
 *   const pagination = usePagination({ pageSize: 20 });
 *   const pageData = pagination.getPageData(allData);
 *   pagination.goTo(3); // 跳到第 3 页
 */

import { ref, computed, readonly } from 'vue';

/**
 * @param {Object} [options]
 * @param {number} [options.pageSize=20] - 每页条数
 * @param {number[]} [options.pageSizeOptions] - 可选每页条数
 * @param {number} [options.total=0] - 总条数（后端分页模式）
 * @param {boolean} [options.serverSide=false] - 是否为后端分页
 * @returns {{
 *   page: Ref<number>,
 *   pageSize: Ref<number>,
 *   total: Ref<number>,
 *   totalPages: ComputedRef<number>,
 *   hasNext: ComputedRef<boolean>,
 *   hasPrev: ComputedRef<boolean>,
 *   pageRange: ComputedRef<{start: number, end: number}>,
 *   goTo: (n: number) => void,
 *   next: () => void,
 *   prev: () => void,
 *   setPageSize: (n: number) => void,
 *   setTotal: (n: number) => void,
 *   reset: () => void,
 *   getPageData: <T>(data: T[]) => T[],
 *   pageSizeOptions: number[],
 * }}
 */
export function usePagination(options = {}) {
  const {
    pageSize = 20,
    pageSizeOptions = [10, 20, 50, 100],
    total: initialTotal = 0,
    serverSide = false,
  } = options;

  const page = ref(1);
  const pageSizeRef = ref(pageSize);
  const total = ref(initialTotal);

  // 计算总页数
  const totalPages = computed(() => {
    if (total.value === 0) return 1;
    return Math.max(1, Math.ceil(total.value / pageSizeRef.value));
  });

  // 是否有上一页/下一页
  const hasPrev = computed(() => page.value > 1);
  const hasNext = computed(() => page.value < totalPages.value);

  // 当前页的数据范围（1-based）
  const pageRange = computed(() => {
    const start = (page.value - 1) * pageSizeRef.value + 1;
    const end = Math.min(page.value * pageSizeRef.value, total.value || Infinity);
    return { start, end };
  });

  /** 跳转到指定页 */
  function goTo(n) {
    const target = Math.max(1, Math.min(n, totalPages.value));
    if (page.value !== target) {
      page.value = target;
    }
  }

  /** 下一页 */
  function next() {
    if (hasNext.value) page.value++;
  }

  /** 上一页 */
  function prev() {
    if (hasPrev.value) page.value--;
  }

  /** 设置每页条数（同时重置到第 1 页） */
  function setPageSize(n) {
    pageSizeRef.value = n;
    page.value = 1;
  }

  /** 设置总条数 */
  function setTotal(n) {
    total.value = n;
    // 如果当前页超出范围，自动调整
    if (page.value > Math.ceil(n / pageSizeRef.value)) {
      page.value = Math.max(1, Math.ceil(n / pageSizeRef.value));
    }
  }

  /** 重置到第 1 页 */
  function reset() {
    page.value = 1;
  }

  /**
   * 从全量数据中切出当前页的数据（前端分页模式）
   * @template T
   * @param {T[]} data - 全量数据
   * @returns {T[]} 当前页数据
   */
  function getPageData(data) {
    if (!data) return [];
    total.value = data.length;
    const start = (page.value - 1) * pageSizeRef.value;
    return data.slice(start, start + pageSizeRef.value);
  }

  return {
    page: readonly(page),
    pageSize: readonly(pageSizeRef),
    total: readonly(total),
    totalPages,
    hasPrev,
    hasNext,
    pageRange,
    goTo,
    next,
    prev,
    setPageSize,
    setTotal,
    reset,
    getPageData,
    pageSizeOptions,
  };
}
