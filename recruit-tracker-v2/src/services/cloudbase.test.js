/**
 * cloudbase.test.js — 真实 SDK 封装层的回归测试（重点是令牌注入）
 *
 * 为什么要有这个文件：
 *   其余测试通过 `__mocks__/cloudbase.js` 把整个封装层替换掉了，因此
 *   「callFunction 统一注入 sessionToken」这段逻辑在别处**完全没有覆盖**。
 *   而它恰恰是第 3 阶段加固的命脉——一旦注入失效，
 *   report-aggregator / get-file-url / email-scanner 会全部拒绝请求，
 *   线上表现为系统大面积打不开数据。
 *   所以这里刻意 mock 掉底层 SDK、用**真实的** cloudbase.js 来跑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callFunctionSpy } = vi.hoisted(() => ({
  callFunctionSpy: vi.fn(async () => ({ result: { success: true, marker: 'real-sdk' } })),
}));

vi.mock('@cloudbase/js-sdk', () => ({
  default: {
    init: vi.fn(() => ({
      callFunction: callFunctionSpy,
      database: () => ({ collection: () => ({}) }),
      auth: () => ({}),
      storage: {},
    })),
  },
}));

vi.mock('../config/env', () => ({ default: { ENV_ID: 'test-env-id' } }));

import cloudbase from './cloudbase';
import { setSessionToken } from './session-token-holder';

/** 取最近一次 callFunction 实际收到的 data */
function lastData() {
  const calls = callFunctionSpy.mock.calls;
  return calls[calls.length - 1][0].data;
}

beforeEach(() => {
  setSessionToken('');
});

describe('callFunction — 返回值透传', () => {
  it('返回 res.result 而不是整个响应对象', async () => {
    const r = await cloudbase.callFunction('any-fn', { action: 'x' });
    expect(r).toEqual({ success: true, marker: 'real-sdk' });
  });
});

describe('callFunction — sessionToken 统一注入', () => {
  it('未登录（令牌为空）→ 不注入任何字段', async () => {
    await cloudbase.callFunction('report-aggregator', { type: 'overview', params: {} });
    const data = lastData();
    expect(data).toEqual({ type: 'overview', params: {} });
    expect('sessionToken' in data).toBe(false);
  });

  it('已登录 → 自动注入 sessionToken（调用方无需自己带）', async () => {
    setSessionToken('signed.token.value');
    await cloudbase.callFunction('report-aggregator', { type: 'overview', params: {} });
    expect(lastData()).toEqual({
      type: 'overview',
      params: {},
      sessionToken: 'signed.token.value',
    });
  });

  it('注入位置与 params 平级（不会混进业务参数、不会被参数日志打印）', async () => {
    setSessionToken('tok');
    await cloudbase.callFunction('report-aggregator', { type: 'trend', params: { months: 6 } });
    const data = lastData();
    expect(data.params).toEqual({ months: 6 });
    expect(data.params.sessionToken).toBeUndefined();
    expect(data.sessionToken).toBe('tok');
  });

  it('调用方已自带 sessionToken → 不覆盖（保持显式传参优先）', async () => {
    setSessionToken('from-holder');
    await cloudbase.callFunction('auth-proxy', { action: 'listUsers', sessionToken: 'explicit' });
    expect(lastData().sessionToken).toBe('explicit');
  });

  it('原对象不被修改（不产生副作用）', async () => {
    setSessionToken('tok');
    const original = { type: 'overview', params: {} };
    await cloudbase.callFunction('report-aggregator', original);
    expect(original).toEqual({ type: 'overview', params: {} });
    expect('sessionToken' in original).toBe(false);
  });

  const nonObjectData = [
    ['undefined', undefined],
    ['null', null],
    ['字符串', 'raw-string'],
    ['数组', [1, 2, 3]],
    ['数字', 42],
  ];

  for (const [name, data] of nonObjectData) {
    it(`data 为 ${name} → 原样传递，不试图注入也不抛错`, async () => {
      setSessionToken('tok');
      await expect(cloudbase.callFunction('some-fn', data)).resolves.toBeTruthy();
      expect(lastData()).toBe(data);
    });
  }

  it('函数名原样传递（注入不影响路由）', async () => {
    setSessionToken('tok');
    await cloudbase.callFunction('email-scanner', { action: 'scan' });
    const calls = callFunctionSpy.mock.calls;
    expect(calls[calls.length - 1][0].name).toBe('email-scanner');
  });

  it('options 参数仍能透传（如超时设置）', async () => {
    setSessionToken('tok');
    await cloudbase.callFunction('email-scanner', { action: 'scan' }, { timeout: 300000 });
    const calls = callFunctionSpy.mock.calls;
    expect(calls[calls.length - 1][0].timeout).toBe(300000);
  });
});
