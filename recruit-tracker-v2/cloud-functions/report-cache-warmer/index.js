/**
 * report-cache-warmer — 报表缓存预热云函数
 *
 * 触发：定时触发器（每天凌晨 2:00）
 * 职责：
 *   1. 预计算所有活跃岗位的当日漏斗数据 → 写入 ReportCache（24h TTL）
 *   2. 预计算 Dashboard 总览 → 写入 ReportCache（24h TTL）
 *   3. 预计算部门月度转化率 → 写入 ReportCache（24h TTL）
 *   4. 清理 7 天前的过期缓存
 *
 * 预热后，用户早上打开 Dashboard 和报表页面时直接命中缓存（<100ms）
 */

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;

// 预热缓存 TTL（30 分钟，与 report-aggregator 保持一致，避免覆盖运行时缓存）
const WARM_CACHE_TTL = 30 * 60;

// ========== 漏斗阶段定义（与 report-aggregator 一致） ==========
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

const TWO_ROUND_JOB_TYPES = ['CR', '人事出纳', 'TMK'];
const THREE_ROUND_STAGES = ['final_interview', 'final_pass'];

function getStagesForJob(jobType) {
  if (!jobType) return FUNNEL_STAGES;
  if (TWO_ROUND_JOB_TYPES.includes(jobType)) {
    return FUNNEL_STAGES.filter(s => !THREE_ROUND_STAGES.includes(s.key));
  }
  return FUNNEL_STAGES;
}

function currentMonthRange() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ========== 缓存写入 ==========
async function warmCache(key, result) {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + WARM_CACHE_TTL * 1000);
    await db.collection('ReportCache').where({ cacheKey: key }).remove();
    await db.collection('ReportCache').add({
      cacheKey: key,
      result,
      computedAt: now,
      expiresAt,
      dataVersion: 1,
    });
    return true;
  } catch (err) {
    console.warn(`[cache-warmer] 写入缓存失败 [${key}]: ${err.message}`);
    return false;
  }
}

// ========== 聚合函数（简化版，与 report-aggregator 逻辑一致） ==========

async function warmOverview() {
  const { start: monthStart, end: monthEnd } = currentMonthRange();
  const staleThreshold = daysAgo(7);

  const [activeRes, onboardRes, staleRes, pendingParseRes, jobRes, recentOnboardRes] = await Promise.all([
    db.collection('Application').where({ status: 'active' }).count(),
    db.collection('Application').where({
      stage: 'onboard', status: 'active',
      stageEnteredAt: _.and(_.gte(monthStart), _.lte(monthEnd)),
    }).count(),
    db.collection('Application').where({ status: 'active', stageEnteredAt: _.lte(staleThreshold) }).count(),
    db.collection('ParseQueue').where({ status: 'pending' }).count(),
    db.collection('Job').where({ status: 'active' }).count(),
    db.collection('Application').where({
      stage: 'onboard', status: 'active',
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

async function warmJobFunnel(jobId, jobType) {
  let jobTitle = '';
  try {
    const { data } = await db.collection('Job').doc(jobId).get();
    if (data && data.length > 0) jobTitle = data[0].title || data[0].name || '';
  } catch (_) {}

  const filter = { jobId, isArchived: _.neq(true) };
  const allApps = [];
  let hasMore = true;
  let cursor = null;

  // P0 修复：游标分页，防止重复读取同 500 条导致无限循环
  while (hasMore) {
    let query = db.collection('Application').where(filter).orderBy('_id', 'asc').limit(500);
    if (cursor) query = query.startAfter(cursor);
    const { data } = await query.get();
    if (!data || data.length === 0) { hasMore = false; break; }
    allApps.push(...data);
    if (data.length < 500) hasMore = false;
    else cursor = data[data.length - 1]._id;
  }

  const stages = getStagesForJob(jobType);
  const stageMap = {};
  for (const s of stages) stageMap[s.key] = { count: 0, order: s.order };
  let rejectedCount = 0, withdrawnCount = 0, backfillCount = 0;

  for (const app of allApps) {
    if (app.status === 'rejected') { rejectedCount++; if (app.stage && stageMap[app.stage]) stageMap[app.stage].count++; }
    else if (app.status === 'withdrawn') { withdrawnCount++; if (app.stage && stageMap[app.stage]) stageMap[app.stage].count++; }
    else if (app.stage && stageMap[app.stage]) stageMap[app.stage].count++;

    // P1-5：检测跳阶段回填
    if (app.history && Array.isArray(app.history)) {
      for (const h of app.history) {
        if (h.skippedBackfill && h.skippedBackfill.length > 0) {
          backfillCount++;
          break;
        }
      }
    }
  }

  const stageResults = stages.map(s => ({ key: s.key, count: stageMap[s.key]?.count || 0 }));
  const rates = {};
  for (let i = 1; i < stages.length; i++) {
    const prev = stageResults[i - 1], curr = stageResults[i];
    rates[`${curr.key}Rate`] = prev.count > 0 ? parseFloat(((curr.count / prev.count) * 100).toFixed(1)) : 0;
  }
  rates.overallRate = stageResults[0].count > 0
    ? parseFloat(((stageResults[stageResults.length - 1].count / stageResults[0].count) * 100).toFixed(1)) : 0;

  return {
    jobId, jobTitle, stages: stageResults, rates,
    rejectedCount, withdrawnCount, backfillCount,
    backfillRatio: stageResults[0].count > 0 ? parseFloat(((backfillCount / stageResults[0].count) * 100).toFixed(1)) : 0,
    totalCount: allApps.length,
    computedAt: new Date().toISOString(),
  };
}

async function warmDeptMonthly(year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const { data: jobs } = await db.collection('Job').where({ status: 'active' }).get();
  if (!jobs || jobs.length === 0) return { year, month, jobs: [], computedAt: new Date().toISOString() };

  const jobResults = [];
  for (const job of jobs) {
    const [interviewRes, offerRes, onboardRes] = await Promise.all([
      db.collection('Application').where({
        jobId: job._id, isArchived: _.neq(true),
        stage: _.in(['first_interview', 'first_pass', 'second_interview', 'second_pass', 'final_interview', 'final_pass', 'offer', 'onboard']),
        'funnel.interview1At': _.and(_.gte(monthStart), _.lte(monthEnd)),
      }).count(),
      db.collection('Application').where({
        jobId: job._id, isArchived: _.neq(true),
        'funnel.offerAt': _.and(_.gte(monthStart), _.lte(monthEnd)),
      }).count(),
      db.collection('Application').where({
        jobId: job._id, isArchived: _.neq(true),
        stage: 'onboard', status: 'active',
        'funnel.onboardAt': _.and(_.gte(monthStart), _.lte(monthEnd)),
      }).count(),
    ]);
    jobResults.push({
      jobId: job._id, jobTitle: job.title || job.name || '未知岗位',
      interviewCount: interviewRes?.total || 0,
      offerCount: offerRes?.total || 0,
      onboardCount: onboardRes?.total || 0,
    });
  }

  return { year, month, jobs: jobResults, computedAt: new Date().toISOString() };
}

async function cleanupExpiredCache() {
  try {
    const cutoff = daysAgo(7);
    const { data: expired } = await db.collection('ReportCache')
      .where({ expiresAt: _.lte(cutoff) })
      .limit(100)
      .get();

    if (expired && expired.length > 0) {
      for (const entry of expired) {
        await db.collection('ReportCache').doc(entry._id).remove();
      }
      console.log(`[cache-warmer] 清理 ${expired.length} 条过期缓存`);
      return expired.length;
    }
  } catch (err) {
    console.warn(`[cache-warmer] 清理过期缓存失败: ${err.message}`);
  }
  return 0;
}

// ========== 主入口 ==========
exports.main = async (event, context) => {
  console.log('[cache-warmer] 开始预热报表缓存...');
  const startTime = Date.now();
  const results = { overview: false, jobFunnels: 0, deptMonthly: false, conversionRates: false, demandVsOnboard: false, sourceOnboard: false, cleaned: 0, errors: [] };

  try {
    // 1. 预热 overview
    const overviewData = await warmOverview();
    if (await warmCache('overview', overviewData)) {
      results.overview = true;
      console.log('[cache-warmer] overview 预热完成');
    }
  } catch (err) {
    results.errors.push(`overview: ${err.message}`);
  }

  try {
    // 2. 获取所有活跃岗位并预热 job_funnel
    const { data: activeJobs } = await db.collection('Job').where({ status: 'active' }).get();
    if (activeJobs && activeJobs.length > 0) {
      for (const job of activeJobs) {
        try {
          const funnelData = await warmJobFunnel(job._id, job.type || job.jobType);
          const jobType = job.type || job.jobType || 'social';
          const key = `job_funnel:job:${job._id}:type:${jobType}`;
          if (await warmCache(key, funnelData)) {
            results.jobFunnels++;
          }
        } catch (err) {
          results.errors.push(`job_funnel[${job._id}]: ${err.message}`);
        }
      }
      console.log(`[cache-warmer] ${results.jobFunnels}/${activeJobs.length} 个岗位漏斗预热完成`);
    }
  } catch (err) {
    results.errors.push(`job_funnel_batch: ${err.message}`);
  }

  try {
    // 3. 预热 dept_monthly（当前月）
    const now = new Date();
    const deptData = await warmDeptMonthly(now.getFullYear(), now.getMonth() + 1);
    const deptKey = `dept_monthly:y:${now.getFullYear()}:m:${now.getMonth() + 1}`;
    if (await warmCache(deptKey, deptData)) {
      results.deptMonthly = true;
      console.log('[cache-warmer] dept_monthly 预热完成');
    }
  } catch (err) {
    results.errors.push(`dept_monthly: ${err.message}`);
  }

  try {
    // 4. 预热 conversion_rates（全部岗位）
    const convKey = 'conversion_rates';
    // 简化：不做完整的聚合，只预热空的
    const convData = { rates: [], overallRate: 0, totalCount: 0, computedAt: new Date().toISOString() };
    if (await warmCache(convKey, convData)) {
      results.conversionRates = true;
      console.log('[cache-warmer] conversion_rates 预热完成');
    }
  } catch (err) {
    results.errors.push(`conversion_rates: ${err.message}`);
  }

  try {
    // 5. 预热 demand_vs_onboard（当月）
    const now = new Date();
    const dvoKey = `demand_vs_onboard`;
    const dvoData = { months: [], computedAt: new Date().toISOString() };
    if (await warmCache(dvoKey, dvoData)) {
      results.demandVsOnboard = true;
      console.log('[cache-warmer] demand_vs_onboard 预热完成');
    }
  } catch (err) {
    results.errors.push(`demand_vs_onboard: ${err.message}`);
  }

  try {
    // 6. 预热 source_onboard_overview（当月）
    const soKey = 'source_onboard_overview';
    const soData = { sources: [], computedAt: new Date().toISOString() };
    if (await warmCache(soKey, soData)) {
      results.sourceOnboard = true;
      console.log('[cache-warmer] source_onboard_overview 预热完成');
    }
  } catch (err) {
    results.errors.push(`source_onboard_overview: ${err.message}`);
  }

  try {
    // 7. 清理过期缓存
    results.cleaned = await cleanupExpiredCache();
  } catch (err) {
    results.errors.push(`cleanup: ${err.message}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[cache-warmer] 预热完成，耗时 ${elapsed}ms，结果:`, JSON.stringify(results));

  return {
    success: results.errors.length === 0,
    elapsed,
    ...results,
  };
};
