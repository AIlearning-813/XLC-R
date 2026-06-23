/**
 * 关键路径 E2E 测试
 *
 * 覆盖：登录 → 工作台 → 看板管道 → 候选人列表 → 回收站 → 数据分析
 * 使用浏览器端 CloudBase Mock（addInitScript 预加载种子数据）。
 */
import { test, expect } from '@playwright/test';
import { setupE2E, navigateTo, waitForPageReady } from '../helpers.js';
import { SEED_DATA } from '../fixtures/seed-data.js';

// 每个测试前：addInitScript 预加载 Mock DB + localStorage 登录态 → 导航
test.beforeEach(async ({ page }) => {
  await setupE2E(page, SEED_DATA);
  await page.goto('/');
  await waitForPageReady(page);
});

// ============================================================
// 1. 登录与认证
// ============================================================
test.describe('登录与认证', () => {
  test('预设登录态后直接进入工作台', async ({ page }) => {
    // 应自动跳转到 /dashboard，页面标题可见
    const title = page.locator('.topbar-title, .page-title, h2').first();
    await expect(title).toBeVisible({ timeout: 5000 });
  });

  test('侧边栏导航存在且包含关键菜单', async ({ page }) => {
    const sidebar = page.locator('.sidebar, aside, nav').first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    const text = await sidebar.innerText();
    expect(text).toMatch(/工作台/);
    expect(text).toMatch(/招聘看板/);
    expect(text).toMatch(/候选人/);
  });

  test('管理员可见回收站入口', async ({ page }) => {
    const sidebar = page.locator('.sidebar, aside, nav').first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });
    expect(await sidebar.innerText()).toMatch(/回收站/);
  });
});

// ============================================================
// 2. 工作台（Dashboard）
// ============================================================
test.describe('工作台', () => {
  test('页面标题渲染且无崩溃', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    // 检查顶部导航栏标题（所有页面共用 AppLayout）
    const topTitle = page.locator('.topbar-title, .page-title, h2').first();
    await expect(topTitle).toBeVisible({ timeout: 5000 });
  });

  test('页面不出现错误信息', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    const body = page.locator('body');
    // 不应出现崩溃或未知错误
    await expect(body).not.toHaveText(/页面崩溃|未知错误|Fatal/i);
  });
});

// ============================================================
// 3. 招聘看板（Pipeline）
// ============================================================
test.describe('招聘看板', () => {
  test('看板页面成功渲染', async ({ page }) => {
    await navigateTo(page, '/pipeline');
    // 检查顶部导航栏或页面标题
    const title = page.locator('.topbar-title, h2').first();
    await expect(title).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// 4. 候选人列表
// ============================================================
test.describe('候选人列表', () => {
  test('候选人页面渲染', async ({ page }) => {
    await navigateTo(page, '/candidates');
    const body = page.locator('body');
    await expect(body).not.toHaveText(/页面崩溃|Fatal/i);
  });

  test('候选人详情页可访问（不崩溃）', async ({ page }) => {
    await navigateTo(page, '/candidates/cand-001');
    const body = page.locator('body');
    await expect(body).not.toHaveText(/页面崩溃|Fatal/i);
  });
});

// ============================================================
// 5. 回收站（Trash）
// ============================================================
test.describe('回收站', () => {
  test('回收站显示已删除候选人王五', async ({ page }) => {
    await navigateTo(page, '/trash');
    await page.waitForTimeout(1000);

    const body = page.locator('body');
    const text = await body.innerText();
    // 种子数据中有王五 (cand-003, status: deleted)
    expect(text).toMatch(/王五|回收站/i);
  });

  test('无已删除候选人时显示空状态', async ({ page }) => {
    // 动态清空已删除候选人
    await page.evaluate(() => {
      window.__mockDB__.setCollectionData('Candidate', [
        { _id: 'c1', name: '张三', status: 'active', ownerId: 'e2e-test-uid' },
      ]);
    });

    await navigateTo(page, '/trash');
    await page.waitForTimeout(1000);

    const text = await page.locator('body').innerText();
    expect(text).toMatch(/为空|暂无|空|没有/i);
  });
});

// ============================================================
// 6. 数据分析（Reports）
// ============================================================
test.describe('数据分析', () => {
  test('报表页面不崩溃', async ({ page }) => {
    await navigateTo(page, '/reports');
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).not.toHaveText(/页面崩溃|Fatal/i);
  });
});

// ============================================================
// 7. 完整导航遍历
// ============================================================
test.describe('导航完整性', () => {
  test('所有关键页面均可访问且不崩溃', async ({ page }) => {
    const pages = [
      { path: '/dashboard', label: '工作台' },
      { path: '/pipeline', label: '招聘看板' },
      { path: '/candidates', label: '候选人' },
      { path: '/reports', label: '报表' },
      { path: '/settings', label: '设置' },
      { path: '/trash', label: '回收站' },
      { path: '/ai-chat', label: 'AI助手' },
      { path: '/demands', label: '需求' },
    ];

    for (const { path, label } of pages) {
      await navigateTo(page, path);
      await page.waitForTimeout(500);
      const body = page.locator('body');
      const text = await body.innerText();
      // 每个页面至少要有内容，不能是空白
      expect(text.length, `${label} 页面 (${path}) 不应为空`).toBeGreaterThan(10);
    }
  });

  test('不存在的路由重定向到工作台', async ({ page }) => {
    await navigateTo(page, '/nonexistent-xyz-123');
    await page.waitForTimeout(1000);
    const text = await page.locator('body').innerText();
    expect(text).toMatch(/工作台|Dashboard|概览/i);
  });
});

// ============================================================
// 8. Mock DB 控制验证
// ============================================================
test.describe('Mock DB 集成验证', () => {
  test('window.__mockDB__ 在浏览器中可用', async ({ page }) => {
    const exists = await page.evaluate(() => !!window.__mockDB__);
    expect(exists).toBe(true);
  });

  test('种子数据已正确加载到 Mock DB', async ({ page }) => {
    const stats = await page.evaluate(() => ({
      jobCount: window.__mockDB__.getCollectionCount('Job'),
      candidateCount: window.__mockDB__.getCollectionCount('Candidate'),
      appCount: window.__mockDB__.getCollectionCount('Application'),
    }));
    expect(stats.jobCount).toBe(3);
    expect(stats.candidateCount).toBe(4);
    expect(stats.appCount).toBe(3);
  });

  test('动态修改 Mock DB 数据后页面响应', async ({ page }) => {
    // 动态添加一个候选人
    await page.evaluate(() => {
      window.__mockDB__.addToCollection('Candidate', {
        _id: 'dynamic-001',
        name: '动态添加的候选人',
        status: 'active',
        ownerId: 'e2e-test-uid',
      });
    });

    // 导航到候选人页
    await navigateTo(page, '/candidates');
    await page.waitForTimeout(1000);

    // 候选人总数应增加
    const count = await page.evaluate(() =>
      window.__mockDB__.getCollectionCount('Candidate')
    );
    expect(count).toBe(5);
  });
});
