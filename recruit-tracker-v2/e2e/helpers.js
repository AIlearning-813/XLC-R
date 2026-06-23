/**
 * E2E 测试辅助函数
 *
 * 使用 page.addInitScript() 确保：
 *   1. localStorage 登录态在 Vue 初始化前就位
 *   2. Mock DB 种子数据在 cloudbase mock 模块加载时即刻生效
 */

const STORAGE_KEY = 'xlc_auth_session';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

/**
 * 计算 session 签名（与 useAuthStore.signPayload 一致）
 */
function signPayload(data) {
  const str = JSON.stringify(data) + STORAGE_KEY;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * 构建登录态 localStorage payload
 */
function buildAuthPayload(opts = {}) {
  const {
    role = 'admin',
    username = 'admin',
    name = '管理员',
  } = opts;
  const payload = {
    u: username,
    r: role,
    n: name,
    e: Date.now() + TTL_MS,
  };
  payload.sig = signPayload(payload);
  return payload;
}

/**
 * 在页面加载前预设登录态和 Mock DB 种子数据。
 *
 * 使用 addInitScript 确保数据在 Vue 应用初始化之前就位。
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} seedData - 种子数据 { jobs, candidates, applications }
 * @param {Object} authOpts - 登录选项 { role, username, name }
 */
export async function setupE2E(page, seedData = {}, authOpts = {}) {
  const authPayload = buildAuthPayload(authOpts);

  // 构建 Mock DB 预加载数据（与 cloudbase-mock.js 的 __preload__ 协议对接）
  const collections = {};
  if (seedData.jobs) collections.Job = seedData.jobs.map((d, i) => ({ _id: d._id || `mock_Job_${i}`, ...d }));
  if (seedData.candidates) collections.Candidate = seedData.candidates.map((d, i) => ({ _id: d._id || `mock_Candidate_${i}`, ...d }));
  if (seedData.applications) collections.Application = seedData.applications.map((d, i) => ({ _id: d._id || `mock_Application_${i}`, ...d }));

  const preload = {
    collections,
    callFunctionResults: {
      'report-aggregator': { success: true, data: { summary: { total: seedData.candidates?.length || 0 }, demands: seedData.jobs || [] } },
      'email-scanner': { success: true, data: { scanned: 0 } },
      'auth-proxy': { success: true, data: { role: authOpts.role || 'admin', name: authOpts.name || '管理员', username: authOpts.username || 'admin' } },
    },
    authState: { loggedIn: true, uid: 'e2e-test-uid' },
  };

  // 🔥 在页面所有脚本之前执行：设置 localStorage + Mock DB 预加载
  await page.addInitScript(({ authPayload, preload }) => {
    // 1. 预设登录态
    localStorage.setItem('xlc_auth_session', JSON.stringify(authPayload));
    // 2. 预设 Mock DB（cloudbase-mock.js 初始化时自动读取）
    window.__preload__ = preload;
  }, { authPayload, preload });
}

/**
 * 仅预设登录态（不加载种子数据）
 */
export async function setupAuth(page, opts = {}) {
  await setupE2E(page, {}, opts);
}

/**
 * 等待页面加载完成
 */
export async function waitForPageReady(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

/**
 * 通过 hash 路由导航
 */
export async function navigateTo(page, path) {
  await page.evaluate((p) => {
    window.location.hash = '#' + p;
  }, path);
  await waitForPageReady(page);
}

/**
 * 断言 toast 消息出现
 */
export async function expectToast(page, text) {
  const toast = page.locator('.toast, .toast-item, [role="alert"]').filter({ hasText: text });
  await toast.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  return toast.first();
}
