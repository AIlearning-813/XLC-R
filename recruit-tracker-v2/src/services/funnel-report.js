/**
 * funnel-report.js — 报表查询服务层
 *
 * 所有报表数据查询的统一入口，封装云函数调用。
 * 前端组件只调这里，不直接查数据库，也不直接调云函数。
 *
 * 数据流：Vue 组件 → funnel-report.js → report-aggregator 云函数 → ReportCache/Application
 */

import cloudbase from './cloudbase';

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
    if (!result.success) {
      console.warn(`[funnel-report] ${type} 查询失败:`, result.error);
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
export async function getDashboardOverview() {
  return callAggregator('overview');
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

export default {
  getDashboardOverview,
  getJobFunnel,
  getTrend,
  getDeptMonthly,
  getDemandMetrics,
  getRecruiterEfficiency,
  getOverviewWithFilters,
};
