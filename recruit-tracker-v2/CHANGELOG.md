# 变更日志

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
