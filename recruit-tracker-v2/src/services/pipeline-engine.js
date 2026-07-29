/* 新励成招聘管理系统 V2.0 — 管道流转引擎（纯函数，无副作用）
 *
 * 封装所有流转逻辑，实现：
 *   1. 阶段有效性校验（canTransition）
 *   2. 跳阶段回填（getIntermediateStages）
 *   3. 差异化面试轮次（getStagesForJob / getInterviewRounds）
 *   4. 前置条件检查（checkPreconditions）
 *   5. 流转数据载荷构建（buildTransitionPayload）
 *
 * 所有函数均为纯函数，不依赖外部状态，不访问数据库。
 */

import { FUNNEL_STAGES, JOB_TYPES } from '../config/constants';

// ===== 阶段映射 =====

/** 所有阶段的有序列表（key → order） */
const STAGE_ORDER_MAP = Object.fromEntries(
  FUNNEL_STAGES.map((s) => [s.key, s.order])
);

/** 所有阶段的 order → key 映射 */
const ORDER_STAGE_MAP = Object.fromEntries(
  FUNNEL_STAGES.map((s) => [s.order, s.key])
);

/** order → label 映射 */
const STAGE_LABEL_MAP = Object.fromEntries(
  FUNNEL_STAGES.map((s) => [s.key, s.label])
);

// ===== 面试轮次 =====

/** 默认面试轮数（当岗位类型未匹配时使用） */
const DEFAULT_INTERVIEW_ROUNDS = 3;

/**
 * 获取岗位类型对应的面试轮数
 * @param {string} jobType - 岗位类型（如 'CC', 'CR', '讲师' 等）
 * @returns {number} 面试轮数（2 或 3）
 */
export function getInterviewRounds(jobType) {
  if (!jobType) return DEFAULT_INTERVIEW_ROUNDS;
  const config = JOB_TYPES[jobType];
  return config?.interviewRounds || DEFAULT_INTERVIEW_ROUNDS;
}

/** 3轮面试岗位的类型名列表 */
const THREE_ROUND_TYPES = Object.entries(JOB_TYPES)
  .filter(([, config]) => config.interviewRounds >= 3)
  .map(([key]) => key);

/** 2轮面试岗位的类型名列表 */
const TWO_ROUND_TYPES = Object.entries(JOB_TYPES)
  .filter(([, config]) => config.interviewRounds === 2)
  .map(([key]) => key);

// ===== 阶段过滤 =====

/**
 * 获取适用于指定岗位类型的漏斗阶段列表
 * @param {string|null} jobType - 岗位类型
 * @returns {Array<{ key: string, label: string, order: number }>}
 */
export function getStagesForJob(jobType) {
  const rounds = getInterviewRounds(jobType);

  return FUNNEL_STAGES.filter((stage) => {
    // 2轮面试岗位：过滤掉终试和终试通过
    if (rounds < 3) {
      if (stage.key === 'final_interview' || stage.key === 'final_pass') return false;
    }
    // 1轮面试岗位（目前不存在，保留扩展）：
    if (rounds < 2) {
      if (stage.key === 'second_interview' || stage.key === 'second_pass') return false;
    }
    return true;
  });
}

/**
 * 判断某个阶段是否存在于岗位的漏斗中
 * @param {string} stageKey - 阶段 key
 * @param {string|null} jobType - 岗位类型
 * @returns {boolean}
 */
export function stageExists(stageKey, jobType) {
  const stages = getStagesForJob(jobType);
  return stages.some((s) => s.key === stageKey);
}

// ===== 流转校验 =====

/**
 * 流转规则：
 *   - 只能向前流转（order 递增），不允许后退
 *   - 不能跳到同阶段
 *   - 允许跳阶段（如 resume → first_interview），中间自动回填
 *   - reject/withdraw 可从任何活跃阶段进入
 *   - reactivate 可从 reject/withdraw 回到原阶段
 *   - 不允许从结束状态跳到其他阶段（除 reactivate）
 */

/** 是否结束目标 */
export function isEndStage(stageKey) {
  return stageKey === 'rejected' || stageKey === 'withdrawn';
}

/** 是否是合法的活跃阶段 */
export function isActiveStage(stageKey) {
  return stageKey in STAGE_ORDER_MAP;
}

/**
 * 校验流转是否合法
 *
 * @param {string} fromStage - 当前阶段 key
 * @param {string} toStage - 目标阶段 key
 * @param {Object} options
 * @param {string} options.jobType - 岗位类型
 * @param {string} options.currentStatus - 当前申请状态 ('active'|'rejected'|'withdrawn')
 * @returns {{ valid: boolean, reason?: string, isReactivation?: boolean }}
 */
export function canTransition(fromStage, toStage, options = {}) {
  const { jobType = null, currentStatus = 'active' } = options;

  // 0. 相同阶段
  if (fromStage === toStage) {
    return { valid: false, reason: '已在当前阶段，无需重复操作' };
  }

  // 1. 重新激活（rejected/withdrawn → active stage）
  if ((fromStage === 'rejected' || fromStage === 'withdrawn') && isActiveStage(toStage)) {
    return { valid: true, isReactivation: true };
  }

  // 2. 结束操作（任意活跃阶段 → rejected/withdrawn）
  if (currentStatus === 'active' && isEndStage(toStage)) {
    return { valid: true };
  }

  // 3. 从结束状态不允许做其他流转
  if (currentStatus !== 'active') {
    return { valid: false, reason: '已结束的申请无法流转，请先重新激活' };
  }

  // 4. 从未知阶段出发
  if (!isActiveStage(fromStage)) {
    return { valid: false, reason: `未知来源阶段: ${fromStage}` };
  }

  // 5. 到达未知阶段
  if (!isActiveStage(toStage)) {
    return { valid: false, reason: `未知目标阶段: ${toStage}` };
  }

  // 6. 不允许后退
  const fromOrder = STAGE_ORDER_MAP[fromStage];
  const toOrder = STAGE_ORDER_MAP[toStage];
  if (toOrder <= fromOrder) {
    return {
      valid: false,
      reason: `不允许从「${STAGE_LABEL_MAP[fromStage]}」后退到「${STAGE_LABEL_MAP[toStage]}」`,
    };
  }

  // 7. 目标阶段是否在岗位漏斗中存在
  if (jobType && !stageExists(toStage, jobType)) {
    return {
      valid: false,
      reason: `「${STAGE_LABEL_MAP[toStage]}」不适用于当前岗位类型`,
    };
  }

  return { valid: true };
}

// ===== 跳阶段回填 =====

/**
 * 获取两个阶段之间的所有中间阶段 key 列表
 * @param {string} fromStage
 * @param {string} toStage
 * @param {string|null} jobType
 * @returns {string[]}
 */
export function getIntermediateStages(fromStage, toStage, jobType = null) {
  if (!isActiveStage(fromStage) || !isActiveStage(toStage)) return [];

  const fromOrder = STAGE_ORDER_MAP[fromStage];
  const toOrder = STAGE_ORDER_MAP[toStage];

  if (toOrder <= fromOrder) return [];

  const validStages = getStagesForJob(jobType);
  const validKeys = new Set(validStages.map((s) => s.key));

  const intermediates = [];
  for (let o = fromOrder + 1; o < toOrder; o++) {
    const key = ORDER_STAGE_MAP[o];
    if (key && validKeys.has(key)) {
      intermediates.push(key);
    }
  }

  return intermediates;
}

// ===== 前置条件检查 =====

/**
 * 检查进入目标阶段的前置条件
 *
 * 🐛 修复（P2-25）：支持跳阶段回填机制——
 *   当 fromStage 到 targetStage 之间包含前置阶段时，回填会自动补充漏斗时间戳，
 *   此时不应报告"缺少前置条件"。
 *
 * @param {string} targetStage - 目标阶段
 * @param {Object} application - 申请记录
 * @param {Object} job - 岗位信息
 * @param {string} [fromStage] - 当前阶段（用于判断是否通过跳阶段回填满足前置条件）
 * @returns {{ valid: boolean, missing?: string[] }}
 */
export function checkPreconditions(targetStage, application = {}, job = null, fromStage = null) {
  const missing = [];

  // 计算跳阶段回填的阶段集合：这些阶段的时间戳会在流转时自动填充
  const jobType = job?.type || job?.jobType || null;
  const skippedSet = fromStage
    ? new Set(getIntermediateStages(fromStage, targetStage, jobType))
    : new Set();

  // 辅助函数：检查前置阶段是否在回填范围内
  function isBackfilled(preStageKey) {
    return skippedSet.has(preStageKey);
  }

  // 面试阶段：检查是否已邀约
  const interviewStages = ['first_interview', 'second_interview', 'final_interview'];
  if (interviewStages.includes(targetStage)) {
    if (!application.funnel?.inviteAt && !application.funnel?.inviteConfirmedAt) {
      // 如果 invite 或 invite_confirmed 正在被回填，则不报警告
      if (!isBackfilled('invite') && !isBackfilled('invite_confirmed')) {
        missing.push('尚未发邀约');
      }
    }
  }

  // 通过阶段：检查是否经过对应面试
  if (targetStage === 'first_pass') {
    if (!application.funnel?.interview1At) {
      if (!isBackfilled('first_interview')) {
        missing.push('尚未进行初试');
      }
    }
  }
  if (targetStage === 'second_pass') {
    if (!application.funnel?.interview2At) {
      if (!isBackfilled('second_interview')) {
        missing.push('尚未进行复试');
      }
    }
  }
  if (targetStage === 'final_pass') {
    if (!application.funnel?.interview3At) {
      if (!isBackfilled('final_interview')) {
        missing.push('尚未进行终试');
      }
    }
  }

  // Offer 阶段：检查是否已通过面试
  if (targetStage === 'offer') {
    const rounds = getInterviewRounds(jobType);
    const hasPassed = rounds >= 3
      ? application.funnel?.interview3PassAt
      : application.funnel?.interview2PassAt;
    if (!hasPassed) {
      // 3轮：需要 final_pass 通过；2轮：需要 second_pass 通过
      const neededPass = rounds >= 3 ? 'final_pass' : 'second_pass';
      if (!isBackfilled(neededPass)) {
        missing.push('尚未通过最终面试');
      }
    }
  }

  // P2-20：背景调查阶段 — 检查是否已发 Offer
  if (targetStage === 'background_check') {
    if (!application.funnel?.offerAt) {
      if (!isBackfilled('offer')) {
        missing.push('尚未发放 Offer');
      }
    }
  }

  // 入职阶段：检查是否已发 Offer 且完成背景调查
  if (targetStage === 'onboard') {
    if (!application.funnel?.offerAt) {
      if (!isBackfilled('offer')) {
        missing.push('尚未发放 Offer');
      }
    }
    if (!application.funnel?.backgroundCheckAt) {
      if (!isBackfilled('background_check')) {
        missing.push('尚未完成背景调查');
      }
    }
  }

  return {
    valid: missing.length === 0,
    ...(missing.length > 0 ? { missing } : {}),
  };
}

// ===== 漏斗时间戳映射 =====

/**
 * 阶段 key → funnel 时间戳字段名
 * @param {string} stage
 * @returns {string|null}
 */
export function stageToFunnelKey(stage) {
  const map = {
    resume: 'resumeAt',
    valid_resume: 'validAt',
    invite: 'inviteAt',
    invite_confirmed: 'inviteConfirmedAt',
    first_interview: 'interview1At',
    first_pass: 'interview1PassAt',
    second_interview: 'interview2At',
    second_pass: 'interview2PassAt',
    final_interview: 'interview3At',
    final_pass: 'interview3PassAt',
    offer: 'offerAt',
    background_check: 'backgroundCheckAt',
    onboard: 'onboardAt',
  };
  return map[stage] || null;
}

/**
 * 获取某个阶段到之前各阶段的 funnel 时间戳字段映射（用于回填）
 * @param {string} stage - 目标阶段
 * @param {string|null} jobType
 * @returns {Object} funnel 时间戳键值对
 */
export function getFunnelBackfill(stage, jobType = null) {
  const targetOrder = STAGE_ORDER_MAP[stage];
  if (targetOrder === undefined) return {};

  const stages = getStagesForJob(jobType);
  const timestamp = new Date();
  const funnel = {};

  for (const s of stages) {
    if (s.order < targetOrder) {
      const funnelKey = stageToFunnelKey(s.key);
      if (funnelKey) {
        funnel[funnelKey] = timestamp;
      }
    }
  }

  // 返回嵌套 funnel 对象而非点分隔键
  return Object.keys(funnel).length > 0 ? { funnel } : {};
}

// ===== 流转数据载荷 =====

/**
 * 构建一次流转操作的完整更新载荷
 *
 * @param {string} fromStage - 当前阶段
 * @param {string} toStage - 目标阶段
 * @param {Object} options
 * @param {string} options.note - 流转备注
 * @param {string} options.operatorId - 操作人标识
 * @param {string|null} options.jobType - 岗位类型（用于回填）
 * @param {boolean} options.isReactivation - 是否是重新激活
 * @returns {Object} CloudBase 更新数据（不含 updatedAt / _version）
 */
export function buildTransitionPayload(fromStage, toStage, options = {}) {
  const {
    note = '',
    operatorId = '',
    jobType = null,
    isReactivation = false,
  } = options;

  const now = new Date();

  // 重新激活操作
  if (isReactivation) {
    return {
      stage: toStage,
      stageEnteredAt: now,
      status: 'active',
      endedAt: null,
      endReason: '',
      endStage: '',
      reactivatedAt: now,
      reactivatedFrom: fromStage,
      history: {
        fromStage,
        toStage,
        at: now,
        note: note || '重新激活',
        operatorId,
        operator: operatorId,
      },
    };
  }

  // 结束操作
  if (isEndStage(toStage)) {
    return {
      // endApplication 负责更新 status/endReason/endStage/endedAt
      history: {
        fromStage,
        toStage,
        at: now,
        note,
        operatorId,
        operator: operatorId,
      },
    };
  }

  // 普通流转
  const payload = {
    stage: toStage,
    stageEnteredAt: now,
  };

  // 构建 funnel 对象：先复制现有漏斗数据，再叠加回填+目标阶段
  // 使用嵌套对象而非点分隔键，确保 CloudBase 正确写入所有字段
  const funnel = {};

  // 跳阶段回填：自动填写跳过的漏斗时间戳
  const skipped = getIntermediateStages(fromStage, toStage, jobType);
  for (const skippedStage of skipped) {
    const funnelKey = stageToFunnelKey(skippedStage);
    if (funnelKey) {
      funnel[funnelKey] = now;
    }
  }

  // 目标阶段的漏斗时间戳
  const targetFunnelKey = stageToFunnelKey(toStage);
  if (targetFunnelKey) {
    funnel[targetFunnelKey] = now;
  }

  // 仅当有 funnel 更新时才附加
  if (Object.keys(funnel).length > 0) {
    payload.funnel = funnel;
  }

  // 流转历史
  payload.history = {
    fromStage,
    toStage,
    at: now,
    note,
    operatorId,
    operator: operatorId,
    ...(skipped.length > 0 ? { skippedBackfill: skipped } : {}),
  };

  return payload;
}

// ===== 获取可用目标阶段 =====

/**
 * 获取从当前阶段可以流转到的目标阶段列表
 * @param {string} fromStage - 当前阶段
 * @param {string} currentStatus - 当前状态
 * @param {string|null} jobType - 岗位类型
 * @returns {Array<{ key: string, label: string, isEnd: boolean }>}
 */
export function getAvailableTargets(fromStage, currentStatus = 'active', jobType = null) {
  // 从结束状态：可重新激活
  if (currentStatus === 'rejected' || currentStatus === 'withdrawn') {
    const stages = getStagesForJob(jobType);
    return stages.map((s) => ({ key: s.key, label: s.label, isEnd: false }));
  }

  if (currentStatus !== 'active') return [];

  // 结束操作始终可用
  const targets = [];
  const endStages = [
    { key: 'rejected', label: '淘汰', isEnd: true },
    { key: 'withdrawn', label: '放弃', isEnd: true },
  ];

  // 获取当前阶段之后的活跃阶段
  const fromOrder = STAGE_ORDER_MAP[fromStage];
  if (fromOrder === undefined) {
    // 未知阶段，返回所有选项
    return [...getStagesForJob(jobType), ...endStages];
  }

  const stages = getStagesForJob(jobType);
  for (const stage of stages) {
    if (stage.order > fromOrder) {
      targets.push({ key: stage.key, label: stage.label, isEnd: false });
    }
  }

  // 结束阶段放在最后
  targets.push(...endStages);

  return targets;
}

// ===== 按阶段分组 =====

/**
 * 将申请列表按阶段分组（处理已结束的申请路由到 end zone）
 * @param {Array} applications - 申请列表
 * @param {Array} stages - 所有阶段定义
 * @returns {Object} { [stageKey]: Application[] }
 */
export function groupApplicationsByStage(applications, stages) {
  const map = {};
  for (const stage of stages) {
    map[stage.key] = [];
  }
  for (const app of applications) {
    let stage = app.stage || 'resume';
    if (app.status === 'rejected') stage = 'rejected';
    else if (app.status === 'withdrawn') stage = 'withdrawn';
    if (map[stage]) {
      map[stage].push(app);
    }
  }
  return map;
}

// ===== 导出映射表（供 UI 使用） =====

export { STAGE_ORDER_MAP, STAGE_LABEL_MAP };
