#!/usr/bin/env node
/**
 * probe-anon-access-count.cjs — 用「条数」而非「是否报错」度量匿名可读范围
 *
 * 为什么要重做（方法学修正）：
 *   probe-anon-access.cjs 把「调用没抛异常」当成「可读」，于是把返回 0 条的集合
 *   也算作了可读。但 CloudBase 安全规则在多数情况下是**作为查询条件**生效的：
 *   规则不满足时不会报错，而是静默返回 0 条。
 *   因此「没报错」既包含「真的能读到数据」，也包含「被规则挡住、结果为空」。
 *   两者严重程度天差地别，必须用条数区分。
 *
 * 本脚本只用 count() 与 limit(1)（均为只读），打印条数与字段名，
 * **不打印任何字段值**。
 *
 * 用法：node scripts/probe-anon-access-count.cjs
 */

const cloudbase = require('@cloudbase/js-sdk');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

// init-database.md 里列出的全部业务集合
const COLLECTIONS = [
  'Users', 'Job', 'Candidate', 'Application', 'EmailConfig', 'ParseQueue',
  'ParseNotification', 'AuditLog', 'PendingChanges', 'ErrorLog', 'CompanyProfile',
  'KnowledgeBase', 'RecruitmentInsight', 'DuplicateExclusion', 'ReportCache',
  'CommunicationLog', 'ParseCorrectionBank', 'ProcessingLock', 'Config',
  'RecruitmentDemand', 'LoginLog',
];

async function main() {
  console.log(`探针目标环境：${ENV_ID}`);
  console.log('身份：匿名登录（与外部访客完全相同）');
  console.log('度量：count() 匿名可见条数 + 字段名（不打印任何字段值）\n');

  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth({ persistence: 'none' });
  await auth.anonymousAuthProvider().signIn();
  console.log('✔ 匿名登录成功\n');

  const db = app.database();
  const exposed = [];   // 能读到 >0 条 = 真实数据泄露
  const emptyOrFiltered = [];
  const failed = [];

  for (const name of COLLECTIONS) {
    let count = null;
    let fields = '';
    let note = '';

    try {
      const c = await db.collection(name).count();
      count = c ? c.total : undefined;
    } catch (err) {
      const msg = String(err.message || err);
      if (/collection.*not.*exist|集合不存在|DATABASE_COLLECTION_NOT_EXIST/i.test(msg)) {
        note = '集合不存在';
        failed.push(`${name}(不存在)`);
        console.log(`  –      ${name.padEnd(20)} 集合不存在`);
        continue;
      }
      if (/permission|denied|403/i.test(msg)) {
        note = '权限拒绝(显式报错)';
        failed.push(`${name}(拒绝)`);
        console.log(`  ✔ 拒绝 ${name.padEnd(20)} 权限拒绝（显式报错）`);
        continue;
      }
      note = '异常:' + msg.slice(0, 40);
      failed.push(`${name}(异常)`);
      console.log(`  ? 异常 ${name.padEnd(20)} ${msg.slice(0, 60)}`);
      continue;
    }

    // 只有 count>0 时才有必要看字段名
    if (count > 0) {
      try {
        const one = await db.collection(name).limit(1).get();
        const rows = (one && one.data) || [];
        fields = rows.length > 0 ? Object.keys(rows[0]).join(',') : '';
      } catch (err) {
        fields = '(取样本失败)';
      }
      exposed.push(`${name}(${count}条)`);
      console.log(`  ⚠️ 可见 ${name.padEnd(20)} ${String(count).padStart(6)} 条  字段: ${fields.slice(0, 90)}`);
    } else {
      emptyOrFiltered.push(name);
      console.log(`  –      ${name.padEnd(20)} 可见 0 条（被规则过滤或集合本就为空）`);
    }
  }

  console.log('\n================ 结论 ================');
  console.log(`真泄露（匿名可见 >0 条）：${exposed.length} 个`);
  if (exposed.length > 0) {
    console.log('  ' + exposed.join('、'));
  }
  console.log(`可见 0 条（被过滤/空集合，需管理面核对才能定论）：${emptyOrFiltered.length} 个`);
  if (emptyOrFiltered.length > 0) {
    console.log('  ' + emptyOrFiltered.join('、'));
  }
  console.log(`不可用：${failed.length} 个${failed.length ? '（' + failed.join('、') + '）' : ''}`);
  console.log('\n注意：「可见 0 条」不等于安全——只说明匿名读不到；');
  console.log('      但「可见 N 条」是确凿的数据泄露，N 就是匿名访客能拿走的条数。');
}

main().catch((err) => {
  console.error('探针异常：', err && err.message ? err.message : err);
  process.exit(1);
});
