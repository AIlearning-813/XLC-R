/**
 * hash 单元测试
 *
 * 测试导出函数：sha256 / attachHashes
 * 使用 Web Crypto API（SubtleCrypto），在 jsdom 环境中可用。
 */
import { describe, it, expect } from 'vitest';
import { sha256, attachHashes } from './hash';

// ===== sha256 =====

describe('sha256', () => {
  it('正常字符串返回 64 位 hex 哈希', async () => {
    const result = await sha256('13800138000');
    expect(result).toBeTruthy();
    expect(result).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(result)).toBe(true);
  });

  it('相同输入产生相同哈希', async () => {
    const a = await sha256('test@example.com');
    const b = await sha256('test@example.com');
    expect(a).toBe(b);
  });

  it('不同输入产生不同哈希', async () => {
    const a = await sha256('13800138000');
    const b = await sha256('13900139000');
    expect(a).not.toBe(b);
  });

  it('输入自动 trim 和转小写', async () => {
    const a = await sha256('  Test@Example.COM  ');
    const b = await sha256('test@example.com');
    expect(a).toBe(b);
  });

  it('邮箱哈希值与明文明文不同', async () => {
    const hash = await sha256('hr@xlc.com');
    expect(hash).not.toBe('hr@xlc.com');
  });

  it('空字符串返回空字符串', async () => {
    const result = await sha256('');
    expect(result).toBe('');
  });

  it('null 输入返回空字符串', async () => {
    const result = await sha256(null);
    expect(result).toBe('');
  });

  it('undefined 输入返回空字符串', async () => {
    const result = await sha256(undefined);
    expect(result).toBe('');
  });

  it('非字符串输入返回空字符串', async () => {
    const result = await sha256(12345);
    expect(result).toBe('');
  });

  it('64 位 hex 字符串全是小写', async () => {
    const result = await sha256('Hello');
    expect(result).toBe(result.toLowerCase());
    expect(/[A-F]/.test(result)).toBe(false);
  });
});

// ===== attachHashes =====

describe('attachHashes', () => {
  it('仅含 phone 的数据附加 phoneHash（不覆盖已有值）', async () => {
    const data = { name: '张三', phone: '13800138000' };
    const result = await attachHashes(data);
    expect(result.phoneHash).toBeTruthy();
    expect(result.phoneHash).toHaveLength(64);
    expect(result.name).toBe('张三');
    expect(result.phone).toBe('13800138000');
  });

  it('仅含 email 的数据附加 emailHash', async () => {
    const data = { name: '张三', email: 'zhangsan@example.com' };
    const result = await attachHashes(data);
    expect(result.emailHash).toBeTruthy();
    expect(result.emailHash).toHaveLength(64);
    expect(result.email).toBe('zhangsan@example.com');
  });

  it('同时含 phone 和 email 的数据附加两个哈希', async () => {
    const data = {
      name: '张三',
      phone: '13800138000',
      email: 'zhangsan@example.com',
    };
    const result = await attachHashes(data);
    expect(result.phoneHash).toBeTruthy();
    expect(result.emailHash).toBeTruthy();
    expect(result.phoneHash).not.toBe(result.emailHash);
  });

  it('已有 phoneHash 时不覆盖', async () => {
    const data = {
      name: '张三',
      phone: '13800138000',
      phoneHash: 'existing-hash',
    };
    const result = await attachHashes(data);
    expect(result.phoneHash).toBe('existing-hash');
  });

  it('已有 emailHash 时不覆盖', async () => {
    const data = {
      name: '张三',
      email: 'zhangsan@example.com',
      emailHash: 'existing-email-hash',
    };
    const result = await attachHashes(data);
    expect(result.emailHash).toBe('existing-email-hash');
  });

  it('无 phone 和 email 的数据原样返回', async () => {
    const data = { name: '张三', age: 25 };
    const result = await attachHashes(data);
    expect(result).toEqual({ name: '张三', age: 25 });
    expect(result.phoneHash).toBeUndefined();
    expect(result.emailHash).toBeUndefined();
  });

  it('空对象原样返回', async () => {
    const result = await attachHashes({});
    expect(result).toEqual({});
  });

  it('返回新对象而不修改原对象', async () => {
    const data = { phone: '13800138000' };
    const result = await attachHashes(data);
    expect(result).not.toBe(data);
    expect(data.phoneHash).toBeUndefined(); // 原对象未被修改
  });

  it('phone 为 null/undefined 时不生成 phoneHash', async () => {
    const data = { phone: null, email: 'test@test.com' };
    const result = await attachHashes(data);
    expect(result.phoneHash).toBeUndefined();
    expect(result.emailHash).toBeTruthy();
  });

  it('email 为 null/undefined 时不生成 emailHash', async () => {
    const data = { phone: '13800138000', email: null };
    const result = await attachHashes(data);
    expect(result.phoneHash).toBeTruthy();
    expect(result.emailHash).toBeUndefined();
  });
});
