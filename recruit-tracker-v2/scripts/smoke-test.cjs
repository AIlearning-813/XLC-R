/**
 * 端到端冒烟测试 — 验证全链路 API 网关
 *
 * 通过调用云函数验证系统核心链路可用性，
 * 不依赖浏览器，可在 CI 中运行。
 *
 * 使用方式：
 *   TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/smoke-test.cjs
 *
 * 前置条件：
 *   需要在环境变量中设置 CloudBase 管理员凭据：
 *   - TCB_SECRET_ID: 腾讯云 SecretId
 *   - TCB_SECRET_KEY: 腾讯云 SecretKey
 *   获取方式：https://console.cloud.tencent.com/cam/capi
 */

const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'xlc-recruit-d1gmbx8gybc8a3565';
const SECRET_ID = process.env.TCB_SECRET_ID || process.env.TENCENT_SECRET_ID || '';
const SECRET_KEY = process.env.TCB_SECRET_KEY || process.env.TENCENT_SECRET_KEY || '';

if (!SECRET_ID || !SECRET_KEY) {
  console.log('⚠️  未检测到 CloudBase 管理员凭据，冒烟测试需要以下环境变量：');
  console.log('   TCB_SECRET_ID=你的腾讯云SecretId');
  console.log('   TCB_SECRET_KEY=你的腾讯云SecretKey');
  console.log('');
  console.log('💡 本地验证建议：');
  console.log('   • 运行单元测试：npm test');
  console.log('   • 启动开发服务器：npm run dev');
  console.log('   • 在浏览器中手动测试部署环境');
  console.log('');
  console.log('   获取凭据：https://console.cloud.tencent.com/cam/capi');
  process.exit(0);
}

const app = cloudbase.init({
  env: ENV_ID,
  secretId: SECRET_ID,
  secretKey: SECRET_KEY,
});

const PASS = '✅';
const FAIL = '❌';
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ${FAIL} ${name}: ${err.message}`);
    failed++;
  }
}

async function main() {
  console.log('\n🧪 新励成招聘管理系统 V2.0 — 端到端冒烟测试\n');
  console.log(`环境: ${ENV_ID}\n`);

  // ========== 1. 认证链路 ==========
  console.log('── 认证链路 ──');

  await test('auth-proxy 云函数可调用', async () => {
    const r = await app.callFunction({ name: 'auth-proxy', data: { action: 'login', username: 'test', password: 'test' } });
    if (!r.result || r.result.success === undefined) throw new Error('云函数无响应');
    // 预期失败（账号不存在），但只要云函数有响应就算通过
  });

  // ========== 2. 数据库链路 ==========
  console.log('── 数据库链路 ──');

  await test('Job 集合可读', async () => {
    const db = app.database();
    const { data } = await db.collection('Job').limit(1).get();
    if (!Array.isArray(data)) throw new Error('返回格式异常');
  });

  await test('Candidate 集合可读', async () => {
    const db = app.database();
    const { data } = await db.collection('Candidate').limit(1).get();
    if (!Array.isArray(data)) throw new Error('返回格式异常');
  });

  await test('Application 集合可读', async () => {
    const db = app.database();
    const { data } = await db.collection('Application').limit(1).get();
    if (!Array.isArray(data)) throw new Error('返回格式异常');
  });

  await test('Users 集合可读', async () => {
    const db = app.database();
    const { data } = await db.collection('Users').limit(1).get();
    if (!Array.isArray(data)) throw new Error('返回格式异常');
  });

  // ========== 3. 云函数链路 ==========
  console.log('── 云函数链路 ──');

  await test('report-aggregator overview 可用', async () => {
    const r = await app.callFunction({ name: 'report-aggregator', data: { type: 'overview' } });
    if (!r.result || !r.result.success) throw new Error(r.result?.error || '返回失败');
  });

  await test('resume-parser-proxy 可调用', async () => {
    const r = await app.callFunction({ name: 'resume-parser-proxy', data: { resumeText: '测试简历内容' } });
    if (!r.result) throw new Error('无响应');
  });

  await test('write-audit-log 可调用', async () => {
    const r = await app.callFunction({ name: 'write-audit-log', data: {
      action: 'smoke_test',
      entityType: 'System',
      entityIds: ['smoke-test'],
      detail: { note: '冒烟测试' },
      operator: 'smoke-test-script',
    }});
    if (!r.result || !r.result.success) throw new Error(r.result?.error || '写入失败');
  });

  await test('rag-assistant-proxy 可调用', async () => {
    const r = await app.callFunction({ name: 'rag-assistant-proxy', data: { userMessage: '测试' } });
    if (!r.result) throw new Error('无响应');
  });

  // ========== 4. 集合完整性检查 ==========
  console.log('── 集合完整性 ──');

  const requiredCollections = [
    'Users', 'Job', 'Candidate', 'Application',
    'EmailConfig', 'PendingChanges', 'AuditLog', 'ReportCache',
    'ParseQueue', 'ErrorLog', 'Config', 'CommunicationLog',
    'ParseCorrectionBank', 'ProcessingLock', 'CompanyProfile',
    'KnowledgeBase', 'RecruitmentInsight',
  ];

  for (const col of requiredCollections) {
    await test(`集合 ${col} 存在`, async () => {
      const db = app.database();
      await db.collection(col).limit(1).get();
    });
  }

  // ========== 结果汇总 ==========
  console.log(`\n📊 结果: ${PASS} ${passed} 通过 / ${FAIL} ${failed} 失败 / 共 ${passed + failed} 项\n`);

  if (failed > 0) {
    console.log('⚠️  部分测试失败，请检查 CloudBase 环境和云函数部署状态。\n');
    process.exit(1);
  } else {
    console.log('🎉 全部通过！系统核心链路正常。\n');
  }
}

main().catch(err => {
  console.error('💥 测试脚本异常:', err.message);
  process.exit(1);
});
