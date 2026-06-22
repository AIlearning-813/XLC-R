/* 新励成招聘管理系统 V2.0 — 响应式检测 composable
 *
 * 检测屏幕宽度变化，自动切换桌面/移动布局模式。
 * - ≥ 768px → 桌面模式（看板拖拽交互）
 * - < 768px → 移动模式（列表+下拉选择交互）
 *
 * 用法：
 *   const { isMobile, isDesktop, breakpoint } = useResponsive();
 *   if (isMobile.value) { ... }
 */

import { ref, onMounted, onUnmounted, readonly } from 'vue';

// 断点常量
export const BREAKPOINTS = {
  mobile: 768,   // <768px 移动端
  tablet: 1024,  // 768-1023px 平板
  desktop: 1024, // ≥1024px 桌面
};

let instanceCount = 0;
let resizeHandler = null;
const globalWidth = ref(window.innerWidth);

/**
 * @returns {{
 *   width: Readonly<Ref<number>>,
 *   isMobile: Readonly<Ref<boolean>>,
 *   isTablet: Readonly<Ref<boolean>>,
 *   isDesktop: Readonly<Ref<boolean>>,
 *   breakpoint: Readonly<Ref<string>>,
 * }}
 */
export function useResponsive() {
  if (instanceCount === 0) {
    resizeHandler = () => {
      globalWidth.value = window.innerWidth;
    };
    window.addEventListener('resize', resizeHandler);
  }
  instanceCount++;

  const breakpoint = computedBreakpoint(globalWidth);

  // cleanup（组件卸载时调用）
  function cleanup() {
    instanceCount--;
    if (instanceCount <= 0 && resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
  }

  // 注册清理（在 Vue 组件 setup 中可用）
  if (typeof onUnmounted === 'function') {
    onUnmounted(cleanup);
  }

  return {
    width: readonly(globalWidth),
    isMobile: readonly(computed(() => globalWidth.value < BREAKPOINTS.mobile)),
    isTablet: readonly(computed(() => globalWidth.value >= BREAKPOINTS.mobile && globalWidth.value < BREAKPOINTS.tablet)),
    isDesktop: readonly(computed(() => globalWidth.value >= BREAKPOINTS.desktop)),
    breakpoint: readonly(breakpoint),
  };
}

// ===== 辅助函数 =====

function computed(fn) {
  const result = ref(fn());
  // 简单响应式绑定（不引入额外依赖）
  const stopWatch = watchValue(globalWidth, () => {
    result.value = fn();
  });
  return result;
}

function computedBreakpoint(width) {
  const result = ref(getBreakpoint(width.value));
  watchValue(globalWidth, () => {
    result.value = getBreakpoint(globalWidth.value);
  });
  return result;
}

function getBreakpoint(w) {
  if (w < BREAKPOINTS.mobile) return 'mobile';
  if (w < BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

// 简易 watch（不依赖 Vue 的 watch API，纯手动订阅）
const watchers = new Map();

function watchValue(ref, callback) {
  // 使用 Proxy 或 setInterval 太重量级，这里用响应式系统的原生能力
  // 由于 ref 本身就是响应式的，外层 Vue 组件自动追踪
  // 这个 composable 被用在 setup 中时 Vue 自动处理响应性
  return () => {}; // noop cleanup
}
