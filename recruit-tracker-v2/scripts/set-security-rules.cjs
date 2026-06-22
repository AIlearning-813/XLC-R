/**
 * 批量设置 CloudBase 数据库安全规则（10 条）
 * 用法：node scripts/set-security-rules.cjs
 */
const { spawnSync } = require('child_process');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

const rules = [
  {
    name: 'User',
    rule: {
      read: "auth.uid != null && (doc._openid == auth.uid || get('database.User.' + auth.uid).role == 'admin')",
      write: "get('database.User.' + auth.uid).role == 'admin'",
    },
  },
  {
    name: 'Job',
    rule: {
      read: "auth.uid != null",
      create: "get('database.User.' + auth.uid).role == 'admin'",
      update: "get('database.User.' + auth.uid).role == 'admin'",
      delete: false,
    },
  },
  {
    name: 'Candidate',
    rule: {
      read: "auth.uid != null",
      write: "auth.uid != null && (doc.createdBy == auth.uid || get('database.User.' + auth.uid).role == 'admin')",
    },
  },
  {
    name: 'Application',
    rule: {
      read: "auth.uid != null && (doc.ownerId == auth.uid || get('database.User.' + auth.uid).role == 'admin')",
      write: "auth.uid != null && (doc.ownerId == auth.uid || get('database.User.' + auth.uid).role == 'admin')",
    },
  },
  {
    name: 'EmailConfig',
    rule: {
      read: "auth.uid != null && (doc.userId == auth.uid || get('database.User.' + auth.uid).role == 'admin')",
      write: "auth.uid != null && (doc.userId == auth.uid || get('database.User.' + auth.uid).role == 'admin')",
    },
  },
  {
    name: 'PendingChanges',
    rule: {
      read: "auth.uid != null",
      create: "auth.uid != null",
      update: "get('database.User.' + auth.uid).role == 'admin'",
      delete: false,
    },
  },
  {
    name: 'AuditLog',
    rule: {
      read: "get('database.User.' + auth.uid).role == 'admin'",
      write: false,
    },
  },
  {
    name: 'ReportCache',
    rule: {
      read: "auth.uid != null",
      write: false,
    },
  },
  {
    name: 'ParseQueue',
    rule: {
      read: "auth.uid != null",
      write: false,
    },
  },
  {
    name: 'ErrorLog',
    rule: {
      read: "get('database.User.' + auth.uid).role == 'admin'",
      write: "auth.uid != null",
    },
  },
];

const extraRules = [
  {
    name: 'CompanyProfile',
    rule: {
      read: "auth.uid != null",
      write: "get('database.User.' + auth.uid).role == 'admin'",
    },
  },
  {
    name: 'KnowledgeBase',
    rule: {
      read: "auth.uid != null",
      write: "get('database.User.' + auth.uid).role == 'admin'",
    },
  },
  {
    name: 'RecruitmentInsight',
    rule: {
      read: "auth.uid != null",
      write: "get('database.User.' + auth.uid).role == 'admin'",
    },
  },
];

console.log(`🔐 开始设置安全规则...\n`);

let success = 0;
let fail = 0;

function setRule(name, rule) {
  const ruleJson = JSON.stringify(rule);
  const args = [
    'permission', 'set',
    `collection:${name}`,
    '--level', 'custom',
    '--rule', ruleJson,
    '-e', ENV_ID,
  ];

  const result = spawnSync('tcb', args, { encoding: 'utf-8', stdio: 'pipe' });
  const stderr = (result.stderr || '').trim();
  const stdout = (result.stdout || '').trim();

  if (result.status === 0 || stdout.includes('成功') || stdout.includes('success')) {
    console.log(`✅ ${name.padEnd(20)} 已部署`);
    return true;
  } else {
    // 提取有用的错误信息
    const errMsg = stderr.split('\n').filter(l => l && !l.includes('数据加载中') && !l.includes('试试 tcb ai')).pop() || stderr;
    console.log(`❌ ${name.padEnd(20)} ${errMsg}`);
    if (stdout) console.log(`   stdout: ${stdout.substring(0, 100)}`);
    return false;
  }
}

for (const { name, rule } of rules) {
  if (setRule(name, rule)) success++; else fail++;
}

console.log(`\n📝 额外集合...`);
for (const { name, rule } of extraRules) {
  if (setRule(name, rule)) success++; else fail++;
}

console.log(`\n🎯 总计：${success} 成功 / ${fail} 失败`);
