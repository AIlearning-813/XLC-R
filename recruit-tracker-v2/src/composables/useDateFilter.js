/* 新励成招聘管理系统 V2.0 — 日期筛选 composable
 *
 * 统一的日期范围筛选逻辑，支持：
 *   - 预设快捷选项（今日/本周/本月/上月/近3月/自定义）
 *   - 日期范围校验（起止顺序、最大跨度）
 *   - 格式化和本地化
 *   - 与后端 API 的日期参数对接
 *
 * 用法：
 *   const dateFilter = useDateFilter();
 *   dateFilter.setPreset('thisMonth');
 *   // dateFilter.range.value → { start: Date, end: Date }
 *   // dateFilter.rangeLabel.value → '2026年6月'
 */

import { ref, computed, readonly } from 'vue';

// 预设选项
export const DATE_PRESETS = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'last3Months', label: '近3个月' },
  { key: 'last6Months', label: '近6个月' },
  { key: 'thisYear', label: '今年' },
  { key: 'custom', label: '自定义' },
];

/**
 * @param {Object} [options]
 * @param {string} [options.defaultPreset='thisMonth'] - 默认预设
 * @param {number} [options.maxSpanDays=365] - 自定义最大跨度天数
 * @returns {DateFilter}
 */
export function useDateFilter(options = {}) {
  const {
    defaultPreset = 'thisMonth',
    maxSpanDays = 365,
  } = options;

  const preset = ref(defaultPreset);
  const customStart = ref(null);
  const customEnd = ref(null);
  const error = ref('');

  // 计算实际日期范围
  const range = computed(() => {
    if (preset.value === 'custom') {
      return { start: customStart.value, end: customEnd.value };
    }
    return getPresetRange(preset.value);
  });

  // 范围显示文本
  const rangeLabel = computed(() => {
    const presetDef = DATE_PRESETS.find(p => p.key === preset.value);
    if (preset.value !== 'custom') {
      return presetDef?.label || '';
    }
    if (customStart.value && customEnd.value) {
      return `${formatShort(customStart.value)} ~ ${formatShort(customEnd.value)}`;
    }
    return '自定义';
  });

  // ISO 格式（用于 API 调用）
  const isoRange = computed(() => {
    const r = range.value;
    return {
      start: r.start ? toISO(r.start) : null,
      end: r.end ? toISO(r.end, true) : null,
    };
  });

  /** 设置预设 */
  function setPreset(key) {
    preset.value = key;
    error.value = '';
    if (key !== 'custom') {
      customStart.value = null;
      customEnd.value = null;
    }
  }

  /** 设置自定义日期范围 */
  function setCustomRange(start, end) {
    preset.value = 'custom';
    customStart.value = start;
    customEnd.value = end;
    error.value = '';

    // 校验
    if (start && end) {
      if (start > end) {
        error.value = '起始日期不能晚于结束日期';
        return false;
      }
      const spanDays = (end - start) / (1000 * 60 * 60 * 24);
      if (spanDays > maxSpanDays) {
        error.value = `日期跨度不能超过${maxSpanDays}天`;
        return false;
      }
    }
    return true;
  }

  /** 重置为默认 */
  function reset() {
    preset.value = defaultPreset;
    customStart.value = null;
    customEnd.value = null;
    error.value = '';
  }

  return {
    preset: readonly(preset),
    customStart: readonly(customStart),
    customEnd: readonly(customEnd),
    range,
    rangeLabel,
    isoRange,
    error: readonly(error),
    setPreset,
    setCustomRange,
    reset,
    presets: DATE_PRESETS,
  };
}

// ===== 辅助函数 =====

/** 获取预设的日期范围 */
function getPresetRange(key) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;

  switch (key) {
    case 'today':
      start = today;
      end = now;
      break;
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      start = yesterday;
      end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
      break;
    }
    case 'thisWeek': {
      const dayOfWeek = today.getDay();
      start = new Date(today);
      start.setDate(today.getDate() - ((dayOfWeek + 6) % 7)); // 周一
      end = now;
      break;
    }
    case 'lastWeek': {
      const dayOfWeek = today.getDay();
      const lastMonday = new Date(today);
      lastMonday.setDate(today.getDate() - ((dayOfWeek + 6) % 7) - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59);
      start = lastMonday;
      end = lastSunday;
      break;
    }
    case 'thisMonth':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = now;
      break;
    case 'lastMonth': {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
      break;
    }
    case 'last3Months':
      start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
      end = now;
      break;
    case 'last6Months':
      start = new Date(today.getFullYear(), today.getMonth() - 6, 1);
      end = now;
      break;
    case 'thisYear':
      start = new Date(today.getFullYear(), 0, 1);
      end = now;
      break;
    default:
      start = today;
      end = now;
  }

  return { start, end };
}

/** 格式化为中文短日期 */
function formatShort(date) {
  if (!date) return '';
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 转换为 ISO 日期字符串 */
function toISO(date, isEndOfDay = false) {
  if (!date) return null;
  const d = new Date(date);
  if (isEndOfDay) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T23:59:59`;
  }
  return d.toISOString();
}
