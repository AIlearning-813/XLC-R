/**
 * deduplicator.test.js — 邮件/文件去重模块测试
 */

import { describe, it, expect } from 'vitest';
import {
  computeFileHash,
  computeMD5,
  computeSHA256,
  checkDuplicate,
  isMessageIdDuplicate,
  isFileHashDuplicate,
} from './deduplicator';

describe('deduplicator — 文件哈希', () => {
  describe('computeFileHash (SHA-256)', () => {
    it('返回 64 字符 hex 字符串', () => {
      const buf = Buffer.from('hello world');
      const hash = computeFileHash(buf);
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('相同内容产生相同哈希', () => {
      const h1 = computeFileHash(Buffer.from('test content'));
      const h2 = computeFileHash(Buffer.from('test content'));
      expect(h1).toBe(h2);
    });

    it('不同内容产生不同哈希', () => {
      const h1 = computeFileHash(Buffer.from('content A'));
      const h2 = computeFileHash(Buffer.from('content B'));
      expect(h1).not.toBe(h2);
    });

    it('空 Buffer 仍产生有效哈希', () => {
      const hash = computeFileHash(Buffer.alloc(0));
      expect(hash).toHaveLength(64);
    });

    it('二进制内容正确哈希', () => {
      const buf = Buffer.from([0x00, 0xFF, 0x12, 0xAB]);
      const hash = computeFileHash(buf);
      expect(hash).toHaveLength(64);
    });
  });

  describe('computeMD5（废弃 → SHA-256 别名）', () => {
    it('computeMD5 实际调用 SHA-256', () => {
      const buf = Buffer.from('test');
      const md5 = computeMD5(buf);
      const sha256 = computeSHA256(buf);
      expect(md5).toBe(sha256);
      expect(md5).toHaveLength(64); // SHA-256 = 64 hex
    });
  });
});

describe('deduplicator — 去重检查（Mock DB）', () => {
  function mockDb(overrides = {}) {
    const state = { parseQueueCount: 0, candidateCount: 0, ...overrides };
    return {
      collection: (name) => ({
        where: () => ({
          count: async () => {
            if (name === 'ParseQueue') return { total: state.parseQueueCount };
            if (name === 'Candidate') return { total: state.candidateCount };
            return { total: 0 };
          },
        }),
      }),
      command: { in: (arr) => arr },
    };
  }

  describe('isMessageIdDuplicate', () => {
    it('无 messageId → false', async () => {
      const db = mockDb({ parseQueueCount: 1 });
      expect(await isMessageIdDuplicate(db, '')).toBe(false);
    });

    it('messageId 在 ParseQueue 中 → true', async () => {
      const db = mockDb({ parseQueueCount: 1 });
      expect(await isMessageIdDuplicate(db, '<test@mail.com>')).toBe(true);
    });

    it('messageId 不在 ParseQueue 中 → false', async () => {
      const db = mockDb({ parseQueueCount: 0 });
      expect(await isMessageIdDuplicate(db, '<new@mail.com>')).toBe(false);
    });
  });

  describe('isFileHashDuplicate', () => {
    it('无 fileHash → false', async () => {
      expect(await isFileHashDuplicate(mockDb(), '')).toBe(false);
    });

    it('fileHash 在 Candidate 中 → true', async () => {
      const db = mockDb({ candidateCount: 1 });
      expect(await isFileHashDuplicate(db, 'abc123')).toBe(true);
    });

    it('fileHash 不在 Candidate 中 → false', async () => {
      expect(await isFileHashDuplicate(mockDb(), 'abc123')).toBe(false);
    });
  });

  describe('checkDuplicate — 两层联合去重', () => {
    it('两层都无重复 → isDuplicate=false', async () => {
      const db = mockDb({ parseQueueCount: 0, candidateCount: 0 });
      const r = await checkDuplicate(db, '<msg@test.com>', 'hash123');
      expect(r.isDuplicate).toBe(false);
    });

    it('Message-ID 重复 → 直接返回重复', async () => {
      const db = mockDb({ parseQueueCount: 1, candidateCount: 0 });
      const r = await checkDuplicate(db, '<msg@test.com>', 'hash123');
      expect(r.isDuplicate).toBe(true);
      expect(r.reason).toContain('Message-ID');
    });

    it('文件哈希重复 → 返回重复', async () => {
      const db = mockDb({ parseQueueCount: 0, candidateCount: 1 });
      const r = await checkDuplicate(db, '<msg@test.com>', 'hash123');
      expect(r.isDuplicate).toBe(true);
      expect(r.reason).toContain('SHA-256');
    });

    it('Message-ID 和 fileHash 都为空 → 不重复', async () => {
      const db = mockDb({ parseQueueCount: 1, candidateCount: 1 });
      const r = await checkDuplicate(db, '', '');
      expect(r.isDuplicate).toBe(false);
    });
  });
});
