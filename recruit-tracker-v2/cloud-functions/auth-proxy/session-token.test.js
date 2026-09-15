/**
 * session-token.test.js — 会话令牌签发/校验/授权判定的回归测试
 *
 * 重点锁死两件事（2026-09-14 第 2 阶段加固）：
 *   1. 伪造与篡改必须被拒（签名、密钥、过期、格式）
 *   2. 授权判定必须基于「令牌」而非请求体里的自称字段——authorizeSelf 那条
 *      直接对应漏洞 B：原 changePassword 无鉴权，攻击者靠它无限次试密码，
 *      绕过了 handleLogin 的「5 次失败锁 15 分钟」。
 */

import { describe, it, expect } from 'vitest';
import { createSessionTokenService, timingSafeStringEqual, SESSION_TTL_MS } from './session-token';

const KEY = 'unit-test-signing-key-0123456789';
const OTHER_KEY = 'another-key-attacker-controlled';
const svc = createSessionTokenService(KEY);

describe('session-token — 签发与校验', () => {
  it('签发后能校验通过，字段完整回传', () => {
    const token = svc.generate('admin', 'admin', '管理员');
    const r = svc.verify(token);
    expect(r.valid).toBe(true);
    expect(r.username).toBe('admin');
    expect(r.role).toBe('admin');
    expect(r.name).toBe('管理员');
    expect(typeof r.expiry).toBe('number');
  });

  it('中文用户名往返不乱码（本系统账号大量是中文名）', () => {
    const token = svc.generate('王莉', 'recruiter', '王莉');
    const r = svc.verify(token);
    expect(r.valid).toBe(true);
    expect(r.username).toBe('王莉');
    expect(r.role).toBe('recruiter');
  });

  it('expiry 落在 TTL 附近', () => {
    const before = Date.now();
    const token = svc.generate('admin', 'admin', '管理员');
    const r = svc.verify(token);
    expect(r.expiry - before).toBeGreaterThan(SESSION_TTL_MS - 5000);
    expect(r.expiry - before).toBeLessThanOrEqual(SESSION_TTL_MS);
  });
});

describe('session-token — 伪造与篡改必须被拒', () => {
  it('篡改载荷（把自己改成 admin）→ 签名不匹配', () => {
    const token = svc.generate('王莉', 'recruiter', '王莉');
    const forged = Buffer.from('王莉|admin|王莉|' + (Date.now() + 86400000)).toString('base64')
      + '.' + token.split('.')[1];
    const r = svc.verify(forged);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('签名不匹配');
  });

  it('篡改签名 → 拒绝', () => {
    const token = svc.generate('admin', 'admin', '管理员');
    const [p] = token.split('.');
    expect(svc.verify(`${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`).valid).toBe(false);
  });

  it('在签名后追加垃圾字符 → 拒绝（严格比对，不做宽松 base64 归一化）', () => {
    const token = svc.generate('admin', 'admin', '管理员');
    expect(svc.verify(token + '!!').valid).toBe(false);
  });

  it('用攻击者自己的密钥签发的令牌 → 本服务拒绝', () => {
    const attackerSvc = createSessionTokenService(OTHER_KEY);
    const forged = attackerSvc.generate('admin', 'admin', '管理员');
    expect(svc.verify(forged).valid).toBe(false);
  });

  it('已过期的令牌 → 拒绝', () => {
    const shortSvc = createSessionTokenService(KEY, { ttlMs: -1000 }); // 签发即过期
    const r = svc.verify(shortSvc.generate('admin', 'admin', '管理员'));
    expect(r.valid).toBe(false);
    expect(r.error).toContain('过期');
  });
});

describe('session-token — 异常输入一律安全拒绝且不抛错', () => {
  const badTokens = [
    ['空字符串', ''],
    ['null', null],
    ['undefined', undefined],
    ['数字', 12345],
    ['没有分隔点', 'abcdef'],
    ['三个点段', 'a.b.c'],
    ['空载荷', '.sig'],
    ['载荷不是合法 base64 内容', '!!!.###'],
    ['签名长度不符', 'YWRtaW58YWRtaW58fDE=.' + 'x'],
  ];

  for (const [name, token] of badTokens) {
    it(`${name} → valid:false 且不抛错`, () => {
      expect(() => svc.verify(token)).not.toThrow();
      expect(svc.verify(token).valid).toBe(false);
    });
  }

  it('createSessionTokenService 传入空密钥 → 抛错（不允许静默降级成默认串）', () => {
    expect(() => createSessionTokenService('')).toThrow();
    expect(() => createSessionTokenService(undefined)).toThrow();
  });
});

describe('authorizeAdmin — 管理员判定', () => {
  it('管理员令牌通过，并回传可信身份', () => {
    const r = svc.authorizeAdmin(svc.generate('admin', 'admin', '管理员'));
    expect(r.ok).toBe(true);
    expect(r.username).toBe('admin');
    expect(r.role).toBe('admin');
  });

  it('专员令牌被拒（越权）', () => {
    const r = svc.authorizeAdmin(svc.generate('王莉', 'recruiter', '王莉'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('仅管理员');
  });

  it('没有令牌被拒', () => {
    expect(svc.authorizeAdmin(undefined).ok).toBe(false);
  });

  it('攻击者用自己密钥伪造的 admin 令牌被拒', () => {
    const forged = createSessionTokenService(OTHER_KEY).generate('admin', 'admin', '管理员');
    expect(svc.authorizeAdmin(forged).ok).toBe(false);
  });
});

describe('authorizeSelf — 「只能操作自己」判定（漏洞 B 的封堵点）', () => {
  it('令牌用户名与被操作账号一致 → 通过', () => {
    const r = svc.authorizeSelf(svc.generate('王莉', 'recruiter', '王莉'), '王莉');
    expect(r.ok).toBe(true);
  });

  it('令牌用户名与被操作账号不一致 → 拒绝（不能改别人的密码）', () => {
    const r = svc.authorizeSelf(svc.generate('王莉', 'recruiter', '王莉'), 'admin');
    expect(r.ok).toBe(false);
  });

  it('没有令牌 → 拒绝（原实现此处无任何校验，可直接试密码）', () => {
    expect(svc.authorizeSelf(undefined, 'admin').ok).toBe(false);
    expect(svc.authorizeSelf('', 'admin').ok).toBe(false);
  });

  it('账号参数为空 → 拒绝', () => {
    expect(svc.authorizeSelf(svc.generate('王莉', 'recruiter', '王莉'), '').ok).toBe(false);
    expect(svc.authorizeSelf(svc.generate('王莉', 'recruiter', '王莉'), undefined).ok).toBe(false);
  });

  it('管理员也不能借自己的令牌改别人的密码', () => {
    const r = svc.authorizeSelf(svc.generate('admin', 'admin', '管理员'), '王莉');
    expect(r.ok).toBe(false);
  });
});

describe('timingSafeStringEqual — 部署密钥比对', () => {
  it('完全相同的字符串 → true', () => {
    expect(timingSafeStringEqual('abc123', 'abc123')).toBe(true);
  });

  it('不同的字符串 → false', () => {
    expect(timingSafeStringEqual('abc123', 'abc124')).toBe(false);
  });

  it('前缀相同但更短 → false', () => {
    expect(timingSafeStringEqual('abc', 'abc123')).toBe(false);
  });

  it('长度不等时不抛异常（timingSafeEqual 长度不等会抛，必须先判长度）', () => {
    expect(() => timingSafeStringEqual('a', 'abcdefghij')).not.toThrow();
    expect(timingSafeStringEqual('a', 'abcdefghij')).toBe(false);
  });

  it('中文/多字节字符串比对正确', () => {
    expect(timingSafeStringEqual('部署密钥正确', '部署密钥正确')).toBe(true);
    expect(timingSafeStringEqual('部署密钥正确', '部署密钥错误')).toBe(false);
  });

  const badInputs = [
    ['空串与空串', '', ''],
    ['空串与非空', '', 'abc'],
    ['非空与空串', 'abc', ''],
    ['null', null, 'abc'],
    ['undefined', undefined, 'abc'],
    ['数字', 12345, 12345],
    ['对象', {}, {}],
    ['两个 null', null, null],
  ];

  for (const [name, a, b] of badInputs) {
    it(`${name} → false 且不抛错`, () => {
      expect(() => timingSafeStringEqual(a, b)).not.toThrow();
      expect(timingSafeStringEqual(a, b)).toBe(false);
    });
  }
});
