#!/usr/bin/env node
/**
 * probe-anon-write.cjs — 只读探针（写权限部分）：匿名访客能否写数据库
 *
 * ⚠️ 安全性设计：本脚本**不新建任何文档、不修改任何真实数据**。
 *    它对一个必然不存在的文档 ID 调用 update / remove，
 *    只为观察安全规则是否在权限层就把请求拒掉。
 *    无论规则放行还是拒绝，数据集都保持不变。
 *
 * 为什么必须单独探写权限：
 *   读权限泄露的是数据；写权限能造成篡改——例如把候选人的 ownerId 改走、
 *   往 Users 里塞一条 admin 账号，或删掉数据。危害等级更高。
 *
 * 用法：node scripts/probe-anon-write.cjs
 */

const cloudbase = require('@cloudbase/js-sdk');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

// 必然不存在的 ID：真实文档 ID 是 24 位 hex 或随机串，这个前缀保证不撞
const GHOST_ID = 'probe-nonexistent-doc-000000000000';

const TARGETS = [
  'Users',
  'Candidate',
  'Application',
  'EmailConfig',
  'Config',
  'Job',
  'AuditLog',
  'KnowledgeBase',
];

/** 从错误信息判断是否属于「权限拒绝」 */
function isDenied(msg) {
  return /permission|denied|403|PERMISSION_DENIED|无权|权限/i.test(msg || '');
}

async function main() {
  console.log(`探针目标环境：${ENV_ID}`);
  console.log('身份：匿名登录（与外部访客完全相同）');
  console.log(`探针方式：对不存在的文档 ${GHOST_ID} 发起 update / remove`);
  console.log('         不创建、不修改任何真实数据\n');

  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth({ persistence: 'none' });
  await auth.anonymousAuthProvider().signIn();
  console.log('✔ 匿名登录成功\n');

  const db = app.database();
  let writableCount = 0;

  for (const name of TARGETS) {
    const line = [];
    for (const op of ['update', 'remove']) {
      try {
        const ref = db.collection(name).doc(GHOST_ID);
        const res = op === 'update'
          ? await ref.update({ __probe: 'read-only-probe' })
          : await ref.remove();
        // 没抛错 = 规则放行了写操作（即便因文档不存在而实际改动 0 条）
        const changed = res ? (res.updated !== undefined ? res.updated : res.deleted) : undefined;
        line.push(`${op}=放行(改动${changed === undefined ? '?' : changed}条)`);
        writableCount++;
      } catch (err) {
        const msg = err.message || String(err);
        line.push(`${op}=${isDenied(msg) ? '被拒' : '异常:' + msg.slice(0, 40)}`);
      }
    }
    console.log(`  ${name.padEnd(20)} ${line.join('  ')}`);
  }

  console.log('\n================ 结论 ================');
  if (writableCount === 0) {
    console.log('✔ 未发现匿名写权限（update/remove 均被权限层拒绝）');
  } else {
    console.log(`⚠️ 有 ${writableCount} 个写操作被放行 —— 匿名访客具备篡改数据的能力`);
    console.log('   注意：因目标文档不存在，实际改动为 0 条，数据未被修改');
  }
  console.log('（本次探针未创建任何文档，数据集保持原样）');
}

main().catch((err) => {
  console.error('探针异常：', err && err.message ? err.message : err);
  process.exit(1);
});
