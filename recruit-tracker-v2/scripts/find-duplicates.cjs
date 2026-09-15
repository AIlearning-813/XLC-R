/**
 * find-duplicates.cjs — 候选人重复组只读分析
 *
 * 背景：邮箱自动归集 → 在「活跃」Tab 搜不到 → 用户手动重导 → 产生重复。
 * 结果全库积累了多组同 fileHash（同一份文件）/ 同手机号的 Candidate 记录。
 *
 * 本脚本【只读】，不写任何数据。
 * 通道：tcb CLI（node-sdk 需要 secretId/secretKey，CLI 走本地登录态）
 *
 * 用法：node scripts/find-duplicates.cjs
 * 输出：控制台摘要 + duplicates-report.json 完整明细
 */

const { execSync } = require('child_process');
const fs = require('fs');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';
const BATCH = 500;

/** 通过 tcb CLI 执行一次 nosql 查询 */
function query(collection, { filter = {}, projection = null, limit = BATCH, skip = 0 } = {}) {
  const inner = { find: collection, filter, limit, skip };
  if (projection) inner.projection = projection;

  const cmd = JSON.stringify([{
    TableName: collection,
    CommandType: 'QUERY',
    Command: JSON.stringify(inner),
  }]);

  const out = execSync(
    `npx tcb db nosql execute --command ${JSON.stringify(cmd)} -e ${ENV_ID} --json`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  );

  const start = out.indexOf('{');
  if (start < 0) throw new Error('CLI 未返回 JSON：' + out.slice(0, 200));
  const parsed = JSON.parse(out.slice(start));
  return parsed?.data?.results?.[0] || [];
}

/** 分页拉全集合并做字段裁剪 */
function fetchAll(collection, projection) {
  const all = [];
  let skip = 0;
  for (;;) {
    const chunk = query(collection, { projection, limit: BATCH, skip });
    all.push(...chunk);
    if (chunk.length < BATCH) break;
    skip += BATCH;
  }
  return all;
}

function ts(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object') {
    if (v.$date) {
      const d = v.$date;
      if (typeof d === 'object' && d.$numberLong) return Number(d.$numberLong);
      return new Date(d).getTime();
    }
    if (v.$numberLong) return Number(v.$numberLong);
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function fmtDate(v) {
  const t = ts(v);
  return t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : '(无)';
}

/**
 * 判定组内保留谁。
 * 优先级：
 *   1. 有「未归档的已分配申请」→ 这是漏斗里在用的记录
 *   2. 有已分配申请（含归档）
 *   3. 有 active 的空 jobId 申请（即当前显示在待分配里的）
 *   4. 都没有申请
 * 同级取 updatedAt 最新，再取 _id（内含创建时间戳）最大。
 */
function rankGroup(group, appsByCandidate) {
  const scored = group.map((c) => {
    const apps = appsByCandidate.get(c._id) || [];
    const assigned = apps.filter((a) => a.jobId && a.jobId !== '');
    const liveAssigned = assigned.filter((a) => a.isArchived !== true);
    const emptyActive = apps.filter(
      (a) => (!a.jobId || a.jobId === '') && a.status === 'active' && a.isArchived !== true
    );
    return {
      candidate: c,
      apps,
      rank: liveAssigned.length > 0 ? 3
        : (assigned.length > 0 ? 2 : (emptyActive.length > 0 ? 1 : 0)),
      sortKey: Math.max(ts(c.updatedAt), ts(c.createdAt)),
    };
  });

  scored.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    return String(b.candidate._id).localeCompare(String(a.candidate._id));
  });
  return scored;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return map;
}

function main() {
  console.log('🔍 候选人重复组分析（只读）\n');

  console.log('📥 拉取 Candidate ...');
  const candidates = fetchAll('Candidate', {
    _id: 1, name: 1, phone: 1, email: 1, fileHash: 1,
    ownerId: 1, createdBy: 1, status: 1, source: 1, createdAt: 1, updatedAt: 1,
  });
  console.log(`   共 ${candidates.length} 条`);

  console.log('📥 拉取 Application ...');
  const applications = fetchAll('Application', {
    _id: 1, candidateId: 1, ownerId: 1, jobId: 1,
    status: 1, stage: 1, isArchived: 1, createdAt: 1, updatedAt: 1,
  });
  console.log(`   共 ${applications.length} 条\n`);

  const appsByCandidate = new Map();
  for (const a of applications) {
    if (!a.candidateId) continue;
    if (!appsByCandidate.has(a.candidateId)) appsByCandidate.set(a.candidateId, []);
    appsByCandidate.get(a.candidateId).push(a);
  }

  const alive = candidates.filter((c) => c.status !== 'deleted');

  const hashGroups = [...groupBy(alive, (c) => c.fileHash && c.fileHash.trim()).entries()]
    .filter(([, g]) => g.length > 1);
  const phoneGroups = [...groupBy(alive, (c) => c.phone && String(c.phone).trim()).entries()]
    .filter(([, g]) => g.length > 1);

  console.log(`📊 同 fileHash 重复组：${hashGroups.length} 组`);
  console.log(`📊 同 phone    重复组：${phoneGroups.length} 组\n`);

  const report = { generatedAt: new Date().toISOString(), byHash: [], byPhone: [] };

  function render(title, groups, keyName) {
    console.log('═'.repeat(84));
    console.log(` ${title}`);
    console.log('═'.repeat(84));
    const out = [];
    for (const [key, group] of groups) {
      const scored = rankGroup(group, appsByCandidate);
      const entry = {
        key: keyName === 'fileHash' ? key.slice(0, 16) + '…' : key,
        rawKey: key,
        members: scored.map((s, i) => ({
          _id: s.candidate._id,
          name: s.candidate.name,
          phone: s.candidate.phone,
          email: s.candidate.email,
          ownerId: s.candidate.ownerId,
          status: s.candidate.status,
          source: s.candidate.source,
          createdAt: fmtDate(s.candidate.createdAt),
          updatedAt: fmtDate(s.candidate.updatedAt),
          rank: s.rank,
          role: i === 0 ? '保留' : '归档',
          apps: s.apps.map((a) => ({
            _id: a._id,
            jobId: a.jobId || '(空)',
            status: a.status,
            stage: a.stage,
            isArchived: a.isArchived === true,
            createdAt: fmtDate(a.createdAt),
          })),
        })),
      };
      out.push(entry);

      console.log(`\n[${entry.key}]  ${entry.members.length} 条`);
      for (const m of entry.members) {
        const tag = m.role === '保留' ? '✅ 保留' : '🗑  归档';
        console.log(`  ${tag}  ${m.name || '(无名)'}  ${m.phone || ''}  owner=${m.ownerId || '-'}`);
        console.log(`         _id=${m._id}  rank=${m.rank}  建于 ${m.createdAt}`);
        if (m.apps.length === 0) console.log('         └ (无申请)');
        for (const a of m.apps) {
          console.log(`         └ jobId=${a.jobId} status=${a.status} stage=${a.stage} archived=${a.isArchived} 建于 ${a.createdAt}`);
        }
      }
    }
    return out;
  }

  report.byHash = render(' 一、同 fileHash（同一份文件被重复录入）', hashGroups, 'fileHash');
  report.byPhone = render(' 二、同手机号', phoneGroups, 'phone');

  fs.writeFileSync('duplicates-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('\n' + '─'.repeat(84));
  console.log('📄 完整明细已写入 duplicates-report.json');
}

main();
