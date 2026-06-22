/**
 * optimistic-lock 单元测试
 *
 * 测试：initialVersion(), VersionConflictError, isVersionConflict(),
 *       conflictMessage(), backoffDelay()
 *
 * 注意：versionedUpdate() 和 versionedBatchUpdate() 依赖 CloudBase SDK，
 * 需要 mock 后才能测试，此处暂测纯函数。
 */
import { describe, it, expect } from 'vitest';
import {
  initialVersion,
  VersionConflictError,
  isVersionConflict,
  conflictMessage,
} from './optimistic-lock.js';

describe('initialVersion', () => {
  it('返回 0', () => {
    expect(initialVersion()).toBe(0);
  });

  it('每次调用返回相同值', () => {
    expect(initialVersion()).toBe(initialVersion());
  });
});

describe('VersionConflictError', () => {
  it('创建包含正确字段的错误实例', () => {
    const err = new VersionConflictError('Job', 'abc123', 3, 5, false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect(err.name).toBe('VersionConflictError');
    expect(err.collection).toBe('Job');
    expect(err.docId).toBe('abc123');
    expect(err.expectedVersion).toBe(3);
    expect(err.actualVersion).toBe(5);
    expect(err.retriesExhausted).toBe(false);
  });

  it('retriesExhausted=true 时消息提示刷新重试', () => {
    const err = new VersionConflictError('Candidate', 'xyz', 1, 2, true);
    expect(err.retriesExhausted).toBe(true);
    expect(err.message).toContain('重试次数已用尽');
  });

  it('retriesExhausted=false 时消息不含重试用尽提示', () => {
    const err = new VersionConflictError('Candidate', 'xyz', 1, 2, false);
    expect(err.message).not.toContain('重试次数已用尽');
  });

  it('消息包含集合名和文档 ID', () => {
    const err = new VersionConflictError('Application', 'doc-001', 0, 1, false);
    expect(err.message).toContain('Application');
    expect(err.message).toContain('doc-001');
  });
});

describe('isVersionConflict', () => {
  it('VersionConflictError 实例返回 true', () => {
    const err = new VersionConflictError('Job', 'id', 1, 2, false);
    expect(isVersionConflict(err)).toBe(true);
  });

  it('普通 Error 返回 false', () => {
    expect(isVersionConflict(new Error('普通错误'))).toBe(false);
  });

  it('null/undefined 返回 false', () => {
    expect(isVersionConflict(null)).toBe(false);
    expect(isVersionConflict(undefined)).toBe(false);
  });

  it('name 属性为 VersionConflictError 的对象返回 true', () => {
    expect(isVersionConflict({ name: 'VersionConflictError' })).toBe(true);
  });
});

describe('conflictMessage', () => {
  it('非版本冲突错误返回 null', () => {
    expect(conflictMessage(new Error('其他错误'))).toBeNull();
    expect(conflictMessage(null)).toBeNull();
  });

  it('retriesExhausted=true 返回带"自动重试失败"提示', () => {
    const err = new VersionConflictError('Job', 'id', 1, 2, true);
    const msg = conflictMessage(err);
    expect(msg).toContain('自动重试失败');
    expect(msg).toContain('刷新页面');
  });

  it('retriesExhausted=false 返回不带"自动重试失败"提示', () => {
    const err = new VersionConflictError('Job', 'id', 1, 2, false);
    const msg = conflictMessage(err);
    expect(msg).toContain('刷新页面');
    expect(msg).not.toContain('自动重试失败');
  });
});
