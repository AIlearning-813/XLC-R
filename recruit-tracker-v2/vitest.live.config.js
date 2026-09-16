import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

/**
 * 「生产数据实测」专用配置 —— **不参与默认测试套件**。
 *
 * 为什么单独一个配置：默认配置的 include 是 `src/**\/*.test.js`，
 * 而在线实测要连生产库、有网络依赖、耗时以秒计，不该混进每次 `vitest run`。
 * 故在线用例命名为 `*.live.js`，默认套件根本不匹配它（基线数字不受影响）；
 * 只有显式跑 `npx vitest run --config vitest.live.config.js` 才会执行。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.live.js'],
    setupFiles: ['./vitest.setup.js'],
    testTimeout: 180000,   // 全量拉 4900 条 + 候选人，慢是正常的
    hookTimeout: 120000,
    // 在线实测必须串行：并发打生产库既无必要也不礼貌
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
