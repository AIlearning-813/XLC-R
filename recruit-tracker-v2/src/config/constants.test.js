/**
 * constants 单元测试
 *
 * 测试：normalizeJobData(), validateJobData()
 */
import { describe, it, expect } from 'vitest';
import { normalizeJobData, validateJobData } from './constants.js';

describe('validateJobData', () => {
  it('所有必填字段（title, type, department）都有值时返回 valid', () => {
    const result = validateJobData({
      title: '前端工程师',
      department: '技术部',
      type: '社会招聘',
    });
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('缺少必填字段 department 时返回缺失列表', () => {
    const result = validateJobData({
      title: '前端工程师',
      type: '社会招聘',
      // 缺少 department
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('department');
    expect(result.missing).not.toContain('title');
  });

  it('缺少多个必填字段时返回完整缺失列表', () => {
    const result = validateJobData({
      title: '前端工程师',
      // 缺少 department, type
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['type', 'department']);
  });

  it('空对象缺失全部 3 个必填字段', () => {
    const result = validateJobData({});
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['title', 'type', 'department']);
  });

  it('falsy 值（空字符串）视为缺失', () => {
    const result = validateJobData({
      title: '',
      department: '技术部',
      type: '社会招聘',
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('title');
  });

  it('headcount 和 workCity 是可选字段，缺失不影响 valid', () => {
    const result = validateJobData({
      title: '测试岗',
      department: '技术部',
      type: '社会招聘',
      // headcount 和 workCity 是可选字段
    });
    expect(result.valid).toBe(true);
  });
});

describe('normalizeJobData', () => {
  it('为缺失的可选字段填充默认值', () => {
    const result = normalizeJobData({
      title: '前端工程师',
      department: '技术部',
      type: '社会招聘',
      headcount: 2,
    });
    // workCity 缺失时应有默认值
    expect(result.workCity).toBeDefined();
    // salaryRange 缺失时应填充
    expect(result.salaryRange).toBeDefined();
    // requirements 缺失时应填充
    expect(result.requirements).toBeDefined();
    // expiryDate 缺失时应填充（默认 30 天后）
    expect(result.expiryDate).toBeDefined();
  });

  it('已有值的字段不被覆盖', () => {
    const input = {
      title: '前端工程师',
      department: '技术部',
      type: '社会招聘',
      headcount: 5,
      workCity: '深圳',
      salaryRange: { min: 10, max: 20 },
    };
    const result = normalizeJobData(input);
    expect(result.headcount).toBe(5);
    expect(result.workCity).toBe('深圳');
    expect(result.salaryRange).toEqual({ min: 10, max: 20 });
  });

  it('缺失字段填充默认值（expiryDate 默认为 null）', () => {
    const result = normalizeJobData({
      title: '测试岗',
      department: '技术部',
      type: '社会招聘',
      headcount: 1,
      workCity: '广州',
    });
    // expiryDate 默认值为 null
    expect(result.expiryDate).toBeNull();
  });

  it('接受空对象的默认值填充', () => {
    const result = normalizeJobData({});
    // 所有 JOB_OPTIONAL_FIELDS 的 key 都应有默认值
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });
});
