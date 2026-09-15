/**
 * 对重复组分类（只读）
 *
 * 判断"清理会不会丢东西"的准确口径：
 *   归档某条成员记录后，它名下的【活动申请】所对应的岗位，在保留方是否也有活动申请？
 *     - 是 → 该岗位的活跃进度在保留方仍有体现，清理无损
 *     - 否 → 清理会让这位候选人在该岗位上从"活跃"里消失 → 有损，需人工确认
 *   空 jobId 的活动申请（待分配残留）单独统计：归档它正是本次清理的目的。
 */
const r = require('../duplicates-report.json');

const groups = [];
for (const key of ['byHash', 'byPhone']) {
  for (const g of r[key]) {
    groups.push({ source: key, key: g.key, members: g.members });
  }
}

// 按成员 _id 集合去重：同一批人可能同时出现在 hash 组和手机号组里
const seen = new Set();
const unique = [];
for (const g of groups) {
  const sig = g.members.map((m) => m._id).sort().join('|');
  if (seen.has(sig)) continue;
  seen.add(sig);
  unique.push(g);
}

const liveJobs = (m) => m.apps
  .filter((a) => a.status === 'active' && !a.isArchived && a.jobId && a.jobId !== '(空)')
  .map((a) => a.jobId);

const emptyLive = (m) => m.apps
  .filter((a) => a.status === 'active' && !a.isArchived && (!a.jobId || a.jobId === '(空)'))
  .length;

const safe = [];
const lossy = [];
const crossOwner = [];

for (const g of unique) {
  const owners = new Set(g.members.map((m) => m.ownerId).filter(Boolean));
  const [keep, ...rest] = g.members;
  const keepJobs = new Set(liveJobs(keep));

  const lostJobs = new Set();
  let emptyCleaned = 0;
  for (const m of rest) {
    for (const j of liveJobs(m)) {
      if (!keepJobs.has(j)) lostJobs.add(j);
    }
    emptyCleaned += emptyLive(m);
  }

  const item = {
    key: g.key,
    name: keep.name || '无名',
    owner: [...owners].join('/') || '-',
    members: g.members.length,
    lostJobs: [...lostJobs],
    emptyCleaned,
    names: g.members.map((m) => `${m.name || '无名'}(${m.ownerId || '-'})`).join(' / '),
  };

  if (owners.size > 1) crossOwner.push(item);
  else if (lostJobs.size > 0) lossy.push(item);
  else safe.push(item);
}

console.log(`原始 ${groups.length} 组 → 去重后 ${unique.length} 组（涉及 ${unique.reduce((n, g) => n + g.members.length, 0)} 条候选人记录）\n`);

console.log(`【① 可安全清理】${safe.length} 组 — 清理后不会丢任何岗位上的活跃进度`);
for (const x of safe) {
  const extra = x.emptyCleaned ? `，清掉 ${x.emptyCleaned} 条待分配残留` : '';
  console.log(`    ${x.name}(${x.owner}) ×${x.members}${extra}`);
}

console.log(`\n【② 会丢活跃进度，需人工确认】${lossy.length} 组`);
for (const x of lossy) {
  console.log(`    ${x.name}(${x.owner}) ×${x.members}  会丢失岗位: ${x.lostJobs.join(', ')}`);
}

console.log(`\n【③ 跨 owner，涉及归属，需业务决策】${crossOwner.length} 组`);
for (const x of crossOwner) {
  console.log(`    ${x.names} ×${x.members}  会丢失岗位: ${x.lostJobs.join(', ') || '无'}`);
}
