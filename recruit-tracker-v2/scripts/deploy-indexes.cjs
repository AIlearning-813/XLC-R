#!/usr/bin/env node
/**
 * deploy-indexes.cjs — CloudBase 数据库索引「控制台操作清单」生成器
 *
 * 使用方法：node scripts/deploy-indexes.cjs
 *
 * ⚠️ 这个脚本**不会**创建任何索引，只打印清单。这不是偷懒，是能力边界：
 *   - `@cloudbase/node-sdk` 与 `@cloudbase/database` 都**没有** `createIndex`；
 *   - tcb CLI 的 NoSQL 子命令只有 QUERY / INSERT / UPDATE / DELETE / COMMAND；
 *   - 索引只能在 CloudBase 控制台手动创建。
 * 本脚本此前直接调用 `db.collection(x).createIndex(...)`，那是个不存在的方法，
 * 跑起来必定 TypeError —— 所以它从未真正建过索引，`init-all.sh` 里的这一步一直是空转。
 *
 * 现在它做三件事：
 *   1. 打印逐条的控制台操作清单（含字段与方向，可直接照抄）；
 *   2. 打印可直接粘进 `init-database.md` 的表格行；
 *   3. **交叉校验**：读 `init-database.md`，比对「集合名 + 索引名」集合是否一致，
 *      不一致就报错并以非零码退出。此前脚本声明 21 条、文档记录 28 条，长期对不上，
 *      这一步就是为了让这种漂移在 CI / 本地显式暴露，而不是靠人去发现。
 */

const fs = require('fs');
const path = require('path');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';
const DOC_PATH = path.join(__dirname, 'init-database.md');

/**
 * 索引定义 —— **本数组是本项目索引的唯一事实来源**。
 * 改动后必须同步 `init-database.md`，否则脚本第 3 步会报错（这是有意的）。
 * dir: 1 = 升序，-1 = 降序（与 CloudBase 控制台的方向选择一一对应）
 */
const INDEXES = [
  // ===== 基础 19 条 =====
  { collection: 'Users', indexName: 'openid_unique', unique: true, keys: [['_openid', 1]] },
  { collection: 'Job', indexName: 'dept_status', keys: [['department', 1], ['status', 1]] },
  { collection: 'Candidate', indexName: 'phone_idx', keys: [['phone', 1]] },
  { collection: 'Application', indexName: 'owner_status', keys: [['ownerId', 1], ['status', 1]] },
  { collection: 'Application', indexName: 'job_status', keys: [['jobId', 1], ['status', 1]] },
  { collection: 'EmailConfig', indexName: 'user_unique', unique: true, keys: [['userId', 1]] },
  { collection: 'ParseQueue', indexName: 'status_time', keys: [['status', 1], ['createdAt', 1]] },
  { collection: 'ParseNotification', indexName: 'user_status_time', keys: [['userId', 1], ['status', 1], ['createdAt', -1]] },
  { collection: 'AuditLog', indexName: 'time_desc', keys: [['createdAt', -1]] },
  { collection: 'PendingChanges', indexName: 'status_time', keys: [['status', 1], ['submittedAt', 1]] },
  { collection: 'ErrorLog', indexName: 'time_desc', keys: [['createdAt', -1]] },
  { collection: 'ErrorLog', indexName: 'severity_time', keys: [['severity', 1], ['createdAt', -1]] },
  { collection: 'KnowledgeBase', indexName: 'category_status', keys: [['category', 1], ['status', 1]] },
  { collection: 'KnowledgeBase', indexName: 'time_desc', keys: [['createdAt', -1]] },
  { collection: 'RecruitmentInsight', indexName: 'type_idx', keys: [['type', 1]] },
  { collection: 'DuplicateExclusion', indexName: 'candA', keys: [['candidateA', 1]] },
  { collection: 'DuplicateExclusion', indexName: 'candB', keys: [['candidateB', 1]] },
  { collection: 'ReportCache', indexName: 'type_expires', keys: [['reportType', 1], ['expiresAt', 1]] },

  // ===== P0-3 新增 =====
  { collection: 'CommunicationLog', indexName: 'cand_time', keys: [['candidateId', 1], ['createdAt', -1]] },
  { collection: 'ParseCorrectionBank', indexName: 'field_ov_cv', keys: [['field', 1], ['originalValue', 1], ['correctedValue', 1]] },
  { collection: 'ProcessingLock', indexName: 'lock_unique', unique: true, keys: [['lockKey', 1]] },

  // ===== P1-2 新增 5 条 =====
  { collection: 'Candidate', indexName: 'status_deleted', keys: [['status', 1], ['deletedAt', -1]] },
  { collection: 'Candidate', indexName: 'phone_hash', keys: [['phoneHash', 1]] },
  { collection: 'Candidate', indexName: 'email_hash', keys: [['emailHash', 1]] },
  { collection: 'Application', indexName: 'cand_status', keys: [['candidateId', 1], ['status', 1]] },
  { collection: 'ParseQueue', indexName: 'source_config', keys: [['sourceEmailConfigId', 1]] },

  // ===== D-2 新增 5 条：候选人列表分页下推 =====
  // 方向必须与代码里的排序链逐位一致（updatedAt desc, _id asc），
  // 否则 CloudBase 会退化成 32MB 阻塞式内存排序（且查询会在超限时直接失败）。
  // ownerId 必须最左：专员视角每次查询都以「ownerId = 我」开头，复合索引只有在最左字段
  // 被等值约束时，后续字段才能同时充当扫描边界与排序键（ESR 规则）。
  // admin 查询不带 ownerId，用不上下面两条 ownerId 前缀索引，故必须另建 status 前缀的两条。
  { collection: 'Application', indexName: 'owner_status_updated', keys: [['ownerId', 1], ['status', 1], ['updatedAt', -1], ['_id', 1]] },
  { collection: 'Application', indexName: 'status_updated', keys: [['status', 1], ['updatedAt', -1], ['_id', 1]] },
  { collection: 'Application', indexName: 'owner_cand', keys: [['ownerId', 1], ['candidateId', 1]] },
  { collection: 'Application', indexName: 'cand', keys: [['candidateId', 1]] },
  { collection: 'Candidate', indexName: 'owner_id', keys: [['ownerId', 1], ['_id', 1]] },
];

/** 收集 init-database.md 里记录的「集合名|索引名」，用于交叉校验 */
function readDocIndexKeys() {
  if (!fs.existsSync(DOC_PATH)) return null;
  const rows = fs.readFileSync(DOC_PATH, 'utf8').split(/\r?\n/);
  const found = new Set();
  for (const line of rows) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // 表格列：| # | 集合名 | 权限预设 | 索引名 | 字段 | 方向 | 唯一 | 说明 |
    if (cells.length < 6) continue;
    const num = cells[1];
    if (!/^\d+$/.test(num)) continue;                    // 跳过表头与分隔行
    const collection = cells[2].replace(/\*\*/g, '');
    const indexName = cells[4].replace(/`/g, '').replace(/\*\*/g, '');
    if (!collection || indexName === '—' || !indexName) continue; // 无索引的集合（如 CompanyProfile）
    found.add(`${collection}|${indexName}`);
  }
  return found;
}

function printChecklist() {
  console.log(`\n📋 CloudBase 控制台操作清单（环境 ${ENV_ID}）`);
  console.log('   路径：控制台 → 数据库 → 选择集合 → 索引管理 → 新建索引\n');
  console.log('   #   集合                 索引名                    字段');
  console.log('   ' + '─'.repeat(88));
  INDEXES.forEach((idx, i) => {
    const fields = idx.keys.map(([n, d]) => `${n} ${d === -1 ? '↓降序' : '↑升序'}`).join(' + ');
    const uniq = idx.unique ? '  [唯一]' : '';
    console.log(
      `   ${String(i + 1).padStart(2)}  ${idx.collection.padEnd(20)} ${idx.indexName.padEnd(24)} ${fields}${uniq}`
    );
  });
}

function printMarkdownRows(startNo) {
  console.log('\n📄 可直接粘进 init-database.md 的表格行（编号按本脚本声明顺序，与文档现有编号可能不同）：\n');
  INDEXES.forEach((idx, i) => {
    const fields = idx.keys.map(([n]) => `\`${n}\``).join(' + ');
    const dirs = idx.keys.map(([, d]) => (d === -1 ? '↓ 降序' : '↑ 升序')).join(' + ');
    const uniq = idx.unique ? '✅' : '❌';
    console.log(`| ${startNo + i} | **${idx.collection}** | ADMINWRITE | \`${idx.indexName}\` | ${fields} | ${dirs} | ${uniq} | |`);
  });
}

function crossCheck() {
  const docKeys = readDocIndexKeys();
  if (docKeys === null) {
    console.log(`\n⚠️  未找到 ${path.relative(process.cwd(), DOC_PATH)}，跳过交叉校验。`);
    return true;
  }

  const scriptKeys = new Set(INDEXES.map((i) => `${i.collection}|${i.indexName}`));
  const onlyInScript = [...scriptKeys].filter((k) => !docKeys.has(k));
  const onlyInDoc = [...docKeys].filter((k) => !scriptKeys.has(k));

  console.log('\n🔍 交叉校验 init-database.md');
  if (onlyInScript.length === 0 && onlyInDoc.length === 0) {
    console.log(`   ✅ 与文档一致（共 ${scriptKeys.size} 条索引）`);
    return true;
  }
  if (onlyInScript.length > 0) {
    console.log('   ❌ 只在本脚本里，文档缺记：');
    onlyInScript.forEach((k) => console.log(`      - ${k.replace('|', ' . ')}`));
  }
  if (onlyInDoc.length > 0) {
    console.log('   ❌ 只在文档里，本脚本未声明：');
    onlyInDoc.forEach((k) => console.log(`      - ${k.replace('|', ' . ')}`));
  }
  console.log('   请让两者对齐后再上线（文档是给人看的，脚本是给校验用的，不能各说各话）。');
  return false;
}

function main() {
  console.log('🚀 CloudBase 索引部署 —— 控制台操作清单');
  console.log('   本脚本不连接数据库、不做任何写操作（SDK 与 CLI 均不支持创建索引）。');

  printChecklist();
  printMarkdownRows(1);
  const ok = crossCheck();

  const uniqCount = INDEXES.filter((i) => i.unique).length;
  console.log(`\n📊 合计 ${INDEXES.length} 条索引（其中唯一索引 ${uniqCount} 条）`);
  console.log('   全部非唯一以外的方向请严格照抄：方向不匹配会让排序退化成内存排序。');

  if (!ok) process.exit(1);
  console.log('✅ 清单已输出，请逐条在控制台创建。');
}

main();
