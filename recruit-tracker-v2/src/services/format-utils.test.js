/**
 * format-utils 单元测试
 *
 * 测试全部 4 个导出函数：
 * formatDateTime / formatDateShort / formatDateISO / formatRelativeTime
 */
import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatDateShort,
  formatDateISO,
  formatRelativeTime,
} from './format-utils';

// ===== formatDateTime =====

describe('formatDateTime', () => {
  it('Date 对象返回中文本地化字符串', () => {
    const d = new Date(2024, 0, 15, 14, 30, 0);
    const result = formatDateTime(d);
    expect(result).toContain('2024');
    expect(result).toContain('1');
    expect(result).toContain('15');
    expect(result).toContain('14');
    expect(result).toContain('30');
  });

  it('ISO 字符串正常解析', () => {
    const result = formatDateTime('2024-06-15T10:00:00');
    expect(result).toContain('2024');
    expect(result).toContain('6');
    expect(result).toContain('15');
  });

  it('时间戳（number）正常解析', () => {
    const result = formatDateTime(1700000000000);
    expect(result).toContain('2023');
  });

  it('null 返回默认回退值', () => {
    expect(formatDateTime(null)).toBe('—');
  });

  it('undefined 返回默认回退值', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('空字符串返回默认回退值', () => {
    expect(formatDateTime('')).toBe('—');
  });

  it('无效日期字符串返回回退值', () => {
    expect(formatDateTime('not-a-date')).toBe('—');
  });

  it('无效 Date 对象返回回退值', () => {
    expect(formatDateTime(new Date('invalid'))).toBe('—');
  });

  it('自定义回退值', () => {
    expect(formatDateTime(null, '暂无')).toBe('暂无');
    expect(formatDateTime('', '未知')).toBe('未知');
  });
});

// ===== formatDateShort =====

describe('formatDateShort', () => {
  it('Date 对象返回简短格式', () => {
    const d = new Date(2024, 0, 15, 14, 30, 0);
    const result = formatDateShort(d);
    expect(result).toContain('1');
    expect(result).toContain('15');
    expect(result).toContain('14');
    expect(result).toContain('30');
  });

  it('null 返回回退值', () => {
    expect(formatDateShort(null)).toBe('—');
  });

  it('undefined 返回回退值', () => {
    expect(formatDateShort(undefined)).toBe('—');
  });

  it('无效日期返回回退值', () => {
    expect(formatDateShort(new Date('invalid'))).toBe('—');
  });

  it('自定义回退值', () => {
    expect(formatDateShort(null, 'N/A')).toBe('N/A');
  });
});

// ===== formatDateISO =====

describe('formatDateISO', () => {
  it('Date 对象返回 YYYY-MM-DD 格式', () => {
    // 使用 ISO 字符串避免时区问题
    const d = new Date('2024-01-15');
    const result = formatDateISO(d);
    expect(result).toBe('2024-01-15');
  });

  it('ISO 字符串正常解析', () => {
    const result = formatDateISO('2024-06-15T10:00:00Z');
    expect(result).toBe('2024-06-15');
  });

  it('末尾日期正确处理', () => {
    const d = new Date('2024-12-31');
    const result = formatDateISO(d);
    expect(result).toBe('2024-12-31');
  });

  it('月初日期正确处理', () => {
    const d = new Date('2024-06-01');
    const result = formatDateISO(d);
    expect(result).toBe('2024-06-01');
  });

  it('null 返回空字符串（默认回退值）', () => {
    expect(formatDateISO(null)).toBe('');
  });

  it('undefined 返回空字符串', () => {
    expect(formatDateISO(undefined)).toBe('');
  });

  it('空字符串返回空字符串', () => {
    expect(formatDateISO('')).toBe('');
  });

  it('无效日期返回空字符串', () => {
    expect(formatDateISO('abc')).toBe('');
    expect(formatDateISO(new Date('invalid'))).toBe('');
  });

  it('自定义回退值', () => {
    expect(formatDateISO(null, '未知')).toBe('未知');
  });
});

// ===== formatRelativeTime =====

describe('formatRelativeTime', () => {
  it('刚刚过去的瞬间返回"刚刚"', () => {
    const d = new Date(Date.now() - 30000); // 30 秒前
    const result = formatRelativeTime(d);
    expect(result).toBe('刚刚');
  });

  it('0 毫秒差返回"刚刚"（未来时间也返回"刚刚"）', () => {
    // 未来时间 diff < 0 返回 "刚刚"
    const future = new Date(Date.now() + 10000);
    const result = formatRelativeTime(future);
    expect(result).toBe('刚刚');
  });

  it('精确的 1 分钟前返回"1分钟前"', () => {
    // 需要 > 60000，用 65 秒确保
    const d = new Date(Date.now() - 65000);
    const result = formatRelativeTime(d);
    expect(result).toBe('1分钟前');
  });

  it('5 分钟前返回"5分钟前"', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    const result = formatRelativeTime(d);
    expect(result).toBe('5分钟前');
  });

  it('1 小时前返回"1小时前"', () => {
    const d = new Date(Date.now() - 65 * 60 * 1000);
    const result = formatRelativeTime(d);
    expect(result).toBe('1小时前');
  });

  it('3 小时前返回"3小时前"', () => {
    const d = new Date(Date.now() - 3 * 3600 * 1000);
    const result = formatRelativeTime(d);
    expect(result).toBe('3小时前');
  });

  it('1 天前返回"1天前"', () => {
    const d = new Date(Date.now() - 25 * 3600 * 1000);
    const result = formatRelativeTime(d);
    expect(result).toBe('1天前');
  });

  it('3 天前返回"3天前"', () => {
    const d = new Date(Date.now() - 3 * 86400 * 1000);
    const result = formatRelativeTime(d);
    expect(result).toBe('3天前');
  });

  it('超过 7 天返回本地日期格式', () => {
    const d = new Date(2024, 0, 15);
    const result = formatRelativeTime(d);
    // 超过 7 天，返回完整日期
    expect(result).toContain('2024');
    expect(result.length).toBeGreaterThan(5);
  });

  it('null 返回回退值', () => {
    expect(formatRelativeTime(null)).toBe('—');
  });

  it('undefined 返回回退值', () => {
    expect(formatRelativeTime(undefined)).toBe('—');
  });

  it('空字符串返回回退值', () => {
    expect(formatRelativeTime('')).toBe('—');
  });

  it('无效日期返回回退值', () => {
    expect(formatRelativeTime('not-a-date')).toBe('—');
  });

  it('自定义回退值', () => {
    expect(formatRelativeTime(null, '未知时间')).toBe('未知时间');
  });

  it('时间戳输入正常解析', () => {
    const d = new Date(Date.now() - 2 * 3600 * 1000).getTime();
    const result = formatRelativeTime(d);
    expect(result).toBe('2小时前');
  });
});
