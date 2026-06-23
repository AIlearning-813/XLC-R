/**
 * Playwright E2E 测试配置
 *
 * 启动 Vite dev server（Mock 模式），然后运行浏览器端到端测试。
 *
 * 用法:
 *   npx playwright test                 # 运行所有 E2E 测试
 *   npx playwright test --ui            # 交互式 UI 模式
 *   npx playwright test --headed        # 显示浏览器窗口
 *   npx playwright test --debug         # 逐步调试
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false, // E2E 测试串行执行，避免状态冲突
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'e2e/reports' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // 后续可添加移动端视口
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  // 启动 Vite dev server（Mock 模式）
  webServer: {
    command: `npx vite --config vite.e2e.config.js --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
