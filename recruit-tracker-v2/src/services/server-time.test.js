/**
 * server-time 单元测试
 *
 * 测试导出函数：calibrate / getNow / getNowISO / isCalibrated
 * Mock cloudbase.callFunction 以模拟服务端时间返回
 *
 * 注意：server-time 模块使用模块级变量（_offset, _calibrated 等），
 * 每个 describe 块内使用 vi.resetModules() 确保状态隔离。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 全局 mock cloudbase
vi.mock('./cloudbase');

// 辅助函数：动态导入 server-time 模块（每次导入获取最新状态）
async function importServerTime() {
  return await import('./server-time');
}

// ===== calibrate =====

describe('calibrate', () => {
  let cloudbase;

  beforeEach(async () => {
    vi.resetModules();
    // 重新 mock
    vi.doMock('./cloudbase');
    const cbModule = await import('./cloudbase');
    cloudbase = cbModule.default;
  });

  it('成功校准返回 success: true', async () => {
    const serverTimeISO = new Date(Date.now() + 5000).toISOString();
    cloudbase.__setCallFunctionResult('report-aggregator', {
      serverTime: serverTimeISO,
    });

    const { calibrate } = await importServerTime();
    const result = await calibrate();
    expect(result.success).toBe(true);
    expect(typeof result.offset).toBe('number');
    expect(result.offset).toBeGreaterThanOrEqual(4000);
  });

  it('校准后 isCalibrated 返回 true', async () => {
    const serverTimeISO = new Date(Date.now() + 5000).toISOString();
    cloudbase.__setCallFunctionResult('report-aggregator', {
      serverTime: serverTimeISO,
    });

    const { calibrate, isCalibrated } = await importServerTime();
    await calibrate();
    expect(isCalibrated()).toBe(true);
  });

  it('校准后 getNow 返回校准后时间', async () => {
    const serverTimeISO = new Date(Date.now() + 10000).toISOString();
    cloudbase.__setCallFunctionResult('report-aggregator', {
      serverTime: serverTimeISO,
    });

    const { calibrate, getNow } = await importServerTime();
    await calibrate();
    const now = getNow();
    expect(now).toBeInstanceOf(Date);
    // 校准后时间应接近服务器时间
    const serverTime = new Date(serverTimeISO).getTime();
    expect(Math.abs(now.getTime() - serverTime)).toBeLessThan(500);
  });

  it('校准失败返回 success: false', async () => {
    cloudbase.callFunction = vi.fn(async () => {
      throw new Error('网络超时');
    });

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { calibrate } = await importServerTime();
    const result = await calibrate();
    expect(result.success).toBe(false);
    expect(result.offset).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('校准失败后 isCalibrated 返回 false', async () => {
    cloudbase.callFunction = vi.fn(async () => {
      throw new Error('网络超时');
    });

    const { calibrate, isCalibrated } = await importServerTime();
    await calibrate();
    expect(isCalibrated()).toBe(false);
  });

  it('calibrate 传递 clientTime 给云函数', async () => {
    cloudbase.__setCallFunctionResult('report-aggregator', {
      serverTime: new Date().toISOString(),
    });

    const { calibrate } = await importServerTime();
    await calibrate();
    expect(cloudbase.callFunction).toHaveBeenCalledWith(
      'report-aggregator',
      expect.objectContaining({
        type: 'ping',
        clientTime: expect.any(Number),
      })
    );
  });
});

// ===== getNow (需独立模块状态) =====

describe('getNow', () => {
  let cloudbase;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('./cloudbase');
    const cbModule = await import('./cloudbase');
    cloudbase = cbModule.default;
  });

  it('未校准时返回客户端时间（offset=0）', async () => {
    const { getNow, isCalibrated } = await importServerTime();
    expect(isCalibrated()).toBe(false);
    const now = getNow();
    expect(now).toBeInstanceOf(Date);
    // 未校准，offset 为 0，getNow 应接近 Date.now()
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(100);
  });

  it('校准后返回校准后时间', async () => {
    const serverTimeISO = new Date(Date.now() + 15000).toISOString();
    cloudbase.__setCallFunctionResult('report-aggregator', { serverTime: serverTimeISO });

    const { calibrate, getNow } = await importServerTime();
    await calibrate();
    const now = getNow();
    // 校准后时间应接近服务器时间
    const serverTime = new Date(serverTimeISO).getTime();
    expect(Math.abs(now.getTime() - serverTime)).toBeLessThan(500);
  });
});

// ===== getNowISO =====

describe('getNowISO', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('./cloudbase');
  });

  it('返回 ISO 格式字符串', async () => {
    const { getNowISO } = await importServerTime();
    const iso = getNowISO();
    expect(typeof iso).toBe('string');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('以 Z 结尾', async () => {
    const { getNowISO } = await importServerTime();
    const iso = getNowISO();
    expect(iso.endsWith('Z')).toBe(true);
  });
});

// ===== isCalibrated =====

describe('isCalibrated', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('./cloudbase');
  });

  it('初始化为 false', async () => {
    const { isCalibrated } = await importServerTime();
    expect(isCalibrated()).toBe(false);
  });

  it('calibrate 成功后返回 true', async () => {
    const cbModule = await import('./cloudbase');
    const cloudbase = cbModule.default;
    cloudbase.__setCallFunctionResult('report-aggregator', {
      serverTime: new Date().toISOString(),
    });

    const { calibrate, isCalibrated } = await importServerTime();
    await calibrate();
    expect(isCalibrated()).toBe(true);
  });
});
