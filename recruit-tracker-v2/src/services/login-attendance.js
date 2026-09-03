/**
 * login-attendance.js — 管理员登录考勤查询服务层
 *
 * 封装 report-aggregator 云函数的 login_attendance 聚合查询。
 * 仅供管理员使用（路由 meta.requireAdmin 拦截），看全部专员，
 * 因此不套用 ownerFilter（专员数据隔离对本页面无意义）。
 *
 * 数据流：LoginAttendancePage.vue → login-attendance.js → report-aggregator（实时，绕过缓存）
 */

import cloudbase from './cloudbase';
import { handleError } from './error-handler';

const FUNCTION_NAME = 'report-aggregator';

/**
 * 获取某月专员登录考勤（后端实时聚合，绕过 30min ReportCache）
 * @param {number} year - 年份（如 2026）
 * @param {number} month - 月份 1-12
 * @returns {Promise<object|null>} 结构：{ year, month, daysInMonth,
 *   recruiters:[{ username, name, totalLogins, activeDays, daily:[{day,logins,active}] }] }
 *   失败返回 null
 */
export async function getLoginAttendance(year, month) {
  try {
    const result = await cloudbase.callFunction(FUNCTION_NAME, {
      type: 'login_attendance',
      params: { year, month },
    });
    if (!result || !result.success) {
      console.warn('[login-attendance] 查询失败:', result?.error);
      return null;
    }
    return result.data;
  } catch (err) {
    handleError(err, { context: '报表-登录考勤', silent: true });
    return null;
  }
}

export default { getLoginAttendance };
