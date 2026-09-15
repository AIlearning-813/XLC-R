/**
 * session-token-holder.test.js — 会话令牌载体的回归测试
 *
 * 这个模块很小，但它是「云函数能不能拿到令牌」的唯一通道：
 * useAuthStore 写入 → cloudbase.callFunction 读取 → 注入到每次调用。
 * 它一旦失效，report-aggregator / get-file-url / email-scanner 会全部返回
 * 「身份校验失败」，线上表现为整个系统打不开数据。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setSessionToken, getSessionToken } from './session-token-holder';

beforeEach(() => {
  setSessionToken('');
});

describe('session-token-holder — 基本存取', () => {
  it('默认是空串（未登录状态）', () => {
    expect(getSessionToken()).toBe('');
  });

  it('写入后可读回', () => {
    setSessionToken('abc.def');
    expect(getSessionToken()).toBe('abc.def');
  });

  it('登出传空串可清除', () => {
    setSessionToken('abc.def');
    setSessionToken('');
    expect(getSessionToken()).toBe('');
  });
});

describe('session-token-holder — 异常输入不得让令牌变成非字符串', () => {
  const badInputs = [
    ['undefined', undefined],
    ['null', null],
    ['数字', 12345],
    ['对象', { token: 'x' }],
    ['数组', ['x']],
    ['布尔', true],
  ];

  for (const [name, input] of badInputs) {
    it(`${name} → 存为空串（下游会拼进请求体，非字符串很危险）`, () => {
      setSessionToken('先放一个有效值');
      setSessionToken(input);
      expect(getSessionToken()).toBe('');
      expect(typeof getSessionToken()).toBe('string');
    });
  }

  it('任何情况下 getSessionToken 都返回字符串', () => {
    for (const bad of [undefined, null, 1, {}, []]) {
      setSessionToken(bad);
      expect(typeof getSessionToken()).toBe('string');
    }
  });
});
