/**
 * cloudbase.test.js — Mock 层自测
 *
 * 为什么 mock 自己要测：
 *   mock 是全部 service 测试的地基。它一旦「静默失真」（该过滤的没过滤、该报错的没报错），
 *   上层所有测试都会**假绿**——这比没有测试更危险。D-2 之前 mock 就有两处这类问题：
 *   未知运算符被静默忽略、`.where()` 合并语义与真实 SDK 的替换语义不符。
 *
 * 本文件把 mock 自身当作被测对象，逐条钉住它与 CloudBase/MongoDB 的语义对齐点。
 *
 * 另注（聚合运算符的可用面）：真实 SDK 的 `db.command.aggregate` 里有 `neq`
 * （产出 `$neq`）而**没有** `ne`，但 MongoDB 聚合认识的是 `$ne`。这个不确定地带
 * 生产代码选择绕开——只用 `$ifNull / $eq / $and / $cond / $max` 这五个已确认存在的
 * 运算符表达判定，见下方「$cond + $ifNull」用例。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import cloudbase, {
  __setCollectionData,
  __resetAll,
  __countQueries,
  __countAggregates,
  __setAggregateError,
  __allowUnknownOperators,
} from './cloudbase';

const db = () => cloudbase.db();
const _ = cloudbase.db().command;

function seedApps() {
  __setCollectionData('Application', [
    { _id: 'a1', candidateId: 'c1', jobId: 'J1', status: 'active', ownerId: '王莉', n: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { _id: 'a2', candidateId: 'c1', jobId: '', status: 'active', ownerId: '王莉', n: 5, createdAt: '2026-02-01T00:00:00.000Z' },
    { _id: 'a3', candidateId: 'c2', jobId: '', status: 'rejected', ownerId: '王莉', n: 9, createdAt: '2026-03-01T00:00:00.000Z' },
    { _id: 'a4', candidateId: 'c3', jobId: 'J2', status: 'active', ownerId: '刘滢滢', n: 3, createdAt: '2026-01-15T00:00:00.000Z' },
  ]);
}

beforeEach(() => {
  __resetAll();
});

// ===================== 1. 匹配引擎 =====================

describe('Mock 匹配引擎 — 查询运算符', () => {
  beforeEach(seedApps);

  const ids = async (cond) => {
    const { data } = await db().collection('Application').where(cond).get();
    return data.map((d) => d._id).sort();
  };

  it('gt / gte / lt / lte 生效（旧版静默忽略）', async () => {
    expect(await ids({ n: _.gt(3) })).toEqual(['a2', 'a3']);
    expect(await ids({ n: _.gte(5) })).toEqual(['a2', 'a3']);
    expect(await ids({ n: _.lt(4) })).toEqual(['a1', 'a4']);
    expect(await ids({ n: _.lte(3) })).toEqual(['a1', 'a4']);
  });

  it('gt 对缺字段 / null 不匹配', async () => {
    __setCollectionData('T', [{ _id: 'x' }, { _id: 'y', v: null }, { _id: 'z', v: 7 }]);
    const { data } = await db().collection('T').where({ v: _.gt(1) }).get();
    expect(data.map((d) => d._id)).toEqual(['z']);
  });

  it('neq 匹配缺字段；条件值为 null 时匹配 null 与缺字段', async () => {
    __setCollectionData('T', [{ _id: 'x' }, { _id: 'y', v: null }, { _id: 'z', v: 1 }]);
    const neq = await db().collection('T').where({ v: _.neq(1) }).get();
    expect(neq.data.map((d) => d._id).sort()).toEqual(['x', 'y']);

    const nul = await db().collection('T').where({ v: null }).get();
    expect(nul.data.map((d) => d._id).sort()).toEqual(['x', 'y']);
  });

  it('nin 里的 null 会排除缺字段（jobId $nin [null,""] 的关键依据）', async () => {
    __setCollectionData('T', [
      { _id: 'missing' },
      { _id: 'null', jobId: null },
      { _id: 'empty', jobId: '' },
      { _id: 'real', jobId: 'J1' },
    ]);
    const { data } = await db().collection('T').where({ jobId: _.nin([null, '']) }).get();
    expect(data.map((d) => d._id)).toEqual(['real']);
  });

  it('exists 区分「字段存在」与「值为 null」', async () => {
    __setCollectionData('T', [{ _id: 'x' }, { _id: 'y', v: null }]);
    const has = await db().collection('T').where({ v: _.exists(true) }).get();
    expect(has.data.map((d) => d._id)).toEqual(['y']);
    const no = await db().collection('T').where({ v: _.exists(false) }).get();
    expect(no.data.map((d) => d._id)).toEqual(['x']);
  });

  it('or / and 逻辑组合生效（含子条件里的运算符）', async () => {
    const or = await db().collection('Application')
      .where(_.or([{ status: 'rejected' }, { n: _.gt(8) }])).get();
    expect(or.data.map((d) => d._id)).toEqual(['a3']);

    const and = await db().collection('Application')
      .where(_.and([{ status: 'active' }, { jobId: _.nin([null, '']) }])).get();
    expect(and.data.map((d) => d._id).sort()).toEqual(['a1', 'a4']);
  });

  it('点路径字段可查询（funnelMeta.entrySource）', async () => {
    __setCollectionData('T', [
      { _id: 'x', funnelMeta: { entrySource: 'email' } },
      { _id: 'y', funnelMeta: { entrySource: 'manual' } },
      { _id: 'z' },
    ]);
    const { data } = await db().collection('T').where({ 'funnelMeta.entrySource': 'email' }).get();
    expect(data.map((d) => d._id)).toEqual(['x']);
  });

  it('未知运算符抛错（不再静默忽略条件）', async () => {
    __setCollectionData('T', [{ _id: 'x', v: 1 }]);
    await expect(
      db().collection('T').where({ v: { __command: '不存在的运算符', value: 1 } }).get()
    ).rejects.toThrow(/未知运算符/);
  });

  it('未知运算符可用逃生开关放行', async () => {
    __setCollectionData('T', [{ _id: 'x', v: 1 }]);
    __allowUnknownOperators(true);
    const { data } = await db().collection('T').where({ v: { __command: '什么鬼', value: 1 } }).get();
    expect(data).toHaveLength(1); // 条件被忽略 → 全量返回
  });
});

// ===================== 2. where 语义 =====================

describe('Mock .where() — 与真实 SDK 一致：替换而非合并', () => {
  beforeEach(seedApps);

  it('链式 where 只保留最后一次的条件（真实 SDK 实测行为）', async () => {
    const { data } = await db().collection('Application')
      .where({ status: 'rejected' })
      .where({ jobId: 'J1' })
      .get();
    // 若为合并语义 → 空集（无文档同时满足）；替换语义 → 只剩 jobId='J1' → a1
    expect(data.map((d) => d._id)).toEqual(['a1']);
  });

  it('单次 where 传多条件仍然同时生效', async () => {
    const { data } = await db().collection('Application')
      .where({ status: 'active', jobId: 'J1' })
      .get();
    expect(data.map((d) => d._id)).toEqual(['a1']); // a4 的 jobId 是 J2，不命中
  });

  it('where 之后链 orderBy / limit 不受影响', async () => {
    const { data } = await db().collection('Application')
      .where({ ownerId: '王莉' })
      .orderBy('n', 'desc')
      .limit(2)
      .get();
    expect(data.map((d) => d._id)).toEqual(['a3', 'a2']);
  });
});

// ===================== 3. 排序 =====================

describe('Mock 排序 — 单键与稳定性', () => {
  /**
   * 这条守着本轮踩到的坑：mock 曾按「链式会累加」实现，而真实 SDK 是相反的
   * ——链式会静默丢掉主排序键且不报错（生产实测见 candidate-listing.js 的注释）。
   * 假象修掉后，链式调用必须在默认套件里就炸。
   */
  it('链式 orderBy 直接抛错（真实 SDK 会静默取错序且不报错）', async () => {
    __setCollectionData('T', [{ _id: 'a', k: 1 }, { _id: 'b', k: 2 }]);
    expect(() => db().collection('T').orderBy('k', 'asc').orderBy('_id', 'asc')).toThrow(/链式/);
  });

  it('多键排序走聚合 $sort（这是链式 orderBy 的替代路径）', async () => {
    __setCollectionData('T', [
      { _id: 'b', k: 1 }, { _id: 'a', k: 1 }, { _id: 'c', k: 2 },
    ]);
    const { data } = await db().collection('T').aggregate()
      .sort({ k: 1, _id: 1 }).end();
    expect(data.map((d) => d._id)).toEqual(['a', 'b', 'c']);
  });

  it('排序键相等时比较器返回 0（可稳定排序）', async () => {
    __setCollectionData('T', [
      { _id: 'p', k: 1 }, { _id: 'q', k: 1 }, { _id: 'r', k: 1 },
    ]);
    const { data } = await db().collection('T').orderBy('k', 'asc').get();
    expect(data.map((d) => d._id)).toEqual(['p', 'q', 'r']); // 保持插入顺序
  });

  it('ISO 日期字符串与 Date 对象可互相比较', async () => {
    __setCollectionData('T', [
      { _id: 'old', t: '2026-01-01T00:00:00.000Z' },
      { _id: 'new', t: '2026-06-01T00:00:00.000Z' },
    ]);
    const { data } = await db().collection('T')
      .where({ t: _.gte(new Date('2026-03-01T00:00:00.000Z')) }).get();
    expect(data.map((d) => d._id)).toEqual(['new']);
  });
});

// ===================== 4. count =====================

describe('Mock count() — 忽略 skip/limit', () => {
  it('带 skip/limit 的查询，count 仍返回条件命中的全量条数', async () => {
    __setCollectionData('T', Array.from({ length: 30 }, (_, i) => ({ _id: 't' + i, v: 1 })));
    const { total } = await db().collection('T').where({ v: 1 }).skip(10).limit(5).count();
    expect(total).toBe(30);
  });
});

// ===================== 5. 聚合 =====================

describe('Mock aggregate() — 管道阶段', () => {
  beforeEach(seedApps);

  it('$match + $group 按 candidateId 归并并求 $max', async () => {
    const agg = db().collection('Application').aggregate();
    agg.match({ ownerId: '王莉' });
    agg.group({ _id: '$candidateId', maxN: _.aggregate.max('$n') });
    const { data } = await agg.end();
    const byId = Object.fromEntries(data.map((r) => [r._id, r.maxN]));
    expect(byId).toEqual({ c1: 5, c2: 9 });
  });

  /**
   * 这段管道与 D-2 生产代码算「待分配」用的形态完全一致：
   * 只用 $ifNull / $eq / $and / $cond / $max 五个运算符，绕开 $ne 的不确定地带。
   *   非空 jobId       ⟺ $ifNull(jobId,'') ≠ ''  ⟺ $cond([$eq([...]), 0, 1]) 取反写法
   *   未归档           ⟺ $ifNull(isArchived,false) === false
   */
  it('$group 配 $cond + $ifNull 可算出「有已分配 / 有空活跃」两个标志位', async () => {
    __setCollectionData('Application', [
      { _id: 'x1', candidateId: 'c1', jobId: 'J1', status: 'active' },
      { _id: 'x2', candidateId: 'c2', jobId: '', status: 'active' },
      { _id: 'x3', candidateId: 'c3', jobId: '', status: 'rejected' },
      { _id: 'x4', candidateId: 'c4', jobId: '', status: 'active', isArchived: true },
      { _id: 'x5', candidateId: 'c5', jobId: 'J9', status: 'active' },   // 已分配，同时有空 jobId 残留
      { _id: 'x6', candidateId: 'c5', jobId: '', status: 'active' },
    ]);

    // 辅助：$ifNull(field, fallback) / $eq(a,b) / $and([...]) / $cond([c,t,f])
    const ifNull = (field, fb) => _.aggregate.ifNull([field, fb]);
    const eq = (a, b) => _.aggregate.eq([a, b]);
    const and = (...xs) => _.aggregate.and(xs);
    const cond = (c, t, f) => _.aggregate.cond([c, t, f]);

    const agg = db().collection('Application').aggregate();
    agg.group({
      _id: '$candidateId',
      // jobId 非空 → 1，否则 0
      hasAssigned: _.aggregate.max(cond(eq(ifNull('$jobId', ''), ''), 0, 1)),
      // 空 jobId ∧ active ∧ 未归档 → 1，否则 0
      hasEmptyActive: _.aggregate.max(
        cond(
          and(
            eq(ifNull('$jobId', ''), ''),
            eq(ifNull('$status', ''), 'active'),
            eq(ifNull('$isArchived', false), false)
          ),
          1, 0
        )
      ),
    });
    const { data } = await agg.end();
    const byId = Object.fromEntries(data.map((r) => [r._id, r]));

    expect(byId.c1.hasAssigned).toBe(1);
    expect(byId.c1.hasEmptyActive).toBe(0);
    expect(byId.c2.hasEmptyActive).toBe(1);
    expect(byId.c3.hasEmptyActive).toBe(0);   // 已结束 → 不算待分配
    expect(byId.c4.hasEmptyActive).toBe(0);   // 已归档 → 不算待分配
    expect(byId.c5.hasAssigned).toBe(1);      // 有空 jobId 残留，但已分配 → 不算待分配
    expect(byId.c5.hasEmptyActive).toBe(1);

    // |E| = hasAssigned=0 且 hasEmptyActive=1 的行数 = 1（只有 c2）
    const E = data.filter((r) => !r.hasAssigned && r.hasEmptyActive).length;
    expect(E).toBe(1);
    // |R| = 分组行数 = 5 个候选人
    expect(data).toHaveLength(5);
  });

  it('$group 后 $count 返回单行计数', async () => {
    const agg = db().collection('Application').aggregate();
    agg.match({ ownerId: '王莉' });
    agg.group({ _id: '$candidateId' });
    agg.count('n');
    const { data } = await agg.end();
    expect(data).toEqual([{ n: 2 }]); // c1、c2
  });

  it('$sort / $skip / $limit / $project 依次生效', async () => {
    const agg = db().collection('Application').aggregate();
    agg.match({ ownerId: '王莉' });
    agg.sort({ n: -1 });
    agg.skip(1);
    agg.limit(1);
    agg.project({ _id: 1, n: 1 });
    const { data } = await agg.end();
    expect(data).toEqual([{ _id: 'a2', n: 5 }]);
  });

  it('$match 里的命令对象同样生效（如 $nin）', async () => {
    const agg = db().collection('Application').aggregate();
    agg.match({ jobId: _.nin([null, '']) });
    const { data } = await agg.end();
    expect(data.map((d) => d._id).sort()).toEqual(['a1', 'a4']);
  });

  it('聚合抛错可注入（用于验证降级路径）', async () => {
    __setAggregateError('Application', true);
    const agg = db().collection('Application').aggregate();
    agg.match({ ownerId: '王莉' });
    await expect(agg.end()).rejects.toThrow(/not permitted/);
  });

  it('聚合走独立日志，不污染 __countQueries', async () => {
    const agg = db().collection('Application').aggregate();
    agg.group({ _id: '$candidateId' });
    await agg.end();

    expect(__countAggregates('Application')).toBe(1);
    expect(__countQueries('Application')).toBe(0); // 关键：D-1 的请求数断言口径不受影响
  });

  it('EJSON 往返保真：Date 保留为 Date', async () => {
    __setCollectionData('T', [{ _id: 'x', d: new Date('2026-03-01T00:00:00.000Z') }]);
    const agg = db().collection('T').aggregate();
    agg.match({ d: _.gte(new Date('2026-01-01T00:00:00.000Z')) });
    const { data } = await agg.end();
    expect(data).toHaveLength(1);
    expect(data[0].d).toBeInstanceOf(Date);
  });
});
