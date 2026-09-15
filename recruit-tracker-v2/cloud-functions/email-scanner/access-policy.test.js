/**
 * access-policy.test.js — 邮箱配置操作权限判定的回归测试
 *
 * 背景（2026-09-14 第 3 阶段加固）：
 *   email-scanner 加固前所有动作无鉴权。createConfig 的 userId 取自请求体，
 *   updateConfig/deleteConfig 只凭 id 就改删——任何人都能改任何人的收件邮箱。
 *
 * 这里要锁死的关键点是「按归属收紧，而不是一律管理员」：
 *   本系统里专员也管理自己的收件邮箱（侧边栏可见、路由未设 requireAdmin），
 *   粗暴改成仅管理员会让专员功能直接不可用。
 */

import { describe, it, expect } from 'vitest';
import {
  canManageConfig,
  resolveScanUserId,
  resolveConfigOwner,
  isAdminOnlyAction,
  ADMIN_ONLY_ACTIONS,
} from './access-policy';

const ADMIN = { username: 'admin', role: 'admin' };
const WANGLI = { username: '王莉', role: 'recruiter' };
const ZHANGSAN = { username: '张三', role: 'recruiter' };

describe('canManageConfig — 配置归属判定', () => {
  it('管理员可操作任意配置', () => {
    expect(canManageConfig(ADMIN, { userId: '王莉' }).allowed).toBe(true);
  });

  it('本人可操作自己的配置', () => {
    expect(canManageConfig(WANGLI, { userId: '王莉' }).allowed).toBe(true);
  });

  it('🔒 专员操作别人的配置 → 拒绝（原实现只凭 id 就改删）', () => {
    const r = canManageConfig(ZHANGSAN, { userId: '王莉' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('无权');
  });

  it('🔒 无主配置（userId 为空）专员不得认领', () => {
    expect(canManageConfig(WANGLI, { userId: '' }).allowed).toBe(false);
    expect(canManageConfig(WANGLI, {}).allowed).toBe(false);
  });

  it('配置查不到（null/undefined）→ 拒绝', () => {
    expect(canManageConfig(WANGLI, null).allowed).toBe(false);
    expect(canManageConfig(WANGLI, undefined).allowed).toBe(false);
  });

  it('调用者缺失 → 拒绝且不抛错', () => {
    expect(() => canManageConfig(null, { userId: '王莉' })).not.toThrow();
    expect(canManageConfig(null, { userId: '王莉' }).allowed).toBe(false);
    expect(canManageConfig({ username: '', role: 'recruiter' }, { userId: '' }).allowed).toBe(false);
  });

  it('userId 非字符串时不误判为本人', () => {
    expect(canManageConfig(WANGLI, { userId: 123 }).allowed).toBe(false);
    expect(canManageConfig(WANGLI, { userId: ['王莉'] }).allowed).toBe(false);
  });
});

describe('resolveScanUserId — 扫描范围强制', () => {
  it('管理员不指定 → 空串（扫全部）', () => {
    expect(resolveScanUserId(ADMIN, undefined)).toEqual({ ok: true, userId: '' });
    expect(resolveScanUserId(ADMIN, '')).toEqual({ ok: true, userId: '' });
  });

  it('管理员指定某人 → 按指定', () => {
    expect(resolveScanUserId(ADMIN, '王莉')).toEqual({ ok: true, userId: '王莉' });
  });

  it('🔒 专员指定别人 → 被忽略，强制只扫自己', () => {
    expect(resolveScanUserId(WANGLI, '张三')).toEqual({ ok: true, userId: '王莉' });
  });

  it('🔒 专员不指定 → 仍只扫自己（不是"全部"）', () => {
    expect(resolveScanUserId(WANGLI, undefined)).toEqual({ ok: true, userId: '王莉' });
    expect(resolveScanUserId(WANGLI, '')).toEqual({ ok: true, userId: '王莉' });
  });

  it('🔒 专员传奇怪类型 → 仍强制自己', () => {
    expect(resolveScanUserId(WANGLI, ['张三']).userId).toBe('王莉');
    expect(resolveScanUserId(WANGLI, { u: '张三' }).userId).toBe('王莉');
  });

  it('调用者缺失 → 失败关闭', () => {
    expect(resolveScanUserId(null, '').ok).toBe(false);
    expect(resolveScanUserId({ username: '' }, '').ok).toBe(false);
  });
});

describe('resolveConfigOwner — 新建配置的归属', () => {
  it('专员新建 → 强制归自己（请求体身份不作数）', () => {
    expect(resolveConfigOwner(WANGLI, '张三')).toEqual({ ok: true, userId: '王莉' });
    expect(resolveConfigOwner(WANGLI, undefined)).toEqual({ ok: true, userId: '王莉' });
  });

  it('管理员新建 → 默认归自己，可显式指定他人', () => {
    expect(resolveConfigOwner(ADMIN, undefined)).toEqual({ ok: true, userId: 'admin' });
    expect(resolveConfigOwner(ADMIN, '王莉')).toEqual({ ok: true, userId: '王莉' });
  });

  it('调用者缺失 → 失败关闭', () => {
    expect(resolveConfigOwner(null, '王莉').ok).toBe(false);
  });
});

describe('isAdminOnlyAction — 一次性迁移与排查工具仅管理员', () => {
  it('rotateKeys（密钥轮换）仅管理员', () => {
    expect(isAdminOnlyAction('rotateKeys')).toBe(true);
  });

  it('debugInbox（收件箱结构排查）仅管理员', () => {
    expect(isAdminOnlyAction('debugInbox')).toBe(true);
  });

  it('日常动作不受限', () => {
    for (const a of ['scan', 'createConfig', 'updateConfig', 'deleteConfig', 'diagnose', 'test', 'extractText', 'refetch']) {
      expect(isAdminOnlyAction(a)).toBe(false);
    }
  });

  it('未定义/空动作不会被误判为管理员专属', () => {
    expect(isAdminOnlyAction(undefined)).toBe(false);
    expect(isAdminOnlyAction('')).toBe(false);
  });

  it('管理员专属清单是预期的那两个', () => {
    expect(ADMIN_ONLY_ACTIONS.sort()).toEqual(['debugInbox', 'rotateKeys']);
  });
});
