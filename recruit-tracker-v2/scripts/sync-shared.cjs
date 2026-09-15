#!/usr/bin/env node
/**
 * sync-shared.cjs — 把 _shared/ 的 canonical 模块分发到各云函数目录
 *
 * 为什么需要它：
 *   腾讯云 CloudBase 每个云函数独立打包上传，函数之间**无法跨目录 require**。
 *   所以共享模块只能在每个函数目录下各放一份副本。手抄副本必然漂移
 *   （本仓库已有的 format-router.js 三份副本就是前车之鉴），因此：
 *     · canonical 只放 cloud-functions/_shared/
 *     · 副本由本脚本生成，不要手改
 *     · _shared/shared-sync.test.js 断言副本与 canonical 逐字节一致，
 *       漂移会让 `npm test` 直接失败，而不是等到线上行为不一致才发现
 *
 * 用法：
 *   node scripts/sync-shared.cjs          # 同步（覆盖副本）
 *   node scripts/sync-shared.cjs --check  # 只检查，不写入；有漂移则退出码 1
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED_DIR = path.join(ROOT, 'cloud-functions', '_shared');

/**
 * 哪些函数需要哪些共享模块。
 * 新增依赖共享模块的云函数时，在这里登记一行，再跑一次同步脚本。
 */
const TARGETS = {
  'auth-proxy': ['session-token.js'],
  'get-file-url': ['session-token.js', 'access-guard.js'],
  'report-aggregator': ['session-token.js', 'access-guard.js'],
  'email-scanner': ['session-token.js', 'access-guard.js'],
};

function readCanonical(name) {
  const p = path.join(SHARED_DIR, name);
  if (!fs.existsSync(p)) {
    throw new Error(`canonical 模块不存在：${p}`);
  }
  return fs.readFileSync(p);
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let drifted = 0;
  let synced = 0;

  for (const [fnName, modules] of Object.entries(TARGETS)) {
    const fnDir = path.join(ROOT, 'cloud-functions', fnName);
    if (!fs.existsSync(fnDir)) {
      console.error(`✘ 云函数目录不存在：${fnDir}`);
      drifted++;
      continue;
    }

    for (const mod of modules) {
      const canonical = readCanonical(mod);
      const destPath = path.join(fnDir, mod);
      const existing = fs.existsSync(destPath) ? fs.readFileSync(destPath) : null;

      if (existing && existing.equals(canonical)) {
        continue; // 已一致
      }

      if (checkOnly) {
        console.error(`✘ 漂移：${fnName}/${mod} 与 canonical 不一致`);
        drifted++;
      } else {
        fs.writeFileSync(destPath, canonical);
        console.log(`✔ 已同步 ${fnName}/${mod}`);
        synced++;
      }
    }
  }

  if (checkOnly) {
    if (drifted > 0) {
      console.error(`\n共 ${drifted} 处漂移。运行 node scripts/sync-shared.cjs 修复。`);
      process.exit(1);
    }
    console.log(`✔ 全部 ${Object.keys(TARGETS).length} 个云函数的共享模块副本与 canonical 一致`);
    return;
  }

  console.log(synced > 0 ? `\n完成，同步 ${synced} 个文件。` : '\n无需同步，所有副本已是最新。');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('同步失败:', err.message);
    process.exit(1);
  }
}

module.exports = { TARGETS, SHARED_DIR };
