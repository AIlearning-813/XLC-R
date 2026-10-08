#!/usr/bin/env node
/**
 * apply-db-security-rules.cjs — 数据库安全规则批量设置（可先看、可验证、可回滚）
 *
 * ⚠️ 2026-10-08 用 --status 实测到的现状（19 个集合），是本脚本全部设计的依据：
 *   · 多数集合为 CUSTOM { read: "auth.uid != null", write: "auth.uid != null" }
 *   · 但**匿名用户同样有 auth.uid**（随机匿名 ID），这条规则因此对匿名访客等于没拦
 *     ——「看似配了规则、实测仍可匿名读写」的根因就在这里。
 *   · 少数集合原本更严：Users / LoginLog 为 PRIVATE（仅创建者可读写）；
 *     ParseNotification / DuplicateExclusion 为 ADMINWRITE（所有用户可读、仅管理端可写）；
 *     ReportCache、AuditLog 的 write 为 false；PendingChanges 的 delete 为 false。
 *
 * 🔒 核心原则：**只收紧身份判据，绝不放宽任何既有约束。**
 *   初版设计对所有集合统一写 { read, write }，会把上面那些更严的设置一并放宽
 *   （write:false → 可写、ADMINWRITE → 客户端可写、PRIVATE → 登录用户可读），
 *   等于修漏洞时开新口子。现在按集合保留原有形状，并加装运行时拦截：
 *   --apply 前会拉取线上现状，一旦发现「目标比现状宽松」立即中止（见 assertNoLoosening）。
 *
 * 凭据：从环境变量读取（不要写进文件、不要提交）
 *   TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY  或  TCB_API_KEY_ID / TCB_API_KEY
 *   SDK 找不到时可用 CBSDK_DIR 指定临时安装目录
 *
 * 用法：
 *   node scripts/apply-db-security-rules.cjs --print-rules    # 预览目标规则（无需凭据）
 *   node scripts/apply-db-security-rules.cjs --status         # 只读：线上各集合当前权限
 *   node scripts/apply-db-security-rules.cjs --apply --yes    # 收紧（含「不得放宽」拦截）
 *   node scripts/apply-db-security-rules.cjs --rollback --yes # 恢复到 2026-10-08 实测基线
 *
 * 前置条件：必须先完成自定义登录切换并**确认前端能拿到非匿名会话**
 * （见 docs/安全加固-自定义登录与数据库规则.md）。顺序颠倒会导致前端读写被拒、系统不可用。
 */

const fs = require('fs');
const path = require('path');

const SECRET_ID = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_API_KEY_ID || '';
const SECRET_KEY = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_API_KEY || '';
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'xlc-recruit-d1gmbx8gybc8a3565';

const ROOT = path.resolve(__dirname, '..');

/** 旧判据：匿名用户同样满足，因此挡不住匿名访客 */
const U = "auth.uid != null";
/** 新判据：匿名登录的 loginType 为 'ANONYMOUS' */
const R = "auth.loginType != 'ANONYMOUS'";
const j = (o) => JSON.stringify(o);

/** 统一的「仅登录用户可读写」配置（对应现状形状，只换判据） */
const READ_WRITE = () => ({ permission: 'CUSTOM', securityRule: j({ read: R, write: R }) });

/**
 * 目标规则表。每条都对应现状，只是把身份判据换成 R；
 * 现状里更严的部分（write:false / delete:false / ADMINWRITE 的写限制）**原样保留**。
 */
const TARGETS = {
  Candidate: READ_WRITE(),
  Application: READ_WRITE(),
  Job: READ_WRITE(),
  RecruitmentDemand: READ_WRITE(),
  Config: READ_WRITE(),
  KnowledgeBase: READ_WRITE(),
  CompanyProfile: READ_WRITE(),
  EmailConfig: READ_WRITE(),
  RecruitmentInsight: READ_WRITE(),
  CommunicationLog: READ_WRITE(),
  ParseCorrectionBank: READ_WRITE(),
  ErrorLog: READ_WRITE(),

  // 现状 delete:false —— 必须保留，否则等于放开删除
  PendingChanges: { permission: 'CUSTOM', securityRule: j({ read: R, create: R, update: R, delete: false }) },
  // 现状 write:false —— 必须保留（客户端本就不可写）
  ReportCache: { permission: 'CUSTOM', securityRule: j({ read: R, write: false }) },
  AuditLog: { permission: 'CUSTOM', securityRule: j({ read: R, write: false }) },
  // 现状 ADMINWRITE（所有用户可读、仅管理端可写）→ 读收紧，写维持「客户端不可写」
  ParseNotification: { permission: 'CUSTOM', securityRule: j({ read: R, write: false }) },
  DuplicateExclusion: { permission: 'CUSTOM', securityRule: j({ read: R, write: false }) },

  // 现状 PRIVATE（仅创建者可读写）→ 收紧为仅管理端。前端无任何直连 Users 的调用（已核对）
  Users: { permission: 'ADMINONLY' },
};

/** 刻意不动的集合 */
const UNTOUCHED = {
  LoginLog: 'PRIVATE（仅创建者可读写）。记录由云函数写入、无客户端创建者，客户端实际读不到；改成 CUSTOM 反而会放开给所有登录用户，故刻意不动',
};

/** 回滚基线：2026-10-08 --status 的实测结果，按原样恢复 */
const BASELINE_SPECIAL = {
  Users: { permission: 'PRIVATE' },
  LoginLog: { permission: 'PRIVATE' },
  ParseNotification: { permission: 'ADMINWRITE' },
  DuplicateExclusion: { permission: 'ADMINWRITE' },
  PendingChanges: { permission: 'CUSTOM', securityRule: j({ read: U, create: U, update: U, delete: false }) },
  ReportCache: { permission: 'CUSTOM', securityRule: j({ read: U, write: false }) },
  AuditLog: { permission: 'CUSTOM', securityRule: j({ read: U, write: false }) },
};
function baselineFor(coll) {
  return BASELINE_SPECIAL[coll] || { permission: 'CUSTOM', securityRule: j({ read: U, write: U }) };
}

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--print-rules') ? 'print'
  : 'status';
const confirmed = process.argv.includes('--yes');

/**
 * 金丝雀开关：--only=ErrorLog 只对指定集合生效。
 * 用途：正式收紧全库前，先在单个集合上确认「新判据真的能拦住匿名访客」，
 * 再推全量——避免一次性改完才发现规则未生效。
 */
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

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

/** 「前端在用但既没纳入目标、也不是刻意不动」的集合；非空即说明整改会留下暴露面 */
function completenessGap() {
  const covered = new Set([...Object.keys(TARGETS), ...Object.keys(UNTOUCHED)]);
  return [...scanClientCollections()].filter((c) => !covered.has(c)).sort();
}

/**
 * 「不得放宽」拦截：把目标与线上现状逐集合比对。
 * 只要目标比现状宽松就返回问题清单（--apply 会因此中止）。
 */
function assertNoLoosening(targets, currentMap) {
  const problems = [];
  for (const [coll, cfg] of Object.entries(targets)) {
    const cur = currentMap[coll];
    if (!cur) { problems.push(`${coll}：线上未查到当前权限，无法确认不会放宽（请先 --status）`); continue; }

    // 1) 现状已是客户端完全不可访问的，绝不允许变成 CUSTOM
    if ((cur.permission === 'PRIVATE' || cur.permission === 'ADMINONLY') && cfg.permission === 'CUSTOM') {
      problems.push(`${coll}：现状 ${cur.permission}（客户端不可访问）→ 目标 CUSTOM 会放开`);
      continue;
    }
    // 2) 现状规则里显式为 false 的键，目标必须仍为 false
    let curRule = null;
    try { curRule = cur.securityRule ? JSON.parse(cur.securityRule) : null; } catch { curRule = null; }
    let tgtRule = null;
    if (cfg.permission === 'CUSTOM' && cfg.securityRule) {
      try { tgtRule = JSON.parse(cfg.securityRule); } catch { tgtRule = null; }
    }
    if (curRule) {
      for (const [k, v] of Object.entries(curRule)) {
        if (v === false && (!tgtRule || tgtRule[k] !== false)) {
          problems.push(`${coll}：现状 ${k}=false（禁止），目标未保持 false`);
        }
      }
      // 现状未出现的键（如 create/update/delete）不应被目标新开权限
      if (tgtRule) {
        for (const k of Object.keys(tgtRule)) {
          if (!(k in curRule) && k !== 'read' && k !== 'write') {
            problems.push(`${coll}：现状未定义 ${k}，目标却新增了该权限`);
          }
        }
      }
    }
    // 3) 现状 ADMINWRITE（客户端不可写）时，目标不得给写入权限
    if (cur.permission === 'ADMINWRITE' && tgtRule) {
      const allowsWrite = tgtRule.write === R || tgtRule.write === true || tgtRule.create === R;
      if (allowsWrite) problems.push(`${coll}：现状 ADMINWRITE（客户端不可写）→ 目标允许写入`);
    }
  }
  return problems;
}

// ===== 预览模式：不需要凭据、也不接触云端 =====
if (mode === 'print') {
  console.log('环境：' + ENV_ID);
  console.log('');
  console.log('--apply 将应用的规则（身份判据 auth.uid != null → auth.loginType != ANONYMOUS）：');
  for (const [coll, cfg] of Object.entries(TARGETS)) {
    const detail = cfg.permission === 'CUSTOM' ? cfg.securityRule : cfg.permission;
    console.log('  ' + coll.padEnd(22) + detail);
  }
  console.log('');
  console.log('刻意不动的集合：');
  for (const [coll, why] of Object.entries(UNTOUCHED)) console.log('  ' + coll.padEnd(22) + why);
  const gap = completenessGap();
  console.log('');
  console.log(gap.length
    ? '⚠️ 保护清单不完整，缺少：' + gap.join(', ') + '（--apply 会因此中止）'
    : '✔ 保护清单完备：前端访问到的集合均已覆盖');
  console.log('');
  console.log('--rollback 会按 2026-10-08 实测基线恢复（含 Users/LoginLog 的 PRIVATE）。');
  process.exit(0);
}

// ===== 其余模式需要凭据 =====
if (!SECRET_ID || !SECRET_KEY) {
  console.error('✘ 缺少腾讯云凭据。请在 PowerShell 中先设置（只对本窗口有效）：');
  console.error('    $env:TENCENTCLOUD_SECRETID="<SecretId>"');
  console.error('    $env:TENCENTCLOUD_SECRETKEY="<SecretKey>"');
  process.exit(1);
}
if (mode !== 'status' && !confirmed) {
  console.error('✘ 这是会改动线上权限的操作，请追加 --yes 明确确认（建议先 --status）。');
  process.exit(1);
}

function loadManagerNode() {
  const candidates = ['@cloudbase/manager-node'];
  if (process.env.CBSDK_DIR) {
    candidates.push(path.join(process.env.CBSDK_DIR, 'node_modules', '@cloudbase', 'manager-node'));
  }
  for (const c of candidates) {
    try { return require(c); } catch { /* 尝试下一个 */ }
  }
  return null;
}

const _mod = loadManagerNode();
if (!_mod) {
  die('未找到 @cloudbase/manager-node。可临时安装后指定 CBSDK_DIR：\n' +
      '  mkdir C:\\cbsdk -Force; cd C:\\cbsdk; npm i @cloudbase/manager-node\n' +
      '  $env:CBSDK_DIR="C:\\cbsdk"');
}
const CloudBase = _mod.default || _mod.CloudBase || _mod;
const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID });
const permission = app.permission;

function toMap(list) {
  const map = {};
  for (const it of list || []) {
    map[it.Resource] = { permission: it.Permission, securityRule: it.SecurityRule || '' };
  }
  return map;
}

async function fetchCurrent(resources) {
  const res = await permission.describeResourcePermission({ resourceType: 'collection', resources });
  const list = (res && (res.PermissionList || (res.Data && res.Data.PermissionList))) || [];
  return toMap(list);
}

async function main() {
  const gap = completenessGap();
  if (gap.length) {
    die('保护清单不完整：以下集合被前端代码访问却未纳入保护 → ' + gap.join(', ') +
        '\n  这会留下未覆盖的暴露面，已中止。');
  }

  console.log('环境：' + ENV_ID);
  console.log('模式：' + mode + '\n');

  const all = [...new Set([...Object.keys(TARGETS), ...Object.keys(UNTOUCHED), ...Object.keys(BASELINE_SPECIAL)])];
  const current = await fetchCurrent(all);

  if (mode === 'status') {
    for (const coll of all) {
      const c = current[coll];
      console.log('  ' + coll.padEnd(22) + (c ? c.permission.padEnd(12) + (c.securityRule || '') : '(未查到)'));
    }
    console.log('');
    console.log('「不得放宽」预检结果：');
    const problems = assertNoLoosening(TARGETS, current);
    if (!problems.length) console.log('  ✔ 目标规则没有比现状更宽松的地方');
    else problems.forEach((p) => console.log('  ⚠️ ' + p));
    return;
  }

  const targets = mode === 'apply' ? TARGETS : baselineFor;
  let entries = mode === 'apply'
    ? Object.entries(TARGETS)
    : all.map((c) => [c, baselineFor(c)]);

  if (ONLY) {
    const valid = mode === 'apply' ? Object.keys(TARGETS) : all;
    const unknown = ONLY.filter((c) => !valid.includes(c));
    if (unknown.length) die('--only 指定的集合无效：' + unknown.join(', '));
    entries = entries.filter(([c]) => ONLY.includes(c));
    console.log('金丝雀模式（' + mode + '）：仅对 ' + ONLY.join(', ') + ' 生效\n');
  }

  if (mode === 'apply') {
    const problems = assertNoLoosening(Object.fromEntries(entries), current);
    if (problems.length) {
      console.error('✘ 「不得放宽」拦截：以下地方目标规则比现状宽松，已中止，未改动任何线上设置：');
      problems.forEach((p) => console.error('  · ' + p));
      process.exit(1);
    }
    console.log('✔ 「不得放宽」预检通过\n');
  }

  let ok = 0;
  let fail = 0;
  for (const [collection, cfg] of entries) {
    const payload = { resourceType: 'collection', resource: collection, permission: cfg.permission };
    if (cfg.securityRule) payload.securityRule = cfg.securityRule;
    try {
      await permission.modifyResourcePermission(payload);
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