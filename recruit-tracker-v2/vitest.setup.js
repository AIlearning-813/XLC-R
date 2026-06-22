/**
 * Vitest 全局配置 — 自动 Mock CloudBase SDK + 测试环境初始化
 *
 * 所有测试自动获得:
 *   1. CloudBase SDK mock（不联网、不花钱）
 *   2. 全局 describe/it/expect（vi 模式）
 */

import { vi } from 'vitest';

// 自动将 cloudbase.js 替换为 mock 版本
vi.mock('./src/services/cloudbase', () => {
  const mock = require('./src/__mocks__/cloudbase');
  return { default: mock.default };
});

// 每个测试前自动重置 mock 状态
beforeEach(() => {
  // 动态导入以避免循环依赖
  try {
    const mock = require('./src/__mocks__/cloudbase');
    mock.default.__resetAll();
  } catch (e) {
    // 某些测试可能不需要 mock
  }
});
