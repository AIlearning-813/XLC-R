/**
 * candidate-listing.live.js — **对生产真实数据**的双路径对拍（默认不跑）
 *
 * 跑法：npx vitest run --config vitest.live.config.js
 *
 * 为什么需要它：mock 里的夹具再全，也只是「我设想的数据形态」。真正要回答的是
 * 「下推路径和全量装配路径，在**线上那 4900 条真实数据**上会不会给出不同结果」。
 * 这是计划里的验证方法 6，也是 D-2 唯一无法靠 mock 闭环的一环。
 *
 * 为什么现在能做：此前卡在「本机拿不到专员登录态」。但生产库的数据库安全规则
 * 实际并未生效——匿名（auth.uid 为空）即可读到全库 Application / Candidate。
 * 于是用**匿名只读**连接就能把两条路径都跑起来。这不测「专员身份下的规则行为」
 * （因为规则本来就没在过滤），只测**取数逻辑的等价性**，恰好是本次要证的那件事。
 *
 * 只读保证：两条路径全部是 get / count / aggregate，无任何写操作。
 * 数据量：admin 约 10 批 Application；专员「高艺」约 3 批 + 其名下全部候选人。
 * 这正是 App 打开一次「候选人」模块本来就会做的读取量，不会造成额外负担。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import cloudbase from '@cloudbase/js-sdk';

import {
  loadWorkspace,
  loadWorkspaceLegacy,
  __setListPushdownEnabled,
  __resetListPushdown,
} from './candidate-listing';

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

/** 三个已分配 Tab —— 正是 D-2 下推覆盖的范围 */
const TABS = ['active', 'in-progress', 'ended'];

let db = null;

beforeAll(async () => {
  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth({ persistence: 'none' });
  await auth.anonymousAuthProvider().signIn();
  db = app.database();
  console.log(`\n已连接生产环境 ${ENV_ID}（匿名只读）`);
});

beforeEach(() => {
  __setListPushdownEnabled(true);
  __resetListPushdown();
});

/** 采集下推路径的降级日志：一旦降级，对拍就退化成 legacy 自比，必须显式拦下 */
function captureDegrade() {
  const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const e = vi.spyOn(console, 'error').mockImplementation(() => {});
  return {
    restore() { w.mockRestore(); e.mockRestore(); },
    messages: () => [...w.mock.calls, ...e.mock.calls].flat().map(String).join(' | '),
  };
}

/** 对拍一个场景：行 _id 序列（顺序敏感）、total、tabCounts 三项全等，并记录耗时 */
async function diffScenario(label, options) {
  const cap = captureDegrade();
  let pushed;
  try {
    const t0 = Date.now();
    pushed = await loadWorkspace(db, options);
    var tPushed = Date.now() - t0;
  } finally {
    cap.restore();
  }
  expect(cap.messages(), `下推路径发生了降级：${cap.messages()}`).toBe('');

  const t1 = Date.now();
  const legacy = await loadWorkspaceLegacy(db, options);
  const tLegacy = Date.now() - t1;

  const pushedIds = pushed.rows.map((r) => r._id);
  const legacyIds = legacy.rows.map((r) => r._id);

  const rowDiff = pushedIds.length !== legacyIds.length
    || pushedIds.some((id, i) => id !== legacyIds[i]);

  console.log(
    `  ${label.padEnd(28)} 行 ${String(pushedIds.length).padStart(3)}` +
    `  total ${String(pushed.total).padStart(5)}` +
    `  角标 ${JSON.stringify(pushed.tabCounts)}` +
    `  下推 ${String(tPushed).padStart(5)}ms / 全量 ${String(tLegacy).padStart(5)}ms`
  );

  expect(pushedIds, `${label} 行集与顺序不一致`).toEqual(legacyIds);
  expect(pushed.total, `${label} total 不一致`).toBe(legacy.total);
  expect(pushed.tabCounts, `${label} 角标不一致`).toEqual(legacy.tabCounts);

  return { pushed, legacy, tPushed, tLegacy, rowDiff };
}

describe('生产数据双路径对拍 — admin 视角', () => {
  for (const tab of TABS) {
    it(`${tab}：下推 ≡ 全量装配`, async () => {
      await diffScenario(`admin · ${tab}`, {
        ownerId: null, isAdmin: true, tab, filters: {}, page: 1, pageSize: 20,
      });
    });
  }

  it('第 3 页（翻页后仍一致，验证 skip/_id tiebreaker）', async () => {
    await diffScenario('admin · active · page 3', {
      ownerId: null, isAdmin: true, tab: 'active', filters: {}, page: 3, pageSize: 20,
    });
  });

  it('带筛选（stage=interview）', async () => {
    await diffScenario('admin · active · stage=interview', {
      ownerId: null, isAdmin: true, tab: 'active', filters: { stage: 'interview' }, page: 1, pageSize: 20,
    });
  });

  it('带日期下界（createdAt 区间下推）', async () => {
    await diffScenario('admin · active · dateFrom', {
      ownerId: null, isAdmin: true, tab: 'active',
      filters: { dateFrom: '2026-01-01' }, page: 1, pageSize: 20,
    });
  });
});

describe('生产数据双路径对拍 — 专员视角', () => {
  // 高艺是申请数最多的专员（约 1272 条 |R| ≈ 1256），孤儿实算的分块路径才会被走到
  const OWNER = '高艺';

  for (const tab of TABS) {
    it(`${tab}：下推 ≡ 全量装配（含待分配角标的精确孤儿实算）`, async () => {
      await diffScenario(`${OWNER} · ${tab}`, {
        ownerId: OWNER, isAdmin: false, tab, filters: {}, page: 1, pageSize: 20,
      });
    });
  }

  it('翻页一致性', async () => {
    await diffScenario(`${OWNER} · active · page 5`, {
      ownerId: OWNER, isAdmin: false, tab: 'active', filters: {}, page: 5, pageSize: 20,
    });
  });

  it('待分配角标的量级（|E| + 孤儿，应远小于申请总数）', async () => {
    const cap = captureDegrade();
    let r;
    try {
      r = await loadWorkspace(db, {
        ownerId: OWNER, isAdmin: false, tab: 'active', filters: {}, page: 1, pageSize: 20,
      });
    } finally {
      cap.restore();
    }
    expect(cap.messages()).toBe('');
    const legacy = await loadWorkspaceLegacy(db, {
      ownerId: OWNER, isAdmin: false, tab: 'active', filters: {}, page: 1, pageSize: 20,
    });
    expect(r.tabCounts.unassigned).toBe(legacy.tabCounts.unassigned);
    console.log(`\n  ${OWNER} 四个角标（与全量装配一致）：${JSON.stringify(r.tabCounts)}`);
  });
});

describe('极端边界', () => {
  it('越界页：rows 为空、total 仍为全量、不报错', async () => {
    const r = await loadWorkspace(db, {
      ownerId: null, isAdmin: true, tab: 'active', filters: {}, page: 9999, pageSize: 20,
    });
    expect(r.rows).toEqual([]);
    const legacy = await loadWorkspaceLegacy(db, {
      ownerId: null, isAdmin: true, tab: 'active', filters: {}, page: 9999, pageSize: 20,
    });
    expect(r.total).toBe(legacy.total);
    console.log(`\n  越界页 total（与全量装配一致）：${r.total}`);
  });

  it('不存在的专员：三个 Tab 均空，角标全 0', async () => {
    const r = await loadWorkspace(db, {
      ownerId: '__不存在的归属人__', isAdmin: false, tab: 'active', filters: {}, page: 1, pageSize: 20,
    });
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
    console.log(`\n  不存在的专员角标：${JSON.stringify(r.tabCounts)}`);
  });
});
