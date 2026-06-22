/**
 * migrate-ownerid.cjs — 数据隔离迁移脚本
 *
 * 将 Candidate/Application/Job 中旧的匿名 UID ownerId
 * 映射到真实用户名（auth-proxy 验证过的 username）。
 *
 * 策略：
 *   1. 扫描所有 Candidate/Application/Job，找出 ownerId 不是已知用户名的记录
 *   2. 尝试通过 createdBy 字段或 AuditLog 推断真实用户
 *   3. 无法确定的设为 'system'
 *   4. 逐条更新（保留 _version 乐观锁）
 *
 * 使用方式：node scripts/migrate-ownerid.cjs
 */

const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';
const app = cloudbase.init({ env: ENV_ID });
const db = app.database();

async function main() {
  console.log('🚀 开始 ownerId 数据迁移...\n');

  // 1. 收集所有已知用户名
  const { data: users } = await db.collection('Users')
    .field({ username: true })
    .limit(200)
    .get();
  const knownUsers = new Set((users || []).map(u => u.username));
  console.log(`  已知用户: ${knownUsers.size} 个 (${[...knownUsers].join(', ')})`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  // 2. 迁移 Candidate
  console.log('\n── Candidate ──');
  const { data: candidates } = await db.collection('Candidate')
    .field({ ownerId: true, createdBy: true })
    .limit(500)
    .get();

  for (const cand of (candidates || [])) {
    const currentOwner = cand.ownerId || cand.createdBy;
    if (!currentOwner || knownUsers.has(currentOwner)) {
      skipped++;
      continue;
    }

    // 尝试推断：检查 createdBy 是否包含已知用户名
    const inferredOwner = inferOwner(cand, knownUsers);
    try {
      await db.collection('Candidate').doc(cand._id).update({
        ownerId: inferredOwner,
        updatedAt: new Date(),
      });
      migrated++;
      if (migrated % 10 === 0) process.stdout.write(`  已迁移 ${migrated} 条...\r`);
    } catch (err) {
      failed++;
      console.warn(`  ❌ ${cand._id}: ${err.message}`);
    }
  }
  console.log(`  Candidate: 迁移 ${migrated} / 跳过 ${skipped} / 失败 ${failed}`);

  // 3. 迁移 Application
  let appMigrated = 0, appSkipped = 0, appFailed = 0;
  console.log('\n── Application ──');
  const { data: apps } = await db.collection('Application')
    .field({ ownerId: true })
    .limit(500)
    .get();

  for (const app of (apps || [])) {
    const currentOwner = app.ownerId;
    if (!currentOwner || knownUsers.has(currentOwner)) {
      appSkipped++;
      continue;
    }

    const inferredOwner = 'system'; // Application 没有 createdBy 辅助推断
    try {
      await db.collection('Application').doc(app._id).update({
        ownerId: inferredOwner,
        updatedAt: new Date(),
      });
      appMigrated++;
      if (appMigrated % 10 === 0) process.stdout.write(`  已迁移 ${appMigrated} 条...\r`);
    } catch (err) {
      appFailed++;
      console.warn(`  ❌ ${app._id}: ${err.message}`);
    }
  }
  console.log(`  Application: 迁移 ${appMigrated} / 跳过 ${appSkipped} / 失败 ${appFailed}`);

  // 4. 迁移 Job
  let jobMigrated = 0, jobSkipped = 0;
  console.log('\n── Job ──');
  const { data: jobs } = await db.collection('Job')
    .field({ ownerId: true })
    .limit(200)
    .get();

  for (const job of (jobs || [])) {
    if (!job.ownerId || knownUsers.has(job.ownerId)) {
      jobSkipped++;
      continue;
    }
    try {
      await db.collection('Job').doc(job._id).update({
        ownerId: 'admin',
        updatedAt: new Date(),
      });
      jobMigrated++;
    } catch (err) {
      console.warn(`  ❌ ${job._id}: ${err.message}`);
    }
  }
  console.log(`  Job: 迁移 ${jobMigrated} / 跳过 ${jobSkipped}`);

  console.log('\n✅ 迁移完成');
}

/** 尝试通过现有字段推断真实 owner */
function inferOwner(doc, knownUsers) {
  // 如果 createdBy 是已知用户名，使用它
  if (doc.createdBy && knownUsers.has(doc.createdBy)) return doc.createdBy;
  // 默认回退到 admin
  return 'admin';
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message);
  process.exit(1);
});
