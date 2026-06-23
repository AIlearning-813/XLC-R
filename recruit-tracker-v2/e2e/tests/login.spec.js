/**
 * 登录页面 E2E 测试
 *
 * 不需要 setupE2E（无登录态），直接验证登录页面渲染和表单交互。
 */
import { test, expect } from '@playwright/test';
import { navigateTo } from '../helpers.js';

test.beforeEach(async ({ page }) => {
  // 仅加载 Mock DB，不设登录态
  await page.addInitScript(() => {
    window.__preload__ = {
      collections: {},
      callFunctionResults: {
        'auth-proxy': { success: true, data: { role: 'admin', name: '管理员', username: 'admin' } },
      },
      authState: { loggedIn: true, uid: 'e2e-test-uid' },
    };
  });
  await page.goto('/');
  // 确保 localStorage 无登录态
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1500);
});

test('品牌信息和核心卖点展示', async ({ page }) => {
  const text = await page.locator('body').innerText();
  expect(text).toMatch(/新励成/);
  expect(text).toMatch(/招聘管理系统/);
  expect(text).toMatch(/V2\.0|2\.0/);
  expect(text).toMatch(/12/);
  expect(text).toMatch(/15/);
  expect(text).toMatch(/AI/);
});

test('登录表单元素完整', async ({ page }) => {
  const text = await page.locator('body').innerText();
  expect(text).toMatch(/登录系统|登 录|登录/);

  // 账号和密码输入框
  const inputs = page.locator('input');
  expect(await inputs.count()).toBeGreaterThanOrEqual(2);

  // 登录按钮
  const btn = page.locator('button').filter({ hasText: /登.*录|Login/i });
  expect(await btn.count()).toBeGreaterThanOrEqual(1);
});

test('初始化按钮存在', async ({ page }) => {
  const text = await page.locator('body').innerText();
  expect(text).toMatch(/初始化/);
});

test('登录页无崩溃无错误', async ({ page }) => {
  await expect(page.locator('body')).not.toHaveText(/页面崩溃|Fatal|Uncaught/i);
});
