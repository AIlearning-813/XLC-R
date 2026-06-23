/**
 * crypto.test.js — 云函数端密码加解密测试
 *
 * 验证：
 *   - AES-256-GCM 加密 → 解密 完整往返
 *   - 相同明文不同密文（随机盐）
 *   - 空输入拒绝 / 环境变量缺失
 *   - PLAINTEXT: 前缀兼容解密
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// vitest 通过 vite 转换链支持 import CommonJS 模块
import { encrypt, decrypt } from './crypto';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.MASTER_SECRET = 'test-master-secret-for-unit-tests';
  process.env.SALT_PEPPER = 'test-salt-pepper-value';
});

afterEach(() => {
  process.env.MASTER_SECRET = originalEnv.MASTER_SECRET;
  process.env.SALT_PEPPER = originalEnv.SALT_PEPPER;
});

describe('crypto — 加解密往返', () => {
  it('encrypt → decrypt 完整往返', () => {
    const plaintext = 'my_imap_password_123';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('相同明文产生不同密文（随机盐）', () => {
    const plaintext = 'same_password';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    expect(enc1).not.toBe(enc2);
    // 都能解密
    expect(decrypt(enc1)).toBe(plaintext);
    expect(decrypt(enc2)).toBe(plaintext);
  });

  it('中文密码往返', () => {
    const plaintext = '我的密码123!@#';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('长密码往返', () => {
    const plaintext = 'A'.repeat(200);
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('特殊字符密码往返', () => {
    const plaintext = 'p@$$w0rd!\\/"\'`~%^&*()';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });
});

describe('crypto — 输入校验', () => {
  it('空明文 → 抛出错误', () => {
    expect(() => encrypt('')).toThrow('密码不能为空');
  });

  it('空密文 → 抛出错误', () => {
    expect(() => decrypt('')).toThrow('加密数据不能为空');
  });

  it('无效 Base64 → 抛出错误', () => {
    expect(() => decrypt('abc')).toThrow();
  });
});

describe('crypto — PLAINTEXT: 兼容', () => {
  it('PLAINTEXT: 前缀的密码直接返回明文', () => {
    const result = decrypt('PLAINTEXT:my_password');
    expect(result).toBe('my_password');
  });
});

describe('crypto — 环境变量缺失', () => {
  it('缺少 MASTER_SECRET → 加密抛出错误', () => {
    delete process.env.MASTER_SECRET;
    expect(() => encrypt('test')).toThrow('加密密钥未配置');
  });

  it('缺少 SALT_PEPPER → 解密抛出错误', () => {
    delete process.env.SALT_PEPPER;
    expect(() => decrypt('dGVzdA==')).toThrow('加密密钥未配置');
  });
});
