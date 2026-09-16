# 变更日志

## D-2（2026-09-16）— 候选人列表「筛选 / 排序 / 分页 / 角标」整体下推到数据库

### 问题

D-1 已把分批拉取并发化，并把三个已分配 Tab 改成「先分页再取当页候选人」，
但 `loadWorkspace` 仍在**分派任何分支之前无条件全量拉取**：

```js
const [apps, orphanCandidates] = await Promise.all([...]);   // ← 无论用于哪个分支都先拉全量
```

因为有三件事依赖完整数据集：`collectUnassignedEntries`（待分配判定）、`countByTab`（四个角标）、
`buildPagedApplicationRows` 的输入。后果是**默认落地页只显示 20 行，却要把全库约 4900 条申请
（约 2MB）全拉下来**，且随数据增长而恶化。

### 改动

**目标**：active / in-progress / ended 三个 Tab 的分页与四个角标全部下推，全量拉取变为惰性。
**非目标**（有意保留全量装配）：搜索分支、待分配 Tab 的列表（前者要按候选人字段过滤，
后者行序依赖 `Candidate.updatedAt`）。

1. **Tab 谓词下推**（`tabPredicate`）—— 与 JS 形态逐条等价，依据是生产库只读实测：
   - `a.isArchived !== true` ⟺ `{isArchived: {$ne: true}}`（实测 4903 = 4916 − 13，即**匹配缺失字段**）
   - `a.jobId && a.jobId !== ''` ⟺ `{jobId: {$nin: [null, '']}}`（实测空串 2713 + 非空 2203 = 4916；
     `null` 必须带上，否则缺失字段会被误收进结果）
   - `a.stage !== 'resume' && a.stage !== 'onboard'` ⟺ `{stage: {$nin: ['resume','onboard']}}`（**保留**缺失字段）
2. **非搜索筛选下推**（`buildAppFilterParts` / `assembleWhere`）—— stage / jobId / entrySource / createdAt 区间。
   `dateTo` 用 `setHours(23,59,59,999)` 复刻 JS 的本地时区语义（传字符串会差 8 小时）。
3. **排序下推走聚合管道**：`aggregate().match(where).sort({updatedAt:-1, _id:1}).skip().limit().end()`。
   **不能用 find 的链式 `orderBy`**——真实 SDK 的 `orderBy` 不叠加，主排序键会被静默顶掉（详见下文
   「上线前真机对拍发现并修复的真实缺陷」）。tiebreaker 也不能省：JS 侧的隐式 `_id asc` 来自
   `fetchAllApplications` 的排序，下推后那个输入序列不复存在，缺了它同 `updatedAt` 的行会在页间漂移。
4. **角标下推**（`fetchTabCounts`）：3 次 `count()` + 待分配聚合。
   角标语义仍是「未叠加筛选的积压量」，**绝不合并 filters**。
5. **待分配角标 = |E| + 精确孤儿数**（用户选择「精确优先」）：
   ```
   admin：badge = |E|                                    // 按定义无孤儿，1 次聚合
   专员 ：|R| / |E| 共用一次 $group（0 额外请求）
           badge = |E| + (|C_me| − |C_me∩R|)             // 多 1 + ceil(|R|/500) 次 count
   ```
   为什么不能用近似值：`useCandidateStore` 里存在「申请创建失败 → 回滚删候选人也失败
   （需手动清理）」的路径，孤儿是**真实可达状态**；且 `handover` 移交只改 `Application.ownerId`、
   **不动 `Candidate.ownerId`**，所以 `app.ownerId === candidate.ownerId` 这个假设不成立。
6. **聚合只用 5 个已确认存在的运算符**（`$ifNull/$eq/$and/$cond/$max`），
   有意绕开 `$ne`：真实 SDK 暴露的是 `neq`（产出 `$neq`）而没有 `ne`，MongoDB 聚合认识的却是 `$ne`，
   这个不确定地带不值得赌。「非空」改用 `$cond([$eq(...), 0, 1])` 表达。
7. **降级与熔断**：下推路径的任何异常（含聚合被拒、count 失真、排序键缺失）都整条降级到
   `loadWorkspaceLegacy` 并置熔断位，本会话不再重试。`VITE_LIST_PUSHDOWN=false` 一行整体回滚。
   另有零成本一致性守卫：角标是「未叠加筛选的积压量」，筛选只会让它变小，
   故恒有 `tabCounts[tab] >= paged.total`；一旦违反即判定口径不一致 → 降级并熔断。
8. `repairTotal(counted, page, pageSize, rowCount)` 只在 `rowCount > 0` 时向上修复 total。
   无条件 `Math.max` 会把越界页的 total 顶成 `start`，破坏「页码越界时 total 仍为全量条数」的既有契约。

### 新增的防御

- **mock 补强**（`src/services/__mocks__/cloudbase.js`）：`command` 补 `gt/gte/lt/lte/exists/nin/and`、
  递归匹配器（含点路径与缺失字段语义）、`aggregate()` 全阶段。
  并修掉**三处**长期存在的**静默失真**——未知运算符曾不报错只忽略条件、`.where()` 曾按合并语义
  （真实 SDK 是**替换**语义）、`orderBy` 曾按「链式累加」实现（真实 SDK 恰恰相反，见下），
  三者都会让上层测试**假绿**。第三处是本次上线前真机对拍才暴露出来的，现已改为**链式直接抛错**。
- **mock 自测**（`src/services/__mocks__/cloudbase.test.js`，24 例）：mock 是全部 service 测试的地基，
  它自己失真比没有测试更危险，故把它本身当作被测对象钉住语义对齐点。
- **判定矩阵**（`candidate-listing.pushdown.test.js`）：`isArchived × jobId × stage × status` 全组合
  256 条 + 1 条他人数据，对每个 Tab 双向断言「JS 谓词接受集 ≡ `buildTabWhere` 接受集」。
- **差分对拍**（最强护栏）：同一夹具下 `loadWorkspace`（下推）与 `loadWorkspaceLegacy`（全量装配，oracle）
  的 `rows._id` 序列、`total`、`tabCounts` 逐条相等。**每次都断言聚合确实被调用过**——
  否则一旦静默降级，对拍就会退化成 legacy 自己跟自己比而「假绿」。

### 实测效果（mock 计数，1200 条申请）

| 场景 | D-1 | D-2 | 变化 |
|------|-----|-----|------|
| admin 首屏 active Tab | 12 次请求 | **7 次** | Application 查询 4 次（分页 total 1 + 角标 3）、聚合 2 次（当页管道 + 待分配）、Candidate 1 次 |
| 专员首屏 active Tab | — | **9–11 次** | 含精确孤儿：1 + ceil(\|R\|/500) 次 Candidate count |
| Application 拉取量 | 全量约 4900 条 | **当页 20 条 + 角标** | 与库大小解耦（1200 条与 120 条请求数相同） |

### 真实 SDK 形态验证（关键，mock 覆盖不到的那一面）

用**匿名只读探针**（`cloudbase.init` + 匿名登录，无需任何凭据，仅 count / get / aggregate）在生产环境实测：

| 验证项 | 结果 |
|---|---|
| `aggregate.ifNull / eq / and / cond / max` 存在 | ✅ 5/5（`ne`、`exists` 确实缺失，与设计假设一致） |
| `command.gt/gte/lt/lte/nin/in/neq/and/or/exists` 存在 | ✅ 10/10 |
| 三个 Tab 的 where 形态、`command.and([...])` 组装形态 | ✅ 均被接受 |
| 聚合 `$match` 吃 command 对象 / 原生 `$nin` 字面量 | ✅ 两种形态同值（1290） |
| 聚合并行 `$sort` 多键 + `$skip` + `$limit` | ✅ 与 JS 全序**逐条相同**（18/18，见下） |
| 点路径 `funnelMeta.entrySource` | ✅ 可用（3713 条） |
| **D-2 的 `$group` 规格 + `$match` + `$count`** | ✅ **`n = 2491`**，与只读实测的 \|E\| = 2492 一致（差异为实时写入） |

即 R2「`$cond/$max` 客户端不支持」风险已实测排除，且聚合结果与人工统计口径吻合。

### 上线前真机对拍发现并修复的真实缺陷（**这一步救了 D-2**）

原计划的「验证方法 6：真机双路径比对」此前一直卡在「本机拿不到专员登录态」。
本次改用**无需登录态**的复现方式做了：生产库的数据库安全规则实际并未生效，
**匿名只读**即可读到全库，于是 `cloudbase.init` + 匿名登录就能把下推路径与
`loadWorkspaceLegacy` 两条路径都跑起来并在**真实数据**上逐条对拍
（`vitest.live.config.js` + `src/services/candidate-listing.live.js`，13 例；默认套件不跑）。

**结果：mock 全绿的 47 例背后，下推路径的当页与 legacy 交集 0/20。**

| 症状 | 真因 |
|---|---|
| 当页 `_id` 集合与 legacy **完全不相交**（`total` 与四个角标却完全一致，所以极易漏掉） | **真实 SDK 的 `orderBy` 不叠加**：`.orderBy('updatedAt','desc').orderBy('_id','asc')` 的结果与「只写 `.orderBy('_id','asc')`」**逐条相同**——主排序键被 tiebreaker 静默顶掉，当页取回的是 `_id` 最小的一批。它**不报错**。 |

这正是计划里 **P5「复合 `orderBy` 是否生效」** 那条风险，兜底方案本就写着「单字段 + 客户端二次排序」。
实测进一步确认：**单键** `orderBy('updatedAt','desc')` 完全正确（skip=0/20/1280 均与 JS 全序逐条相同，
4944 条 `updatedAt` 全为 Date 且**全局唯一无重值**）；坏的只有链式。

**修法（比原设计更强）**：翻页改走聚合的 `$sort`，一次拿到真正的多键排序。
实测 admin/专员 × 三个 Tab × 页首/页中/页尾共 **18 组，18/18 与 legacy 全序逐条相同**，
耗时与 find 持平（46ms vs 47ms）。于是 `_id` tiebreaker 不再依赖任何数据假设。

**为什么 mock 没拦住**：mock 的 `orderBy` 当初按「链式会累加」实现——**我先假设了真实 SDK 的行为，
再让 mock 按假设实现，于是假设被自己的 mock 验证了一遍**。
现已把 mock 的链式 `orderBy` 改为**直接抛错**，并新增两条断言：
① 翻页管道的阶段序列必须是 `$match → $sort → $skip → $limit`；
② `$sort` 载荷必须是 `{updatedAt:-1, _id:1}`（为此让 mock 的聚合日志额外记录 `stageParams`，
否则「漏写 `_id` tiebreaker」这类 bug 会被 JS 的稳定排序掩盖而永远抓不到）。

### 真机对拍结果（生产环境 `xlc-recruit-d1gmbx8gybc8a3565`，4944 条申请，2026-09-16）

下推 / 全量装配两条路径的 `rows._id` 序列、`total`、四个角标**逐项相等**（13/13 通过）：

| 场景 | 行数 | total | 下推耗时 | 全量装配耗时 |
|------|------|-------|----------|--------------|
| admin · active | 20 | 1290 | 532ms | 1052ms |
| admin · in-progress | 20 | 110 | 239ms | 652ms |
| admin · ended | 20 | 1134 | 188ms | 689ms |
| admin · active · 第 3 页 | 20 | 1290 | 212ms | 662ms |
| admin · active · dateFrom 筛选 | 20 | 1290 | 189ms | 722ms |
| 高艺 · active | 20 | 273 | 300ms | 1547ms |
| 高艺 · in-progress | 20 | 47 | 408ms | 1558ms |
| 高艺 · ended | 20 | 42 | 399ms | 1596ms |
| 高艺 · active · 第 5 页 | 20 | 273 | 473ms | 1473ms |

四个角标两侧完全一致：admin `{active:1290, in-progress:110, unassigned:2506, ended:1134}`、
高艺 `{active:273, in-progress:47, unassigned:946, ended:42}`。
另含三个边界例：越界页（rows 空、total 仍为全量）、不存在的专员（全 0）、待分配角标量级（精确孤儿实算一致）。

### 索引（**必须人工在控制台创建**）

`node scripts/deploy-indexes.cjs` 现在输出控制台操作清单，并交叉校验 `scripts/init-database.md`
（不一致即以非零码退出）。本次新增 5 条，共 31 条：

| # | 集合 | 索引名 | 键 |
|---|------|--------|-----|
| 29 | Application | `owner_status_updated` | `ownerId` ↑ + `status` ↑ + `updatedAt` ↓ + `_id` ↑ |
| 30 | Application | `status_updated` | `status` ↑ + `updatedAt` ↓ + `_id` ↑ |
| 31 | Application | `owner_cand` | `ownerId` ↑ + `candidateId` ↑ |
| 32 | Application | `cand` | `candidateId` ↑ |
| 33 | Candidate | `owner_id` | `ownerId` ↑ + `_id` ↑ |

方向不能改：`updatedAt` 必须降序、`_id` 必须升序，与代码里的排序链逐位一致，否则退化成 32MB 阻塞式内存排序。
`ownerId` 必须最左（ESR 规则）；admin 查询不带 `ownerId`，故必须另建 #30 / #32。

### 顺带修复

- `scripts/deploy-indexes.cjs` 此前调用 `db.collection(x).createIndex(...)` —— 该方法在本项目 SDK 里
  **不存在**（`@cloudbase/node-sdk` 与 CLI 的 NoSQL 子命令都没有创建索引能力），跑必抛 `TypeError`，
  即 `init-all.sh` 的这一步一直是空转。现改为输出清单 + 文档交叉校验。
- `scripts/init-all.sh`：步骤 3 改名并说明需人工创建；校验失败不再被 `set -e` 静默中断，
  而是在收尾处集中提醒。
- `scripts/init-database.md`：集合名笔误 `PendingChange` → `PendingChanges`（代码里用的是复数），
  补 D-2 的 5 条索引，索引总数 28 → 31。

### 验收

- 新增 `src/services/candidate-listing.pushdown.test.js`（48 例）+ `src/services/__mocks__/cloudbase.test.js`（25 例）。
- 全量测试：**47 files / 1329 tests 全绿**（D-1 基线 46/1280，+49 例，无回归）。
  `candidate-listing.test.js` 的 44 例回归网**未做任何修改**即通过。
- 真机双路径对拍：**13/13 通过**（见上文表格）。
- 生产构建通过（1.11s）。

### 已知未覆盖

- **浏览器真机下的专员登录态未验证**。上文的真机对拍用匿名只读连接完成，它证明了
  **取数逻辑等价**，但没有验证「登录态下安全规则对聚合的影响」——因为实际部署的
  Application 规则**并未**按 ownerId 过滤（见下），这个风险面当前并不存在。
  仍需用户在浏览器里以专员 / 管理员身份各看一次候选人模块（步骤 ②）。
- **索引是否已被查询真正用上未实测**：索引已在控制台创建，但「建索引前后的耗时对比」没做
  （真机对拍时索引已存在）。下推耗时（188–532ms）已优于全量装配，符合预期。
- CloudBase 个人版的聚合 QPS 容忍度未实测。
- 仍未做：**部署**。线上仍是 D-1。

### ⚠️ 与 D-2 无关但已确认的生产问题（待用户决策，本次未改）

1. **数据库安全规则实际未生效**：匿名（`auth.uid` 为空）实测可读 `Application` 4918 条、
   `Candidate` 4897 条、`AuditLog` 4752 条、`EmailConfig` 8 条等，仅 `Users` 为 0 条。
   按 `init-database.md` 的规则这些都应返回 0 条。根因是 `scripts/set-security-rules.cjs` 走的是
   `tcb permission set`（网关 OPA），**改不了数据库安全规则**——数据库规则只能在控制台设置。
   即该脚本从未真正部署过规则，却因 CLI 返回成功而无人察觉。
   同时脚本与文档里的规则表达式都写成 `get('database.User.' + auth.uid)`（单数），
   而集合名是 `Users`，即使规则能部署，admin 分支也永远不会成立。
2. `src/stores/usePendingChangeStore.js:89-98`：`.where({status})` 之后又链了一次
   `.where({_id: db.command.gt(cursor)})`。真实 SDK 的 `where()` 是**替换**而非合并语义，
   第 2 页起 `status` 筛选被静默丢弃。仅当 `PendingChanges` 超过 100 条时才会显形（当前 256 条，已满足）。

## D-1（2026-09-15）— 候选人列表首屏性能优化（取数层，不改语义）

### 问题

用户反馈：打开「候选人」模块需 **5–9 秒**才显示，管理员账号尤其明显。

### 排查结论（实测）

对生产库只读统计（环境 `xlc-recruit-d1gmbx8gybc8a3565`）：

| 指标 | 条数 |
|------|------|
| Application 总数 | 4895 |
| Candidate 总数 | 4874 |
| active Tab 口径（active+未归档+jobId 非空） | 1277 |

根因**不是缓存慢，而是取数层没有缓存、且分批请求全部串行**：

| 环节 | 代码 | 批次数 |
|------|------|--------|
| 拉全部申请 | `fetchAllApplications`（`BATCH_APP=500`，admin 无 ownerId 过滤） | 10 次串行 |
| 拉候选人详情 | `fetchCandidatesByIds`（`BATCH_CAND=100`，按**整个 Tab** 而非当前页） | 13 次串行 |
| **首屏合计** | | **23 次串行往返 ≈ 5–9 秒** |

延后次要因素（已实测排除为主因）：`orderBy('_id').skip(N)` 深浅分页实测仅差 57ms，`_id` 默认索引可用。

### 改动

**均只改取数方式，不改任何 Tab 语义与返回值契约。**

1. `fetchAllApplications` / `fetchCandidatesByOwner`：分批由**串行等待**改为**并发发出**。
   首批兼作探针（不足一批仍是 1 次请求），其余用 `count()` 推断批数后按 `BATCH_CONCURRENCY=6` 并发；
   `count()` 不可用时回退串行探测。
2. `fetchCandidatesByIds`：批次并发化，写入仍按批次原顺序，保持「同一 id 取首次出现」语义。
3. **核心**：新增 `buildPagedApplicationRows` —— `active` / `in-progress` / `ended` 三个 Tab
   改为**先对 Application 筛选排序分页、再只取当前页 20 条的候选人**（原为整个 Tab 全量取）。
   等价性依据：筛选链路只读 Application 字段；行的排序键 `row.updatedAt === app.updatedAt`。
   搜索与 `unassigned`（排序键是 `Candidate.updatedAt`）保持全量装配不动。

### 新增的防御（重要）

并发拉取依赖 `count()` 推断批数，而 **CloudBase 安全规则会「静默过滤」导致 count 偏小**，
一旦失真就会截断数据，正好破坏本模块最核心的「取全不截断」契约（文件头记录的两个线上故障均由截断引起）。
因此加了**收尾兜底**：只要「最后一批仍是满的」就继续串行拉，直到出现不足批。
正常情况最后一批不满，**零额外请求**。

### 实测效果（mock 固定 20ms 延迟，真实规模 4895 条，admin 视角）

| 场景 | 改造前 | 改造后 | 变化 |
|------|--------|--------|------|
| 首屏 active Tab | 23 次请求 / 714ms | **12 次 / 150ms** | 请求 −48%，耗时 **−79%** |
| 搜索 | 60 次 / 1868ms | 61 次 / 431ms | 耗时 **−77%**（请求数持平，为保语义） |
| 待分配 Tab | 35 次 / 1074ms | 36 次 / 280ms | 耗时 **−74%** |

三个场景的 `total` 与当页行 `_id` 序列均与改造前**逐条一致**。

### 验收

- 新增 `src/services/candidate-listing.perf.test.js`（19 例）：性能契约 + 语义等价 + 不截断防御。
- mock 增强：查询日志、并发峰值、查询延迟、count 覆盖/报错（均为测试基础设施，默认关闭，不影响既有用例）。
- 全量测试：**45 files / 1256 tests 全绿**（较基线 1237 增加 19 例，无回归）。
- 生产构建通过。

### 生产验证（2026-09-15）

- 部署到 CloudBase 环境 `xlc-recruit-d1gmbx8gybc8a3565`，官网 `https://recruit.xlczg.com/`（该域名为本环境绑定的自定义域名，非独立站点）。
- 上线产物核验：主包 `vue-vendor--HcKyYOM.js` 线上 1,556,897 字节，sha256 与本地 `dist/` **逐位一致**。
- **用户线上实测确认：候选人模块缓存时间已缩短。**

### 已知未覆盖（留给 D-2 及以后）

- `count()` 在真实环境的耗时未实测（无前端登录态）；若偏慢，可改用游标分页。
- 并发度 6 在 CloudBase 个人版环境下的 QPS 容忍度未实测。
- `unassigned` Tab 与搜索路径仍是全量装配，本轮未动。
- `CandidatesPage.onMounted` 中 `jobStore.fetchActive()` 仍串行阻塞在 `loadData` 之前（改动它需先保证
  `jobsLookup` 就绪，否则岗位标题会缺失，故本轮不动）。

## V2.0.0（2026-06-23）— 全新重构版本

### 一、整体架构变更

| V18 | V2.0 |
|-----|------|
| 单文件 HTML（11,497 行） | Vue 3 模块化 SPA（~200 文件） |
| 342 个全局函数 | 10 个 Store + 32 个 Service + 7 个 Composable |
| localStorage 为主数据源 | CloudBase 文档数据库为唯一数据源 |
| 浏览器端 Tesseract OCR | 腾讯云 OCR API（中文识别 95%+） |
| 无 AI 解析 | DeepSeek API 结构化简历解析 |
| 无 AI 助手 | RAG 增强 AI 招聘助手（知识库 + 公司人设） |
| 无审批机制 | 轻量审批（Job/Config 变更需管理员审核） |
| 无自动备份 | 每日自动备份 + 健康监控 |
| 1100 行同步冲突解决代码 | ~50 行乐观锁（`_version` 字段） |
| PC 单端 | 响应式布局（PC + 移动端自适应） |

### 二、新增功能

#### 核心业务

| 功能 | 说明 |
|------|------|
| 🆕 招聘需求管理 | 需求创建 → 审批 → 招聘中 → 完成/关闭，支持四级部门树关联 |
| 🆕 简历 AI 解析 | DeepSeek + 腾讯云 OCR 双引擎，结构化提取 20+ 字段 |
| 🆕 12 步招聘漏斗 | 筛选通过→邀约→已确认面试→初试→复试→终试→Offer→入职→已通过，含淘汰/放弃 |
| 🆕 看板拖拽流转 | SortableJS 拖拽 + 快捷键流转 + 批量操作，跳阶段自动回填 |
| 🆕 变更审批 | Job 和 Config 增删改需管理员审核，Candidate 操作通过审计日志追溯 |
| 🆕 沟通记录 | 5 种沟通方式 + 方向标注 + 跟进提醒 |
| 🆕 去重检测 | 三级匹配（文件 Hash / 手机邮箱 / 姓名+公司），不阻止录入但展示提醒 |

#### 邮箱自动归集

| 功能 | 说明 |
|------|------|
| 🆕 IMAP 邮箱扫描 | 支持 QQ邮箱/163邮箱/企业邮箱，每 30 分钟自动拉取 |
| 🆕 简历附件解析 | 支持 PDF/Word/图片/TXT/RTF/HTML/压缩包等 15 种格式 |
| 🆕 ParseQueue 解耦 | 收取与解析分离（email-scanner + parse-queue-processor） |
| 🆕 授权码加密 | AES-256-GCM + PBKDF2 派生密钥，密钥和盐值分离存放 |

#### AI 能力

| 功能 | 说明 |
|------|------|
| 🆕 RAG 招聘助手 | 5 步管道：意图识别→知识检索→Prompt组装→DeepSeek生成→返回 |
| 🆕 知识库系统 | 9 种分类 + 关键词/标签匹配 + AI 网络搜索自动生成草稿 |
| 🆕 公司人设 | CompanyProfile 单例文档作为 AI System Prompt 约束 |
| 🆕 历史洞察 | 分析历史 Application 数据自动生成招聘规律洞察 |
| 🆕 简历匹配度 | 6 维度加权评分（技能/经验/学历/地点/薪资/岗位） |

#### 数据分析

| 功能 | 说明 |
|------|------|
| 🆕 多维度报表 | 概览/岗位漏斗/趋势/部门月度 四种报表 |
| 🆕 漏斗可视化 | Chart.js 漏斗图和转化率面板 |
| 🆕 报表缓存预热 | 每日凌晨 2:00 预计算，前端只收 <10KB 统计结果 |
| 🆕 渠道/来源统计 | 按招聘来源统计入职人数 |

#### 系统管理

| 功能 | 说明 |
|------|------|
| 🆕 回收站 | 软删除 + 恢复 + 永久删除 + 关联恢复 |
| 🆕 数据移交 | 专员离职时批量移交 Candidate 数据 |
| 🆕 历史数据导入 | CSV/Excel 4 步向导 + 去重策略 |
| 🆕 数据库备份 | 每日全量备份（30天保留）+ 每周归档（12周）+ 手动永久备份 |
| 🆕 健康监控 | 每小时心跳检查 + API 余额探测 + ErrorLog 告警 |
| 🆕 年度归档 | 入职>6月 + 结束>12月的 Application 自动标记 isArchived |
| 🆕 批量操作 | 10 种批量操作，单次上限 100 条，分批写入 |

#### 其他

| 功能 | 说明 |
|------|------|
| 🆕 快捷键系统 | Space/Ctrl+方向键/E/W/A/? 等 8 个快捷键 |
| 🆕 移动端适配 | 768px 断点自动切换汉堡菜单 + 列表视图 |
| 🆕 空状态引导 | 首次使用空页面提供操作入口 |
| 🆕 乐观锁 | `_version` 字段并发控制，自动重试 |
| 🆕 离线兜底 | localStorage 缓存 + OfflineBanner 离线提示 |
| 🆕 15 种文件格式 | RTF/HTML/压缩包递归解压/Apple Pages 全格式覆盖 |

### 三、数据模型变更

| V18 | V2.0 | 说明 |
|-----|------|------|
| 扁平 Candidate | Candidate ↔ Application ↔ Job 三层模型 | 同一候选人可投多岗位 |
| 无漏斗概念 | Application.funnel 嵌入式漏斗 | 与 Greenhouse/Lever 对齐 |
| 无结束状态 | status + endStage + endReason | 淘汰 5 选项 + 放弃 8 选项 |
| 无审计日志 | AuditLog 集合 | 所有操作可追溯 |

新增集合（共 14 个 → 17 个）：
- 🆕 CompanyProfile：公司人设
- 🆕 KnowledgeBase：RAG 知识库
- 🆕 RecruitmentInsight：历史招聘洞察
- 🆕 ParseQueue：简历解析队列
- 🆕 ReportCache：报表缓存
- 🆕 EmailConfig：邮箱配置
- 🆕 PendingChange：变更审批
- 🆕 Notification：通知
- 🆕 Config：系统配置
- 🆕 AuditLog：审计日志
- 🆕 ErrorLog：错误日志
- 🆕 BackupSnapshot：备份快照
- 🆕 RecruitmentDemand：招聘需求

### 四、云函数（15 个）

| 云函数 | 用途 |
|--------|------|
| auth-proxy | 用户认证 + 账号管理 |
| resume-parser-proxy | DeepSeek 简历解析代理 |
| email-scanner | IMAP 邮箱扫描 |
| parse-queue-processor | 简历解析队列消费 |
| report-aggregator | 报表聚合 |
| report-cache-warmer | 报表缓存预热 |
| rag-assistant-proxy | RAG AI 助手 |
| web-search-agent | AI 网络搜索 |
| history-insight-generator | 历史洞察生成 |
| db-backup | 数据库自动备份 |
| health-monitor | 系统健康监控 |
| write-audit-log | 审计日志写入 |
| get-file-url | 云存储文件下载代理 |
| archive-old-applications | 年度归档 |
| init-department-tree | 初始化部门树 |

### 五、关键技术决策（31 条）

详见《项目规划书》第十六章"关键设计决策记录"。

### 六、安全性增强

| 项目 | 说明 |
|------|------|
| API Key 保护 | DeepSeek/腾讯云 Key 仅存云函数环境变量，前端不可见 |
| 密码哈希 | PBKDF2-SHA256，100,000 次迭代 |
| 暴力破解防护 | 5 次失败锁定 15 分钟 |
| 数据库权限 | 集合级安全规则（10 条），Application 按 ownerId 隔离 |
| 审计追溯 | 所有操作写入 AuditLog |
| IMAP 密码加密 | AES-256-GCM + PBKDF2 派生密钥 |
| 会话管理 | JWT + localStorage 24h 有效期 + 签名校验 |

### 七、已知限制

| 限制 | 说明 |
|------|------|
| RAG 检索 | 关键词+标签匹配（非向量语义检索），条目 <1000 无性能问题 |
| 移动端 | 响应式降级（列表代替拖拽），不上 PWA/离线 |
| 数据规模 | CloudBase 免费额度内，年末约 18,000 条 Application |

### 八、从 V18 迁移

V18 尚未正式投入使用，无需数据迁移。V2.0 全新启动。

---

> 📖 关联文档：[项目规划书](recruit-tracker-v2-plan.md) | [实施规范](recruit-tracker-v2-implementation.md) | [用户操作手册](docs/用户操作手册.md)
