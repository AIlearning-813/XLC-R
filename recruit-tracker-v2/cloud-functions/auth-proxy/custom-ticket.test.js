/**
 * custom-ticket.test.js — 票据签发的回归测试
 *
 * 重点钉住「失败必须降级为 null 而不是抛错」这条契约：
 * 未开启自定义登录时若抛错，会把「功能未启用」变成「全员无法登录」。
 */
import { describe, it, expect } from 'vitest';
import { issueCustomTicket } from './custom-ticket';

describe('issueCustomTicket', () => {
  it('createTicket 返回 { ticket } 时取到票据', async () => {
    const auth = { createTicket: async () => ({ ticket: 'TK-1' }) };
    expect(await issueCustomTicket(auth, '王莉')).toBe('TK-1');
  });

  it('兼容 { data: { ticket } } 形态', async () => {
    const auth = { createTicket: async () => ({ data: { ticket: 'TK-2' } }) };
    expect(await issueCustomTicket(auth, '王莉')).toBe('TK-2');
  });

  it('传入 app 实例时自动取 app.auth()', async () => {
    const app = { auth: () => ({ createTicket: async () => ({ ticket: 'TK-3' }) }) };
    expect(await issueCustomTicket(app, '王莉')).toBe('TK-3');
  });

  it('auth 缺失或没有 createTicket 时返回 null', async () => {
    expect(await issueCustomTicket(null, '王莉')).toBeNull();
    expect(await issueCustomTicket({}, '王莉')).toBeNull();
  });

  it('app.auth() 抛错时返回 null 而不抛出', async () => {
    const app = { auth: () => { throw new Error('SDK 未就绪'); } };
    await expect(issueCustomTicket(app, '王莉')).resolves.toBeNull();
  });

  it('用户名为空时返回 null', async () => {
    const auth = { createTicket: async () => ({ ticket: 'TK' }) };
    expect(await issueCustomTicket(auth, '')).toBeNull();
    expect(await issueCustomTicket(auth, undefined)).toBeNull();
  });

  it('createTicket 抛错时返回 null（未开启自定义登录的真实情形）', async () => {
    const auth = { createTicket: async () => { throw new Error('自定义登录未开启'); } };
    await expect(issueCustomTicket(auth, '王莉')).resolves.toBeNull();
  });

  it('返回结构中没有票据时返回 null', async () => {
    expect(await issueCustomTicket({ createTicket: async () => ({}) }, '王莉')).toBeNull();
    expect(await issueCustomTicket({ createTicket: async () => ({ ticket: '' }) }, '王莉')).toBeNull();
  });
});