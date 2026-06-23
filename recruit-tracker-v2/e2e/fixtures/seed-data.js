/**
 * E2E 测试种子数据
 *
 * 预定义的 Mock 数据集，供 Playwright 测试使用。
 * 通过 page.evaluate() 注入到 window.__mockDB__。
 */

/** 标准种子数据：包含职位、候选人、申请记录 */
export const SEED_DATA = {
  /** 招聘职位 */
  jobs: [
    {
      _id: 'job-001',
      title: '高级前端工程师',
      department: '技术部',
      status: 'active',
      headCount: 2,
      priority: 'high',
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 30 * 24 * 3600_000,
    },
    {
      _id: 'job-002',
      title: '产品经理',
      department: '产品部',
      status: 'active',
      headCount: 1,
      priority: 'medium',
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 15 * 24 * 3600_000,
    },
    {
      _id: 'job-003',
      title: 'UI 设计师',
      department: '设计部',
      status: 'closed',
      headCount: 1,
      priority: 'low',
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 60 * 24 * 3600_000,
    },
  ],

  /** 候选人 */
  candidates: [
    {
      _id: 'cand-001',
      name: '张三',
      phone: '13800138001',
      email: 'zhangsan@test.com',
      status: 'active',
      source: 'boss',
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 10 * 24 * 3600_000,
    },
    {
      _id: 'cand-002',
      name: '李四',
      phone: '13800138002',
      email: 'lisi@test.com',
      status: 'active',
      source: 'zhaopin',
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 7 * 24 * 3600_000,
    },
    {
      _id: 'cand-003',
      name: '王五',
      phone: '13800138003',
      email: 'wangwu@test.com',
      status: 'deleted',
      source: 'liepin',
      ownerId: 'e2e-test-uid',
      previousStatus: 'active',
      deletedAt: Date.now() - 2 * 24 * 3600_000,
      deletedBy: '管理员',
    },
    {
      _id: 'cand-004',
      name: '赵六',
      phone: '13800138004',
      email: 'zhaoliu@test.com',
      status: 'active',
      source: 'internal',
      ownerId: 'other-recruiter',
      createdAt: Date.now() - 3 * 24 * 3600_000,
    },
  ],

  /** 申请记录 */
  applications: [
    {
      _id: 'app-001',
      candidateId: 'cand-001',
      jobId: 'job-001',
      status: 'active',
      stage: 'HR面试',
      stageIndex: 4,
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 10 * 24 * 3600_000,
      logs: [{ action: 'create', timestamp: Date.now() - 10 * 24 * 3600_000 }],
    },
    {
      _id: 'app-002',
      candidateId: 'cand-002',
      jobId: 'job-002',
      status: 'active',
      stage: '初筛',
      stageIndex: 1,
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 7 * 24 * 3600_000,
      logs: [{ action: 'create', timestamp: Date.now() - 7 * 24 * 3600_000 }],
    },
    {
      _id: 'app-003',
      candidateId: 'cand-003',
      jobId: 'job-001',
      status: 'withdrawn',
      stage: 'HR面试',
      stageIndex: 4,
      ownerId: 'e2e-test-uid',
      createdAt: Date.now() - 5 * 24 * 3600_000,
      logs: [{ action: 'create', timestamp: Date.now() - 5 * 24 * 3600_000 }],
    },
  ],
};

/**
 * 将种子数据注入到浏览器的 Mock DB 中
 * @param {import('@playwright/test').Page} page
 */
export async function seedMockDatabase(page) {
  await page.evaluate((data) => {
    window.__mockDB__.resetAll();
    if (data.jobs) window.__mockDB__.setCollectionData('Job', data.jobs);
    if (data.candidates) window.__mockDB__.setCollectionData('Candidate', data.candidates);
    if (data.applications) window.__mockDB__.setCollectionData('Application', data.applications);
    // 设置默认云函数返回值
    window.__mockDB__.setCallFunctionResult('report-aggregator', {
      success: true,
      data: { summary: { total: data.candidates?.length || 0 } },
    });
    window.__mockDB__.setCallFunctionResult('email-scanner', {
      success: true,
      data: { scanned: 0 },
    });
  }, data);
}
