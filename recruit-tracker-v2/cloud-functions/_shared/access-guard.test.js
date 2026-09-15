/**
 * access-guard.test.js — 云函数统一访问守卫的回归测试
 *
 * 背景（2026-09-14 第 3 阶段加固）：
 *   加固前 get-file-url / report-aggregator / email-scanner 三个云函数对公网
 *   完全敞开——get-file-url 的 candidateOwnerId 与 callerUsername 都取自请求体，
 *   专员把自己名字填进去即可下载存储桶里任意简历；report-aggregator 连身份参数
 *   都没有。本模块把「验令牌 → 回查数据库 → 强制归属」这套判定收敛到一处。
 *
 * 本文件锁死三条不可退让的规则：
 *   1. 角色以**数据库当前值**为准，不采信令牌里的签发时快照
 *      （账号被降级或删除后，旧令牌不能继续当管理员）
 *   2. 非管理员的 ownerId **一律强制为本人**，请求体传什么都不作数
 *   3. 任何异常路径都**失败关闭**（拒绝），绝不因为查库出错就放行
 */

import { describe, it, expect, vi } from 'vitest';
import { createAccessGuard } from './access-guard';
import { createSessionTokenService, SESSION_TTL_MS } from './session-token';

const KEY = 'guard-unit-test-key-0123456789';
const OTHER_KEY = 'attacker-controlled-key-9876543210';
const svc = createSessionTokenService(KEY);

/** 构造一个可控的用户表 */
function makeFindUser(users) {
  return vi.fn(async (username) => users[username] || null);
}

const USERS = {
  admin: { username: 'admin', role: 'admin', name: '管理员' },
  王莉: { username: '王莉', role: 'recruiter', name: '王莉' },
};

function makeGuard(users = USERS) {
  return createAccessGuard({ signingKey: KEY, findUser: makeFindUser(users) });
}

// ============================================================

describe('createAccessGuard — 构造期校验', () => {
  it('缺少签名密钥 → 抛错（不允许退化成「不校验」）', () => {
    expect(() => createAccessGuard({ findUser: async () => null })).toThrow();
    expect(() => createAccessGuard({ signingKey: '', findUser: async () => null })).toThrow();
  });

  it('缺少 findUser 注入 → 抛错（否则无法回查数据库确认角色）', () => {
    expect(() => createAccessGuard({ signingKey: KEY })).toThrow();
  });
});

// ============================================================

describe('identify — 只验令牌，不查库', () => {
  it('合法令牌 → 回传签发时字段', async () => {
    const g = makeGuard();
    const r = await g.identify(svc.generate('王莉', 'recruiter', '王莉'));
    expect(r.ok).toBe(true);
    expect(r.username).toBe('王莉');
    expect(r.role).toBe('recruiter');
  });

  const badTokens = [
    ['无令牌', undefined],
    ['空串', ''],
    ['null', null],
    ['乱码', 'not-a-token'],
    ['只有一段', 'abcdef'],
    ['三段', 'a.b.c'],
  ];
  for (const [name, token] of badTokens) {
    it(`${name} → UNAUTHENTICATED 且不抛错`, async () => {
      const g = makeGuard();
      const r = await g.identify(token);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('UNAUTHENTICATED');
    });
  }

  it('攻击者用自己密钥伪造的令牌 → 拒绝', async () => {
    const forged = createSessionTokenService(OTHER_KEY).generate('admin', 'admin', '管理员');
    const r = await makeGuard().identify(forged);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNAUTHENTICATED');
  });

  it('已过期的令牌 → 拒绝', async () => {
    const expired = createSessionTokenService(KEY, { ttlMs: -1000 }).generate('admin', 'admin', '管理员');
    expect((await makeGuard().identify(expired)).ok).toBe(false);
  });

  it('identify 不查数据库（调用计数为 0）', async () => {
    const findUser = makeFindUser(USERS);
    const g = createAccessGuard({ signingKey: KEY, findUser });
    await g.identify(svc.generate('admin', 'admin', '管理员'));
    expect(findUser).not.toHaveBeenCalled();
  });
});

// ============================================================

describe('requireUser — 验令牌 + 回查数据库', () => {
  it('合法令牌且账号仍在 → 通过', async () => {
    const r = await makeGuard().requireUser(svc.generate('王莉', 'recruiter', '王莉'));
    expect(r.ok).toBe(true);
    expect(r.username).toBe('王莉');
  });

  it('🔒 角色以数据库为准：令牌自称 admin 但库中已是 recruiter → 回传 recruiter', async () => {
    // 攻击者拿到过一个 admin 令牌，账号随后被降级；旧令牌不能继续当管理员用
    const downgraded = { ...USERS, 王莉: { username: '王莉', role: 'recruiter', name: '王莉' } };
    const g = makeGuard(downgraded);
    const staleAdminToken = svc.generate('王莉', 'admin', '王莉'); // 令牌里写着 admin
    const r = await g.requireUser(staleAdminToken);
    expect(r.ok).toBe(true);
    expect(r.role).toBe('recruiter'); // ← 关键：不是 admin
  });

  it('令牌有效但账号已被删除 → FORBIDDEN', async () => {
    const r = await makeGuard().requireUser(svc.generate('ghost', 'recruiter', '幽灵'));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
    expect(r.error).toContain('账号状态已变更');
  });

  it('🔒 查库抛异常 → 失败关闭（拒绝，不因异常放行）', async () => {
    const g = createAccessGuard({
      signingKey: KEY,
      findUser: vi.fn(async () => { throw new Error('数据库连接超时'); }),
    });
    const r = await g.requireUser(svc.generate('admin', 'admin', '管理员'));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('无效令牌 → UNAUTHENTICATED（不进入查库环节）', async () => {
    const findUser = makeFindUser(USERS);
    const g = createAccessGuard({ signingKey: KEY, findUser });
    const r = await g.requireUser('garbage');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNAUTHENTICATED');
    expect(findUser).not.toHaveBeenCalled();
  });

  it('账号名字回退到令牌中的 name 时不丢字段', async () => {
    const g = makeGuard({ admin: { username: 'admin', role: 'admin' } }); // 库中无 name
    const r = await g.requireUser(svc.generate('admin', 'admin', '管理员'));
    expect(r.ok).toBe(true);
    expect(r.name).toBe('管理员');
  });
});

// ============================================================

describe('requireAdmin — 管理员判定', () => {
  it('管理员 → 通过', async () => {
    const r = await makeGuard().requireAdmin(svc.generate('admin', 'admin', '管理员'));
    expect(r.ok).toBe(true);
    expect(r.role).toBe('admin');
  });

  it('专员 → FORBIDDEN', async () => {
    const r = await makeGuard().requireAdmin(svc.generate('王莉', 'recruiter', '王莉'));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
    expect(r.error).toContain('仅管理员');
  });

  it('🔒 令牌自称 admin 但数据库里已降级 → FORBIDDEN（越权核心）', async () => {
    const g = makeGuard({ 王莉: { username: '王莉', role: 'recruiter', name: '王莉' } });
    const r = await g.requireAdmin(svc.generate('王莉', 'admin', '王莉'));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FORBIDDEN');
  });

  it('无令牌 → UNAUTHENTICATED', async () => {
    const r = await makeGuard().requireAdmin(undefined);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNAUTHENTICATED');
  });

  it('攻击者伪造的 admin 令牌 → 拒绝', async () => {
    const forged = createSessionTokenService(OTHER_KEY).generate('admin', 'admin', '管理员');
    expect((await makeGuard().requireAdmin(forged)).ok).toBe(false);
  });
});

// ============================================================

describe('ownerFilterFor — 归属强制（越权取数的封堵点）', () => {
  it('管理员可指定任意 ownerId', () => {
    const g = makeGuard();
    expect(g.ownerFilterFor({ role: 'admin', username: 'admin' }, '王莉').ownerId).toBe('王莉');
  });

  it('管理员不指定 → 空串（表示全部）', () => {
    const g = makeGuard();
    expect(g.ownerFilterFor({ role: 'admin', username: 'admin' }, undefined).ownerId).toBe('');
    expect(g.ownerFilterFor({ role: 'admin', username: 'admin' }, '').ownerId).toBe('');
  });

  it('🔒 专员指定别人的 ownerId → 被忽略，强制为本人', () => {
    const g = makeGuard();
    expect(g.ownerFilterFor({ role: 'recruiter', username: '王莉' }, '张三').ownerId).toBe('王莉');
  });

  it('🔒 专员不指定 → 仍强制为本人（不是「全部」）', () => {
    const g = makeGuard();
    expect(g.ownerFilterFor({ role: 'recruiter', username: '王莉' }, undefined).ownerId).toBe('王莉');
  });

  it('🔒 专员传空串 / null → 仍强制为本人', () => {
    const g = makeGuard();
    expect(g.ownerFilterFor({ role: 'recruiter', username: '王莉' }, '').ownerId).toBe('王莉');
    expect(g.ownerFilterFor({ role: 'recruiter', username: '王莉' }, null).ownerId).toBe('王莉');
  });

  it('🔒 角色缺失或异常 → 按非管理员处理（失败关闭）', () => {
    const g = makeGuard();
    expect(g.ownerFilterFor({ username: '王莉' }, '张三').ownerId).toBe('王莉');
    expect(g.ownerFilterFor({ username: '王莉' }, '张三').ok).toBe(true);
  });

  it('🔒 非管理员传数组/对象等奇怪类型 → 强制为本人', () => {
    const g = makeGuard();
    expect(g.ownerFilterFor({ role: 'recruiter', username: '王莉' }, ['张三']).ownerId).toBe('王莉');
    expect(g.ownerFilterFor({ role: 'recruiter', username: '王莉' }, { a: 1 }).ownerId).toBe('王莉');
  });

  it('actor 为 null/undefined → 失败关闭（不给任何数据）', () => {
    const g = makeGuard();
    const r = g.ownerFilterFor(null, '张三');
    expect(r.ok).toBe(false);
  });
});

// ============================================================

describe('会话有效期常量随模块一同分发', () => {
  it('TTL 为 24 小时', () => {
    expect(SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
