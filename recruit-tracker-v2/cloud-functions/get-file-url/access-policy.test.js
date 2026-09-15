/**
 * access-policy.test.js — 简历文件访问判定的回归测试
 *
 * 背景（2026-09-14 第 3 阶段加固）：
 *   加固前的 get-file-url 把 callerUsername 和 candidateOwnerId **都取自请求体**，
 *   然后比对 `caller.username !== candidateOwnerId`——两个值都由调用方提供，
 *   专员只要把自己名字同时填进两个字段就能下载存储桶里任意简历。
 *   真正的修法是服务端按 fileId 反查候选人，再用**数据库里的归属**判定。
 *
 * 判定规则必须与前端 useCandidateStore.fetchById 的权限模型一致，否则正常专员
 * 会被误拒（功能性回归）：
 *   1. 管理员放行
 *   2. Candidate.ownerId === 调用者
 *   3. 存在一条 ownerId === 调用者 的 Application 关联该候选人
 */

import { describe, it, expect } from 'vitest';
import { decideFileAccess } from './access-policy';

const ADMIN = { username: 'admin', role: 'admin' };
const WANGLI = { username: '王莉', role: 'recruiter' };
const ZHANGSAN = { username: '张三', role: 'recruiter' };

describe('decideFileAccess — 放行路径', () => {
  it('管理员可访问任意候选人的简历', () => {
    const r = decideFileAccess({ actor: ADMIN, candidate: { ownerId: '王莉' }, applicationOwnerIds: [] });
    expect(r.allowed).toBe(true);
  });

  it('候选人归属人本人可访问', () => {
    const r = decideFileAccess({ actor: WANGLI, candidate: { ownerId: '王莉' }, applicationOwnerIds: [] });
    expect(r.allowed).toBe(true);
  });

  it('虽非候选人归属人，但有一条自己负责的 Application 关联它 → 放行', () => {
    const r = decideFileAccess({
      actor: ZHANGSAN,
      candidate: { ownerId: '王莉' },
      applicationOwnerIds: ['王莉', '张三'],
    });
    expect(r.allowed).toBe(true);
  });
});

describe('decideFileAccess — 拒绝路径', () => {
  it('专员访问别人的简历且无关联 Application → 拒绝', () => {
    const r = decideFileAccess({ actor: ZHANGSAN, candidate: { ownerId: '王莉' }, applicationOwnerIds: ['王莉'] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('无权');
  });

  it('🔒 请求体自称是归属人也不作数（原本的漏洞路径）', () => {
    // 加固前：调用方传 candidateOwnerId='张三' 且 callerUsername='张三' 即被放行。
    // 现在归属取自数据库，张三绝无可能访问王莉的简历。
    const r = decideFileAccess({ actor: ZHANGSAN, candidate: { ownerId: '王莉' }, applicationOwnerIds: [] });
    expect(r.allowed).toBe(false);
  });

  it('专员越权访问且 applicationOwnerIds 为空数组 → 拒绝', () => {
    expect(decideFileAccess({ actor: ZHANGSAN, candidate: { ownerId: '王莉' }, applicationOwnerIds: [] }).allowed)
      .toBe(false);
  });

  it('找不到该 fileId 对应的候选人 → 拒绝（不因查不到就放行）', () => {
    const r = decideFileAccess({ actor: WANGLI, candidate: null, applicationOwnerIds: [] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('未找到');
  });
});

describe('decideFileAccess — 边界与异常输入一律失败关闭', () => {
  const cases = [
    ['actor 为 null', { actor: null, candidate: { ownerId: '王莉' }, applicationOwnerIds: [] }],
    ['actor 为 undefined', { actor: undefined, candidate: { ownerId: '王莉' }, applicationOwnerIds: [] }],
    ['actor.username 为空串', { actor: { username: '', role: 'recruiter' }, candidate: { ownerId: '' }, applicationOwnerIds: [] }],
    ['candidate.ownerId 与 actor.username 均为空串（不得因空===空而放行）',
      { actor: { username: '', role: 'recruiter' }, candidate: { ownerId: '' }, applicationOwnerIds: [] }],
    ['applicationOwnerIds 为 undefined', { actor: ZHANGSAN, candidate: { ownerId: '王莉' }, applicationOwnerIds: undefined }],
    ['applicationOwnerIds 为 null', { actor: ZHANGSAN, candidate: { ownerId: '王莉' }, applicationOwnerIds: null }],
    ['candidate 没有 ownerId 字段', { actor: ZHANGSAN, candidate: {}, applicationOwnerIds: [] }],
    ['role 缺失的调用者', { actor: { username: '王莉' }, candidate: { ownerId: '张三' }, applicationOwnerIds: [] }],
  ];

  for (const [name, input] of cases) {
    it(`${name} → 拒绝且不抛错`, () => {
      expect(() => decideFileAccess(input)).not.toThrow();
      expect(decideFileAccess(input).allowed).toBe(false);
    });
  }

  it('applicationOwnerIds 含 null/undefined/非字符串时不误放行', () => {
    const r = decideFileAccess({ actor: ZHANGSAN, candidate: { ownerId: '王莉' }, applicationOwnerIds: [null, undefined, 123] });
    expect(r.allowed).toBe(false);
  });

  it('actor 名字为空串时，即使候选人 ownerId 也是空串也不放行', () => {
    const r = decideFileAccess({ actor: { username: '', role: 'recruiter' }, candidate: { ownerId: '' }, applicationOwnerIds: [''] });
    expect(r.allowed).toBe(false);
  });

  it('返回结构稳定：拒绝时一定带 reason 字符串', () => {
    const r = decideFileAccess({ actor: null, candidate: null, applicationOwnerIds: null });
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
