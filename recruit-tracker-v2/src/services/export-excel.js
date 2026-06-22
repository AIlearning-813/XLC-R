/* 新励成招聘管理系统 V2.0 — Excel 导出服务
 *
 * 基于 SheetJS (xlsx) 实现，支持：
 *   - 候选人列表导出
 *   - 报表数据导出（漏斗数据、趋势数据）
 *   - 岗位需求导出
 *   - 自动列宽、中文表头、多 Sheet 工作簿
 */

import * as XLSX from 'xlsx';

// ===== 工具函数 =====

/**
 * 将数据数组导出为 Excel 文件并触发浏览器下载
 * @param {Object[]} data - 数据数组
 * @param {Object} options
 * @param {string} options.filename - 文件名（不含扩展名）
 * @param {Object[]} [options.columns] - 列定义 [{ key, label, width?, transform? }]
 * @param {string} [options.sheetName='Sheet1'] - 工作表名
 * @param {boolean} [options.autoWidth=true] - 是否自动列宽
 */
export function exportToExcel(data, options = {}) {
  const {
    filename = 'export',
    columns,
    sheetName = 'Sheet1',
    autoWidth = true,
  } = options;

  if (!data || data.length === 0) {
    console.warn('[export-excel] 数据为空，无法导出');
    return false;
  }

  // 确定列定义
  const cols = columns || inferColumns(data);
  if (!cols || cols.length === 0) return false;

  // 构建工作表数据（首行为表头）
  const headerRow = cols.map(c => c.label || c.key);
  const dataRows = data.map(row =>
    cols.map(c => {
      const value = c.transform ? c.transform(row) : row[c.key];
      return value !== undefined && value !== null ? value : '';
    })
  );

  const sheetData = [headerRow, ...dataRows];

  // 创建工作簿和工作表
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // 自动列宽
  if (autoWidth) {
    ws['!cols'] = cols.map((col, i) => {
      if (col.width) return { wch: col.width };
      // 计算该列最大字符数
      const maxLen = Math.max(
        ...sheetData.map(row => {
          const val = String(row[i] || '');
          // 中文字符按 2 个字符宽度计算
          let len = 0;
          for (const ch of val) {
            len += ch.charCodeAt(0) > 127 ? 2.2 : 1.1;
          }
          return len;
        })
      );
      return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
    });
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // 触发下载
  const fullFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, fullFilename);

  return true;
}

/**
 * 导出多 Sheet 工作簿
 * @param {Array<{ data: Object[], sheetName: string, columns?: Object[] }>} sheets
 * @param {string} filename - 文件名
 */
export function exportMultiSheet(sheets, filename) {
  if (!sheets || sheets.length === 0) return false;

  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const cols = sheet.columns || inferColumns(sheet.data);
    const headerRow = cols.map(c => c.label || c.key);
    const dataRows = sheet.data.map(row =>
      cols.map(c => {
        const value = c.transform ? c.transform(row) : row[c.key];
        return value !== undefined && value !== null ? value : '';
      })
    );
    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName);
  }

  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  return true;
}

/**
 * 从数据自动推断列定义
 * @param {Object[]} data
 * @returns {Object[]}
 */
function inferColumns(data) {
  if (!data || data.length === 0) return [];
  const keys = Object.keys(data[0]);
  return keys.map(key => ({
    key,
    label: key,
  }));
}

// ===== 预置列定义 =====

/** 候选人列表列定义 */
export const CANDIDATE_COLUMNS = [
  { key: 'name', label: '姓名', width: 10 },
  { key: 'phone', label: '电话', width: 14 },
  { key: 'email', label: '邮箱', width: 22 },
  { key: 'gender', label: '性别', width: 6 },
  { key: 'age', label: '年龄', width: 6 },
  {
    key: 'expectedPosition', label: '期望岗位', width: 16,
    transform: (r) => r.expectedPosition || r.parsedData?.expected_position || '',
  },
  {
    key: 'education', label: '最高学历', width: 10,
    transform: (r) => {
      const edu = r.parsedData?.education;
      if (Array.isArray(edu) && edu.length > 0) return edu[0].degree || '';
      return r.education || '';
    },
  },
  {
    key: 'school', label: '毕业院校', width: 18,
    transform: (r) => {
      const edu = r.parsedData?.education;
      if (Array.isArray(edu) && edu.length > 0) return edu[0].school || '';
      return '';
    },
  },
  { key: 'city', label: '所在城市', width: 10, transform: (r) => r.city || r.parsedData?.basic_info?.city || '' },
  {
    key: 'workYears', label: '工作年限', width: 8,
    transform: (r) => r.workYears || r.parsedData?.basic_info?.years_of_experience || '',
  },
  {
    key: 'recruitmentSource', label: '来源', width: 10,
    transform: (r) => r.recruitmentSource || '手动录入',
  },
  {
    key: 'createdAt', label: '录入时间', width: 18,
    transform: (r) => formatDate(r.createdAt),
  },
  { key: 'createdBy', label: '录入人', width: 10 },
  { key: 'status', label: '状态', width: 8 },
];

/** 岗位需求列定义 */
export const JOB_COLUMNS = [
  { key: 'title', label: '岗位名称', width: 14 },
  { key: 'type', label: '岗位类型', width: 10 },
  { key: 'department', label: '所属部门', width: 10 },
  { key: 'headcount', label: '招聘人数', width: 8 },
  {
    key: 'salaryMin', label: '薪资下限(K)', width: 10,
    transform: (r) => r.salaryRange?.min || '',
  },
  {
    key: 'salaryMax', label: '薪资上限(K)', width: 10,
    transform: (r) => r.salaryRange?.max || '',
  },
  { key: 'workCity', label: '工作城市', width: 10 },
  { key: 'requirements', label: '岗位要求', width: 30 },
  { key: 'status', label: '状态', width: 8 },
  { key: 'createdAt', label: '创建时间', width: 18, transform: (r) => formatDate(r.createdAt) },
];

/** 漏斗数据列定义 */
export const FUNNEL_COLUMNS = [
  { key: 'stage', label: '阶段名称', width: 12 },
  { key: 'count', label: '当前人数', width: 10 },
  { key: 'entered', label: '本月进入', width: 10 },
  { key: 'passed', label: '本月通过', width: 10 },
  { key: 'conversionRate', label: '转化率', width: 10, transform: (r) => r.conversionRate ? `${r.conversionRate}%` : '—' },
];

/** 趋势/汇总数据列定义 */
export const TREND_COLUMNS = [
  { key: 'period', label: '时间段', width: 14 },
  { key: 'newCandidates', label: '新增候选人', width: 12 },
  { key: 'newApplications', label: '新增申请', width: 12 },
  { key: 'interviews', label: '面试数', width: 10 },
  { key: 'offers', label: 'Offer数', width: 10 },
  { key: 'onboards', label: '入职数', width: 10 },
  { key: 'conversionRate', label: '入职转化率', width: 12, transform: (r) => r.conversionRate ? `${r.conversionRate}%` : '—' },
];

// ===== 便捷导出函数 =====

/**
 * 导出候选人列表
 */
export function exportCandidates(candidates, filename = '候选人列表') {
  return exportToExcel(candidates, {
    columns: CANDIDATE_COLUMNS,
    filename,
    sheetName: '候选人',
  });
}

/**
 * 导出岗位需求列表
 */
export function exportJobs(jobs, filename = '岗位需求') {
  return exportToExcel(jobs, {
    columns: JOB_COLUMNS,
    filename,
    sheetName: '岗位需求',
  });
}

/**
 * 导出漏斗数据
 */
export function exportFunnel(stages, filename = '漏斗数据') {
  return exportToExcel(stages, {
    columns: FUNNEL_COLUMNS,
    filename,
    sheetName: '漏斗数据',
  });
}

/**
 * 导出趋势数据
 */
export function exportTrends(trends, filename = '趋势数据') {
  return exportToExcel(trends, {
    columns: TREND_COLUMNS,
    filename,
    sheetName: '趋势数据',
  });
}

// ===== 内部工具 =====

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
