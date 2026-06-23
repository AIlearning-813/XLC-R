/**
 * server-time.js — 服务器时间校准模块
 *
 * P0-5 修复：客户端 new Date() 不可靠（时区偏差、时钟漂移、篡改）。
 * 本模块在应用启动时查询服务器时间，计算偏移量，后续所有时间戳使用校准后的值。
 *
 * 原理：
 *   1. 调用轻量级云函数获取服务器当前时间
 *   2. 计算 offset = serverTime - clientTime
 *   3. 后续 getNow() = Date.now() + offset
 *
 * 降级策略：
 *   - 云函数不可用时，降级为客户端时间（带警告标记）
 *   - 定时重新校准（每 60 分钟）
 */

import cloudbase from './cloudbase';

// 客户端-服务器时间偏移量（毫秒）
let _offset = 0;
let _calibrated = false;
let _lastCalibration = 0;

// 重新校准间隔（60 分钟）
const RECALIBRATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 校准服务器时间
 * @returns {Promise<{success: boolean, offset: number}>}
 */
export async function calibrate() {
  const clientNow = Date.now();

  try {
    // 使用 report-aggregator 云函数的 ping action 获取服务器时间
    const result = await cloudbase.callFunction('report-aggregator', {
      type: 'ping',
      clientTime: clientNow,
    });

    if (result && result.serverTime) {
      const serverNow = new Date(result.serverTime).getTime();
      _offset = serverNow - clientNow;
      _calibrated = true;
      _lastCalibration = clientNow;

      console.log(
        `[server-time] ✅ 已校准，偏移: ${_offset > 0 ? '+' : ''}${Math.round(_offset / 1000)}s ` +
        `(服务器=${new Date(serverNow).toISOString()}, 客户端=${new Date(clientNow).toISOString()})`
      );
      return { success: true, offset: _offset };
    }
  } catch (err) {
    console.warn('[server-time] ⚠️ 校准失败，使用客户端时间:', err.message);
  }

  _calibrated = false;
  return { success: false, offset: 0 };
}

/**
 * 获取当前时间（校准后）
 * @returns {Date}
 */
export function getNow() {
  // 必要时自动重新校准（触发异步校准，本次调用使用上次偏移量）
  if (_calibrated && Date.now() - _lastCalibration > RECALIBRATE_INTERVAL_MS) {
    calibrate().catch(() => {});  // 异步重新校准，不阻塞
  }

  return new Date(Date.now() + _offset);
}

/**
 * 获取 ISO 字符串（校准后）
 * @returns {string}
 */
export function getNowISO() {
  return getNow().toISOString();
}

/**
 * 是否已校准
 */
export function isCalibrated() {
  return _calibrated;
}

export default { calibrate, getNow, getNowISO, isCalibrated };
