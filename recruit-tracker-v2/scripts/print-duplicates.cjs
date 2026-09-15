/** 打印重复组紧凑清单（只读） */
const r = require('../duplicates-report.json');

function describeApp(a) {
  const job = a.jobId === '(空)' ? '空job' : a.jobId.slice(0, 10);
  return `${job}/${a.status}/${a.stage}${a.isArchived ? '/已归档' : ''}`;
}

function describeMember(m, i) {
  const apps = m.apps.length ? m.apps.map(describeApp).join('  +  ') : '无申请';
  const tag = i === 0 ? '保留' : '归档';
  const name = (m.name || '无名').padEnd(6, '　');
  const phone = (m.phone || '-').padEnd(13, ' ');
  const owner = (m.ownerId || '-').padEnd(6, '　');
  return `   ${tag} ${name} ${phone} ${owner} ${m.createdAt}  ${apps}`;
}

let totalGroups = 0;
let totalArchive = 0;

for (const [key, label] of [['byHash', '一、同 fileHash'], ['byPhone', '二、同 手机号']]) {
  console.log('\n' + '='.repeat(96));
  console.log(` ${label}   共 ${r[key].length} 组`);
  console.log('='.repeat(96));
  for (const g of r[key]) {
    totalGroups++;
    totalArchive += g.members.length - 1;
    console.log(`\n[${totalGroups}] ${g.key}  (${g.members.length} 条)`);
    g.members.forEach((m, i) => console.log(describeMember(m, i)));
  }
}

console.log('\n' + '-'.repeat(96));
console.log(`合计 ${totalGroups} 组，建议归档 ${totalArchive} 条记录`);
