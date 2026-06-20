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
  if (params.months) parts.push(`months:${params.months}`);
  if (params.year) parts.push(`y:${params.year}`);
  if (params.month) parts.push(`m:${params.month}`);
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
 */
async function aggregateOverview() {
  const { start: monthStart, end: monthEnd } = currentMonthRange();
  const staleThreshold = daysAgo(7);

  // 并行查询
  const [activeRes, onboardRes, staleRes, pendingParseRes, jobRes, recentOnboardRes] = await Promise.all([
    // 活跃候选人（status=active，未结束）
    db.collection('Application').where({ status: 'active' }).count(),
    // 本月入职
    db.collection('Application').where({
      stage: 'onboard',
      status: 'active',
      stageEnteredAt: _.and(_.gte(monthStart), _.lte(monthEnd)),
    }).count(),
    // 待跟进（活跃且当前阶段停留 >7 天）
    db.collection('Application').where({
      status: 'active',
      stageEnteredAt: _.lte(staleThreshold),
    }).count(),
    // 待解析简历
    db.collection('ParseQueue').where({ status: 'pending' }).count(),
    // 活跃岗位数
    db.collection('Job').where({ status: 'active' }).count(),
    // 近30天入职（用于趋势）
    db.collection('Application').where({
      stage: 'onboard',
      status: 'active',
      stageEnteredAt: _.gte(daysAgo(30)),
    }).count(),
  ]);

  return {
    activeCount: activeRes?.total || 0,
    monthlyOnboardCount: onboardRes?.total || 0,
    pendingFollowCount: staleRes?.total || 0,
    pendingParseCount: pendingParseRes?.total || 0,
    activeJobCount: jobRes?.total || 0,
    recent30dOnboardCount: recentOnboardRes?.total || 0,
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

  // 获取所有活跃岗位
  const { data: jobs } = await db.collection('Job')
    .where({ status: 'active' })
    .get();

  if (!jobs || jobs.length === 0) {
    return { year: y, month: m, jobs: [], computedAt: new Date().toISOString() };
  }

  // 对每个岗位统计
  const jobResults = [];
  for (const job of jobs) {
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
        result = await aggregateOverview();
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

      default:
        return {
          success: false,
          error: `不支持的聚合类型: ${type}，支持的类型: overview, job_funnel, trend, dept_monthly`,
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
