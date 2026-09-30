#!/usr/bin/env node
/**
 * apply-db-security-rules.cjs — 数据库安全规则批量设置（可先看、可验证、可回滚）
 *
 * 为什么需要它：
 *   生产库曾被实测为「匿名访客可读且可写」（见 scripts/probe-anon-access.cjs 与
 *   probe-anon-write.cjs）。收紧规则要在近 20 个集合上逐一设置，控制台点选既慢
 *   又无留痕；本脚本把这件事变成一条可复现、可回滚、可先预览的命令。
 *
 * 规则为什么用 auth.loginType 而不是 auth.uid：
 *   **匿名用户同样有 auth.uid**（随机匿名 ID），所以 { read: 'auth.uid != null' }
 *   会放行匿名访客 —— 漏洞没修却让人以为修好了。官方文档明确匿名登录的
 *   auth.loginType 为 'ANONYMOUS'，据此排除：
 *   https://docs.cloudbase.net/authentication/method/anonymous
 *
 * 凭据：从环境变量读取（不要写进文件、不要提交）
 *   TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY  或  TCB_API_KEY_ID / TCB_API_KEY
 *
 * 用法：
 *   node scripts/apply-db-security-rules.cjs --print-rules       # 预览规则（无需凭据）
 *   node scripts/apply-db-security-rules.cjs --status            # 只读：线上各集合当前权限
 *   node scripts/apply-db-security-rules.cjs --apply --yes       # 收紧
 *   node scripts/apply-db-security-rules.cjs --rollback --yes    # 恢复为放行（仅紧急恢复）
 *
 * 前置条件：必须已完成「自定义登录」的切换（见
 * docs/安全加固-自定义登录与数据库规则.md）。顺序颠倒会导致前端直连读写被拒、系统不可用。
 */

const fs = require('fs');
const path = require('path');

const SECRET_ID = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_API_KEY_ID || '';
const SECRET_KEY = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_API_KEY || '';
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'xlc-recruit-d1gmbx8gybc8a3565';

/** 项目根目录（本文件位于 scripts/ 下） */
const ROOT = path.resolve(__dirname, '..');

/** 前端会直连访问、因此需要保护的集合（Users 单独处理为 ADMINONLY） */
const LOGGED_IN_ONLY = [
  'Candidate', 'Application', 'Job', 'RecruitmentDemand', 'Config',
  'KnowledgeBase', 'CompanyProfile', 'EmailConfig', 'PendingChanges',
  'RecruitmentInsight', 'ParseNotification', 'CommunicationLog',
  'DuplicateExclusion', 'ParseCorrectionBank', 'ReportCache',
  'LoginLog', 'AuditLog', 'ErrorLog',
];

/** 仅 api 侧使用、但为稳妥仍纳入保护的集合（可后续进一步收紧为 ADMINONLY） */
const RULE_LOGGED_IN = JSON.stringify({
  read: "auth.loginType != 'ANONYMOUS'",
  write: "auth.loginType != 'ANONYMOUS'",
});
const RULE_PERMISSIVE = JSON.stringify({ read: true, write: true });

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--print-rules') ? 'print'
  : 'status';
const confirmed = process.argv.includes('--yes');

function die(msg) {
  console.error('✘ ' + msg);
  process.exit(1);
}

/** 扫描前端代码里字面量形式的集合访问（用于自检保护清单完备性） */
function scanClientCollections() {
  const srcRoot = path.join(ROOT, 'src');
  const found = new Set();
  if (!fs.existsSync(srcRoot)) return found;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__mocks__') walk(p);
        continue;
      }
      if (!/\.(js|vue)$/.test(entry.name) || entry.name.endsWith('.test.js')) continue;
      const txt = fs.readFileSync(p, 'utf8');
      for (const m of txt.matchAll(/\.collection\(\s*'([A-Za-z][A-Za-z0-9_]*)'\s*\)/g)) found.add(m[1]);
    }
  };
  walk(srcRoot);
  return found;
}

/** 「前端在用但清单里没有」的集合；非空即说明整改会留下未覆盖的暴露面 */
function completenessGap() {
  const covered = new Set(['Users', ...LOGGED_IN_ONLY]);
  return [...scanClientCollections()].filter((c) => !covered.has(c)).sort();
}

// ===== 预览模式：不需要凭据、也不接触云端 =====
if (mode === 'print') {
  console.log('环境：' + ENV_ID);
  console.log('');
  console.log('--apply 将应用的规则：');
  console.log(('  Users').padEnd(26) + '-> ADMINONLY（客户端完全禁止，仅云函数特权访问）');
  for (const c of LOGGED_IN_ONLY) {
    console.log(('  ' + c).padEnd(26) + '-> CUSTOM ' + RULE_LOGGED_IN);
  }
  const gap = completenessGap();
  console.log('');
  if (gap.length) {
    console.log('⚠️ 保护清单不完整，缺少：' + gap.join(', ') + '（--apply 会因此中止）');
  } else {
    console.log('✔ 保护清单完备：前端访问到的集合均已覆盖');
  }
  console.log('--rollback 会把这些集合恢复为：' + RULE_PERMISSIVE);
  process.exit(0);
}

// ===== 其余模式需要凭据 =====
if (!SECRET_ID || !SECRET_KEY) {
  console.error('✘ 缺少腾讯云凭据。请先设置环境变量后重试：');
  console.error('    $env:TENCENTCLOUD_SECRETID="<SecretId>"');
  console.error('    $env:TENCENTCLOUD_SECRETKEY="<SecretKey>"');
  console.error('  （凭据只在本机进程内使用，不会写入任何文件）');
  process.exit(1);
}
if (mode !== 'status' && !confirmed) {
  console.error('✘ 这是会改动线上权限的操作，请追加 --yes 明确确认。');
  console.error('  建议先执行 --status 查看当前状态。');
  process.exit(1);
}

function loadManagerNode() {
  const candidates = ['@cloudbase/manager-node'];
  if (process.env.CBSDK_DIR) {
    candidates.push(path.join(process.env.CBSDK_DIR, 'node_modules', '@cloudbase', 'manager-node'));
  }
  for (const c of candidates) {
    try { return require(c); } catch { /* 继续尝试下一个 */ }
  }
  return null;
}

const _mod = loadManagerNode();
if (!_mod) {
  die('未找到 @cloudbase/manager-node。两种方式任选：\n' +
      '  a) 临时目录安装并指定 CBSDK_DIR：\n' +
      '     mkdir /tmp/cbsdk && cd /tmp/cbsdk && npm i @cloudbase/manager-node\n' +
      '     $env:CBSDK_DIR="/tmp/cbsdk"\n' +
      '  b) 或在项目内安装：npm i -D @cloudbase/manager-node');
}
const CloudBase = _mod.default || _mod.CloudBase || _mod;
const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID });
const permission = app.permission;

async function main() {
  const gap = completenessGap();
  if (gap.length) {
    die('保护清单不完整：以下集合被前端代码访问却未纳入保护 → ' + gap.join(', ') +
        '\n  这会留下未覆盖的暴露面（正是「假修复」的来源），已中止。');
  }

  console.log('环境：' + ENV_ID);
  console.log('模式：' + mode + '\n');

  const all = ['Users', ...LOGGED_IN_ONLY];

  // 探测授权引擎：老环境使用 ModifyResourcePermission；启用 OPA 的环境需另一套接口
  if (typeof permission.isOpaAuthzEngine === 'function') {
    try {
      const opa = await permission.isOpaAuthzEngine();
      console.log('授权引擎：' + (opa
        ? 'OPA（本脚本的旧接口可能不生效，需改用 modifyEnvAuthzConfig）'
        : '传统（ModifyResourcePermission）'));
    } catch { /* 探测失败不阻塞 */ }
  }

  if (mode === 'status') {
    const res = await permission.describeResourcePermission({ resourceType: 'collection', resources: all });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const targets = mode === 'apply'
    ? {
        Users: { permission: 'ADMINONLY' },
        ...Object.fromEntries(LOGGED_IN_ONLY.map((c) => [c, { permission: 'CUSTOM', securityRule: RULE_LOGGED_IN }])),
      }
    : Object.fromEntries(all.map((c) => [c, { permission: 'CUSTOM', securityRule: RULE_PERMISSIVE }]));

  let ok = 0;
  let fail = 0;
  for (const [collection, cfg] of Object.entries(targets)) {
    try {
      await permission.modifyResourcePermission({ resourceType: 'collection', resource: collection, ...cfg });
      console.log('  ✔ ' + collection.padEnd(22) + cfg.permission);
      ok++;
    } catch (e) {
      console.log('  ✘ ' + collection.padEnd(22) + (e && e.message));
      fail++;
    }
  }
  console.log('\n完成：成功 ' + ok + '，失败 ' + fail);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => die(e && e.message ? e.message : String(e)));