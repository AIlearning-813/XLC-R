/**
 * demand-report.js — 招聘需求报表服务层
 *
 * 封装需求跟踪看板、预警数据等云函数调用。
 * 前端组件只调这里，不直接调云函数。
 */

import cloudbase from './cloudbase';
import { ownerFilter } from './data-filter';

const FUNCTION_NAME = 'report-aggregator';

async function callAggregator(type, params = {}) {
  try {
    const result = await cloudbase.callFunction(FUNCTION_NAME, { type, params });
    // cloudbase.callFunction 已内部解包 res.result，直接返回云函数返回值
    if (!result || !result.success) {
      console.warn(`[demand-report] ${type} 查询失败:`, result?.error);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error(`[demand-report] ${type} 调用异常:`, err.message);
    return null;
  }
}

/** 获取需求跟踪看板数据（每个需求的缺口/进度/预警） */
export async function getDemandTracking(params = {}) {
  const of = ownerFilter();
  return callAggregator('demand_tracking', { ...params, ...(of ? { ownerId: of.ownerId } : {}) });
}

/** 获取需求预警列表（已逾期/临近截止/高缺口） */
export function getDemandAlerts(trackingData) {
  if (!trackingData?.demands) return [];
  return trackingData.demands.filter(d => d.isOverdue || d.isNearDeadline || d.isHighGap);
}

export default { getDemandTracking, getDemandAlerts };
