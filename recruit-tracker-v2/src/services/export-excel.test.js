/**
 * export-excel 单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { exportToExcel, exportCandidates, exportJobs, CANDIDATE_COLUMNS, JOB_COLUMNS } from './export-excel';

// mock XLSX.writeFile
vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

describe('exportToExcel', () => {
  it('空数据返回 false', () => {
    expect(exportToExcel([], { filename: 'test' })).toBe(false);
    expect(exportToExcel(null, { filename: 'test' })).toBe(false);
  });

  it('无列定义时自动推断', () => {
    const data = [{ name: '张三', phone: '13800138000' }];
    const result = exportToExcel(data, { filename: 'test' });
    expect(result).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalled();
  });

  it('使用指定列定义', () => {
    const data = [{ name: '张三', phone: '13800138000', email: 'test@test.com' }];
    const columns = [
      { key: 'name', label: '姓名' },
      { key: 'phone', label: '电话' },
    ];
    const result = exportToExcel(data, { filename: 'test', columns });
    expect(result).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalled();
  });

  it('transform 列正确转换', () => {
    const data = [{ createdAt: '2026-01-15T10:30:00Z' }];
    const columns = [
      { key: 'createdAt', label: '时间', transform: (r) => new Date(r.createdAt).toLocaleString('zh-CN') },
    ];
    const result = exportToExcel(data, { filename: 'test', columns });
    expect(result).toBe(true);
  });
});

describe('exportCandidates', () => {
  it('使用预设列导出候选人', () => {
    const data = [
      { name: '张三', phone: '13800138000', email: 'zhang@test.com', expectedPosition: 'CC', createdAt: '2026-01-15T10:30:00Z' },
    ];
    const result = exportCandidates(data);
    expect(result).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalled();
  });
});

describe('exportJobs', () => {
  it('使用预设列导出岗位', () => {
    const data = [
      { title: 'CC', type: 'CC', department: 'CC部', headcount: 5, salaryRange: { min: 6, max: 15 }, workCity: '广州' },
    ];
    const result = exportJobs(data);
    expect(result).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalled();
  });
});

describe('CANDIDATE_COLUMNS', () => {
  it('所有列有 key 和 label', () => {
    for (const col of CANDIDATE_COLUMNS) {
      expect(col).toHaveProperty('key');
      expect(col).toHaveProperty('label');
    }
  });
});

describe('JOB_COLUMNS', () => {
  it('所有列有 key 和 label', () => {
    for (const col of JOB_COLUMNS) {
      expect(col).toHaveProperty('key');
      expect(col).toHaveProperty('label');
    }
  });
});
