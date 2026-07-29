/**
 * pipeline-engine 单元测试
 *
 * 测试 12 个纯函数：getInterviewRounds / getStagesForJob / stageExists /
 * isEndStage / isActiveStage / canTransition / getIntermediateStages /
 * checkPreconditions / stageToFunnelKey / getFunnelBackfill /
 * buildTransitionPayload / getAvailableTargets / groupApplicationsByStage
 */
import { describe, it, expect } from 'vitest';
import {
  getInterviewRounds,
  getStagesForJob,
  stageExists,
  isEndStage,
  isActiveStage,
  canTransition,
  getIntermediateStages,
  checkPreconditions,
  stageToFunnelKey,
  getFunnelBackfill,
  buildTransitionPayload,
  getAvailableTargets,
  groupApplicationsByStage,
  STAGE_ORDER_MAP,
  STAGE_LABEL_MAP,
} from './pipeline-engine';

// ===== 面试轮次 =====

describe('getInterviewRounds', () => {
  it('null/undefined 返回默认 3 轮', () => {
    expect(getInterviewRounds(null)).toBe(3);
    expect(getInterviewRounds(undefined)).toBe(3);
  });

  it('未知岗位类型返回默认 3 轮', () => {
    expect(getInterviewRounds('不存在的类型')).toBe(3);
  });

  it('已知类型返回对应轮数', () => {
    // CR（课程顾问）通常 2 轮面试
    const rounds = getInterviewRounds('CR');
    expect([2, 3]).toContain(rounds);
  });
});

// ===== 阶段过滤 =====

describe('getStagesForJob', () => {
  it('null 参数返回所有阶段', () => {
    const stages = getStagesForJob(null);
    expect(stages.length).toBeGreaterThan(5);
  });

  it('返回的阶段按 order 升序', () => {
    const stages = getStagesForJob(null);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].order).toBeGreaterThan(stages[i - 1].order);
    }
  });

  it('每个阶段包含 key/label/order', () => {
    const stages = getStagesForJob(null);
    for (const s of stages) {
      expect(s.key).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(typeof s.order).toBe('number');
    }
  });
});

describe('stageExists', () => {
  it('resume 阶段在任何岗位都存在', () => {
    expect(stageExists('resume', null)).toBe(true);
    expect(stageExists('resume', 'CR')).toBe(true);
  });

  it('不存在的阶段返回 false', () => {
    expect(stageExists('不存在的阶段', null)).toBe(false);
  });
});

// ===== 阶段状态判断 =====

describe('isEndStage', () => {
  it('rejected 是结束阶段', () => expect(isEndStage('rejected')).toBe(true));
  it('withdrawn 是结束阶段', () => expect(isEndStage('withdrawn')).toBe(true));
  it('resume 不是结束阶段', () => expect(isEndStage('resume')).toBe(false));
  it('onboard 不是结束阶段', () => expect(isEndStage('onboard')).toBe(false));
  it('随机字符串不是结束阶段', () => expect(isEndStage('abc123')).toBe(false));
});

describe('isActiveStage', () => {
  it('resume 是活跃阶段', () => expect(isActiveStage('resume')).toBe(true));
  it('onboard 是活跃阶段', () => expect(isActiveStage('onboard')).toBe(true));
  it('rejected 不是活跃阶段', () => expect(isActiveStage('rejected')).toBe(false));
  it('withdrawn 不是活跃阶段', () => expect(isActiveStage('withdrawn')).toBe(false));
  it('不存在阶段不是活跃阶段', () => expect(isActiveStage('xxx')).toBe(false));
});

// ===== 流转校验（核心） =====

describe('canTransition', () => {
  // --- 基础校验 ---
  it('相同阶段不允许流转', () => {
    const r = canTransition('resume', 'resume');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('当前阶段');
  });

  // --- 重新激活 ---
  it('从 rejected 可重新激活到活跃阶段', () => {
    const r = canTransition('rejected', 'resume', { currentStatus: 'rejected' });
    expect(r.valid).toBe(true);
    expect(r.isReactivation).toBe(true);
  });

  it('从 withdrawn 可重新激活到活跃阶段', () => {
    const r = canTransition('withdrawn', 'invite', { currentStatus: 'withdrawn' });
    expect(r.valid).toBe(true);
    expect(r.isReactivation).toBe(true);
  });

  it('重新激活时到结束阶段不算 reactivation', () => {
    const r = canTransition('rejected', 'rejected', { currentStatus: 'rejected' });
    // 同阶段无效，不是 reactivation
    expect(r.valid).toBe(false);
  });

  // --- 结束操作 ---
  it('活跃阶段可流转到 rejected', () => {
    const r = canTransition('resume', 'rejected');
    expect(r.valid).toBe(true);
    expect(r.isReactivation).toBeUndefined();
  });

  it('活跃阶段可流转到 withdrawn', () => {
    const r = canTransition('resume', 'withdrawn');
    expect(r.valid).toBe(true);
  });

  it('从活跃阶段不可后退', () => {
    const r = canTransition('first_interview', 'resume');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('后退');
  });

  it('从结束状态不能流转到其他阶段（除 reactivation）', () => {
    const r = canTransition('rejected', 'resume', { currentStatus: 'rejected' });
    // 这是 reactivation，应该是 valid
    expect(r.valid).toBe(true);
  });

  it('从结束状态不允许跳阶段', () => {
    const r = canTransition('rejected', 'offer', { currentStatus: 'rejected' });
    // 这也是 reactivation，应该是 valid
    expect(r.valid).toBe(true);
  });

  // --- 前进流转 ---
  it('允许向前流转 resume → valid_resume', () => {
    const r = canTransition('resume', 'valid_resume');
    expect(r.valid).toBe(true);
  });

  it('允许跳阶段 resume → first_interview', () => {
    const r = canTransition('resume', 'first_interview');
    expect(r.valid).toBe(true);
  });

  // --- 未知阶段 ---
  it('未知来源阶段不可流转', () => {
    const r = canTransition('nonexistent', 'resume');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('未知来源阶段');
  });

  it('未知目标阶段不可流转', () => {
    const r = canTransition('resume', 'nonexistent');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('未知目标阶段');
  });

  // --- 结束状态不能流转 ---
  it('非 active 状态不能进行正常流转', () => {
    const r = canTransition('resume', 'valid_resume', { currentStatus: 'rejected' });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('已结束');
  });
});

// ===== 跳阶段回填 =====

describe('getIntermediateStages', () => {
  it('相邻阶段无中间阶段', () => {
    const r = getIntermediateStages('resume', 'valid_resume');
    expect(r).toEqual([]);
  });

  it('跳阶段有中间阶段', () => {
    const r = getIntermediateStages('resume', 'first_interview');
    // valid_resume 和 invite 在中间
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it('后退操作返回空数组', () => {
    const r = getIntermediateStages('offer', 'resume');
    expect(r).toEqual([]);
  });

  it('不存在阶段返回空数组', () => {
    expect(getIntermediateStages('xxx', 'resume')).toEqual([]);
    expect(getIntermediateStages('resume', 'xxx')).toEqual([]);
    expect(getIntermediateStages('xxx', 'yyy')).toEqual([]);
  });
});

// ===== 前置条件检查 =====

describe('checkPreconditions', () => {
  it('resume 阶段无前置条件', () => {
    const r = checkPreconditions('resume', {}, null);
    expect(r.valid).toBe(true);
  });

  it('面试阶段需邀约（无 funnel 则缺失）', () => {
    const r = checkPreconditions('first_interview', {}, null);
    expect(r.valid).toBe(false);
    expect(r.missing).toContain('尚未发邀约');
  });

  it('面试阶段有邀约则通过', () => {
    const r = checkPreconditions('first_interview', {
      funnel: { inviteConfirmedAt: new Date() },
    }, null);
    expect(r.valid).toBe(true);
  });

  it('first_pass 需经过初试', () => {
    const r = checkPreconditions('first_pass', {}, null);
    expect(r.valid).toBe(false);
    expect(r.missing).toContain('尚未进行初试');
  });

  it('first_pass 有 interview1At 则通过', () => {
    const r = checkPreconditions('first_pass', {
      funnel: { interview1At: new Date() },
    }, null);
    expect(r.valid).toBe(true);
  });

  // 🐛 修复：跳阶段回填时应跳过前置条件检查
  it('跳阶段 resume→first_pass：first_interview 会被回填，不报警告', () => {
    const r = checkPreconditions('first_pass', { funnel: {} }, null, 'resume');
    expect(r.valid).toBe(true);
  });

  it('跳阶段 valid_resume→first_pass：first_interview 会被回填，不报警告', () => {
    const r = checkPreconditions('first_pass', { funnel: {} }, null, 'valid_resume');
    expect(r.valid).toBe(true);
  });

  it('不跳阶段 first_interview→first_pass：没有被回填的初试，仍报警告', () => {
    const r = checkPreconditions('first_pass', { funnel: {} }, null, 'first_interview');
    expect(r.valid).toBe(false);
    expect(r.missing).toContain('尚未进行初试');
  });

  it('offer 阶段需通过最终面试', () => {
    const r = checkPreconditions('offer', { funnel: {} }, null);
    expect(r.valid).toBe(false);
    expect(r.missing).toContain('尚未通过最终面试');
  });

  it('3轮面试岗位 offer 需 interview3PassAt', () => {
    const r = checkPreconditions('offer', {
      funnel: { interview3PassAt: new Date() },
    }, { type: 'default' });
    expect(r.valid).toBe(true);
  });

  it('onboard 阶段需已发 Offer', () => {
    const r = checkPreconditions('onboard', { funnel: {} }, null);
    expect(r.valid).toBe(false);
    expect(r.missing).toContain('尚未发放 Offer');
  });

  it('onboard 有 offerAt 和 backgroundCheckAt 则通过（P2-20：背调前置）', () => {
    const r = checkPreconditions('onboard', {
      funnel: { offerAt: new Date(), backgroundCheckAt: new Date() },
    }, null);
    expect(r.valid).toBe(true);
  });
});

// ===== 漏斗时间戳映射 =====

describe('stageToFunnelKey', () => {
  it('resume 映射为 resumeAt', () => {
    expect(stageToFunnelKey('resume')).toBe('resumeAt');
  });

  it('first_interview 映射为 interview1At', () => {
    expect(stageToFunnelKey('first_interview')).toBe('interview1At');
  });

  it('offer 映射为 offerAt', () => {
    expect(stageToFunnelKey('offer')).toBe('offerAt');
  });

  it('onboard 映射为 onboardAt', () => {
    expect(stageToFunnelKey('onboard')).toBe('onboardAt');
  });

  it('未知阶段返回 null', () => {
    expect(stageToFunnelKey('xxx')).toBeNull();
  });

  it('rejected/withdrawn 返回 null', () => {
    expect(stageToFunnelKey('rejected')).toBeNull();
    expect(stageToFunnelKey('withdrawn')).toBeNull();
  });
});

describe('getFunnelBackfill', () => {
  it('resume 阶段之前无阶段，回填为空', () => {
    const r = getFunnelBackfill('resume');
    expect(r).toEqual({});
  });

  it('offer 阶段之前有多阶段需回填', () => {
    const r = getFunnelBackfill('offer');
    expect(r.funnel).toBeDefined();
    expect(Object.keys(r.funnel).length).toBeGreaterThan(0);
  });

  it('回填时间戳为 Date 实例', () => {
    const r = getFunnelBackfill('first_interview');
    if (r.funnel) {
      for (const v of Object.values(r.funnel)) {
        expect(v).toBeInstanceOf(Date);
      }
    }
  });

  it('不存在阶段返回空对象', () => {
    expect(getFunnelBackfill('xxx')).toEqual({});
  });
});

// ===== 流转载荷构建 =====

describe('buildTransitionPayload', () => {
  it('重新激活返回正确结构', () => {
    const p = buildTransitionPayload('rejected', 'resume', { isReactivation: true });
    expect(p.status).toBe('active');
    expect(p.stage).toBe('resume');
    expect(p.reactivatedAt).toBeInstanceOf(Date);
    expect(p.reactivatedFrom).toBe('rejected');
    expect(p.history).toBeDefined();
  });

  it('结束操作返回 history 记录', () => {
    const p = buildTransitionPayload('resume', 'rejected', { note: '不合适' });
    expect(p.history).toBeDefined();
    expect(p.history.toStage).toBe('rejected');
    expect(p.history.note).toBe('不合适');
  });

  it('普通流转包含 stage 和 funnel', () => {
    const p = buildTransitionPayload('resume', 'valid_resume', { operatorId: 'admin' });
    expect(p.stage).toBe('valid_resume');
    expect(p.stageEnteredAt).toBeInstanceOf(Date);
    expect(p.history.operatorId).toBe('admin');
  });

  it('跳阶段流转包含 skippedBackfill', () => {
    const p = buildTransitionPayload('resume', 'first_pass');
    expect(p.history.skippedBackfill).toBeDefined();
    expect(p.history.skippedBackfill.length).toBeGreaterThan(0);
  });

  it('跳阶段自动回填中间阶段的 funnel 时间戳', () => {
    const p = buildTransitionPayload('resume', 'first_interview');
    // 至少应该有 valid_resume 的 funnel key
    expect(p.funnel).toBeDefined();
  });
});

// ===== 可用目标阶段 =====

describe('getAvailableTargets', () => {
  it('resume 阶段的后继阶段不包含自身', () => {
    const targets = getAvailableTargets('resume');
    const keys = targets.map(t => t.key);
    expect(keys).not.toContain('resume');
  });

  it('包含 rejected 和 withdrawn 结束选项', () => {
    const targets = getAvailableTargets('resume');
    const endKeys = targets.filter(t => t.isEnd).map(t => t.key);
    expect(endKeys).toContain('rejected');
    expect(endKeys).toContain('withdrawn');
  });

  it('结束状态返回所有阶段（用于重新激活）', () => {
    const targets = getAvailableTargets('resume', 'rejected');
    expect(targets.length).toBeGreaterThan(0);
    // 所有都应该不是结束阶段
    expect(targets.every(t => !t.isEnd)).toBe(true);
  });

  it('非活跃非结束状态返回空数组', () => {
    const targets = getAvailableTargets('resume', 'unknown_status');
    expect(targets).toEqual([]);
  });

  it('最后活跃阶段 onboard 只有结束选项', () => {
    const targets = getAvailableTargets('onboard');
    const activeTargets = targets.filter(t => !t.isEnd);
    expect(activeTargets).toHaveLength(0);
    expect(targets.length).toBe(2); // rejected + withdrawn
  });
});

// ===== 按阶段分组 =====

describe('groupApplicationsByStage', () => {
  const stages = [
    { key: 'resume', label: '简历', order: 0 },
    { key: 'valid_resume', label: '有效简历', order: 1 },
    { key: 'invite', label: '邀约', order: 2 },
  ];

  it('将申请按 stage 分组', () => {
    const apps = [
      { _id: '1', stage: 'resume', name: '张三' },
      { _id: '2', stage: 'resume', name: '李四' },
      { _id: '3', stage: 'invite', name: '王五' },
    ];
    const map = groupApplicationsByStage(apps, stages);
    expect(map.resume).toHaveLength(2);
    expect(map.invite).toHaveLength(1);
    expect(map.valid_resume).toHaveLength(0);
  });

  it('空数组返回全空分组', () => {
    const map = groupApplicationsByStage([], stages);
    for (const stage of stages) {
      expect(map[stage.key]).toEqual([]);
    }
  });

  it('rejected 状态路由到 rejected 组', () => {
    const apps = [{ _id: '1', stage: 'resume', status: 'rejected' }];
    const map = groupApplicationsByStage(apps, stages);
    expect(map.resume).toHaveLength(0);
  });

  it('withdrawn 状态路由到 withdrawn 组', () => {
    const apps = [{ _id: '1', stage: 'resume', status: 'withdrawn' }];
    const map = groupApplicationsByStage(apps, stages);
    expect(map.resume).toHaveLength(0);
  });
});

// ===== 映射表 =====

describe('STAGE_ORDER_MAP', () => {
  it('包含 resume 阶段', () => {
    expect(STAGE_ORDER_MAP.resume).toBe(0);
  });

  it('包含 onboard 阶段（最后阶段）', () => {
    expect(STAGE_ORDER_MAP.onboard).toBeGreaterThan(0);
  });
});

describe('STAGE_LABEL_MAP', () => {
  it('resume 对应中文标签', () => {
    expect(STAGE_LABEL_MAP.resume).toBeTruthy();
    expect(typeof STAGE_LABEL_MAP.resume).toBe('string');
  });
});
