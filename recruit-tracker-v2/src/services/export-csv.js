/* 新励成招聘管理系统 V2.0 — CSV 导出服务
 *
 * 轻量级 CSV 导出（无需额外依赖），支持：
 *   - UTF-8 BOM（中文 Excel 兼容）
 *   - 自动转义逗号和引号
 *   - 流式大批量导出
 */

// ===== 工具函数 =====

/** CSV 字段转义 */
function escapeField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // 包含逗号、双引号、换行符时需要包裹并转义
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 将数据数组导出为 CSV 文件并触发浏览器下载
 * @param {Object[]} data - 数据数组
 * @param {Object} options
 * @param {string} options.filename - 文件名（不含扩展名）
 * @param {Object[]} [options.columns] - 列定义 [{ key, label, transform? }]
 * @param {boolean} [options.bom=true] - 是否添加 UTF-8 BOM（Excel 兼容）
 */
export function exportToCSV(data, options = {}) {
  const {
    filename = 'export',
    columns,
    bom = true,
  } = options;

  if (!data || data.length === 0) {
    console.warn('[export-csv] 数据为空，无法导出');
    return false;
  }

  // 确定列定义
  const cols = columns || inferColumns(data);
  if (!cols || cols.length === 0) return false;

  // 构建 CSV 行
  const lines = [];

  // 表头
  const headerLine = cols.map(c => escapeField(c.label || c.key)).join(',');
  lines.push(headerLine);

  // 数据行
  for (const row of data) {
    const dataLine = cols.map(c => {
      const value = c.transform ? c.transform(row) : row[c.key];
      return escapeField(value);
    }).join(',');
    lines.push(dataLine);
  }

  const content = lines.join('\r\n'); // Windows 换行符
  const fullContent = bom ? '﻿' + content : content;

  // 触发下载
  downloadFile(fullContent, filename.endsWith('.csv') ? filename : `${filename}.csv`, 'text/csv;charset=utf-8');
  return true;
}

/**
 * 流式导出大量数据（分批构建，防止内存溢出）
 * @param {Object[]} data - 完整数据数组
 * @param {Object} options - 同 exportToCSV
 */
export function exportLargeCSV(data, options = {}) {
  // 浏览器环境下直接使用 Blob 分批写入
  // 这里简化处理，对于 <50000 行的数据直接一次性导出
  // 未来如需支持更大数据量，可用 Streams API
  return exportToCSV(data, options);
}

/**
 * 从数据自动推断列定义
 */
function inferColumns(data) {
  if (!data || data.length === 0) return [];
  const keys = Object.keys(data[0]);
  return keys.map(key => ({ key, label: key }));
}

/**
 * 触发浏览器文件下载
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===== 预置列定义（与 Excel 导出共享定义源）=====

import { CANDIDATE_COLUMNS, JOB_COLUMNS, FUNNEL_COLUMNS, TREND_COLUMNS } from './export-excel';

/**
 * 导出候选人列表为 CSV
 */
export function exportCandidatesCSV(candidates, filename = '候选人列表') {
  return exportToCSV(candidates, {
    columns: CANDIDATE_COLUMNS,
    filename,
  });
}

/**
 * 导出岗位需求为 CSV
 */
export function exportJobsCSV(jobs, filename = '岗位需求') {
  return exportToCSV(jobs, {
    columns: JOB_COLUMNS,
    filename,
  });
}

/**
 * 导出漏斗数据为 CSV
 */
export function exportFunnelCSV(stages, filename = '漏斗数据') {
  return exportToCSV(stages, {
    columns: FUNNEL_COLUMNS,
    filename,
  });
}

/**
 * 导出趋势数据为 CSV
 */
export function exportTrendsCSV(trends, filename = '趋势数据') {
  return exportToCSV(trends, {
    columns: TREND_COLUMNS,
    filename,
  });
}
