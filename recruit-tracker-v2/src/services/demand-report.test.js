/**
 * demand-report.test.js — 招聘需求报表服务测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - getDemandTracking：调用云函数 + ownerFilter 数据隔离
 *   - getDemandAlerts：纯函数 — 过期/临近截止/低完成率 筛选
 *   - 异常处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===== Mock CloudBase =====
vi.mock('./cloudbase');

// ===== Mock Auth Store =====
let authState;
vi.mock('../stores/useAuthStore', () => ({
  useAuthStore: () => authState,
}));

// ===== Mock data-filter =====
vi.mock('./data-filter', async () => {
  return {
    ownerFilter: vi.fn(() => {
      if (authState?.isAdmin) return null;
      return { ownerId: authState?.currentUsername || '__no_user__' };
    }),
    applyOwnerFilter: vi.fn((base = {}) => {
      if (authState?.isAdmin) return base;
      return { ...base, ownerId: authState?.currentUsername || '__no_user__' };
    }),
  };
});

import cloudbase from './cloudbase';
import { getDemandTracking, getDemandAlerts } from './demand-report';

beforeEach(() => {
  authState = {
    isAdmin: true,
    currentUsername: 'admin',
    userName: '管理员',
    isLoggedIn: true,
  };
  cloudbase.__setCallFunctionResult('report-aggregator', null);
});

describe('demand-report — getDemandTracking', () => {
  it('调用 report-aggregator demand_tracking', async () => {
    cloudbase.__setCallFunctionResult('report-aggregator', {
      success: true,
      data: { demands: [] },
    });

    const result = await getDemandTracking({ department: '销售部' });

    expect(result).toEqual({ demands: [] });
    expect(cloudbase.callFunction).toHaveBeenCalledWith(
      'report-aggregator',
      expect.objectContaining({
        type: 'demand_tracking',
        params: expect.objectContaining({ department: '销售部' }),
      })
    );
  });

  it('云函数返回失败 → 返回 null', async () => {
    cloudbase.__setCallFunctionResult('report-aggregator', {
      success: false,
      error: '查询失败',
    });

    const result = await getDemandTracking();
    expect(result).toBeNull();
  });

  it('云函数抛异常 → 返回 null', async () => {
    cloudbase.__setCallFunctionResult('report-aggregator', () => {
      throw new Error('超时');
    });

    const result = await getDemandTracking();
    expect(result).toBeNull();
  });

  it('Recruiter 附加 ownerId', async () => {
    authState.isAdmin = false;
    authState.currentUsername = 'recruiter1';
    cloudbase.__setCallFunctionResult('report-aggregator', { success: true, data: {} });

    await getDemandTracking();

    expect(cloudbase.callFunction).toHaveBeenCalledWith(
      'report-aggregator',
      expect.objectContaining({
        params: expect.objectContaining({ ownerId: 'recruiter1' }),
      })
    );
  });
});

describe('demand-report — getDemandAlerts（纯函数）', () => {
  it('空数据 → 返回空数组', () => {
    expect(getDemandAlerts(null)).toEqual([]);
    expect(getDemandAlerts({})).toEqual([]);
    expect(getDemandAlerts({ demands: [] })).toEqual([]);
  });

  it('过期需求 → 筛选出来', () => {
    const data = {
      demands: [
        { id: 'd1', title: '正常', isOverdue: false, isNearDeadline: false, completionRate: 80 },
        { id: 'd2', title: '过期', isOverdue: true, isNearDeadline: false, completionRate: 50 },
      ],
    };
    const alerts = getDemandAlerts(data);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('d2');
  });

  it('临近截止 → 筛选出来', () => {
    const data = {
      demands: [
        { id: 'd1', title: '临近', isOverdue: false, isNearDeadline: true, completionRate: 60 },
      ],
    };
    const alerts = getDemandAlerts(data);
    expect(alerts).toHaveLength(1);
  });

  it('高缺口 (isHighGap) → 筛选出来', () => {
    const data = {
      demands: [
        { id: 'd1', title: '高缺口', isOverdue: false, isNearDeadline: false, isHighGap: true },
        { id: 'd2', title: '正常', isOverdue: false, isNearDeadline: false, isHighGap: false },
      ],
    };
    const alerts = getDemandAlerts(data);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('d1');
  });

  it('所有预警类型同时命中', () => {
    const data = {
      demands: [
        { id: 'd1', title: '过期+高缺口', isOverdue: true, isNearDeadline: false, isHighGap: true },
        { id: 'd2', title: '临近+高缺口', isOverdue: false, isNearDeadline: true, isHighGap: true },
        { id: 'd3', title: '仅高缺口', isOverdue: false, isNearDeadline: false, isHighGap: true },
        { id: 'd4', title: '正常', isOverdue: false, isNearDeadline: false, isHighGap: false },
      ],
    };
    const alerts = getDemandAlerts(data);
    expect(alerts).toHaveLength(3);
  });

  it('isHighGap=false 不算预警', () => {
    const data = {
      demands: [
        { id: 'd1', isHighGap: false, isOverdue: false, isNearDeadline: false },
      ],
    };
    const alerts = getDemandAlerts(data);
    expect(alerts).toHaveLength(0);
  });
});
