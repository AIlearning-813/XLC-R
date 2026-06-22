import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 测试环境统一使用 Mock 层替代 CloudBase SDK
      '@cloudbase-mock': path.resolve(__dirname, 'src/services/__mocks__/cloudbase.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.js'],
    // 每个测试文件运行前自动重置 Mock 状态
    setupFiles: ['./vitest.setup.js'],
    // 自动清除所有 mock 调用记录（不影响 mock 实现）
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js'],
    },
  },
});
