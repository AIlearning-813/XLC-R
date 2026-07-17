/**
 * error-handler 单元测试
 *
 * 测试导出函数：handleError / withErrorHandler
 * 验证统一错误处理：日志 + Toast 通知 + 静默模式 + 版本冲突回调
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleError, withErrorHandler } from './error-handler';

// 在每个测试前重置 console.error spy
beforeEach(() => {
  vi.restoreAllMocks();
});

// ===== handleError =====

describe('handleError', () => {
  it('返回错误消息字符串', () => {
    const msg = handleError(new Error('网络错误'));
    expect(msg).toBe('网络错误');
  });

  it('总是输出 console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError(new Error('测试错误'), { context: '保存候选人' });
    expect(spy).toHaveBeenCalled();
    const callArg = spy.mock.calls[0][0];
    expect(callArg).toContain('保存候选人');
    expect(callArg).toContain('失败');
  });

  it('传入 toast 时调用 toast.error', () => {
    const toast = { error: vi.fn() };
    handleError(new Error('操作失败'), { context: '删除候选人', toast });
    expect(toast.error).toHaveBeenCalledWith('删除候选人失败：操作失败');
  });

  it('silent 模式下不调用 toast', () => {
    const toast = { error: vi.fn() };
    handleError(new Error('静默错误'), { context: '自动保存', toast, silent: true });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('silent 模式下仍输出 console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleError(new Error('后台错误'), { silent: true });
    expect(spy).toHaveBeenCalled();
  });

  it('无 toast 时不报错（仅日志）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => handleError(new Error('无 toast'))).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('无 options 时不报错', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = handleError(new Error('默认上下文'));
    expect(msg).toBe('默认上下文');
    expect(spy).toHaveBeenCalled();
  });

  it('context 默认为 "操作"', () => {
    const toast = { error: vi.fn() };
    handleError(new Error('失败'), { toast });
    expect(toast.error).toHaveBeenCalledWith('操作失败：失败');
  });

  it('传入字符串而非 Error 对象', () => {
    const toast = { error: vi.fn() };
    const msg = handleError('纯文本错误', { toast });
    // 字符串无 .message 属性，toChineseError 返回兜底中文文案
    expect(typeof msg).toBe('string');
    expect(toast.error).toHaveBeenCalled();
    const toastCallArg = toast.error.mock.calls[0][0];
    expect(toastCallArg).toContain('操作失败');
  });

  it('传入 Error 对象但 message 为空', () => {
    const toast = { error: vi.fn() };
    const msg = handleError(new Error(''), { toast });
    // safeErrorMsg 会将空消息映射为中文兜底
    expect(typeof msg).toBe('string');
  });

  it('VersionConflictError 触发 onConflict 回调', () => {
    const onConflict = vi.fn();
    const err = new Error('版本冲突');
    err.name = 'VersionConflictError';
    handleError(err, { context: '更新候选人', onConflict });
    expect(onConflict).toHaveBeenCalledWith(err);
  });

  it('非 VersionConflictError 不触发 onConflict', () => {
    const onConflict = vi.fn();
    handleError(new Error('普通错误'), { onConflict });
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('没有 onConflict 时不报错', () => {
    const err = new Error('版本冲突');
    err.name = 'VersionConflictError';
    expect(() => handleError(err)).not.toThrow();
  });

  it('返回值为 toChineseError 映射后的中文消息', () => {
    // toChineseError 会将 permission denied 映射为中文
    const msg = handleError(new Error('permission denied'));
    expect(msg).toContain('权限');
  });
});

// ===== withErrorHandler =====

describe('withErrorHandler', () => {
  it('包装函数正常执行时返回原值', async () => {
    const fn = vi.fn(async (x) => x * 2);
    const wrapped = withErrorHandler(fn);
    const result = await wrapped(21);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledWith(21);
  });

  it('包装函数抛出异常时返回 null', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = async () => { throw new Error('异步失败'); };
    const wrapped = withErrorHandler(fn, { context: '异步操作' });
    const result = await wrapped();
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it('包装函数抛出异常时调用 toast（如果传入）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const toast = { error: vi.fn() };
    const fn = async () => { throw new Error('保存失败'); };
    const wrapped = withErrorHandler(fn, { context: '保存', toast });
    await wrapped();
    expect(toast.error).toHaveBeenCalledWith('保存失败：保存失败');
  });

  it('包装函数 silent 模式不弹 toast', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const toast = { error: vi.fn() };
    const fn = async () => { throw new Error('后台错误'); };
    const wrapped = withErrorHandler(fn, { toast, silent: true });
    await wrapped();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('包装函数传入多个参数', async () => {
    const fn = async (a, b, c) => a + b + c;
    const wrapped = withErrorHandler(fn);
    const result = await wrapped(1, 2, 3);
    expect(result).toBe(6);
  });

  it('包装函数无参数也可正常工作', async () => {
    const fn = async () => 'done';
    const wrapped = withErrorHandler(fn);
    const result = await wrapped();
    expect(result).toBe('done');
  });

  it('包装函数返回 falsy 值（非 null）原样返回', async () => {
    const fn = async () => 0;
    const wrapped = withErrorHandler(fn);
    const result = await wrapped();
    expect(result).toBe(0);
  });

  it('无 options 时也可正常工作', async () => {
    const fn = async () => 'ok';
    const wrapped = withErrorHandler(fn);
    const result = await wrapped();
    expect(result).toBe('ok');
  });
});
