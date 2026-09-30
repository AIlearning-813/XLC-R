#!/usr/bin/env node
/**
 * audit-fn-drift.cjs — 线上云函数与仓库的漂移审计（只读）
 *
 * 由来：2026-09-30 手工比对时发现两类真实漂移，且都不是靠工具发现的——
 *   1. 线上存在仓库里根本没有的孤儿函数 refetch-resumes（且无鉴权）
 *   2. db-backup 的仓库版本领先线上（旧备份清理逻辑未部署）
 * 手工比对靠不住，本脚本把它变成一条可重复、可放进运维流程的命令。
 *
 * 用法：
 *   node scripts/audit-fn-drift.cjs           # 只比对清单
 *   node scripts/audit-fn-drift.cjs --deep    # 额外下载线上代码逐文件比对（较慢）
 *
 * 退出码：发现孤儿函数时为 1（孤儿=线上有、仓库无，通常意味着无人维护的资产）。
 * 说明：仅做只读操作，不修改任何线上资源。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FN_ROOT = path.join(ROOT, 'cloud-functions');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'xlc-recruit-d1gmbx8gybc8a3565';

/** 仓库中的云函数（含 index.js 的非 _ 开头目录） */
function repoFunctions() {
  if (!fs.existsSync(FN_ROOT)) return [];
  return fs.readdirSync(FN_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .filter((e) => fs.existsSync(path.join(FN_ROOT, e.name, 'index.js')))
    .map((e) => e.name)
    .sort();
}

/** 线上已部署的云函数（只取需要的字段） */
function deployedFunctions() {
  const out = execSync('tcb fn list -e ' + ENV_ID + ' --json', { encoding: 'utf8', timeout: 120000 });
  const json = JSON.parse(out.slice(out.indexOf('{')));
  return json.data
    .map((f) => ({ name: f.name, runtime: f.runtime, modifyTime: f.modifyTime }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function deepCompare(names) {
  const tmp = path.join(os.tmpdir(), 'fn-drift-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  console.log('');
  console.log('深度比对（下载线上代码与仓库 index.js 逐字节比较）：');
  for (const n of names) {
    const dest = path.join(tmp, n);
    try {
      execSync('tcb fn code download ' + n + ' "' + dest + '" -e ' + ENV_ID, { stdio: 'ignore', timeout: 180000 });
      const localIdx = path.join(FN_ROOT, n, 'index.js');
      const remoteIdx = path.join(dest, 'index.js');
      if (!fs.existsSync(remoteIdx)) { console.log('   ?  ' + n.padEnd(24) + '线上代码未取到'); continue; }
      const same = fs.readFileSync(localIdx).equals(fs.readFileSync(remoteIdx));
      console.log('   ' + (same ? '✔ ' : '⚠️ ') + n.padEnd(24) + (same ? 'index.js 一致' : 'index.js 有差异'));
    } catch (e) {
      console.log('   ?  ' + n.padEnd(24) + '下载失败');
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

function main() {
  const deep = process.argv.includes('--deep');
  const repo = repoFunctions();
  const deployed = deployedFunctions();
  const depNames = deployed.map((d) => d.name);
  const orphans = depNames.filter((n) => !repo.includes(n));
  const undeployed = repo.filter((n) => !depNames.includes(n));

  console.log('环境：' + ENV_ID);
  console.log('仓库函数 ' + repo.length + ' 个，线上函数 ' + deployed.length + ' 个');
  console.log('');

  if (orphans.length) {
    console.log('⚠️ 孤儿函数（线上有、仓库无，无人维护，需确认调用方与鉴权）：');
    for (const n of orphans) {
      const d = deployed.find((x) => x.name === n);
      console.log('   ' + n.padEnd(24) + String(d.runtime).padEnd(14) + '最后修改 ' + d.modifyTime);
    }
  } else {
    console.log('✔ 无孤儿函数');
  }

  if (undeployed.length) {
    console.log('');
    console.log('仓库有、线上未部署（多为本地工具函数，或尚未发布）：');
    undeployed.forEach((n) => console.log('   ' + n));
  } else {
    console.log('✔ 仓库函数均已部署');
  }

  if (deep) deepCompare(depNames.filter((n) => repo.includes(n)));

  console.log('');
  if (orphans.length) {
    console.log('✘ 发现 ' + orphans.length + ' 个孤儿函数，请确认其调用方与鉴权情况后再决定处置。');
    process.exitCode = 1;
  } else {
    console.log('✔ 函数清单无漂移。');
  }
}

main();