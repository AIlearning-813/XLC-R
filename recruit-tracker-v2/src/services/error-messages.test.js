/**
 * error-messages 单元测试
 *
 * 测试：toChineseError(), safeErrorMsg()
 */
import { describe, it, expect } from 'vitest';
import { toChineseError, safeErrorMsg } from './error-messages.js';

describe('toChineseError', () => {
  it('权限错误映射为中文', () => {
    expect(toChineseError(new Error('permission denied'))).toBe('权限不足，请联系管理员');
    expect(toChineseError(new Error('unauthorized'))).toBe('权限不足，请联系管理员');
  });

  it('网络超时映射为中文', () => {
    expect(toChineseError(new Error('network timeout'))).toContain('网络连接超时');
    expect(toChineseError(new Error('ETIMEDOUT'))).toContain('网络连接超时');
  });

  it('数据不存在映射为中文', () => {
    expect(toChineseError(new Error('not found'))).toBe('数据不存在，可能已被删除');
    expect(toChineseError(new Error('nonexist'))).toBe('数据不存在，可能已被删除');
  });

  it('频率限制映射为中文', () => {
    expect(toChineseError(new Error('rate limit exceeded'))).toBe('操作过于频繁，请稍后再试');
    expect(toChineseError(new Error('too many requests'))).toBe('操作过于频繁，请稍后再试');
  });

  it('数据格式错误映射为中文', () => {
    expect(toChineseError(new Error('invalid data'))).toBe('数据格式错误，请检查输入');
    expect(toChineseError(new Error('malformed'))).toBe('数据格式错误，请检查输入');
  });

  it('重复数据映射为中文', () => {
    expect(toChineseError(new Error('duplicate entry'))).toBe('数据已存在，请勿重复操作');
    expect(toChineseError(new Error('already exists'))).toBe('数据已存在，请勿重复操作');
  });

  it('写入失败映射为中文', () => {
    expect(toChineseError(new Error('collection.add:fail'))).toBe('数据写入失败，请稍后重试');
    expect(toChineseError(new Error('collection.update:fail'))).toBe('数据更新失败，请刷新后重试');
    expect(toChineseError(new Error('collection.delete:fail'))).toBe('数据删除失败，请稍后重试');
  });

  it('数据库请求失败映射为中文', () => {
    expect(toChineseError(new Error('database request fail'))).toBe('数据库请求失败，请稍后重试');
  });

  it('存储文件不存在映射为中文', () => {
    expect(toChineseError(new Error('storage nonexist'))).toBe('文件不存在，可能已被删除');
  });

  it('身份验证失败映射为中文', () => {
    expect(toChineseError(new Error('auth fail'))).toBe('身份验证失败，请重新登录');
  });

  it('已是中文的消息直接返回', () => {
    expect(toChineseError(new Error('网络连接失败'))).toBe('网络连接失败');
  });

  it('无法匹配的消息返回兜底中文或原文', () => {
    const result = toChineseError(new Error('unknown system error XYZ'));
    // 应包含中文（兜底）
    expect(result).toMatch(/操作失败|unknown/);
  });

  it('处理非 Error 对象', () => {
    expect(toChineseError({ message: 'permission denied' })).toBe('权限不足，请联系管理员');
    expect(toChineseError('not found')).toBe('数据不存在，可能已被删除');
  });
});

describe('safeErrorMsg', () => {
  it('标准 Error 返回中文映射', () => {
    expect(safeErrorMsg(new Error('permission denied'))).toBe('权限不足，请联系管理员');
  });

  it('null/undefined 返回兜底值', () => {
    expect(safeErrorMsg(null)).toBe('操作失败，请稍后重试');
    expect(safeErrorMsg(undefined)).toBe('操作失败，请稍后重试');
  });

  it('自定义兜底值生效', () => {
    expect(safeErrorMsg(null, '自定义错误')).toBe('自定义错误');
  });

  it('字符串直接返回', () => {
    expect(safeErrorMsg('用户名已存在')).toBe('用户名已存在');
  });

  it('空字符串返回兜底', () => {
    expect(safeErrorMsg('')).toBe('操作失败，请稍后重试');
  });
});
