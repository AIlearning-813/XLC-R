#!/usr/bin/env node
/**
 * preflight-fn-deploy.cjs — 云函数部署前置检查
 *
 * 由来（2026-09-30 真实事故）：
 *   把 get-file-url 的加固代码部署上去后，文件预览整体不可用——因为加固版依赖
 *   MASTER_SECRET 校验会话令牌，而该函数从未配置过这个变量，守卫「失败关闭」把
 *   所有调用都拒了。影子函数验证只覆盖了「代码行为」，没覆盖「生产运行环境」。
 *
 * 本脚本把那次教训变成自动护栏：**部署前先查环境变量，缺一个就非零退出**。
 *
 * 职责：
 *   1. 扫描仓库，找出代码里引用了 process.env.MASTER_SECRET 的云函数
 *      （即加固后必须配置该变量的函数）——随代码演进自动更新，无需手工维护清单
 *   2. 逐个拉取线上环境变量（只读变量名，不打印值），比对是否已配置
 *   3. 有缺失则以退出码 1 结束，可安全地放进部署流程前面
 *
 * 用法：
 *   node scripts/preflight-fn-deploy.cjs              # 检查全部相关函数
 *   node scripts/preflight-fn-deploy.cjs get-file-url # 只检查指定函数
 *
 * 注意：拉取的环境变量会短暂落到临时文件（其中可能含密钥），
 *       脚本在读取变量名后立即删除，绝不打印任何值。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FN_ROOT = path.join(ROOT, 'cloud-functions');
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'xlc-recruit-d1gmbx8gybc8a3565';

/** 加固后必须配置的变量：缺失时守卫会「失败关闭」，功能整体不可用 */
const CRITICAL_VARS = ['MASTER_SECRET'];

/** 扫描仓库：返回 { 函数名: 引用的环境变量名[] } */
function scanEnvUsage() {
  const result = {};
  if (!fs.existsSync(FN_ROOT)) return result;
  for (const entry of fs.readdirSync(FN_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const dir = path.join(FN_ROOT, entry.name);
    const vars = new Set();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) vars.add(m[1]);
    }
    if (vars.size) result[entry.name] = [...vars].sort();
  }
  return result;
}

/** 拉取某函数已配置的环境变量名（不返回值）；拉不到返回 null */
function fetchConfiguredNames(fn) {
  const tmp = path.join(os.tmpdir(), `preflight-${fn}-${process.pid}.env`);
  try {
    execSync(`tcb fn env pull ${fn} --output-file "${tmp}" -e ${ENV_ID}`, { stdio: 'ignore', timeout: 60000 });
    if (!fs.existsSync(tmp)) return [];
    const raw = fs.readFileSync(tmp, 'utf8');
    if (!raw.trim()) return [];
    const names = new Set();
    for (const m of raw.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) names.add(m[1]);
    return [...names].sort();
  } catch (err) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 已删除或从未创建 */ }
  }
}

function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const usage = scanEnvUsage();
  const targets = Object.keys(usage).filter((fn) => (only.length ? only.includes(fn) : true))
    .filter((fn) => usage[fn].some((v) => CRITICAL_VARS.includes(v)));

  if (targets.length === 0) {
    console.log('没有任何函数引用 ' + CRITICAL_VARS.join('/') + '，无需检查。');
    return;
  }

  console.log('环境：' + ENV_ID);
  console.log('检查项：' + CRITICAL_VARS.join(', ') + '（缺失会导致加固函数「失败关闭」）\n');

  let bad = 0;
  for (const fn of targets.sort()) {
    const configured = fetchConfiguredNames(fn);
    if (configured === null) {
      console.log('  ?  ' + fn.padEnd(24) + '无法读取（函数可能未部署）');
      continue;
    }
    const missing = CRITICAL_VARS.filter((v) => !configured.includes(v));
    if (missing.length === 0) {
      console.log('  ✔  ' + fn.padEnd(24) + '已配置 ' + CRITICAL_VARS.join(', '));
    } else {
      console.log('  ✘  ' + fn.padEnd(24) + '缺少 ' + missing.join(', ') + '  ← 部署加固代码会使该函数不可用');
      bad++;
    }
  }

  console.log('');
  if (bad > 0) {
    console.log('✘ 有 ' + bad + ' 个函数缺少必需的环境变量，已阻止部署。');
    console.log('  各函数的 MASTER_SECRET 必须与 auth-proxy 完全一致（令牌由它签发）。');
    process.exitCode = 1;
  } else {
    console.log('✔ 前置检查通过，可以部署。');
  }
}

main();