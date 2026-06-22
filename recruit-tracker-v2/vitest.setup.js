/**
 * Vitest 全局配置 — 测试环境初始化
 *
 * 机制：
 *   1. 自动挂载 CloudBase Mock 层（src/services/__mocks__/cloudbase.js）
 *   2. 每个测试前自动重置内存数据库状态
 *   3. 每个测试文件自行 vi.mock 所需模块
 *
 * Mock 层用法：
 *   import cloudbase from '../services/cloudbase';
 *   cloudbase.__setCollectionData('Candidate', [{ _id: 'c1', name: '张三' }]);
 *   const { data } = await cloudbase.db().collection('Candidate').where({...}).get();
 */

import { beforeEach } from 'vitest';

// 在每个测试前自动重置 Mock 状态
beforeEach(async () => {
  // 动态导入 mock 模块并调用重置（避免循环依赖）
  try {
    const mock = await import('./src/services/__mocks__/cloudbase.js');
    if (mock.default && mock.default.__resetAll) {
      mock.default.__resetAll();
    }
  } catch {
    // mock 文件不存在时静默跳过
  }
});
