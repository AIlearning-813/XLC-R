/**
 * login-attendance.test.js — 登录考勤查询服务测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - 正确调用 report-aggregator 的 login_attendance 类型并透传年月
 *   - 云函数返回失败 / 调用抛异常时返回 null（不向上抛）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===== Mock CloudBase =====
vi.mock('./cloudbase');

import cloudbase from './cloudbase';
import { getLoginAttendance } from './login-attendance';

beforeEach(() => {
  cloudbase.__setCallFunctionResult('report-aggregator', null);
});

describe('login-attendance — 登录考勤查询', () => {
  it('调用 report-aggregator login_attendance 并透传年月', async () => {
    cloudbase.__setCallFunctionResult('report-aggregator', {
      success: true,
      data: { year: 2026, month: 9, daysInMonth: 30, recruiters: [] },
    });

    const data = await getLoginAttendance(2026, 9);

    expect(cloudbase.callFunction).toHaveBeenCalledWith('report-aggregator', {
      type: 'login_attendance',
      params: { year: 2026, month: 9 },
    });
    expect(data).toEqual({ year: 2026, month: 9, daysInMonth: 30, recruiters: [] });
  });

  it('云函数返回 success:false 时返回 null', async () => {
    cloudbase.__setCallFunctionResult('report-aggregator', {
      success: false,
      error: '不支持的聚合类型',
    });

    const data = await getLoginAttendance(2026, 9);
    expect(data).toBeNull();
  });

  it('云函数调用抛异常时返回 null（不向上抛）', async () => {
    cloudbase.callFunction.mockRejectedValueOnce(new Error('network error'));

    const data = await getLoginAttendance(2026, 9);
    expect(data).toBeNull();
  });

  it('未传月份时也应透传 undefined（后端默认本月兜底）', async () => {
    cloudbase.__setCallFunctionResult('report-aggregator', { success: true, data: null });

    await getLoginAttendance(2026);
    expect(cloudbase.callFunction).toHaveBeenCalledWith('report-aggregator', {
      type: 'login_attendance',
      params: { year: 2026, month: undefined },
    });
  });
});
