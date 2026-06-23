/**
 * format-utils.js — 共享格式化工具
 *
 * P1-10 修复：消除代码库中 8 处重复的日期格式化函数。
 * 所有 Vue 组件和 Service 统一从此模块导入，避免 copy-paste 发散。
 */

/**
 * 格式化日期为中文显示字符串（含时分秒）
 * @param {Date|string|number|null|undefined} dateStr - 日期
 * @param {string} [fallback='—'] - 无效日期时的回退值
 * @returns {string}
 */
export function formatDateTime(dateStr, fallback = '—') {
  if (!dateStr) return fallback;
  try {
    const d = typeof dateStr === 'string' || typeof dateStr === 'number' ? new Date(dateStr) : dateStr;
    if (isNaN(d.getTime())) return fallback;
    return d.toLocaleString('zh-CN');
  } catch {
    return typeof dateStr === 'string' ? dateStr : fallback;
  }
}

/**
 * 格式化日期为简短中文显示（不含时间）
 * @param {Date|string|null|undefined} d - 日期
 * @param {string} [fallback='—'] - 无效日期时的回退值
 * @returns {string}
 */
export function formatDateShort(d, fallback = '—') {
  if (!d) return fallback;
  try {
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return fallback;
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return typeof d === 'string' ? d : fallback;
  }
}

/**
 * 格式化为 ISO 日期字符串（YYYY-MM-DD）
 * @param {Date|string|null|undefined} d - 日期
 * @param {string} [fallback=''] - 无效日期时的回退值
 * @returns {string}
 */
export function formatDateISO(d, fallback = '') {
  if (!d) return fallback;
  try {
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return fallback;
    return date.toISOString().slice(0, 10);
  } catch {
    return typeof d === 'string' ? d : fallback;
  }
}

/**
 * 格式化相对时间（如"3分钟前"、"2小时前"）
 * @param {Date|string|number} dateStr - 日期
 * @param {string} [fallback='—'] - 无效日期时的回退值
 * @returns {string}
 */
export function formatRelativeTime(dateStr, fallback = '—') {
  if (!dateStr) return fallback;
  try {
    const d = typeof dateStr === 'string' || typeof dateStr === 'number' ? new Date(dateStr) : dateStr;
    if (isNaN(d.getTime())) return fallback;

    const now = Date.now();
    const diff = now - d.getTime();

    if (diff < 0) return '刚刚';
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
    return d.toLocaleDateString('zh-CN');
  } catch {
    return typeof dateStr === 'string' ? dateStr : fallback;
  }
}

export default { formatDateTime, formatDateShort, formatDateISO, formatRelativeTime };
