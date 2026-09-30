/**
 * funnel-report.js — 报表查询服务层
 *
 * 所有报表数据查询的统一入口，封装云函数调用。
 * 前端组件只调这里，不直接查数据库，也不直接调云函数。
 *
 * 数据流：Vue 组件 → funnel-report.js → report-aggregator 云函数 → ReportCache/Application
 */

import cloudbase from './cloudbase';
import { ownerFilter } from './data-filter';
import { fetchWithFallback } from './offline-cache';
import { handleError } from './error-handler';

const FUNCTION_NAME = 'report-aggregator';

/**
 * 调用聚合云函数
 * @param {string} type - 聚合类型：overview | job_funnel | trend | dept_monthly
 * @param {object} params - 查询参数
 * @returns {Promise<object>} 聚合结果
 */
async function callAggregator(type, params = {}) {
  try {
    const result = await cloudbase.callFunction(FUNCTION_NAME, { type, params });
    // cloudbase.callFunction 已内部解包 res.result，直接返回云函数返回值
    if (!result || !result.success) {
      console.warn(`[funnel-report] ${type} 查询失败:`, result?.error);
      return null;
    }
    return result.data;
  } catch (err) {
    handleError(err, { context: `报表-${type}`, silent: true });
    return null;
  }
}

/**
 * 获取 Dashboard 概览数据（P0-4：带离线兜底）
 * 返回：活跃候选人、本月入职、待跟进、待解析、活跃岗位数、近30天入职
 *
 * CloudBase 不可用时 → 返回上次成功的缓存数据（不超过 24 小时）
 */
export async function getDashboardOverview(params = {}) {
  const of = ownerFilter();
  const cacheParams = { ...params, ...(of ? { ownerId: of.ownerId } : {}) };

  return fetchWithFallback(
    'dashboard_overview',
    () => callAggregator('overview', cacheParams),
    {
      ttlMs: 30 * 60 * 1000,      // 缓存 30 分钟
      maxAgeMs: 24 * 60 * 60 * 1000, // 离线时最多用 24 小时前的缓存
      onCacheHit: (cached) => {
        console.log('[funnel-report] ⚠️ 使用离线缓存的 Dashboard 数据');
      },
    }
  );
}

/**
 * 获取单岗位漏斗数据
 * @param {string} jobId - 岗位 ID（不传则查全部岗位聚合）
 * @param {string} jobType - 岗位类型（用于确定面试轮数）
 * @returns {Promise<object>} { stages, rates, rejectedCount, withdrawnCount, ... }
 */
export async function getJobFunnel(jobId, jobType) {
  const of = ownerFilter();
  return callAggregator('job_funnel', { jobId, jobType, ...(of ? { ownerId: of.ownerId } : {}) });
}

/**
 * 获取按月漏斗转化趋势
 * @param {number} months - 往回查的月数（默认 12）
 * @param {string} jobId - 岗位 ID（可选，不传查全部）
 * @returns {Promise<object>} { data: [{ month, total, onboard, ... }] }
 */
export async function getTrend(months = 12, jobId) {
  const of = ownerFilter();
  return callAggregator('trend', { months, jobId, ...(of ? { ownerId: of.ownerId } : {}) });
}

/**
 * 获取部门月度交叉报表
 * @param {number} year - 年份
 * @param {number} month - 月份（1-12）
 * @returns {Promise<object>} { jobs: [{ jobId, jobTitle, interviewCount, offerCount, onboardCount }] }
 */
export async function getDeptMonthly(year, month) {
  const of = ownerFilter();
  return callAggregator('dept_monthly', { year, month, ...(of ? { ownerId: of.ownerId } : {}) });
}

// ===== Phase 6: 招聘需求指标 + 专员效能 =====

export async function getDemandMetrics(filters = {}) {
  const of = ownerFilter();
  return callAggregator('demand_metrics', { ...filters, ...(of ? { ownerId: of.ownerId } : {}) });
}

export async function getRecruiterEfficiency(filters = {}) {
  const of = ownerFilter();
  return callAggregator('recruiter_efficiency', { ...filters, ...(of ? { ownerId: of.ownerId } : {}) });
}

/** 给现有函数增加 filters 支持 */
export async function getOverviewWithFilters(filters = {}) {
  return callAggregator('overview', filters);
}

/** 获取转化率面板数据 */
export async function getConversionRates(jobId, params = {}) {
  const of = ownerFilter();
  return callAggregator('conversion_rates', { jobId, ...params, ...(of ? { ownerId: of.ownerId } : {}) });
}

/** 获取部门入职概览（支持筛选） */
export async function getDeptOnboardOverview(params = {}) {
  const of = ownerFilter();
  return callAggregator('dept_onboard_overview', { ...params, ...(of ? { ownerId: of.ownerId } : {}) });
}

/** 获取渠道入职看板数据 */
export async function getSourceOnboardStats(params = {}) {
  const of = ownerFilter();
  return callAggregator('source_onboard_overview', { ...params, ...(of ? { ownerId: of.ownerId } : {}) });
}

/** 获取月度需求 vs 入职达成率 */
export async function getDemandVsOnboard(params = {}) {
  const of = ownerFilter();
  return callAggregator('demand_vs_onboard', { ...params, ...(of ? { ownerId: of.ownerId } : {}) });
}

/**
 * 🆕 获取系统状态（数据库连接 + 邮箱配置）
 * 替代 DashboardPage 中的直接 DB 查询
 */
export async function getSystemStatus() {
  const db = cloudbase.db();
  if (!db) return { dbStatus: 'error', emailConfigCount: 0 };

  const result = { dbStatus: 'ok', emailConfigCount: 0, lastScanTime: null };

  try {
    await db.collection('Job').where({ status: 'active' }).count();
  } catch {
    result.dbStatus = 'error';
  }

  try {
    const { data } = await db.collection('EmailConfig').where({ enabled: true }).get();
    result.emailConfigCount = data?.length || 0;
    if (data && data.length > 0) {
      const lastScans = data.map(d => d.lastScanAt).filter(Boolean).sort();
      result.lastScanTime = lastScans.length > 0 ? lastScans[lastScans.length - 1] : null;
    }
  } catch {
    result.emailConfigCount = 0;
  }

  return result;
}

/**
 * 🆕 获取重复候选人（按手机号）
 * 替代 DashboardPage 中的直接 Candidate 查询
 */
/** 重复检测翻页参数：每批条数与安全上限（2 万条） */
const DEDUP_PAGE_SIZE = 500;
const DEDUP_MAX_PAGES = 40;

export async function getDuplicateCandidates() {
  const db = cloudbase.db();
  if (!db) return [];

  try {
    // 🔒 数据隔离：附加 ownerId 过滤
    const conditions = { phone: db.command.neq(null) };
    const of = ownerFilter();
    if (of) conditions.ownerId = of.ownerId;

    // 重复检测必须覆盖**全库**，否则面板形同虚设。
    // 原实现只取 `limit(200)`：在 5663 条的真实库上实测——36 组手机号重复
    // **一组都看不到**（覆盖率 0%），管理员因此长期无法发现重复。
    // 这里沿用 candidate-listing.js 的「取全不截断」契约：
    // 首批探测 → 按 count 并发续拉 → count 失真时靠「最后一批是否满」兜底续拉。
    const buildQuery = () => db.collection('Candidate')
      .where(conditions)
      .field({ phone: true, name: true, email: true, _id: true });
    const fetchBatch = async (skip) => {
      const { data } = await buildQuery().skip(skip).limit(DEDUP_PAGE_SIZE).get();
      return data || [];
    };

    const first = await fetchBatch(0);
    const all = [...first];
    if (first.length === DEDUP_PAGE_SIZE) {
      let total = null;
      try {
        const c = await db.collection('Candidate').where(conditions).count();
        if (c && typeof c.total === 'number') total = c.total;
      } catch { /* count 不可用时回退串行续拉 */ }

      const maxDocs = DEDUP_PAGE_SIZE * DEDUP_MAX_PAGES;
      if (total === null || !Number.isFinite(total) || total < 0 || Math.ceil(total / DEDUP_PAGE_SIZE) > DEDUP_MAX_PAGES) {
        for (let skip = DEDUP_PAGE_SIZE; skip < maxDocs; skip += DEDUP_PAGE_SIZE) {
          const chunk = await fetchBatch(skip);
          all.push(...chunk);
          if (chunk.length < DEDUP_PAGE_SIZE) break;
        }
      } else {
        const batches = Math.ceil(total / DEDUP_PAGE_SIZE);
        const starts = [];
        for (let i = 1; i < batches; i++) starts.push(i * DEDUP_PAGE_SIZE);
        const chunks = starts.length ? await Promise.all(starts.map((s) => fetchBatch(s))) : [];
        for (const chunk of chunks) all.push(...chunk);

        // 收尾兜底（同 candidate-listing.js）：count 偏小时续拉，保证不截断
        let tail = chunks.length ? chunks[chunks.length - 1] : first;
        let skip = Math.max(batches * DEDUP_PAGE_SIZE, DEDUP_PAGE_SIZE);
        while (tail.length === DEDUP_PAGE_SIZE && skip < maxDocs) {
          const chunk = await fetchBatch(skip);
          all.push(...chunk);
          tail = chunk;
          skip += DEDUP_PAGE_SIZE;
        }
      }
      if (total !== null && total > maxDocs) {
        console.warn(`[funnel-report] 候选人总数 ${total} 超过重复检测上限 ${maxDocs}，结果可能不完整`);
      }
    }
    return all;
  } catch (err) {
    console.warn('[funnel-report] 重复检测查询失败:', err.message);
    return [];
  }
}

/**
 * P2-21：获取端到端周期指标（简历投递→入职平均天数）
 * @param {Object} params - { jobId?, startDate?, endDate?, ownerId? }
 * @returns {Promise<{ avgDays, medianDays, minDays, maxDays, count }>}
 */
export async function getE2ECycle(params = {}) {
  const of = ownerFilter();
  return callAggregator('e2e_cycle', { ...params, ...(of ? { ownerId: of.ownerId } : {}) });
}

export default {
  getDashboardOverview,
  getJobFunnel,
  getTrend,
  getDeptMonthly,
  getDemandMetrics,
  getRecruiterEfficiency,
  getOverviewWithFilters,
  getConversionRates,
  getDeptOnboardOverview,
  getSourceOnboardStats,
  getDemandVsOnboard,
  getE2ECycle,
  getSystemStatus,
  getDuplicateCandidates,
};
