#!/usr/bin/env node
/**
 * probe-anon-access.cjs — 只读探针：验证「外部匿名访客能从前端直读哪些数据」
 *
 * 为什么需要它：
 *   本系统前端有 74 处 `db().collection(...)` 直连数据库的调用，
 *   也就是说读操作真正的安全边界是 **CloudBase 数据库安全规则**，
 *   而不是云函数。云函数加固得再好，直连路径敞开就等于没加固。
 *
 *   仓库里 scripts/set-security-rules.cjs 写的是集合名 `User`（单数），
 *   而代码用的是 `Users`（复数）；且规则用 `doc.ownerId == auth.uid` 比对，
 *   但本系统是**匿名登录**（auth.uid 是随机匿名 ID，ownerId 是「王莉」这类用户名），
 *   两者永不相等。因此必须实测线上实际生效的规则，不能只看脚本。
 *
 *   本脚本用与前端完全相同的 SDK 与匿名登录方式，等价于一个外部攻击者的能力。
 *
 * 安全约束：只做 count 与 limit(1) 的**字段名**读取，绝不打印任何业务数据值。
 *
 * 用法：node scripts/probe-anon-access.cjs
 */

const cloudbase = require('@cloudbase/js-sdk');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

// 这些集合一旦可被匿名直读，就意味着数据泄露
const SENSITIVE = [
  'Users',        // 账号（含 passwordHash/salt）
  'Candidate',    // 候选人（含姓名、手机号）
  'Application',  // 投递记录
  'EmailConfig',  // 收件邮箱配置
  'AuditLog',     // 审计日志
  'LoginLog',     // 登录日志
  'ReportCache',  // 报表缓存
  'ParseQueue',   // 解析队列
  'Job',
  'RecruitmentDemand',
  'Config',
  'KnowledgeBase',
];

async function main() {
  console.log(`探针目标环境：${ENV_ID}`);
  console.log('身份：匿名登录（与外部访客完全相同）\n');

  const app = cloudbase.init({ env: ENV_ID });

  try {
    const auth = app.auth({ persistence: 'none' });
    await auth.anonymousAuthProvider().signIn();
    const state = await auth.getLoginState();
    console.log('✔ 匿名登录成功，uid 前 8 位：', state && state.user && state.user.uid
      ? String(state.user.uid).slice(0, 8) + '...'
      : '(未知)');
  } catch (err) {
    console.log('✘ 匿名登录失败：', err.message);
    console.log('  （若匿名登录被关闭，则前端本身也无法工作，需要另论）');
    return;
  }

  const db = app.database();
  const readable = [];
  const blocked = [];

  for (const name of SENSITIVE) {
    try {
      const res = await db.collection(name).limit(1).get();
      const rows = (res && res.data) || [];
      // 只打印字段名，不打印任何值
      const fields = rows.length > 0 ? Object.keys(rows[0]).join(', ') : '(集合为空)';
      console.log(`  ⚠️ 可读  ${name.padEnd(20)} 取到 ${rows.length} 条  字段: ${fields}`);
      readable.push(name);
    } catch (err) {
      const msg = err.message || String(err);
      const denied = /permission|denied|403|PERMISSION_DENIED/i.test(msg);
      console.log(`  ${denied ? '✔ 被拒' : '? 异常'}  ${name.padEnd(20)} ${msg.slice(0, 70)}`);
      if (denied) blocked.push(name);
    }
  }

  console.log('\n================ 结论 ================');
  console.log(`匿名可读集合数：${readable.length}`);
  if (readable.length > 0) {
    console.log('可读清单：' + readable.join('、'));
    console.log('\n⚠️ 这些集合的数据对任何知道环境 ID 的外部访客都是公开的');
    console.log('   （环境 ID 打包在前端 bundle 里，任何人都能看到）');
  }
  console.log(`被正确拒绝：${blocked.length} 个${blocked.length ? '（' + blocked.join('、') + '）' : ''}`);
}

main().catch((err) => {
  console.error('探针异常：', err && err.message ? err.message : err);
  process.exit(1);
});
