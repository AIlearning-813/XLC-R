/**
 * report-aggregator — 报表聚合云函数
 *
 * 职责：
 *   1. 接收前端聚合查询请求（type + params）
 *   2. 先查 ReportCache 缓存（30 分钟 TTL）
 *   3. 未命中则实时聚合 Application/Job/ParseQueue 数据
 *   4. 写入 ReportCache 后返回精简结果（<10KB）
 *
 * 四种聚合维度：
 *   - overview:    Dashboard 统计卡片（活跃/入职/待跟进/待解析）
 *   - job_funnel:  单岗位 12 步漏斗（计数 + 转化率）
 *   - trend:       按月漏斗转化趋势
 *   - dept_monthly: 部门月度交叉报表
 */

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;

// ========== 漏斗阶段定义 ==========
// 所有岗位共用的基础阶段（12 步 + 2 个结束状态）
const FUNNEL_STAGES = [
  { key: 'resume', order: 0 },
  { key: 'valid_resume', order: 1 },
  { key: 'invite', order: 2 },
  { key: 'invite_confirmed', order: 3 },
  { key: 'first_interview', order: 4 },
  { key: 'first_pass', order: 5 },
  { key: 'second_interview', order: 6 },
  { key: 'second_pass', order: 7 },
  { key: 'final_interview', order: 8 },
  { key: 'final_pass', order: 9 },
  { key: 'offer', order: 10 },
  { key: 'onboard', order: 11 },
];

// 只需要 2 轮面试的岗位（无 final_interview 和 final_pass）
const TWO_ROUND_JOB_TYPES = ['CR', '人事出纳', 'TMK'];
const THREE_ROUND_STAGES = ['final_interview', 'final_pass'];

// 缓存 TTL（秒）
const CACHE_TTL = 30 * 60; // 30 分钟

// ========== 缓存工具 ==========

/**
 * 生成缓存键
 */
function cacheKey(type, params) {
  const parts = [type];
  if (params.jobId) parts.push(`job:${params.jobId}`);
  // P0 修复：jobType 不同的缓存键必须不同（如 CR 2轮 vs default 3轮）
  if (params.jobType) parts.push(`type:${params.jobType}`);
  if (params.months) parts.push(`months:${params.months}`);
  if (params.year) parts.push(`y:${params.year}`);
  if (params.month) parts.push(`m:${params.month}`);
  // Phase A4: 时间范围参数
  if (params.startDate) parts.push(`start:${params.startDate}`);
  if (params.endDate) parts.push(`end:${params.endDate}`);
  if (params.department) parts.push(`dept:${params.department}`);
  if (params.ownerId) parts.push(`owner:${params.ownerId}`);
  return parts.join(':');
}

/**
 * 读取缓存
 */
async function readCache(key) {
  try {
    const { data } = await db.collection('ReportCache')
      .where({ cacheKey: key, expiresAt: _.gte(new Date()) })
      .orderBy('computedAt', 'desc')
      .limit(1)
      .get();
    if (data && data.length > 0) {
      return data[0].result;
    }
  } catch (err) {
    console.warn(`[report-aggregator] 读取缓存失败: ${err.message}`);
  }
  return null;
}

/**
 * 写入缓存
 */
async function writeCache(key, result) {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL * 1000);
    // 先删旧缓存再写新缓存（upsert）
    await db.collection('ReportCache').where({ cacheKey: key }).remove();
    await db.collection('ReportCache').add({
      cacheKey: key,
      result,
      computedAt: now,
      expiresAt,
      dataVersion: 1,
    });
  } catch (err) {
    console.warn(`[report-aggregator] 写入缓存失败: ${err.message}`);
  }
}

// ========== 辅助函数 ==========

/**
 * 获取某岗位适用的漏斗阶段列表
 */
function getStagesForJob(jobType) {
  if (!jobType) return FUNNEL_STAGES;
  if (TWO_ROUND_JOB_TYPES.includes(jobType)) {
    return FUNNEL_STAGES.filter(s => !THREE_ROUND_STAGES.includes(s.key));
  }
  return FUNNEL_STAGES;
}

/**
 * 本月起止时间
 */
function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * N 天前的日期
 */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ============ 聚合函数 ============

/**
 * 1. overview — Dashboard 统计卡片数据
 * @param {Object} params - { startDate?, endDate?, ownerId? }
 *   - 不传时间范围默认本月
 */
async function aggregateOverview(params = {}) {
  const rangeStart = params.startDate ? new Date(params.startDate) : currentMonthRange().start;
  const rangeEnd = params.endDate ? new Date(params.endDate) : currentMonthRange().end;
  const staleThreshold = daysAgo(7);

  // ownerId 过滤
  const ownerFilter = params.ownerId ? { ownerId: params.ownerId } : {};

  // 并行查询
  const [activeRes, onboardRes, staleRes, pendingParseRes, jobRes, recentOnboardRes] = await Promise.all([
    // 活跃候选人（status=active，未结束），按 ownerId 过滤
    db.collection('Application').where({ status: 'active', ...ownerFilter }).count(),
    // 周期内入职
    db.collection('Application').where({
      ...ownerFilter,
      stage: 'onboard',
      status: 'active',
      stageEnteredAt: _.and(_.gte(rangeStart), _.lte(rangeEnd)),
    }).count(),
    // 待跟进（活跃且当前阶段停留 >7 天）
    db.collection('Application').where({
      ...ownerFilter,
      status: 'active',
      stageEnteredAt: _.lte(staleThreshold),
    }).count(),
    // 待解析简历
    db.collection('ParseQueue').where({ status: 'pending' }).count(),
    // 活跃岗位数
    db.collection('Job').where({ status: 'active' }).count(),
    // 周期内入职（用于展示，同上）
    db.collection('Application').where({
      ...ownerFilter,
      stage: 'onboard',
      status: 'active',
      stageEnteredAt: _.gte(rangeStart),
    }).count(),
  ]);

  return {
    activeCount: activeRes?.total || 0,
    monthlyOnboardCount: onboardRes?.total || 0,
    pendingFollowCount: staleRes?.total || 0,
    pendingParseCount: pendingParseRes?.total || 0,
    activeJobCount: jobRes?.total || 0,
    recent30dOnboardCount: recentOnboardRes?.total || 0,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    computedAt: new Date().toISOString(),
  };
}

/**
 * 2. job_funnel — 单岗位漏斗
 */
async function aggregateJobFunnel(jobId, jobType) {
  // 获取岗位信息
  let jobTitle = '';
  if (jobId) {
    try {
      const { data } = await db.collection('Job').doc(jobId).get();
      if (data && data.length > 0) {
        jobTitle = data[0].title || data[0].name || '';
      }
    } catch (_) { /* 忽略 */ }
  }

  // 查询该岗位所有未归档申请（游标分页，处理 >500 条数据）
  const baseFilter = { isArchived: _.neq(true) };
  if (jobId) baseFilter.jobId = jobId;

  const allApps = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    let query = db.collection('Application').orderBy('_id', 'asc').limit(500);
    // 组合过滤条件：基础过滤 + 游标分页
    const combinedFilter = { ...baseFilter };
    if (cursor) {
      combinedFilter._id = _.gt(cursor);
    }
    query = query.where(combinedFilter);

    const { data } = await query.get();
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allApps.push(...data);
      if (data.length < 500) hasMore = false;
      else cursor = data[data.length - 1]._id;
    }
  }

  // 按阶段分组
  const stages = getStagesForJob(jobType);
  const stageMap = {};
  for (const s of stages) {
    stageMap[s.key] = { count: 0, order: s.order };
  }
  let rejectedCount = 0;
  let withdrawnCount = 0;
  let backfillCount = 0;

  for (const app of allApps) {
    if (app.status === 'rejected') {
      rejectedCount++;
      // 仍然记录到对应阶段
      if (app.stage && stageMap[app.stage]) {
        stageMap[app.stage].count++;
      }
    } else if (app.status === 'withdrawn') {
      withdrawnCount++;
      if (app.stage && stageMap[app.stage]) {
        stageMap[app.stage].count++;
      }
    } else if (app.stage && stageMap[app.stage]) {
      stageMap[app.stage].count++;
    }
  }

  // P1-5：检测跳阶段回填（从 history 中识别 skippedBackfill）
  for (const app of allApps) {
    if (app.history && Array.isArray(app.history)) {
      for (const h of app.history) {
        if (h.skippedBackfill && h.skippedBackfill.length > 0) {
          backfillCount++;
          break;
        }
      }
    }
  }

  // 计算转化率
  const stageResults = stages.map(s => ({
    key: s.key,
    count: stageMap[s.key]?.count || 0,
  }));

  // 计算相邻阶段的转化率
  const rates = {};
  for (let i = 1; i < stages.length; i++) {
    const prev = stageResults[i - 1];
    const curr = stageResults[i];
    const prevKey = prev.key;
    const currKey = curr.key;
    if (prev.count > 0) {
      rates[`${currKey}Rate`] = parseFloat(((curr.count / prev.count) * 100).toFixed(1));
    } else {
      rates[`${currKey}Rate`] = 0;
    }
  }

  // 整体转化率
  const firstStage = stageResults[0];
  const lastStage = stageResults[stageResults.length - 1];
  rates.overallRate = firstStage.count > 0
    ? parseFloat(((lastStage.count / firstStage.count) * 100).toFixed(1))
    : 0;

  // 回填比例
  const backfillRatio = firstStage.count > 0
    ? parseFloat(((backfillCount / firstStage.count) * 100).toFixed(1))
    : 0;

  return {
    jobId: jobId || 'all',
    jobTitle,
    stages: stageResults,
    rates,
    rejectedCount,
    withdrawnCount,
    backfillCount,
    backfillRatio,
    totalCount: allApps.length,
    computedAt: new Date().toISOString(),
  };
}

/**
 * 3. trend — 按月漏斗转化趋势
 */
async function aggregateTrend(months, jobId) {
  const numMonths = months || 12;

  // 生成月份列表
  const monthKeys = [];
  const now = new Date();
  for (let i = numMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      start: new Date(d.getFullYear(), d.getMonth(), 1),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
    });
  }

  // 查询所有未归档申请（游标分页）
  const baseFilter = { isArchived: _.neq(true) };
  if (jobId) baseFilter.jobId = jobId;

  const allApps = [];
  let hasMore = true;
  let cursor = null;

  while (hasMore) {
    let query = db.collection('Application').orderBy('_id', 'asc').limit(500);
    const combinedFilter = { ...baseFilter };
    if (cursor) {
      combinedFilter._id = _.gt(cursor);
    }
    query = query.where(combinedFilter);

    const { data } = await query.get();
    if (!data || data.length === 0 || data.length < 500) {
      hasMore = false;
    }
    if (data && data.length > 0) {
      allApps.push(...data);
      cursor = data[data.length - 1]._id;
    }
  }

  // 按月聚合
  const trendData = monthKeys.map(mk => {
    const monthApps = allApps.filter(app => {
      const created = new Date(app.createdAt || app._createTime);
      return created >= mk.start && created <= mk.end;
    });

    const stageCount = {};
    let monthOnboard = 0;
    let monthRejected = 0;

    for (const app of monthApps) {
      if (app.stage) {
        stageCount[app.stage] = (stageCount[app.stage] || 0) + 1;
      }
      if (app.stage === 'onboard' && app.status === 'active') monthOnboard++;
      if (app.status === 'rejected') monthRejected++;
    }

    return {
      month: mk.key,
      total: monthApps.length,
      onboard: monthOnboard,
      rejected: monthRejected,
      resumeCount: stageCount.resume || 0,
      interviewCount: (stageCount.first_interview || 0) + (stageCount.first_pass || 0)
        + (stageCount.second_interview || 0) + (stageCount.second_pass || 0)
        + (stageCount.final_interview || 0) + (stageCount.final_pass || 0),
      offerCount: stageCount.offer || 0,
      onboardCount: stageCount.onboard || 0,
    };
  });

  return {
    jobId: jobId || 'all',
    months: numMonths,
    data: trendData,
    computedAt: new Date().toISOString(),
  };
}

/**
 * 4. dept_monthly — 部门月度交叉报表
 */
async function aggregateDeptMonthly(year, month) {
  const y = year || new Date().getFullYear();
  const m = month !== undefined ? month : new Date().getMonth() + 1;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);

  // 获取所有活跃岗位（游标分页，防止 >500 岗位时截断）
  const allJobs = [];
  let jobCursor = null;
  let hasMoreJobs = true;
  while (hasMoreJobs) {
    let query = db.collection('Job').where({ status: 'active' }).limit(500);
    if (jobCursor) query = query.where({ _id: _.gt(jobCursor) });
    const { data } = await query.get();
    if (!data || data.length === 0 || data.length < 500) hasMoreJobs = false;
    if (data) { allJobs.push(...data); jobCursor = data[data.length - 1]._id; }
  }

  if (allJobs.length === 0) {
    return { year: y, month: m, jobs: [], computedAt: new Date().toISOString() };
  }

  // P1-6：N+1 查询（每个岗位 4 个 count），在 <50 岗位时性能可接受。
  // 优化方向：一次查询所有 Application 后内存分组。
  const jobResults = [];
  for (const job of allJobs) {
    const [interviewRes, offerRes, onboardRes, rejectedRes] = await Promise.all([
      // 进入面试阶段的（本月）
      db.collection('Application').where({
        jobId: job._id,
        isArchived: _.neq(true),
        stage: _.in(['first_interview', 'first_pass', 'second_interview', 'second_pass', 'final_interview', 'final_pass', 'offer', 'onboard']),
        'funnel.interview1At': _.and(_.gte(monthStart), _.lte(monthEnd)),
      }).count(),
      // Offer 发出的（本月）
      db.collection('Application').where({
        jobId: job._id,
        isArchived: _.neq(true),
        'funnel.offerAt': _.and(_.gte(monthStart), _.lte(monthEnd)),
      }).count(),
      // 入职的（本月）
      db.collection('Application').where({
        jobId: job._id,
        isArchived: _.neq(true),
        stage: 'onboard',
        status: 'active',
        'funnel.onboardAt': _.and(_.gte(monthStart), _.lte(monthEnd)),
      }).count(),
      // 淘汰的（本月）
      db.collection('Application').where({
        jobId: job._id,
        isArchived: _.neq(true),
        status: 'rejected',
        updatedAt: _.and(_.gte(monthStart), _.lte(monthEnd)),
      }).count(),
    ]);

    jobResults.push({
      jobId: job._id,
      jobTitle: job.title || job.name || '未知岗位',
      interviewCount: interviewRes?.total || 0,
      offerCount: offerRes?.total || 0,
      onboardCount: onboardRes?.total || 0,
      rejectedCount: rejectedRes?.total || 0,
    });
  }

  return {
    year: y,
    month: m,
    jobs: jobResults,
    computedAt: new Date().toISOString(),
  };
}

// ========== 主入口 ==========

// ===== Phase 6: 招聘需求指标 =====

async function aggregateDemandMetrics(params = {}) {
  const filter = {};
  if (params.ownerId) filter.ownerId = params.ownerId;

  const [totalRes, pendingRes, recruitingRes, completedRes] = await Promise.all([
    db.collection('RecruitmentDemand').where({ ...filter, status: _.neq('deleted') }).count(),
    db.collection('RecruitmentDemand').where({ ...filter, status: 'pending' }).count(),
    db.collection('RecruitmentDemand').where({ ...filter, status: 'recruiting' }).count(),
    db.collection('RecruitmentDemand').where({ ...filter, status: 'completed' }).count(),
  ]);

  // 平均审批周期（从 submittedAt 到审批通过的时间）
  let avgApprovalHours = 0;
  try {
    const { data: completed } = await db.collection('RecruitmentDemand')
      .where({ ...filter, status: _.in(['recruiting', 'completed', 'closed']) })
      .field({ submittedAt: true, updatedAt: true }).limit(100).get();
    if (completed?.length) {
      const totalMs = completed.reduce((s, d) => s + (new Date(d.updatedAt) - new Date(d.submittedAt)), 0);
      avgApprovalHours = Math.round(totalMs / completed.length / 3600000);
    }
  } catch (_) {}

  return {
    totalDemands: totalRes?.total || 0,
    pendingDemands: pendingRes?.total || 0,
    recruitingDemands: recruitingRes?.total || 0,
    completedDemands: completedRes?.total || 0,
    avgApprovalHours,
    computedAt: new Date().toISOString(),
  };
}

// ===== Phase 6: 招聘专员效能 =====

async function aggregateRecruiterEfficiency(params = {}) {
  const { ownerId } = params;

  // 获取所有招聘专员
  let users = [];
  try {
    const { data } = await db.collection('Users').where({ role: 'recruiter' }).field({ username: true, name: true }).get();
    users = data || [];
  } catch (_) { users = []; }

  if (ownerId) users = users.filter(u => u.username === ownerId);

  const results = [];
  for (const user of users) {
    const uFilter = { ownerId: user.username, isArchived: _.neq(true) };

    const [resumeRes, interviewRes, offerRes, onboardRes, activeJobRes] = await Promise.all([
      db.collection('Application').where({ ...uFilter, stage: 'resume' }).count(),
      db.collection('Application').where({ ...uFilter, stage: _.in(['first_interview', 'second_interview', 'final_interview']) }).count(),
      db.collection('Application').where({ ...uFilter, stage: 'offer' }).count(),
      db.collection('Application').where({ ...uFilter, stage: 'onboard', status: 'active' }).count(),
      db.collection('Job').where({ ownerId: user.username, status: 'active' }).count(),
    ]);

    results.push({
      ownerId: user.username,
      name: user.name || user.username,
      resumeProcessed: resumeRes?.total || 0,
      interviews: interviewRes?.total || 0,
      offers: offerRes?.total || 0,
      onboarded: onboardRes?.total || 0,
      activeJobs: activeJobRes?.total || 0,
    });
  }

  return { recruiters: results, computedAt: new Date().toISOString() };
}

// ===== Phase A4: 转化率面板 =====

async function aggregateConversionRates(params = {}) {
  const filter = { isArchived: _.neq(true) };
  if (params.jobId) filter.jobId = params.jobId;
  if (params.ownerId) filter.ownerId = params.ownerId;

  if (params.startDate || params.endDate) {
    const createdFilters = [];
    if (params.startDate) createdFilters.push(_.gte(new Date(params.startDate)));
    if (params.endDate) createdFilters.push(_.lte(new Date(params.endDate)));
    filter.createdAt = createdFilters.length === 1 ? createdFilters[0] : _.and(...createdFilters);
  }

  const allApps = [];
  let hasMore = true, cursor = null;
  while (hasMore) {
    let query = db.collection('Application').where(filter).orderBy('_id', 'asc').limit(500);
    if (cursor) query = query.where({ _id: _.gt(cursor) });
    const { data } = await query.get();
    if (!data || data.length === 0) { hasMore = false; break; }
    allApps.push(...data);
    if (data.length < 500) hasMore = false; else cursor = data[data.length - 1]._id;
  }

  const stageMap = {};
  for (const app of allApps) {
    if (app.status === 'active' && app.stage) {
      stageMap[app.stage] = (stageMap[app.stage] || 0) + 1;
    }
  }

  const ratePairs = [
    { label: '有效简历率', numerator: 'valid_resume', denominator: 'resume' },
    { label: '初试通过率', numerator: 'first_pass', denominator: 'first_interview' },
    { label: '复试通过率', numerator: 'second_pass', denominator: 'second_interview' },
    { label: '终试通过率', numerator: 'final_pass', denominator: 'final_interview' },
    { label: 'Offer率', numerator: 'offer', denominator: 'final_pass' },
    { label: '入职率', numerator: 'onboard', denominator: 'offer' },
  ];

  const rates = ratePairs.map(r => ({
    label: r.label,
    numerator: stageMap[r.numerator] || 0,
    denominator: stageMap[r.denominator] || 0,
    rate: stageMap[r.denominator] > 0
      ? parseFloat(((stageMap[r.numerator] / stageMap[r.denominator]) * 100).toFixed(1))
      : 0,
  }));

  const overallRate = (stageMap.resume || 0) > 0
    ? parseFloat((((stageMap.onboard || 0) / stageMap.resume) * 100).toFixed(1))
    : 0;

  return { rates, overallRate, totalCount: allApps.length, computedAt: new Date().toISOString() };
}

// ===== Phase A4: 部门入职概览（支持筛选） =====

async function aggregateDeptOnboardOverview(params = {}) {
  const y = params.year || new Date().getFullYear();
  const m = params.month || (new Date().getMonth() + 1);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);

  const deptFilter = params.department ? { status: 'active', department: params.department } : { status: 'active' };
  const { data: jobs } = await db.collection('Job').where(deptFilter).get();
  if (!jobs || jobs.length === 0) {
    return { year: y, month: m, departments: [], data: [], computedAt: new Date().toISOString() };
  }

  const jobIds = jobs.map(j => j._id);
  const { data: apps } = await db.collection('Application')
    .where({
      jobId: _.in(jobIds),
      stage: 'onboard',
      status: 'active',
      stageEnteredAt: _.and(_.gte(monthStart), _.lte(monthEnd)),
      isArchived: _.neq(true),
    })
    .field({ jobId: true })
    .get();

  const deptMap = {};
  for (const job of jobs) {
    const dept = job.department || '未分配';
    if (!deptMap[dept]) deptMap[dept] = { department: dept, jobCount: 0, onboardCount: 0 };
    deptMap[dept].jobCount++;
  }

  for (const app of (apps || [])) {
    const job = jobs.find(j => j._id === app.jobId);
    const dept = job?.department || '未分配';
    if (deptMap[dept]) deptMap[dept].onboardCount++;
  }

  const data = Object.values(deptMap).sort((a, b) => b.onboardCount - a.onboardCount);
  const departments = data.map(d => d.department);

  return { year: y, month: m, departments, data, computedAt: new Date().toISOString() };
}

// ===== Phase A4: 渠道入职看板 =====

async function aggregateSourceOnboard(params = {}) {
  const rangeStart = params.startDate ? new Date(params.startDate) : daysAgo(90);
  const rangeEnd = params.endDate ? new Date(params.endDate) : new Date();

  const onboardFilter = {
    stage: 'onboard',
    status: 'active',
    stageEnteredAt: _.and(_.gte(rangeStart), _.lte(rangeEnd)),
    isArchived: _.neq(true),
  };
  if (params.ownerId) onboardFilter.ownerId = params.ownerId;

  // 1. 查询入职的 Application（只需要 candidateId 字段）
  const allOnboardApps = [];
  let hasMore = true, cursor = null;
  while (hasMore) {
    let query = db.collection('Application')
      .where(onboardFilter)
      .field({ candidateId: true })
      .orderBy('_id', 'asc').limit(500);
    if (cursor) query = query.where({ _id: _.gt(cursor) });
    const { data } = await query.get();
    if (!data || data.length === 0) { hasMore = false; break; }
    allOnboardApps.push(...data);
    if (data.length < 500) hasMore = false; else cursor = data[data.length - 1]._id;
  }

  // 2. 批量查询 Candidate 获取 recruitmentSource（招聘渠道）
  const candidateIds = [...new Set(allOnboardApps.map(a => a.candidateId).filter(Boolean))];
  const candidateSourceMap = {}; // candidateId → recruitmentSource
  if (candidateIds.length > 0) {
    // 分批查询（CloudBase in 操作符最多支持 100 个值）
    for (let i = 0; i < candidateIds.length; i += 100) {
      const batch = candidateIds.slice(i, i + 100);
      const { data: candidates } = await db.collection('Candidate')
        .where({ _id: _.in(batch) })
        .field({ recruitmentSource: true })
        .get();
      for (const c of (candidates || [])) {
        candidateSourceMap[c._id] = c.recruitmentSource || '未标注';
      }
    }
  }

  // 3. 按 recruitmentSource 统计入职数
  const sourceMap = {};
  for (const app of allOnboardApps) {
    const src = candidateSourceMap[app.candidateId] || '未标注';
    if (!sourceMap[src]) sourceMap[src] = { source: src, onboardCount: 0, totalCount: 0 };
    sourceMap[src].onboardCount++;
  }

  // 4. 查询全部 Application 总数（按候选人的 recruitmentSource 分组）
  //    先获取所有 candidateId，再批量查询 Candidate
  const totalFilter = { isArchived: _.neq(true) };
  if (params.ownerId) totalFilter.ownerId = params.ownerId;

  const allTotalApps = [];
  let hasMore2 = true, cursor2 = null;
  while (hasMore2) {
    let query = db.collection('Application')
      .where(totalFilter)
      .field({ candidateId: true })
      .orderBy('_id', 'asc').limit(500);
    if (cursor2) query = query.where({ _id: _.gt(cursor2) });
    const { data } = await query.get();
    if (!data || data.length === 0) { hasMore2 = false; break; }
    allTotalApps.push(...data);
    if (data.length < 500) hasMore2 = false; else cursor2 = data[data.length - 1]._id;
  }

  // 补充查询尚未查到的 Candidate
  const allCandidateIds = [...new Set(allTotalApps.map(a => a.candidateId).filter(Boolean))];
  const missingIds = allCandidateIds.filter(id => !(id in candidateSourceMap));
  if (missingIds.length > 0) {
    for (let i = 0; i < missingIds.length; i += 100) {
      const batch = missingIds.slice(i, i + 100);
      const { data: candidates } = await db.collection('Candidate')
        .where({ _id: _.in(batch) })
        .field({ recruitmentSource: true })
        .get();
      for (const c of (candidates || [])) {
        candidateSourceMap[c._id] = c.recruitmentSource || '未标注';
      }
    }
  }

  for (const app of allTotalApps) {
    const src = candidateSourceMap[app.candidateId] || '未标注';
    if (!sourceMap[src]) sourceMap[src] = { source: src, onboardCount: 0, totalCount: 0 };
    sourceMap[src].totalCount++;
  }

  const sources = Object.values(sourceMap).map(s => ({
    ...s,
    rate: s.totalCount > 0 ? parseFloat(((s.onboardCount / s.totalCount) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.onboardCount - a.onboardCount);

  return { sources, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(), computedAt: new Date().toISOString() };
}

// ===== Phase A4: 月度需求 vs 入职 =====

async function aggregateDemandVsOnboard(params = {}) {
  const numMonths = params.months || 12;

  const monthKeys = [];
  const now = new Date();
  for (let i = numMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      start: new Date(d.getFullYear(), d.getMonth(), 1),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
    });
  }

  const demandFilter = { status: _.neq('deleted') };
  if (params.ownerId) demandFilter.ownerId = params.ownerId;
  const { data: demands } = await db.collection('RecruitmentDemand').where(demandFilter).get();

  const onboardFilter = { stage: 'onboard', status: 'active', isArchived: _.neq(true) };
  if (params.ownerId) onboardFilter.ownerId = params.ownerId;
  const { data: onboardApps } = await db.collection('Application')
    .field({ stageEnteredAt: true })
    .where(onboardFilter).get();

  const months = monthKeys.map(mk => {
    const monthDemands = (demands || []).filter(d => {
      const s = new Date(d.submittedAt || d.createdAt);
      return s >= mk.start && s <= mk.end;
    });
    const demandCount = monthDemands.length;
    const headcount = monthDemands.reduce((s, d) => s + (d.headcount || 0), 0);

    const monthOnboards = (onboardApps || []).filter(a => {
      const d = new Date(a.stageEnteredAt);
      return d >= mk.start && d <= mk.end;
    });
    const onboarded = monthOnboards.length;
    const achievementRate = headcount > 0 ? parseFloat(((onboarded / headcount) * 100).toFixed(1)) : 0;

    return { month: mk.key, demandCount, headcount, onboarded, achievementRate };
  });

  return { months, computedAt: new Date().toISOString() };
}

// ===== Phase A4: 需求跟踪看板 =====

async function aggregateDemandTracking(params = {}) {
  const filter = { status: 'recruiting' };
  if (params.ownerId) filter.ownerId = params.ownerId;

  const { data: demands } = await db.collection('RecruitmentDemand')
    .where(filter).orderBy('submittedAt', 'desc').limit(100).get();
  if (!demands || demands.length === 0) {
    return { demands: [], alerts: { overdueCount: 0, nearDeadlineCount: 0, highGapCount: 0 }, computedAt: new Date().toISOString() };
  }

  const jobIds = [...new Set(demands.map(d => d.linkedJobId).filter(Boolean))];
  const jobsMap = {};
  if (jobIds.length > 0) {
    const { data: jobs } = await db.collection('Job').where({ _id: _.in(jobIds) }).get();
    for (const j of (jobs || [])) jobsMap[j._id] = j;
  }

  const appStats = {};
  if (jobIds.length > 0) {
    const { data: apps } = await db.collection('Application')
      .where({ jobId: _.in(jobIds), isArchived: _.neq(true) })
      .field({ jobId: true, stage: true, status: true })
      .get();
    for (const a of (apps || [])) {
      if (!appStats[a.jobId]) appStats[a.jobId] = { total: 0, onboard: 0 };
      appStats[a.jobId].total++;
      if (a.stage === 'onboard' && a.status === 'active') appStats[a.jobId].onboard++;
    }
  }

  const nowDate = new Date();
  const demandResults = demands.map(d => {
    const job = jobsMap[d.linkedJobId];
    const stats = appStats[d.linkedJobId] || { total: 0, onboard: 0 };
    const headcount = d.headcount || 1;
    const onboarded = stats.onboard;
    const gap = Math.max(0, headcount - onboarded);
    const completionRate = headcount > 0 ? Math.round(onboarded / headcount * 100) : 0;

    let deadline = null;
    let remainingDays = null;
    if (d.recruitmentCycle && d.submittedAt) {
      const submittedDate = new Date(d.submittedAt);
      const cycleDays = parseInt(d.recruitmentCycle) || 30;
      deadline = new Date(submittedDate.getTime() + cycleDays * 86400000);
      remainingDays = Math.ceil((deadline.getTime() - nowDate.getTime()) / 86400000);
    }

    return {
      id: d._id,
      title: d.title || '未命名需求',
      department: d.department?.displayName || d.department?.level1 || '',
      headcount,
      onboarded,
      gap,
      completionRate,
      deadline: deadline ? deadline.toISOString() : null,
      remainingDays,
      isOverdue: remainingDays !== null && remainingDays < 0,
      isNearDeadline: remainingDays !== null && remainingDays >= 0 && remainingDays <= 7,
      jobTitle: job?.title || '',
      appCount: stats.total,
      status: d.status,
    };
  });

  const alerts = {
    overdueCount: demandResults.filter(d => d.isOverdue).length,
    nearDeadlineCount: demandResults.filter(d => d.isNearDeadline).length,
    highGapCount: demandResults.filter(d => d.completionRate < 30 && !d.isOverdue).length,
  };

  return { demands: demandResults, alerts, computedAt: new Date().toISOString() };
}

exports.main = async (event, context) => {
  const { type, params = {} } = event;

  console.log(`[report-aggregator] 请求类型: ${type}, 参数:`, JSON.stringify(params));

  try {
    let result;
    const ck = cacheKey(type, params);

    // 尝试读缓存
    const cached = await readCache(ck);
    if (cached) {
      console.log(`[report-aggregator] 缓存命中: ${ck}`);
      return { success: true, data: cached, fromCache: true };
    }

    // 根据类型执行聚合
    switch (type) {
      case 'overview':
        result = await aggregateOverview(params);
        break;

      case 'job_funnel':
        result = await aggregateJobFunnel(params.jobId, params.jobType);
        break;

      case 'trend':
        result = await aggregateTrend(params.months, params.jobId);
        break;

      case 'dept_monthly':
        result = await aggregateDeptMonthly(params.year, params.month);
        break;

      case 'demand_metrics':
        result = await aggregateDemandMetrics(params);
        break;

      case 'recruiter_efficiency':
        result = await aggregateRecruiterEfficiency(params);
        break;

      case 'conversion_rates':
        result = await aggregateConversionRates(params);
        break;

      case 'dept_onboard_overview':
        result = await aggregateDeptOnboardOverview(params);
        break;

      case 'source_onboard_overview':
        result = await aggregateSourceOnboard(params);
        break;

      case 'demand_vs_onboard':
        result = await aggregateDemandVsOnboard(params);
        break;

      case 'demand_tracking':
        result = await aggregateDemandTracking(params);
        break;

      default:
        return {
          success: false,
          error: `不支持的聚合类型: ${type}，支持的类型: overview, job_funnel, trend, dept_monthly, demand_metrics, recruiter_efficiency, conversion_rates, dept_onboard_overview, source_onboard_overview, demand_vs_onboard, demand_tracking`,
        };
    }

    // 写入缓存
    await writeCache(ck, result);

    console.log(`[report-aggregator] 聚合完成: ${type}, 耗时: ${Date.now() - context?.startTime || '未知'}ms`);
    return { success: true, data: result, fromCache: false };

  } catch (err) {
    console.error(`[report-aggregator] 异常:`, err);
    return {
      success: false,
      error: `聚合查询失败: ${err.message}`,
    };
  }
};
