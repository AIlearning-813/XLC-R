#!/usr/bin/env node
/**
 * probe-anon-write-verify.cjs — 判定匿名写权限的「零改动」实验
 *
 * 为什么需要它：
 *   probe-anon-write.cjs 对**不存在的**文档调用 update/remove，拿到的是
 *   「无报错 + 改动 0 条」。这个结果有两种完全相反的解释：
 *     A. 安全规则真的放行（威胁成立）
 *     B. 规则被当作查询条件拼接，因目标文档不存在而匹配 0 条（威胁不成立）
 *   不区分 A/B 就上报，等于要么漏报要么误报。
 *
 * 判定原理：
 *   取一条**真实存在**的文档，用原子操作 `db.command.inc(0)` 更新它的一个数字字段。
 *   自增 0 在数学上恒等——字段值**不可能**发生变化，因此这不是一次破坏性写入。
 *   然后看影响行数：
 *     updated = 1  → 规则放行，匿名访客能改任意真实文档（解释 A）
 *     updated = 0  → 规则是过滤器，拦住了不属于自己的文档（解释 B）
 *
 * 安全保证：
 *   · 只对**已存在的数字字段**做 inc(0)，不新增字段、不改值
 *   · 更新前后各读一次，逐字段比对关键值是否一致，并打印比对结果
 *   · 避开 EmailConfig（含密码）等敏感集合
 *
 * 用法：node scripts/probe-anon-write-verify.cjs
 */

const cloudbase = require('@cloudbase/js-sdk');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

// 只碰可再生的缓存类集合，以及对 inc(0) 无感的业务集合
const TARGETS = ['ReportCache', 'Config', 'KnowledgeBase', 'Job', 'Candidate', 'Application'];

const SKIP_FIELDS = new Set(['_id', '_openid']);

async function main() {
  console.log(`探针目标环境：${ENV_ID}`);
  console.log('判定方式：对真实文档的数字字段执行 inc(0)（数学恒等，不改值）\n');

  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth({ persistence: 'none' });
  await auth.anonymousAuthProvider().signIn();
  console.log('✔ 匿名登录成功\n');

  const db = app.database();
  const _ = db.command;
  let allowed = 0;
  let filtered = 0;
  const unknown = [];

  for (const name of TARGETS) {
    let doc;
    try {
      const res = await db.collection(name).limit(1).get();
      const rows = (res && res.data) || [];
      if (rows.length === 0) {
        console.log(`  ${name.padEnd(16)} 集合为空或无权限，跳过`);
        continue;
      }
      doc = rows[0];
    } catch (err) {
      console.log(`  ${name.padEnd(16)} 读取异常：${String(err.message).slice(0, 50)}`);
      continue;
    }

    // 找一个已存在的数字字段
    const numericField = Object.keys(doc).find((k) => !SKIP_FIELDS.has(k) && typeof doc[k] === 'number');
    if (!numericField) {
      const types = Object.keys(doc).filter((k) => !SKIP_FIELDS.has(k))
        .map((k) => `${k}:${Array.isArray(doc[k]) ? 'array' : typeof doc[k]}`).join(' ');
      console.log(`  ${name.padEnd(16)} 无数字字段，无法做零改动判定  字段类型: ${types.slice(0, 80)}`);
      unknown.push(name);
      continue;
    }

    const before = doc[numericField];
    let updated;
    try {
      const r = await db.collection(name).doc(doc._id).update({ [numericField]: _.inc(0) });
      updated = r ? r.updated : undefined;
    } catch (err) {
      const msg = String(err.message || err);
      const denied = /permission|denied|403/i.test(msg);
      console.log(`  ${name.padEnd(16)} 字段 ${numericField}  写被拒(${denied ? '权限' : msg.slice(0, 40)})`);
      filtered++;
      continue;
    }

    // 读回来确认值确实没变
    let unchanged = '未知';
    try {
      const back = await db.collection(name).doc(doc._id).get();
      const rows2 = (back && back.data) || [];
      const after = rows2.length > 0 ? rows2[0][numericField] : undefined;
      unchanged = after === before ? '值未变' : `⚠️ 值被改（${before} → ${after}）`;
    } catch (err) {
      unchanged = '回读失败:' + String(err.message).slice(0, 30);
    }

    const verdict = updated === 1 ? '放行 ← 能改任意真实文档' : '被规则过滤';
    if (updated === 1) allowed++; else filtered++;
    console.log(`  ${name.padEnd(16)} 字段 ${numericField.padEnd(16)} updated=${updated}  ${verdict}  ${unchanged}`);
  }

  console.log('\n================ 结论 ================');
  console.log(`放行（updated=1）：${allowed} 个`);
  console.log(`被过滤（updated=0）：${filtered} 个`);
  if (unknown.length > 0) {
    console.log(`无法判定（无数字字段）：${unknown.length} 个 → ${unknown.join('、')}`);
  }
  if (allowed > 0) {
    console.log('\n⚠️ 解释 A 成立：安全规则确实放行匿名写。匿名访客可篡改任意真实文档。');
  } else if (filtered > 0) {
    console.log('\n✔ 解释 B 成立：写操作被安全规则过滤，匿名访客改不动不属于自己的文档。');
    console.log('   （先前 probe-anon-write.cjs 的「放行(改动0条)」是误报）');
  }
  console.log('\n本次实验用 inc(0)，字段值恒等不变；未新增、未删除任何文档。');
}

main().catch((err) => {
  console.error('探针异常：', err && err.message ? err.message : err);
  process.exit(1);
});
