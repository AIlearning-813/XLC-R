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
    console.error(`[funnel-report] ${type} 调用异常:`, err.message);
    return null;
  }
}

/**
 * 获取 Dashboard 概览数据
 * 返回：活跃候选人、本月入职、待跟进、待解析、活跃岗位数、近30天入职
 */
export async function getDashboardOverview(params = {}) {
  const of = ownerFilter();
  return callAggregator('overview', { ...params, ...(of ? { ownerId: of.ownerId } : {}) });
}

/**
 * 获取单岗位漏斗数据
 * @param {string} jobId - 岗位 ID（不传则查全部岗位聚合）
 * @param {string} jobType - 岗位类型（用于确定面试轮数）
 * @returns {Promise<object>} { stages, rates, rejectedCount, withdrawnCount, ... }
 */
export async function getJobFunnel(jobId, jobType) {
  return callAggregator('job_funnel', { jobId, jobType });
}

/**
 * 获取按月漏斗转化趋势
 * @param {number} months - 往回查的月数（默认 12）
 * @param {string} jobId - 岗位 ID（可选，不传查全部）
 * @returns {Promise<object>} { data: [{ month, total, onboard, ... }] }
 */
export async function getTrend(months = 12, jobId) {
  return callAggregator('trend', { months, jobId });
}

/**
 * 获取部门月度交叉报表
 * @param {number} year - 年份
 * @param {number} month - 月份（1-12）
 * @returns {Promise<object>} { jobs: [{ jobId, jobTitle, interviewCount, offerCount, onboardCount }] }
 */
export async function getDeptMonthly(year, month) {
  return callAggregator('dept_monthly', { year, month });
}

// ===== Phase 6: 招聘需求指标 + 专员效能 =====

export async function getDemandMetrics(filters = {}) {
  return callAggregator('demand_metrics', filters);
}

export async function getRecruiterEfficiency(filters = {}) {
  return callAggregator('recruiter_efficiency', filters);
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
  return callAggregator('dept_onboard_overview', params);
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
export async function getDuplicateCandidates() {
  const db = cloudbase.db();
  if (!db) return [];

  try {
    const { data: candidates } = await db.collection('Candidate')
      .where({ phone: db.command.neq(null) })
      .field({ phone: true, name: true, _id: true })
      .limit(200)
      .get();
    return candidates || [];
  } catch (err) {
    console.warn('[funnel-report] 重复检测查询失败:', err.message);
    return [];
  }
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
  getSystemStatus,
  getDuplicateCandidates,
};
