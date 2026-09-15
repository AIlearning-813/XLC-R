/**
 * shared-sync.test.js — 断言共享模块副本没有漂移
 *
 * 云函数各自独立打包，无法跨目录 require，共享模块只能各放一份副本
 * （见 sync-shared.cjs 顶部说明）。副本一旦漂移，会出现「有的函数已修好、
 * 有的还没」这种最难查的问题——线上表现为「时好时坏」。
 *
 * 这个测试把「副本是否与 canonical 一致」变成 `npm test` 的一部分：
 * 改完 _shared/ 里的模块忘了跑同步脚本，测试会直接失败并告诉你跑哪条命令。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cloudFunctionsDir = path.resolve(here, '..');
const sharedDir = here;

// 与 scripts/sync-shared.cjs 的 TARGETS 保持一致
const TARGETS = {
  'auth-proxy': ['session-token.js'],
  'get-file-url': ['session-token.js', 'access-guard.js'],
  'report-aggregator': ['session-token.js', 'access-guard.js'],
  'email-scanner': ['session-token.js', 'access-guard.js'],
};

describe('共享模块分发 — 副本必须与 canonical 逐字节一致', () => {
  for (const [fnName, modules] of Object.entries(TARGETS)) {
    for (const mod of modules) {
      it(`${fnName}/${mod} 与 _shared/${mod} 一致`, () => {
        const canonicalPath = path.join(sharedDir, mod);
        const copyPath = path.join(cloudFunctionsDir, fnName, mod);

        expect(fs.existsSync(canonicalPath), `canonical 缺失：${canonicalPath}`).toBe(true);
        expect(
          fs.existsSync(copyPath),
          `副本缺失：${copyPath}（运行 node scripts/sync-shared.cjs）`
        ).toBe(true);

        const canonical = fs.readFileSync(canonicalPath);
        const copy = fs.readFileSync(copyPath);

        expect(
          copy.equals(canonical),
          `${fnName}/${mod} 与 canonical 不一致。` +
            '请勿直接改副本，应改 cloud-functions/_shared/ 下的源文件，' +
            '然后运行 node scripts/sync-shared.cjs'
        ).toBe(true);
      });
    }
  }

  it('canonical 目录本身不含测试以外的副本残留', () => {
    // _shared 下只应有 canonical 模块 + 测试 + package.json
    const entries = fs.readdirSync(sharedDir).sort();
    const allowed = ['access-guard.js', 'access-guard.test.js', 'package.json', 'session-token.js', 'shared-sync.test.js'];
    const unexpected = entries.filter((e) => !allowed.includes(e));
    expect(unexpected, `_shared/ 出现未登记的文件：${unexpected.join(', ')}`).toEqual([]);
  });

  it('_shared/package.json 声明 commonjs（否则 CJS 模块会被当成 ESM 加载失败）', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(sharedDir, 'package.json'), 'utf8'));
    expect(pkg.type).toBe('commonjs');
  });
});
