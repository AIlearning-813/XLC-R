# 新励成招聘管理系统 V2.0 — 项目搭建规划书

> **编制日期**：2026-06-13（2026-06-16 修订：第4回専門家審査のParseQueue断链修复済み）  
> **参考标准**：Moka（交互设计）、Lever（看板管道）、DeepSeek API（简历解析）、Clean Architecture（代码架构）  
> **最新状态**：全4回審査の全問題を解決済み，18 章，31 件关键决策，15 种文件格式，10 个云函数，22-28 天工期，RAG 公司知识库系统

---

## 目录

| 章节 | 标题 | 子节 |
|------|------|------|
| **一** | [项目背景与目标](#一项目背景与目标) | 1.1 现状痛点 · 1.2 建设目标 |
| **二** | [技术选型](#二技术选型) | 2.1 整体技术栈 · 2.2 为什么选 Vue 3 · 2.3 为什么不选 React |
| **三** | [系统架构](#三系统架构) | 3.1 分层架构图 · 3.2 数据模型 · 3.3 同步模型 · **3.4 公司知识库与RAG系统** |
| **四** | [前端模块拆分](#四前端模块拆分) | 目录结构 + 云函数清单（10 个）🆕 |
| **五** | [简历解析方案设计](#五简历解析方案设计) | 5.1 方案架构 · 5.2 可行性 · 5.3 API Key 安全方案 · 5.4 解析流程 · 5.5 成本 |
| **六** | [邮箱自动归集方案设计](#六邮箱自动归集方案设计) | 6.1 业务场景 · 6.2 方案架构 · 6.3 IMAP vs POP3 · 6.4 云函数 · 6.5 去重 · 6.6 加密安全性 · 6.7 费用 · 6.8 配置界面 · **6.9 文件格式(15种)** · **6.10 解析通知** · **6.11 解析队列处理器** 🔴 |
| **七** | [招聘漏斗数据模型设计](#七招聘漏斗数据模型设计) | 7.1 背景 · 7.2 需求 · 7.3 业界参考 · 7.4 数据模型 · 7.5 差异化漏斗 · 7.6 回填逻辑 · 7.7 一致性保障 · 7.8 报表层 · 7.9 关键决策 · **7.10 报表聚合层** · **7.11 结束状态** · **7.12 跟进记录** · **7.13 批量操作** · **7.14 重复检测** |
| **八** | [数据初始化策略](#八数据初始化策略) | 初始化脚本 |
| **九** | [变更审批机制](#九变更审批机制) | 9.1 初衷 · 9.2 运行方式 · 9.3 完整流程 · 9.4 数据模型 · 9.5 权限 · 9.6 不审批候选人 · 9.7 实施成本 |
| **十** | [数据库安全规则设计](#十数据库安全规则设计) | 10.1 问题 · 10.2 权限模型 · 10.3 集合级规则(10条) · 10.4 测试矩阵 · 10.5 云函数特权 · 10.6 决策 · **10.7 get()循环依赖验证** |
| **十一** | [数据库自动备份设计](#十一数据库自动备份设计) | 11.1 问题 · 11.2 三级策略 · 11.3 云函数 · 11.4 恢复流程 · 11.5 成本 · 11.6 决策 |
| **十二** | [监控告警体系设计](#十二监控告警体系设计) | 12.1 问题 · 12.2 架构 · 12.3 云函数 · 12.4 前端错误捕获 · 12.5 仪表盘 · 12.6 告警通知 · 12.7 决策 |
| **十三** | [多环境部署策略](#十三多环境部署策略) | 13.1 问题 · 13.2 双环境 · 13.3 环境变量 · 13.4 SDK初始化 · 13.5 部署流水线 · 13.6 数据隔离 · 13.7 回滚 · 13.8 决策 |
| **十四** | [用户体验与适配设计](#十四用户体验与适配设计) | 14.1 空状态设计 · 14.2 移动端适配 · 14.3 决策 |
| **十五** | [实施计划](#十五实施计划) | 8 阶段 · 22-28 天 · 里程碑 |
| **十六** | [关键设计决策记录](#十六关键设计决策记录) | 31 件决策汇总表 🆕 |
| **十七** | [风险与应对](#十七风险与应对) | 风险矩阵 |
| **十八** | [下一步](#十八下一步) | 行动清单 |

> **符号说明**：🆕 = 本轮新增 | **粗体** = 核心/复杂模块

---

## 一、项目背景与目标

### 1.1 现状痛点

| 痛点 | 根因 | 严重程度 |
|------|------|----------|
| 单文件 11,497 行，342 个全局函数 | 无模块化、无分层 | 🔴 改不动 |
| 管理员看不到专员数据 | localStorage为主+CloudBase为备份的模型反了 | 🔴 同步全乱 |
| 简历解析准确率 50-65% | 纯正则匹配，无版面分析 | 🟡 核心功能弱 |
| 只有列表视图 | 无看板管道，行业标准缺失 | 🟡 体验差 |
| 候选人直接绑状态 | 缺 Application 中间层 | 🟡 数据模型局限 |
| 同步代码 1100+ 行 | 本质在JS里手写分布式冲突解决 | 🔴 维护噩梦 |
| BOSS直聘简历需手动下载再上传 | 无邮箱自动归集能力 | 🟡 重复劳动 |
| 招聘漏斗数据无法准确统计 | 无标准化漏斗数据模型，跳阶段录入导致数据缺失 | 🔴 决策无据 |
| 不同岗位面试轮次混用 | CC/负责人需3轮，CR/人事只需2轮，但系统不做区分 | 🟡 流程不匹配 |
| 专员可随意修改/删除招聘需求 | 无变更管控机制，数据造假或误删不可追溯 | 🔴 管控缺失 |
| 专员可随意修改系统配置 | 一人改错岗位/部门/城市，全员受影响 | 🔴 管控缺失 |

### 1.2 建设目标

- **架构**：Clean Architecture 分层，模块化，可测试
- **数据**：CloudBase 为唯一数据源，localStorage 降级为离线缓存
- **简历解析**：腾讯云 OCR API（中文识别 95%+）+ DeepSeek API（结构化提取），零服务器成本
- **邮箱归集**：CloudBase 云函数定时 IMAP 扫描，自动收取 BOSS 直聘邮箱简历，零手动搬运
- **交互**：看板式管道拖拽（参考 Lever），漏斗可视化（参考 Greenhouse）
- **可靠性**：端到端测试覆盖核心流程，同步零丢失

---

## 二、技术选型

### 2.1 整体技术栈

| 层 | 技术 | 理由 |
|----|------|------|
| **前端框架** | Vue 3 + Vite | 组件化天然适配看板UI，生态丰富，学习曲线平缓 |
| **UI 组件** | 自建 + SortableJS（拖拽） | 看板拖拽用 SortableJS，其余组件参考你现有的 CSS 变量体系 |
| **图表** | Chart.js 4.x（沿用） | 你已熟悉，功能足够 |
| **状态管理** | Pinia | Vue 3 官方推荐，比 Vuex 更简洁 |
| **OCR 引擎** | 腾讯云 OCR API | 中文识别率 95%+，与 CloudBase 同属腾讯云，一个账号管理 |
| **信息提取 LLM** | DeepSeek API（v4-flash） | Tool Use 模式结构化提取，国内模型数据不出境，超低成本（¥0.01/份） |
| **数据库** | CloudBase 文档数据库（腾讯云） | 你已购买，沿用但换正确模型 |
| **文件存储** | CloudBase 云存储 | 简历原文件存储 |
| **定时任务** | CloudBase 云函数（SCF）+ 定时触发器 | 每10分钟触发邮件扫描，免费额度内完全够用 |
| **邮件协议** | IMAP（imapflow 库） | Node.js 原生支持，零依赖问题 |
| **部署** | CloudBase 静态托管（前端）+ 云函数（后端） | 纯 Serverless，零服务器 |

### 2.2 为什么选 Vue 3 而不是继续 vanilla JS？

| 考量 | vanilla JS | Vue 3 |
|------|-----------|-------|
| 看板拖拽开发 | 手写状态同步+DnD事件 → 500+行 | SortableJS + v-for 数据驱动 → 100行 |
| 组件复用 | 无 | 候选人卡片/统计卡片/搜索下拉天然可复用 |
| 多人协作 | 全局变量冲突风险高 | 组件作用域隔离 |
| 构建优化 | 无 | Vite 打包后比你现在 568KB 更小 |
| 迁移成本 | — | 你的 CSS 变量体系和业务逻辑可大量复用 |

### 2.3 为什么不选 React？

React 和 Vue 3 能力相当，但 Vue 3 的模板语法更接近你习惯的 HTML 写法（你现在的 11,000 行就是 HTML+JS），迁移心智成本更低。

---

## 三、系统架构

### 3.1 分层架构图

```
┌────────────────────────────────────────────────────────────────┐
│                       浏览器 (SPA)                              │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                 视图层 (UI Layer)                        │   │
│  │   Dashboard │ Pipeline(看板) │ Candidates │ ...        │   │
│  └─────────────────────┬──────────────────────────────────┘   │
│                        │                                       │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │               业务逻辑层 (Services)                      │   │
│  │   PipelineEngine │ MatchingEngine │ ExportService       │   │
│  └─────────────────────┬──────────────────────────────────┘   │
│                        │                                       │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │               数据访问层 (Store/Repository)              │   │
│  │   CandidateStore │ JobStore │ ApplicationStore         │   │
│  └─────────────────────┬──────────────────────────────────┘   │
│                        │                                       │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │                API 通信层 (DataClient)                   │   │
│  │   CloudBase SDK │ 腾讯云OCR客户端                        │   │
│  └──────┬──────────────────┬──────────────────────────────┘   │
│         │                  │                                   │
└─────────┼──────────────────┼───────────────────────────────────┘
          │                  │
┌─────────▼──────────┐ ┌─────▼────────┐
│  CloudBase (腾讯云)  │ │ 腾讯云OCR API │
│                     │ │              │
│  • 文档数据库       │ │ • 中文识别   │
│  • 云存储(简历文件)  │ │   95%+准确率 │
│  • 静态网站托管      │ │ • PDF/图片   │
│  • 匿名登录认证      │ │ • 按量付费   │
│                     │ └──────────────┘
│  • 云函数 SCF ──────┼──→ 定时触发 ──→ 邮件扫描
│    (每10分钟)       │
│                     │
│  • 云函数 SCF ──────┼──→ resume-parser-proxy ──→ DeepSeek API
│    (按需调用)       │        ↑ API Key 仅在云函数环境变量中
└─────────────────────┘
          │
┌─────────▼──────────────────────────────────────────────────┐
│                    专员邮箱 (QQ邮箱 / 企业邮箱)               │
│                    IMAP 协议收取 BOSS直聘 简历邮件            │
└────────────────────────────────────────────────────────────┘

### 3.2 数据模型（核心变更）

```
旧模型（V18 - 扁平）：
  Candidate { id, name, phone, status, position, ... }
  HiringNeed { id, dept1, dept2, position, count, ... }
  ↑ 两者无关联

新模型（V2 - 三层关联）：
  
  Job (职位/需求)
  ├── id, title, department, headcount, deadline, status
  ├── interviewRounds: 2 | 3   ← 🆕 差异化面试轮次（CC/负责人3轮，CR/人事2轮）
  ├── createdBy, createdAt, updatedAt
  │
  Candidate (候选人)
  ├── id, name, phone, email, parsedData (简历解析结果)
  ├── duplicateGroupId, duplicateOf, duplicateScore  ← 🆕 重复检测（7.14）
  ├── createdBy, createdAt, updatedAt
  │
  Application (申请记录) ←── 连接 Candidate 和 Job，**单一真相来源**
  ├── id, candidateId (FK), jobId (FK)
  ├── stage ("简历"→"有效简历"→"邀约"→"初试"→"初试通过"→"复试"→"复试通过"
  │         →"终试"→"终试通过"→"Offer"→"入职")  ← 🆕 12个真实漏斗阶段（含1个可选：已确认面试）
  ├── stageEnteredAt (进入当前阶段的时间，用于计算停留天数+超期预警)
  ├── status: 'active' | 'rejected' | 'withdrawn'    ← 🆕 流程状态
  │     active = 流程中（显示在看板管道）
  │     rejected = 公司淘汰（显示在"已结束"列表）
  │     withdrawn = 候选人放弃（显示在"已结束"列表）
  ├── endStage: 'resume'|'interview1'|'interview2'|...  ← 🆕 结束时所处阶段
  ├── endReason: string   ← 🆕 结束原因（专员从预设选项中选择）
  ├── endedAt: timestamp  ← 🆕 结束时间
  ├── funnel: {                                      ← 🆕 漏斗时间戳嵌入 Application，双轨废除
  │     resumeAt, validAt, inviteAt,                ← 前3个节点
  │     inviteConfirmedAt,                          ← 🆕 已确认面试（可选节点，填补邀约→初试间的业务断点）
  │     interview1At, interview1PassAt,             ← 初试节点
  │     interview2At, interview2PassAt,             ← 复试节点
  │     interview3At, interview3PassAt,             ← 终试节点（2轮岗位为null）
  │     offerAt, onboardAt                          ← 最后节点
  │   }
  ├── funnelMeta: {                                  ← 🆕 回填追踪
  │     entrySource: "manual" | "auto_backfill",
  │     backfillStages: [...],
  │     backfillAt, backfillBy
  │   }
  ├── ownerId (专员), visibility ("global"|"restricted")
  ├── matchScore, tags, source
  ├── history: [ { fromStage, toStage, at, note }, ... ]
  ├── communicationLogs: [ { type, direction, summary, result, followUpAt }, ... ]  ← 🆕 沟通记录
  ├── feedbacks: [ { stage, interviewer, rating, comment, createdAt }, ... ]  ← 🆕 面试评价
  ├── createdAt, updatedAt (服务端时间戳!)
  │
  AuditLog (操作审计)
  ├── id, action, entityType, entityId, operator, detail, timestamp
  
  PendingChanges (变更审批) ←── 🆕 两层写入：专员提交→管理员审核后生效
  ├── id, type: "job" | "config"
  ├── action: "create" | "update" | "delete"
  ├── entityType, entityId
  ├── before: {...}   (变更前数据快照)
  ├── after: {...}    (变更后数据)
  ├── status: "pending" | "approved" | "rejected"
  ├── submittedBy, submittedAt
  ├── reviewedBy, reviewedAt, reviewComment
  
  EmailConfig (专员邮箱配置) ←── 🆕 邮箱扫描
  ├── id, userId (FK), email, imapHost, imapPort, imapUser, imapPassword (AES-256加密)
  ├── filterRules: { fromWhitelist, subjectKeywords }
  ├── scanInterval: 10 (分钟), enabled: true
  ├── lastScanAt, lastSuccessfulScanAt, lastError, failureCount, nextRetryAt, createdAt, updatedAt
  
  ErrorLog (错误日志) ←── 🆕 监控告警（详见第十五章）
  ├── id, type: "cloudFunction"|"api"|"client"|"heartbeat"
  ├── source: string (errorSource: "email-scanner"/"report-aggregator"等)
  ├── message, stack, context (JSON)
  ├── severity: "critical"|"warning"|"info"
  ├── createdAt
  
  ParseQueue (解析队列) ←── 🆕 邮件归集后进入解析管线
  ├── id, fileId (云存储文件ID), fileName, fileHash (MD5去重)
  ├── source: "email"|"manual"|"import", sourceEmailId (邮件Message-ID)
  ├── status: "pending"|"parsing"|"done"|"failed"
  ├── parsedCandidateId (解析完成后关联), retryCount
  ├── createdAt, processedAt
  
  DuplicateExclusion (重复排除列表) ←── 🆕 管理员标记"不是同一个人"
  ├── id, candidateA, candidateB (两个候选人的 ID，双向)
  ├── excludedBy (管理员), excludedAt
  
  ParseNotification (解析通知) ←── 🆕 简历解析结果通知专员
  ├── id, userId, type: "parse_success"|"parse_failed"|"scan_summary"
  ├── parseQueueId, candidateId, candidateName
  ├── title, detail, status: "unread"|"read"
  ├── createdAt

  ─── 公司知识库（RAG 三层体系）🆕 ───

  CompanyProfile (公司画像) ←── 🆕 AI 的"公司人设"，全局唯一一份
  ├── _id: "singleton"
  ├── name, shortName, logo, description
  ├── industry, subIndustry, founded, size, website
  ├── locations: [{city, type, address}]
  ├── businessLines: [{name, description, revenueShare}]
  ├── culture: [string], benefits: [string]
  ├── recruitmentPhilosophy, employerBrand: {strengths, challenges}
  ├── changeLog: [{field, oldValue, newValue, changedAt, changedBy}]
  ├── updatedAt, updatedBy

  KnowledgeBase (知识库条目) ←── 🆕 RAG 核心检索源
  ├── _id, category (9种分类)
  ├── title, content (可检索正文), structured (结构化数据)
  ├── source: "manual"|"web_search"|"ai_extract"|"historical_infer"
  ├── sourceUrl, sourceVerified (AI搜来的需人工审核)
  ├── tags: [string], relevance: "high"|"medium"|"low"
  ├── useCount, lastUsedAt, status: "published"|"draft"|"archived"
  ├── createdBy, createdAt, updatedAt

  RecruitmentInsight (历史洞察缓存) ←── 🆕 从历史数据自动提炼的规律
  ├── _id, cacheKey (如 "insight:sales_manager")
  ├── data: {avgTimeToHire, avgCandidatesPerHire, topSources, 
  │          commonRejectReasons, successfulProfile, salaryRange}
  ├── computedAt, expiresAt, sourceJobIds: [string]
```

**关键设计原则**：
- `updatedAt` 由 CloudBase 服务端生成（`new Date().toISOString()` 在写入时服务端生成），**不依赖客户端时钟**
- 所有数据记录有 `ownerId` 和 `visibility`，权限在查询层控制
- localStorage 仅缓存**当前登录用户**最近查看的数据，不作为数据源

### 3.3 同步模型（彻底重做）

```
旧模型 ❌：
  localStorage.setItem() → monkey-patch触发 → xlcQueueSync → xlcSyncKey → CloudBase
  问题：localStorage是主库，CloudBase是备份

新模型 ✅：
  界面操作 → Store(Pinia) → CloudBase SDK 直接读写 → 返回结果
               ↓
          localStorage（被动缓存，仅用于：
            1. 加速重复读取（读缓存，后台刷新）
            2. 离线降级（网络断开时暂存，恢复后自动推送）
            3. CloudBase API 不可用时兜底）
```

**同步冲突解决**：
- 每条记录一个 `_version` 字段，写入时比对版本号
- 版本冲突 → 服务端优先（你不需要再写 1100 行冲突解决代码）
- 离线写入暂存 IndexedDB，恢复网络后按序回放

### 3.4 公司知识库与 RAG 检索增强生成系统 🆕

> **核心问题**：当前系统的 AI 只做机械的简历文本→JSON 转换，对新励成公司一无所知——不知道公司业务、团队结构、薪资体系、过往招聘偏好。AI 无法给出"懂你公司"的招聘建议。

#### 3.4.1 三层知识架构

```
┌─────────────────────────────────────────────────────────┐
│                    AI 招聘助手                            │
│         (写JD建议 / 筛选建议 / 薪资建议 / 沟通话术)         │
└──────────────────────┬──────────────────────────────────┘
                       │ 检索增强生成 (RAG)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   知识库检索层                             │
│         根据当前上下文（岗位/阶段/候选人）匹配知识条目        │
└───────┬──────────────────┬──────────────────┬───────────┘
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 公司画像      │  │ 招聘知识库    │  │ 历史数据洞察  │
│ CompanyProfile│  │ KnowledgeBase │  │ Recruitment   │
│              │  │              │  │ Insight       │
├──────────────┤  ├──────────────┤  ├──────────────┤
│ • 公司名称     │  │ • 公司文化    │  │ • 各岗位平均   │
│ • 公司介绍     │  │ • 团队结构    │  │   招聘周期     │
│ • 业务线      │  │ • 薪资体系    │  │ • 各渠道转化率  │
│ • 办公地点     │  │ • 岗位JD模板  │  │ • 候选人画像   │
│ • 福利待遇     │  │ • 面试题库    │  │ • 离职原因分析  │
│ • 发展历程     │  │ • 竞品信息    │  │ • 薪资趋势     │
│              │  │ • 行业术语    │  │              │
│ 来源: 管理员编辑│  │ 来源: 手动+AI │  │ 来源: 系统自动  │
└──────────────┘  └──────────────┘  └──────────────┘
```

| 层 | 集合名 | 数量 | 维护方式 | AI 使用方式 |
|----|--------|------|---------|-----------|
| **公司画像** | `CompanyProfile` | 1 条 | 管理员在设置页编辑，变更留痕 | 注入 System Prompt 作为 AI 的"基础人设" |
| **知识库** | `KnowledgeBase` | 数十~数百条 | 手动 + AI 网络搜索 + 文档导入 + 历史推断 | 语义检索匹配 Top-N 条目，注入 Prompt |
| **历史洞察** | `RecruitmentInsight` | 每岗位 1 条 | 云函数定期/导入后自动计算 | 按岗位匹配，提供数据驱动的建议依据 |

#### 3.4.2 CompanyProfile — AI 的"公司人设"

```js
// 集合: CompanyProfile，全局唯一一份 _id = "singleton"
{
  _id: "singleton",
  name: "新励成教育科技集团",
  shortName: "新励成",
  logo: "cloud://xxx/logo.png",
  
  // ── 基本介绍 ──
  description: "新励成是专注…的综合性教育集团",
  industry: "教育培训",
  subIndustry: "素质/口才/演讲培训",
  founded: 2005,
  size: "500-2000人",
  website: "https://www.xlc.com",
  
  // ── 结构化信息 ──
  locations: [
    { city: "广州", type: "总部", address: "..." },
    { city: "北京", type: "分公司" },
    { city: "上海", type: "分公司" }
  ],
  businessLines: [
    { name: "青少年口才培训", description: "...", revenueShare: "40%" },
    { name: "成人演讲培训", description: "...", revenueShare: "35%" },
    { name: "企业内训", description: "...", revenueShare: "25%" }
  ],
  culture: ["以学员为中心", "持续创新教学方法", "团队协作共赢"],
  benefits: [
    "五险一金", "带薪年假15天", "员工子女免费课程", "定期团建"
  ],
  
  // ── 招聘相关（AI 生成 JD / 沟通话术时引用）──
  recruitmentPhilosophy: "我们寻找热爱教育、有成长心态的人才…",
  employerBrand: {
    strengths: ["行业领先", "培训体系完善", "晋升通道清晰"],
    challenges: ["行业认知度待提升", "部分城市人才竞争激烈"]
  },
  
  // ── 变更历史（自动记录，可追溯）──
  changeLog: [
    { field: "name", oldValue: "新励成教育", newValue: "新励成教育科技集团", 
      changedAt: "2026-06-15T10:00:00Z", changedBy: "admin_uid" }
  ],
  
  updatedAt: "2026-06-15T10:00:00Z",
  updatedBy: "admin_uid"
}
```

**管理入口**：设置页 → "公司信息" Tab → 表单编辑 → 保存时自动追加 changeLog。

#### 3.4.3 KnowledgeBase — RAG 核心检索源

```js
// 集合: KnowledgeBase，分类管理
{
  _id: "auto",
  category: "company_culture" | "team_structure" | "salary_system"
          | "job_template" | "interview_question" | "competitor_info"
          | "industry_term" | "recruitment_tip" | "candidate_persona",
  
  title: "新励成教研团队架构说明",
  content: "新励成教研团队分为：课程研发组（负责课程设计）…",  // 全文检索
  structured: {                                      // 结构化数据（选填）
    teamName: "教研部",
    subTeams: ["课程研发组", "教学执行组", "质量评估组"],
    headcount: 45,
    reportTo: "教研副总裁"
  },
  
  source: "manual" | "web_search" | "ai_extract" | "historical_infer" | "document_import",
  sourceUrl: "https://www.xlc.com/about" | null,
  sourceVerified: true,     // AI 搜来的条目默认 false，需管理员审核
  
  tags: ["教研", "团队结构", "组织架构"],
  relevance: "high" | "medium" | "low",
  useCount: 0,              // AI 引用次数，用于评估知识价值
  lastUsedAt: null,
  
  status: "published" | "draft" | "archived",
  createdBy: "admin_uid",
  createdAt: "…",
  updatedAt: "…"
}
```

**知识来源四通道**：

| 通道 | 来源 | 触发方式 | 写入后状态 |
|------|------|---------|-----------|
| 🖊 **手动录入** | 管理员在设置页编写 | 手动操作 | `published`，可直接被检索 |
| 🌐 **AI 网络搜索** | 云函数搜索网上关于新励成的信息 | 管理员点击"搜集公司信息" | `draft`，`sourceVerified: false`，需人工审核后改为 `published` |
| 📄 **文档导入** | 上传公司手册/PPT/Word/PDF | 管理员上传 | `draft`，AI 提取后人工确认 |
| 📊 **历史推断** | 从导入的历史招聘数据中总结规律 | 导入完成后自动触发 | `published`，`source: "historical_infer"` |
| 🔄 **使用反馈** | 管理员发现 AI 回答不好，手动补充知识 | 手动添加 | `published` |

#### 3.4.4 RecruitmentInsight — 历史数据洞察

```js
// 集合: RecruitmentInsight，每岗位一条，云函数定期计算
{
  _id: "insight:sales_manager",
  cacheKey: "insight:sales_manager",
  data: {
    avgTimeToHire: 23,           // 平均招聘周期（天）
    avgCandidatesPerHire: 8.5,   // 平均每个入职需过目多少候选人
    offerAcceptRate: 0.72,       // offer 接受率
    topSources: [                // 最佳来源渠道
      { source: "内推", conversionRate: 0.18, count: 12 },
      { source: "BOSS直聘", conversionRate: 0.12, count: 45 }
    ],
    commonRejectReasons: [       // 高频淘汰原因
      { reason: "行业经验不足", count: 15 },
      { reason: "薪资期望过高", count: 8 },
      { reason: "通勤距离远", count: 5 }
    ],
    successfulProfile: "3-5年教育行业销售经验，本科学历，熟悉广州市场，有B端客户资源…",
    salaryRange: { min: 8000, max: 15000, median: 11000 },
    interviewPassRates: {        // 各轮面试通过率
      interview1: 0.65,
      interview2: 0.45,
      interview3: 0.30
    }
  },
  computedAt: "2026-06-15T02:00:00Z",
  expiresAt: "2026-07-15T02:00:00Z",  // 30天后重新计算
  sourceJobIds: ["job_001", "job_002"] // 参与计算的岗位
}
```

**计算触发时机**：
- 历史数据导入完成后自动触发（首次计算）
- `report-cache-warmer` 定时任务中追加（每月刷新一次）
- 管理员手动触发"重新分析"

#### 3.4.5 RAG 检索增强生成流程

```
用户输入（自然语言）
  │  "帮我写一个广州销售经理的 JD"
  ▼
┌─────────────────────────────────────────┐
│ ① 意图识别（DeepSeek，小请求 ~200 tokens）│
│   提取：岗位=销售经理, 城市=广州, 动作=写JD │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ ② 知识检索（本地数据库查询，不消耗 AI）     │
│                                          │
│   A. 查 CompanyProfile                   │
│      → name, description, culture,       │
│        benefits, employerBrand           │
│                                          │
│   B. 查 KnowledgeBase（关键词 + 标签匹配） │
│      → 搜索 "销售经理" "JD模板" "广州"    │
│      → 返回 Top-5 相关条目                │
│                                          │
│   C. 查 RecruitmentInsight               │
│      → cacheKey = "insight:sales_manager"│
│      → 返回 avgTimeToHire, salaryRange,  │
│        successfulProfile                 │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ ③ 组装增强 Prompt                        │
│                                          │
│   System:                                │
│   你是新励成教育科技集团的招聘AI助手。      │
│   公司介绍：…  公司文化：…  福利：…        │
│   该岗位历史薪资范围：8k-15k               │
│   该岗位平均招聘周期：23天                  │
│   成功候选人画像：…                        │
│   参考JD模板：…                            │
│                                          │
│   User:                                  │
│   帮我写一个广州销售经理的 JD              │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ ④ DeepSeek 生成（带知识上下文）            │
│   → 输出：个性化、懂公司的 JD              │
│   → 包含公司介绍、文化、福利               │
│   → 薪资范围基于历史数据                   │
│   → 要求描述基于成功候选人画像              │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ ⑤ 反馈与沉淀                             │
│   • 用户采纳 → 更新 KnowledgeBase.useCount│
│   • 用户修改后采纳 → 提取差异，提示是否    │
│     沉淀为新知识条目                       │
│   • 用户完全不用 → 记录低质量信号          │
└─────────────────────────────────────────┘
```

#### 3.4.6 AI 网络搜索云函数设计

```js
// cloud-functions/web-search-agent/index.js
// 触发：管理员在设置页点击"搜集公司信息"
// 用途：搜索网上关于新励成的公开信息，提取为 KnowledgeBase 条目

exports.main = async (event, context) => {
  const { searchQueries } = event;
  // 预设搜索维度（管理员可自定义）
  const queries = searchQueries || [
    "新励成 教育 公司介绍 业务",
    "新励成 招聘 岗位 薪资",
    "新励成 口碑 评价 员工",
    "新励成 竞品 行业 对比",
    "口才培训 演讲培训 行业 趋势"
  ];
  
  const results = [];
  
  for (const query of queries) {
    // ⚠️ S8：DeepSeek API 联网搜索能力需验证。如果 API 不提供内建搜索，改为：
    //   方案A：接入 Bing/SearchAPI → 获取搜索结果摘要 → 喂给 DeepSeek 做信息提取
    //   方案B：基于 DeepSeek 训练数据生成内容，明确告知管理员"非实时搜索，信息可能过时"
    // ⚠️ 2026-07-24 前：deepseek-chat 别名将停止服务，已改为直接使用 deepseek-v4-flash
    const response = await deepseek.chat.completions.create({
      model: "deepseek-v4-flash",
      messages: [{
        role: "system",
        content: `你是企业信息采集助手。搜索关于"新励成"公司的信息。
对于每个找到的信息，输出JSON格式：
{
  "title": "信息标题",
  "content": "详细内容（2-5句话）",
  "category": "company_culture|team_structure|salary_system|job_template|competitor_info|industry_term|recruitment_tip",
  "tags": ["标签1", "标签2"],
  "sourceUrl": "来源URL（如有）",
  "confidence": "high|medium|low"
}
只输出有效信息，没找到的维度跳过。`
      }, {
        role: "user",
        content: query
      }],
      response_format: { type: "json_object" }
    });
    
    const items = JSON.parse(response.choices[0].message.content).items || [];
    results.push(...items);
  }
  
  // 写入 KnowledgeBase，标记为待审核
  const db = cloudbase.database();
  const batch = results.map(item => ({
    ...item,
    source: "web_search",
    sourceVerified: false,       // 关键：AI搜来的默认未审核
    status: "draft",
    useCount: 0,
    createdBy: event.userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  
  // 去重：title 已存在的跳过
  const existing = await db.collection('KnowledgeBase')
    .where({ source: "web_search" }).get();
  const existingTitles = new Set(existing.data.map(e => e.title));
  const newItems = batch.filter(item => !existingTitles.has(item.title));
  
  if (newItems.length > 0) {
    await Promise.all(newItems.map(item => 
      db.collection('KnowledgeBase').add(item)
    ));
  }
  
  return {
    total: results.length,
    new: newItems.length,
    skipped: results.length - newItems.length,
    needsReview: newItems.length  // 提醒管理员审核
  };
};
```

#### 3.4.7 历史招聘数据导入流程

```
管理员上传 CSV/Excel
      │
      ▼
导入向导（前端页面 /import）
  ① 选择文件 → 客户端解析 → 预览前 10 行
  ② 列映射界面：CSV列 ↔ Candidate/Application 字段
     • 必填列：姓名、手机号或邮箱
     • 可选列：应聘岗位、入职日期、当前阶段、面试评价等
  ③ 去重策略选择：
     • 跳过重复（手机号/邮箱已存在则跳过）
     • 覆盖更新（已存在则更新字段）
     • 全部导入（不做去重检查）
  ④ 冲突处理：同一文件中重复记录的处理方式
      │
      ▼
确认导入 → 批量写入
  • 写入 Candidate 集合
  • 自动创建 Application（关联到 Job，如果岗位存在）
  • 标记 funnelMeta.entrySource = "historical_import"
  • 标记 funnelMeta.backfillAt = 导入时间
  • endStage/endReason 根据状态推断
      │
      ▼
导入完成 → 触发后续动作
  ├─→ 生成 RecruitmentInsight（首次分析历史数据）
  ├─→ 生成 KnowledgeBase 条目（从面试评价中提取关键词）
  └─→ 展示导入统计：总条数/成功/跳过/失败
```

**导入数据格式支持**：
| 格式 | 解析方式 | 适用场景 |
|------|---------|---------|
| CSV / Excel (.xlsx/.xls) | SheetJS 客户端解析 | 从其他系统导出的表格数据 |
| JSON | 直接解析 | API 导出的结构化数据 |
| BOSS直聘导出 | 预置列映射模板 | BOSS 直聘后台导出的候选人数据 |

**预置列映射模板**：为常见招聘平台（BOSS直聘、智联、猎聘）预置列映射配置，专员只需选择平台，系统自动匹配字段名。

#### 3.4.8 前端管理界面

**设置页新增 Tab**：

| Tab | 内容 | 操作 |
|-----|------|------|
| 🏢 **公司信息** | CompanyProfile 表单编辑 | 保存（自动记录 changeLog） |
| 📚 **知识库** | KnowledgeBase 列表 + 搜索 + 分类筛选 | 新增/编辑/删除/审核（web_search 条目）/归档 |
| 📊 **历史洞察** | RecruitmentInsight 列表，按岗位展示 | 查看/手动刷新/导出 |
| 🌐 **信息采集** | AI 网络搜索触发按钮 + 上次搜索结果 | 点击"搜索公司信息"→ 等待 → 审核 → 发布 |
| 📥 **数据导入** | 文件上传 + 列映射 + 预览 + 导入 | 三步向导式流程 |

**知识库条目审核流程**（针对 AI 搜来的条目）：
```
web_search → draft (sourceVerified=false)
  → 管理员查看列表，标记"待审核"
  → 逐条审核：确认/编辑/拒绝
  → 确认 → published（可被 RAG 检索）
  → 拒绝 → archived
```

#### 3.4.9 成本估算

| 操作 | 调用模型 | Token 消耗 | 预估费用 |
|------|---------|-----------|---------|
| RAG 意图识别 | DeepSeek v4-flash | ~200 tokens 输入 + ~100 tokens 输出 | ¥0.0004/次 |
| RAG 增强生成（写JD） | DeepSeek v4-flash | ~3000 tokens 输入 + ~1000 tokens 输出 | ¥0.005/次 |
| AI 网络搜索（5个维度） | DeepSeek-chat（联网） | ~2000 tokens 输入 + ~3000 tokens 输出 | ¥0.01/次 |
| 历史洞察计算 | DeepSeek v4-flash | ~5000 tokens 输入 + ~2000 tokens 输出 | ¥0.009/次 |
| 文档导入（AI 提取） | DeepSeek v4-flash | ~10000 tokens 输入 + ~3000 tokens 输出 | ¥0.016/次 |

**月度估算**：
- AI 助手每日使用 30 次 → ¥0.005 × 30 × 30 = ¥4.50/月
- AI 网络搜索每月执行 4 次 → ¥0.04/月
- 历史洞察每月刷新 1 次 → ¥0.009/月
- **合计：约 ¥5/月** — AI 知识库的增量成本极低

#### 3.4.10 关键设计决策

| # | 决策点 | 选择 | 理由 |
|----|--------|------|------|
| 26 | 知识库存储方式 | CloudBase 文档数据库集合 | 无需额外向量数据库；KnowledgeBase 条目数在数百级别，关键词+标签匹配足够；CloudBase 免费额度（50,000次读/天）远超需求 |
| 27 | AI 网络搜索→知识库的写入策略 | draft + sourceVerified=false | AI 搜来的信息可能不准确/过时/有偏见，必须管理员审核后才能被 RAG 检索使用 |
| 28 | 知识检索方式 | 关键词+标签匹配（非向量检索） | 条目数小（<1000），无需向量数据库的复杂度和成本；未来条目增长到 5000+ 可升级为向量检索 |
| 29 | CompanyProfile 的存储模型 | 单例文档（_id="singleton"） | 公司信息全局唯一，单例模型最简单；changeLog 数组记录完整变更历史 |
| 30 | 历史数据导入的去重策略 | 手机号+邮箱双重匹配 | 与现有 Candidate 查重逻辑一致（§7.14），导入时预设三种策略（跳过/覆盖/全部导入）给用户选择 |

---

## 四、前端模块拆分

```
src/
├── main.js                       # 入口：挂载 Vue、Pinia、路由
├── App.vue                       # 根组件（布局壳 + 侧边栏 + 路由出口）
│
├── config/
│   ├── constants.js              # 管道阶段、部门树、岗位列表、结束状态
│   └── default-settings.js       # 系统默认配置
│
├── stores/                       # Pinia 状态 + 数据访问
│   ├── useAuthStore.js           # 登录/角色/会话
│   ├── useJobStore.js            # 职位/需求 CRUD
│   ├── useCandidateStore.js      # 候选人 CRUD
│   ├── useApplicationStore.js    # 🆕 申请记录 + 管道状态 + 漏斗数据（单一文档读写）
│   ├── useConfigStore.js         # 系统配置
│   ├── usePendingChangeStore.js  # 🆕 变更审批（专员提交→管理员审核）
│   └── useSyncStore.js           # 离线队列 + 同步状态
│
├── services/                     # 纯业务逻辑（无 UI 依赖，可单元测试）
│   ├── cloudbase.js              # CloudBase SDK 初始化 + CRUD 封装
│   ├── resume-parser.js          # 简历解析：PDF提取 → OCR → DeepSeek结构化
│   ├── email-scanner.js          # 🆕 邮箱扫描逻辑（IMAP连接+邮件过滤+附件下载）
│   ├── pipeline-engine.js        # 管道流转（允许进入哪些阶段、漏斗计算）
│   ├── matching-engine.js        # AI 匹配度计算
│   ├── export-excel.js           # Excel 导出（保留你现有逻辑）
│   ├── export-csv.js             # CSV 导出
│   └── audit.js                  # 审计日志记录
│
├── composables/                  # Vue 组合式函数（可复用逻辑）
│   ├── useSearchDropdown.js      # 搜索下拉（你在用的大量部门/岗位搜索）
│   ├── usePagination.js          # 分页
│   └── useDateFilter.js          # 日期筛选（今天/本周/本月）
│
├── components/                   # 可复用 UI 组件
│   ├── layout/
│   │   ├── AppSidebar.vue        # 侧边栏（保留你现在的导航结构）
│   │   └── AppHeader.vue         # 顶栏
│   ├── common/
│   │   ├── SearchDropdown.vue    # 带搜索的下拉（替换你现在的下拉组件）
│   │   ├── StatCard.vue          # 统计卡片
│   │   ├── DateFilterBar.vue     # 日期筛选栏
│   │   ├── FilterBar.vue         # 通用筛选栏
│   │   ├── ConfirmModal.vue      # 确认弹窗
│   │   └── ToastBadge.vue        # 消息提示
│   ├── pipeline/
│   │   ├── KanbanBoard.vue       # 🆕 看板（列=阶段，卡片=候选人）
│   │   ├── KanbanColumn.vue      # 看板列
│   │   ├── CandidateCard.vue     # 🆕 候选人卡片（显示姓名/岗位/停留天数）
│   │   └── PipelineFunnel.vue    # 漏斗图（Chart.js）
│   ├── resume/
│   │   ├── ResumeUploader.vue    # 文件拖拽上传区
│   │   ├── ParseResultView.vue   # 解析结果预览
│   │   └── CandidateForm.vue     # 候选人信息录入表单
│   └── analytics/
│       ├── TrendChart.vue        # 趋势图
│       └── AchieveGauge.vue      # 达成率仪表盘
│
├── views/                        # 页面级组件
│   ├── LoginPage.vue             # 登录页
│   ├── DashboardPage.vue         # 工作台（统计卡片+漏斗+需求概览）
│   ├── PipelinePage.vue          # 🆕 招聘管道看板（默认视图）
│   ├── CandidateListPage.vue     # 简历库（列表模式）
│   ├── CandidateDetailPage.vue   # 候选人详情 + 状态时间线
│   ├── ResumeImportPage.vue      # 简历录入（上传+解析+确认）
│   ├── AnalyticsPage.vue         # 数据分析
│   ├── NeedsPage.vue             # 招聘需求管理
│   ├── BossImportPage.vue        # BOSS 数据导入
│   ├── EmailConfigPage.vue       # 🆕 邮箱配置（IMAP设置+扫描状态）
│   ├── AdminReviewPage.vue       # 🆕 管理员审核页（审批专员提交的变更）
│   ├── AIChatPage.vue            # AI 招聘助手
│   └── SettingsPage.vue          # 系统配置
│
├── utils/
│   ├── format.js                 # 日期/数字格式化
│   ├── validate.js               # 表单验证规则
│   ├── id-generator.js           # ID 生成器
│   └── migration.js              # V18 → V2 数据迁移工具
│
└── assets/
    └── styles/
        ├── variables.css         # CSS 变量（保留你现有配色体系）
        ├── base.css              # 基础样式
        └── components.css        # 组件通用样式

cloud-functions/                   # 🆕 CloudBase 云函数（Serverless 后端）
├── resume-parser-proxy/          # 🆕 简历解析代理（API Key 不出前端）
│   ├── index.js                  # 入口：接收前端文本 → 调 DeepSeek API → 返回结构化 JSON
│   ├── package.json              # 依赖：无（仅需 Node.js 内置 fetch）
│   └── config.json               # 云函数配置（超时30s，内存256MB，环境变量 DEEPSEEK_API_KEY）
├── email-scanner/
│   ├── index.js                  # 入口：定时触发 → 扫描所有启用的邮箱
│   ├── imap-client.js            # IMAP 连接 + 邮件搜索 + 附件下载
│   ├── deduplicator.js           # Message-ID hash 去重
│   ├── package.json              # 依赖：imapflow, @cloudbase/node-sdk
│   └── config.json               # 云函数配置（超时60s，内存256MB）
	├── parse-queue-processor/        # 🆕 解析队列消费（定时触发，消费 ParseQueue pending 条目）
	│   ├── index.js                  # 入口：定时触发 → 取 pending 条目 → 文本提取 → 调 resume-parser-proxy → 创建 Candidate → 通知专员
	│   ├── package.json              # 依赖：@cloudbase/node-sdk, pdfjs-dist, mammoth, word-extractor
	│   └── config.json               # 云函数配置（超时180s，内存512MB）
├── report-aggregator/            # 🆕 报表聚合层（防止大数据量卡浏览器）
│   ├── index.js                  # 入口：接收查询请求 → 聚合 Application 数据
│   ├── aggregators.js            # 聚合函数：按岗位/部门/趋势/总览四种维度
│   ├── cache.js                  # ReportCache 读写 + TTL 管理
│   ├── package.json              # 依赖：@cloudbase/node-sdk
│   └── config.json               # 云函数配置（超时30s，内存512MB）
└── report-cache-warmer/          # 🆕 缓存预热（每日凌晨触发）
    ├── index.js                  # 入口：定时触发 → 预热所有活跃岗位报表
    ├── package.json              # 依赖：@cloudbase/node-sdk
    └── config.json               # 云函数配置（超时120s，内存512MB）
├── db-backup/                    # 🆕 数据库自动备份（每日凌晨触发）
│   ├── index.js                  # 入口：定时触发 → 导出所有集合 → 存云存储
│   ├── package.json              # 依赖：@cloudbase/node-sdk
│   └── config.json               # 云函数配置（超时300s，内存512MB）
└── health-monitor/               # 🆕 健康监控（每30分钟触发）
    ├── index.js                  # 入口：定时触发 → 检查云函数可用性+API余额 → 异常告警
    ├── package.json              # 依赖：@cloudbase/node-sdk
    └── config.json               # 云函数配置（超时60s，内存256MB）
```

---

## 五、简历解析方案设计

### 5.1 方案架构

**无需服务器**，全部通过 API 调用完成：

```
浏览器端                                        云 API
────────                                        ──────

用户上传文件
    │
    ├─→ PDF 文件 → PDF.js 提取文本层（浏览器端，免费）
    │
    ├─→ Word 文件 → Mammoth.js 提取文本（浏览器端，免费）
    │
    ├─→ 图片文件 → 腾讯云 OCR API → 识别文字（云端，¥0.01/次）
    │      ↑
    │   解决你当前 Tesseract.js 中文识别率 70% 的问题
    │   腾讯云 OCR 中文识别率 95%+
    │
    ├─→ TXT 文件 → 直接读取
    │
    └─→ 文本汇总 ──→ resume-parser-proxy 云函数 ──→ DeepSeek API ──→ 结构化 JSON
                         ↑                              ↑
                   （浏览器端调用）           （服务端持有API Key，前端不可见）
                   提取 50+ 字段，¥0.01/份，国内模型，数据不出境
```

### 5.2 为什么这个方案可行

| 环节 | 你现在的 V18 | 新版 | 变化 |
|------|------------|------|------|
| PDF 文本提取 | PDF.js ✅ | PDF.js ✅ | 不变 |
| Word 文本提取 | Mammoth.js ✅ | Mammoth.js ✅ | 不变 |
| 图片 OCR | Tesseract.js 70% | **腾讯云 OCR 95%+** | +25% |
| 信息提取 | 正则匹配 50% | **DeepSeek LLM 85%+** | +35% |
| **综合准确率** | **50-65%** | **85%+** | **翻倍** |
| 服务器 | 无 | 无 | 不变 |

### 5.3 DeepSeek 解析 Prompt 设计（API Key 安全方案）

> ⚠️ **安全硬约束**：DeepSeek API Key **绝不能出现在前端代码中**。Vite 打包后 `dist/` 目录里所有 JS 明文可见，任何人打开浏览器 DevTools → Sources 就能拿到 Key。本节采用**云函数代理**方案：前端只传简历文本到云函数，云函数在服务端持有 Key 调用 DeepSeek API。

#### 5.3.1 前端侧（调云函数，不调 DeepSeek）

```javascript
// services/resume-parser.js — 前端侧（轻量，不持有 API Key）

import cloudbase from './cloudbase.js';

const SYSTEM_PROMPT = `你是一个专业的简历解析引擎。请从以下简历文本中提取结构化信息。

规则：
1. 只提取文本中明确提到的信息，不要推测或编造
2. 无法确定的信息字段返回 null
3. 多个教育/工作经历按时间倒序排列
4. 手机号格式化：11位数字
5. 日期格式：YYYY-MM（如2020-03），无法确定月份填 YYYY-01`;

// ✅ 通过云函数代理调用 DeepSeek，API Key 前端不可见
async function parseResumeWithDeepSeek(resumeText) {
  const result = await cloudbase.callFunction({
    name: 'resume-parser-proxy',
    data: {
      resumeText,
      systemPrompt: SYSTEM_PROMPT
    }
  });

  if (result.result.success) {
    return result.result.data;  // 已结构化的简历 JSON
  } else {
    throw new Error(result.result.error || '简历解析失败');
  }
}
```

#### 5.3.2 云函数侧（持有 API Key，调用 DeepSeek）

```javascript
// cloud-functions/resume-parser-proxy/index.js

// DeepSeek API Key 存放在云函数环境变量中（CloudBase 控制台 > 云函数 > 环境变量）
// 前端代码、git 仓库、打包产物中均不可见
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

exports.main = async (event, context) => {
  const { resumeText, systemPrompt } = event;

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        temperature: 0,           // 零温度，确保稳定输出
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: resumeText }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_resume',
            description: '提取简历结构化信息',
            parameters: {
              type: 'object',
              properties: {
                basic_info: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: '姓名' },
                    gender: { type: 'string', enum: ['男', '女', null] },
                    phone: { type: 'string', description: '11位手机号' },
                    email: { type: 'string' },
                    age: { type: 'integer' },
                    city: { type: 'string', description: '所在城市' },
                    years_of_experience: { type: 'integer' }
                  }
                },
                education: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      school: { type: 'string' },
                      major: { type: 'string' },
                      degree: { type: 'string', description: '大专/本科/硕士/博士/MBA' },
                      start_date: { type: 'string' },
                      end_date: { type: 'string' }
                    }
                  }
                },
                work_experience: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      company: { type: 'string' },
                      position: { type: 'string' },
                      start_date: { type: 'string' },
                      end_date: { type: 'string' },
                      description: { type: 'string' }
                    }
                  }
                },
                skills: { type: 'array', items: { type: 'string' } },
                certificates: { type: 'array', items: { type: 'string' } },
                expected_position: { type: 'string' },
                expected_salary: { type: 'string' },
                self_evaluation: { type: 'string' }
              }
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'extract_resume' } }
      })
    });

    const data = await response.json();
    const toolCall = data.choices[0].message.tool_calls[0];
    const parsed = JSON.parse(toolCall.function.arguments);

    return { success: true, data: parsed };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
```

#### 5.3.3 方案对比

| 维度 | ❌ 前端直接调 DeepSeek | ✅ 云函数代理 |
|------|------------------------|--------------|
| **API Key 安全性** | 打包进 `dist/`，任何人可见 | 仅在云函数环境变量中，前端不可见 |
| **Git 安全性** | 极易误提交到仓库 | 不在代码中，无泄露风险 |
| **调用路径** | 浏览器 → DeepSeek | 浏览器 → 云函数 → DeepSeek |
| **延迟** | ~2-3秒 | ~2.5-3.5秒（多一次云函数调用，约 100-300ms） |
| **费用** | ¥0.015/份 | ¥0.015 + 云函数调用（免费额度内） |
| **Key 轮换** | 需重新打包部署前端 | 控制台改环境变量即可，零部署 |

### 5.4 解析流程（完整时序）

```
用户点击上传 PDF
    │
    ├─→ ① PDF.js 提取文本（浏览器端，~0.5秒）
    │      └─→ 失败？提示"无法读取文件"
    │
    ├─→ ② 检测是否含图片（如扫描件PDF无文本层）
    │      是 → 腾讯云 OCR API（~1-2秒）
    │      否 → 直接使用提取的文本
    │
    ├─→ ③ DeepSeek API 结构化提取（~2-3秒）
    │      └─→ Tool Use 模式返回验证过的 JSON
    │
    └─→ ④ 展示解析结果，用户确认/修正后入库
           总耗时约 3-5 秒
```

### 5.5 成本估算

| 项目 | 单价 | 每份简历用量 | 每份成本 |
|------|------|-------------|---------|
| 腾讯云 OCR | ¥0.01/次 | 仅图片简历需要 | ¥0-0.01 |
| DeepSeek v4-flash 输入 | ¥1/百万tokens | ~2000 tokens | ¥0.002 |
| DeepSeek v4-flash 输出 | ¥2/百万tokens | ~500 tokens | ¥0.001 |
| **合计** | | | **约 ¥0.015/份** |

> 每月解析 500 份简历 ≈ **¥7.5**，比 68 元服务器方案省 90%。

### 5.6 解析修正反馈机制 🆕

#### 5.6.1 业务场景

专员在 `ParseResultView.vue` 确认/修正解析结果后，如果某个错误反复出现（如某大学名字总被识错、某行业术语总被误判），这些修正数据可以作为 few-shot examples 加入 system prompt，持续提升解析准确率，无需 fine-tuning。

#### 5.6.2 修正数据收集

```javascript
// 在 ParseResultView.vue 用户确认时记录修正
// 存入 Candidate.parsedData + 修正历史

// Candidate 新增字段
Candidate {
  // ... 现有字段 ...
  parseCorrections: [{
    field: 'name' | 'phone' | 'school' | ...,
    originalValue: string,    // DeepSeek 原始解析值
    correctedValue: string,   // 专员修正后的值
    correctedBy: userId,
    correctedAt: timestamp
  }]
}
```

#### 5.6.3 反馈注入策略

```
当某类修正累计达到阈值（如同一字段被修正 ≥10 次），自动触发优化：
          │
          ▼
┌──────────────────────────────────────────────┐
│ ① 系统筛选高频修正字段                        │
│    如 "school" 字段被修正了 15 次              │
│                                              │
│ ② 取最近 5 条修正案例作为 few-shot examples    │
│    格式：                                     │
│    "原始解析: XXX  →  正确应为: YYY"           │
│                                              │
│ ③ 追加到 system prompt 末尾                   │
│    "## 常见修正案例（请参考以下模式）：        │
│     • '新励城' 应识别为 '新励成'（公司名）      │
│     • '新东方教育' 应保留完整，不要截断为'新东方'│
│    "                                         │
│                                              │
│ ④ 管理员在设置页可查看和管理修正案例库           │
│    [查看案例] [手动添加] [删除] [重置]          │
└──────────────────────────────────────────────┘
```

#### 5.6.4 云函数侧实现

```javascript
// cloud-functions/resume-parser-proxy/index.js — 动态追加修正案例

const CORRECTION_DB = db.collection('ParseCorrectionBank');

async function buildSystemPrompt(basePrompt) {
  // 查询高频修正案例（被修正 ≥10 次，取最近 5 条案例）
  const stats = await CORRECTION_DB
    .where({ correctionCount: db.command.gte(10) })
    .orderBy('correctionCount', 'desc')
    .limit(5)
    .get();
  
  if (stats.data.length === 0) return basePrompt;
  
  // 构建 few-shot 示例
  const examples = stats.data.map(c =>
    `• "${c.originalValue}" 应识别为 "${c.correctedValue}"（${c.field}字段）`
  ).join('\n');
  
  return `${basePrompt}\n\n## 常见修正案例（请参考以下模式纠正类似错误，仅当你确认文本中出现了类似模式时应用）：\n${examples}`;
}

// 管理端接口：聚合修正数据
async function aggregateCorrections(db) {
  // 按 field + originalValue + correctedValue 聚合，统计修正次数
  const corrections = await db.collection('Candidate')
    .where({ 'parseCorrections': db.command.exists(true) })
    .get();
  
  const stats = {};
  for (const c of corrections.data) {
    for (const corr of c.parseCorrections || []) {
      const key = `${corr.field}::${corr.originalValue}::${corr.correctedValue}`;
      stats[key] = (stats[key] || 0) + 1;
    }
  }
  
  // 同步到 ParseCorrectionBank（供 resume-parser-proxy 查询）
  for (const [key, count] of Object.entries(stats)) {
    const [field, originalValue, correctedValue] = key.split('::');
    await CORRECTION_DB.where({ field, originalValue, correctedValue }).remove();
    await CORRECTION_DB.add({ field, originalValue, correctedValue, correctionCount: count, updatedAt: new Date() });
  }
}
```

#### 5.6.5 关键设计决策

| 决策 | 说明 |
|------|------|
| **不 fine-tuning** | 通过动态 prompt 注入实现，零模型训练成本，修正案例即时生效 |
| **阈值触发（≥10次）** | 防止单个专员的个人偏好影响全局解析；只有高频修正才纳入 |
| **管理员可管理** | 案例库可查看/手动添加/删除/重置，管理员控制最终注入内容 |
| **不自动修改解析结果** | few-shot 只是提示参考，DeepSeek 自行判断是否应用 |

---

## 六、邮箱自动归集方案设计 🆕

### 6.1 业务场景

BOSS 直聘绑定邮箱后，候选人投递的简历会以**邮件附件形式**发送到专员邮箱：
- 发件人：`*@zhipin.com` 或 `*@kanzhun.com`
- 标题：包含候选人姓名 + 投递岗位
- 附件：PDF/Word 简历文件

> 现状：专员手动下载邮件附件 → 打开系统 → 上传 → 解析。完全是重复劳动。

### 6.2 方案架构

```
阶段 A：邮件收取（email-scanner 云函数，每 10 分钟触发）
│
├─→ ① 读取 EmailConfig 表，获取所有启用的邮箱配置
│      └─→ 包含：IMAP 服务器 / 账号 / 加密密码 / 过滤规则
│
├─→ ② IMAP 连接各邮箱 (imapflow 库)
│      └─→ 拉取未读邮件 → 代码过滤发件人域名（RFC 3501 限制）
│
├─→ ③ 下载附件 → 计算 MD5 hash → 去重检查
│      └─→ 重复？跳过。新文件？上传到 CloudBase 云存储
│
├─→ ④ 写入 ParseQueue 集合（status: "pending"）
│
├─→ ⑤ 标记邮件为已读
│
└─→ ⑥ 更新 EmailConfig.lastSuccessfulScanAt

        ║  ParseQueue  ║
        ║  (解耦缓冲)   ║
        ╚══════════════╝
              │
              ▼
阶段 B：解析消费（parse-queue-processor 云函数，每 5 分钟触发）
│
├─→ ① 查询 ParseQueue 中 status: "pending" 的条目（按 createdAt ASC，每次最多 20 条）
│
├─→ ② 逐条处理：
│      ├─ 从云存储下载文件 → format-router.js 识别格式并提取文本（15 种格式）
│      ├─ 调 resume-parser-proxy 云函数（内部调 DeepSeek API）→ 结构化 JSON
│      ├─ 创建/更新 Candidate + Application 记录
│      ├─ 更新 ParseQueue status: "done" + parsedCandidateId
│      └─ 创建 ParseNotification（通知专员）
│
├─→ ③ 失败处理：
│      ├─ 可重试（OCR 超时/DeepSeek 超时）→ retryCount++，retryCount < 3 保持 pending
│      └─ 不可重试（格式不支持/文件损坏）→ status: "failed" + failReason + 通知专员
│
└─→ ④ 记录 ErrorLog（如连续零产出超过 1 小时）
```

### 6.3 为什么是 IMAP 而不是 POP3？

| 协议 | 优点 | 缺点 |
|------|------|------|
| **IMAP**（✅ 选用） | 服务器端保留邮件；标记已读/未读；支持多设备同步 | 需保持连接 |
| POP3 | 简单，一次性下载 | 下载后删除或本地留存，无法同步状态 |

IMAP 的 `\Seen` 标记机制天然适合"已处理/未处理"状态管理。

> ⚠️ **IMAP SEARCH 限制**：RFC 3501 规定的 IMAP SEARCH 命令不支持 FROM 字段的通配符匹配（如 `FROM "*@zhipin.com"`）。`*@domain.com` 语法在大多数 IMAP 服务器（QQ邮箱 Dovecot、Dovecot、Cyrus）上会返回空结果或语法错误。本方案改为拉取近期未读邮件后在云函数代码中使用 JavaScript 字符串匹配过滤发件人。虽然每次多拉几封非招聘邮件，但结果可靠。

### 6.4 云函数设计

```javascript
// cloud-functions/email-scanner/index.js

const Imapflow = require('imapflow');
const cloudbase = require('@cloudbase/node-sdk');

// BOSS直聘/招聘平台的发件人域名特征（在代码中过滤，不依赖 IMAP SEARCH）
const RECRUITMENT_FROM_DOMAINS = [
  '@zhipin.com',      // BOSS直聘
  '@kanzhun.com',     // BOSS直聘（看准）
  '@zhaopin.com.cn',  // 智联招聘
  '@liepin.com',      // 猎聘
];

exports.main = async (event, context) => {
  // 1. 获取所有启用的邮箱配置
  const db = cloudbase.database();
  const configs = await db.collection('EmailConfig')
    .where({ enabled: true }).get();
  
  const results = [];
  for (const config of configs.data) {
    // ⚠️ S6：多邮箱间添加 5-10 秒间隔，防止 QQ邮箱 对同一 IP 集中连接触发临时封禁
    // 8 个专员全部启用 ≈ 40-80 秒完成全量扫描，仍在云函数 60s 超时内（如超时可错开触发器 2-3 分钟）
    if (results.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 5000)); // 5-10 秒随机间隔
    }
    
    // 2. 连接 IMAP
    const client = new Imapflow({
      host: config.imapHost,
      port: config.imapPort,
      secure: true,
      auth: {
        user: config.imapUser,
        pass: decrypt(config.imapPassword) // AES-256-GCM + PBKDF2 解密（crypto.js）
      }
    });
    await client.connect();
    
    // 3. 拉取近期未读邮件（IMAP SEARCH 不支持 FROM 通配符，改为拉取后在代码中过滤）
    //    RFC 3501 规定 SEARCH 的 FROM 参数不支持 * 通配符匹配
    const messages = await client.fetch('INBOX', {
      unseen: true,
      // ✅ 只用 IMAP 原生支持的过滤条件：未读 + 有附件
      // ❌ 不再使用 source.from 通配符（此语法在大多数 IMAP 服务器上不生效）
    });
    
    let processedCount = 0;
    for (const msg of messages) {
      // 3a. 代码中过滤发件人（比 IMAP SEARCH 通配符可靠）
      const fromAddress = msg.envelope.from?.[0]?.address || '';
      const isRecruitmentMail = RECRUITMENT_FROM_DOMAINS.some(
        domain => fromAddress.toLowerCase().endsWith(domain)
      );
      
      // 非招聘平台邮件 → 跳过，不标记已读（用户可能在邮箱里还需要看）
      if (!isRecruitmentMail) continue;
      
      // 无附件 → 跳过
      if (!msg.attachments || msg.attachments.length === 0) continue;
      
      // 4. Message-ID 去重
      const exists = await db.collection('ParseQueue')
        .where({ sourceEmailId: msg.messageId }).count();
      if (exists.total > 0) continue;
      
      // 5. 下载附件 → 上传云存储
      for (const att of msg.attachments) {
        const buffer = await client.download(att);
        const hash = md5(buffer);
        const upload = await cloudbase.uploadFile({
          cloudPath: `resumes/${hash}_${att.filename}`,
          fileContent: buffer
        });
        
        // 6. 写入解析队列（仅写入，不在此解析——由 parse-queue-processor 云函数消费）
        await db.collection('ParseQueue').add({
          fileId: upload.fileID,
          fileName: att.filename,
          fileHash: hash,
          source: 'email',
          sourceEmailId: msg.messageId,
          status: 'pending',
          retryCount: 0,
          createdAt: new Date()
        });
      }
      // 7. 标记已读（仅对已处理的招聘邮件）
      await client.messageFlagsAdd(msg.seq, ['\\Seen']);
      processedCount++;
    }
    await client.logout();
    results.push({ email: config.email, processed: processedCount, totalUnread: messages.length });
  }
  
  // 8. 自检：如果启用了邮箱但长时间零产出，记录告警
  for (const config of configs.data) {
    const lastSuccessAt = config.lastSuccessfulScanAt;
    const hoursSinceLastSuccess = lastSuccessAt
      ? (Date.now() - new Date(lastSuccessAt).getTime()) / 3600000
      : null;
    
    if (hoursSinceLastSuccess !== null && hoursSinceLastSuccess > 24) {
      await db.collection('ErrorLog').add({
        type: 'heartbeat',
        source: 'email-scanner',
        message: `邮箱 ${config.email} 超过 ${Math.round(hoursSinceLastSuccess)} 小时未成功扫描到简历，请检查 IMAP 连接或授权码`,
        severity: 'warning',
        createdAt: new Date()
      });
    }
  }
  
  return { success: true, results };
};
```

### 6.4.1 连接失败的重试策略 🆕

> ⚠️ 8 个专员各自配置邮箱后，email-scanner 每 10 分钟连接 8 个 IMAP 服务器。QQ邮箱对同一 IP 的频繁连接可能触发临时封禁，授权码在用户修改 QQ 密码后会立即失效。如果简单每 10 分钟重试，会加剧封禁风险且消耗云函数配额。

**指数退避策略**：

```javascript
// cloud-functions/email-scanner/index.js — 连接失败时的退避逻辑

async function scanMailbox(config, db) {
  try {
    // ... 正常 IMAP 连接 + 扫描逻辑（见 §6.4） ...
    
    // ✅ 扫描成功 → 重置失败计数
    await db.collection('EmailConfig').doc(config._id).update({
      lastScanAt: new Date(),
      lastSuccessfulScanAt: new Date(),
      failureCount: 0,
      nextRetryAt: null,
      lastError: null
    });
    
  } catch (error) {
    // ❌ 扫描失败 → 指数退避
    const newFailureCount = (config.failureCount || 0) + 1;
    
    // 退避间隔：1次失败→10分钟, 2次→30分钟, 3次→1小时, 4次+→4小时
    const backoffMinutes = [10, 30, 60, 240][Math.min(newFailureCount - 1, 3)];
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60000);
    
    await db.collection('EmailConfig').doc(config._id).update({
      lastScanAt: new Date(),
      lastError: error.message,
      failureCount: newFailureCount,
      nextRetryAt
    });
    
    // 连续失败 ≥3 次 → 写入 ErrorLog 告警
    if (newFailureCount >= 3) {
      await db.collection('ErrorLog').add({
        type: 'cloudFunction',
        source: 'email-scanner',
        message: `邮箱 ${config.email} 连续 ${newFailureCount} 次扫描失败: ${error.message}`,
        severity: newFailureCount >= 5 ? 'critical' : 'warning',
        createdAt: new Date()
      });
    }
    
    // 云函数主循环中跳过 nextRetryAt 未到的邮箱
    // if (config.nextRetryAt && new Date() < new Date(config.nextRetryAt)) continue;
  }
}
```

**退避时间线示例**：

```
第1次失败 10:00 → 下次重试 10:10
第2次失败 10:10 → 下次重试 10:40（30分钟）
第3次失败 10:40 → 下次重试 11:40（1小时）→ 🟡 Dashboard 告警
第4次失败 11:40 → 下次重试 15:40（4小时）
第5次失败 15:40 → 下次重试 19:40（4小时）→ 🔴 管理员收到 critical 告警
某次成功     → failureCount 归零，恢复正常 10 分钟间隔
```

> **EmailConfig 新增字段**：`failureCount`（连续失败次数）、`nextRetryAt`（下次重试时间）、`lastError`（最近错误信息）。这三个字段配合 §6.4 已有的 `lastSuccessfulScanAt`，组成完整的连接健康状态。

### 6.5 去重机制

| 去重层级 | 字段 | 说明 |
|----------|------|------|
| **邮件级** | `sourceEmailId` (Message-ID) | 同一封邮件不处理两次 |
| **文件级** | `fileHash` (MD5) | 同一份简历不改名重复投递 |
| **候选人级** | Candidate.phone + Candidate.email | 解析后由应用层合并重复候选人 |

### 6.6 安全性

#### 6.6.1 密码加密方案（升级版）

> ⚠️ **上版缺陷**：AES 密钥直接明文存在云函数环境变量中，任何有 CloudBase 控制台访问权限的人都能看到密钥。本次升级为**派生密钥 + 双变量**方案。

```
加密流程：
  专员输入 IMAP 密码
      │
      ▼
  ┌─────────────────────────────────────────────┐
  │ ① 生成随机 IV（16 字节）                      │
  │                                              │
  │ ② 派生加密密钥（PBKDF2）：                    │
  │    MASTER_SECRET (env var, 64-char hex)       │
  │    + SALT (env var, 32-char hex)             │
  │    → PBKDF2(100,000 iterations, SHA-256)     │
  │    → 256-bit AES key                         │
  │                                              │
  │ ③ AES-256-GCM 加密                           │
  │    ciphertext = AES-GCM(plaintext, key, iv)  │
  │                                              │
  │ ④ 存储格式：iv + ciphertext + tag（Base64）   │
  │    写入 EmailConfig.imapPassword              │
  └─────────────────────────────────────────────┘
```

> **为什么这样更安全**：即使攻击者看到了环境变量的值，没有 PBKDF2 的迭代参数和盐值分离策略，无法直接用于解密。两个环境变量（`MASTER_SECRET` 和 `SALT`）分别存放，单一泄露不导致密钥泄露。

```javascript
// cloud-functions/email-scanner/crypto.js — 加解密工具

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32;  // 256 bits

function deriveKey() {
  const masterSecret = process.env.IMAP_MASTER_SECRET;  // 64-char hex
  const salt = process.env.IMAP_KEY_SALT;                // 32-char hex
  
  return crypto.pbkdf2Sync(
    Buffer.from(masterSecret, 'hex'),
    Buffer.from(salt, 'hex'),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );
}

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  
  // 存储格式：iv:tag:ciphertext (全部 Base64)
  return Buffer.concat([iv, tag, Buffer.from(encrypted, 'base64')]).toString('base64');
}

function decrypt(stored) {
  const key = deriveKey();
  const buf = Buffer.from(stored, 'base64');
  
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const ciphertext = buf.subarray(32);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
```

#### 6.6.2 密钥轮换流程

```
需要轮换密钥时：
  ① 在 CloudBase 控制台生成新的 MASTER_SECRET 和 SALT
  ② 更新云函数环境变量
  ③ 运行 key-rotation 脚本：
     对每个 EmailConfig，用旧密钥解密 → 用新密钥重新加密 → 写回
  ④ 验证：取一个配置，用新密钥解密确认可读
  ⑤ 删除旧环境变量
```

#### 6.6.3 安全措施总览

| 措施 | 实现 |
|------|------|
| **密码加密** | AES-256-GCM + PBKDF2 派生密钥（100,000 迭代），双环境变量隔离 |
| **密钥轮换** | 支持在线轮换，旧密钥解密→新密钥加密，零停机 |
| **传输加密** | IMAP over SSL/TLS（993端口） |
| **控制台访问控制** | 仅管理员拥有 CloudBase 控制台登录权限；开启 MFA |
| **权限隔离** | 每个专员只能配置自己的邮箱，Admin 可管理所有 |
| **日志审计** | 每次扫描记录到 AuditLog；密钥轮换操作单独记录 |

### 6.7 费用估算

| 项目 | 用量 | 费用 |
|------|------|------|
| CloudBase 云函数调用 | ~4,320 次/月 (每10分钟) | ¥0（免费额度 100 万次） |
| 云函数执行时间 | ~23,040 GB-秒/月 | ¥0（免费额度 40 万 GB-秒） |
| 外网流量 | ~216 MB/月 | ¥0（免费额度 1 GB） |
| CloudBase 云存储 | 简历文件存储 | ¥0（免费额度 5 GB） |
| **合计** | | **¥0/月** |

> 即使专员数量增长到 10 人、简历量翻 10 倍，仍远在免费额度内。

### 6.8 用户配置界面

管理员/专员在系统 **设置页 → 邮箱配置** 中：
- 选择邮箱类型（QQ邮箱 / 腾讯企业邮箱 / 其他）
- 输入邮箱账号 + 授权码（非登录密码，QQ邮箱需开启 IMAP 并获取授权码）
- 设置过滤规则（发件人白名单、主题关键词）
- 开关启用/停用
- 查看上次扫描时间 + 已归集简历数 + **最近错误信息**
- 🆕 **"测试连接"按钮**：配置完成后即时验证 IMAP 连接是否正常，无需等待 10 分钟后的云函数扫描

#### 6.8.1 测试连接功能 🆕

专员输入邮箱配置后，点击"测试连接"按钮，触发云函数做一次即时连接测试：

```javascript
// cloud-functions/email-scanner/test-connection.js
// 或作为 email-scanner 云函数的一个 action

exports.main = async (event, context) => {
  const { action, config } = event;
  
  if (action === 'test_connection') {
    try {
      const client = new Imapflow({
        host: config.imapHost,
        port: config.imapPort,
        secure: true,
        auth: { user: config.imapUser, pass: config.imapPassword }
      });
      
      await client.connect();
      
      // 检查 INBOX 是否存在 + 搜索最近 1 封邮件确认可读
      const recent = await client.fetch('INBOX', { limit: 1 });
      
      await client.logout();
      
      return {
        success: true,
        message: '连接成功！',
        details: {
          inboxExists: true,
          recentMailCount: recent.length,
          serverInfo: client.serverInfo
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `连接失败：${error.message}`,
        suggestions: getSuggestions(error)  // 常见错误给出修复建议
      };
    }
  }
};

function getSuggestions(error) {
  const msg = error.message.toLowerCase();
  if (msg.includes('auth')) return '请检查授权码是否正确（不是 QQ 登录密码）。QQ邮箱需在 设置→账户→POP3/IMAP 中开启 IMAP 并获取授权码。';
  if (msg.includes('timeout')) return '连接超时，请检查 IMAP 服务器地址和端口是否正确。QQ邮箱 IMAP 地址：imap.qq.com，端口：993。';
  if (msg.includes('certificate')) return 'SSL 证书错误，请确认端口是否为 993（SSL）。';
  return '请检查网络连接和邮箱配置参数。';
}
```

**前端交互**：

```
┌──────────────────────────────────────────────────────┐
│  邮箱配置                                             │
│                                                      │
│  邮箱类型：[QQ邮箱 ▼]                                  │
│  邮箱账号：hr@qq.com                                  │
│  授权码：  [••••••••••••••••]                         │
│                                                      │
│  [测试连接]                                           │
│                                                      │
│  ┌─ 测试结果 ──────────────────────────────────────┐ │
│  │ ✅ 连接成功！                                    │ │
│  │ 📧 收件箱可正常访问                              │ │
│  │ 📬 最近邮件：12 封未读                           │ │
│  │ 🕐 测试时间：2026-06-15 16:30                    │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  [保存配置]  [取消]                                   │
└──────────────────────────────────────────────────────┘
```

**常见错误和建议**：

| 错误 | 可能原因 | 建议 |
|------|----------|------|
| Authentication failed | 授权码错误或未开启 IMAP | QQ邮箱→设置→账户→POP3/IMAP→开启→获取授权码 |
| Connection timeout | 服务器地址或端口错误 | QQ邮箱: imap.qq.com:993；腾讯企业邮箱: imap.exmail.qq.com:993 |
| Certificate error | 未使用 SSL 连接 | 确保端口为 993（SSL），非 143（非加密） |
| Too many connections | 连接过于频繁 | 等待几分钟后重试 |

> **设计原则**：测试连接使用专员刚输入的配置值（不保存），只验证连接能力。测试成功后专员仍需点击"保存配置"才能持久化。

### 6.9 邮件附件支持的文件格式 🆕

#### 6.9.1 全格式覆盖

> 招聘邮件中的简历附件格式多种多样——PDF、Word、图片只是最常见的三种。BOSS 直聘、智联招聘、猎聘等不同平台导出的格式各不相同，还可能出现 RTF、HTML、纯文本、压缩包等格式。邮件扫描器必须逐一识别并选择正确的解析策略。

| 格式 | 扩展名 | 识别方式 | 解析策略 | 备注 |
|------|--------|----------|----------|------|
| **PDF** | `.pdf` | MIME `application/pdf` | PDF.js 提取文本层 | 最通用，优先级最高 |
| **Word (新版)** | `.docx` | MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Mammoth.js 提取文本 | 主流格式 |
| **Word (旧版)** | `.doc` | MIME `application/msword` | `word-extractor` npm 包提取（纯 JS，云函数兼容）⚠️ **不可用 antiword**：CloudBase SCF 是 Node.js 沙箱，不预装也不允许安装系统级二进制 | 老系统导出，需服务端处理 |
| **图片 — PNG** | `.png` | MIME `image/png` | 腾讯云 OCR API | 截图/拍照简历 |
| **图片 — JPG/JPEG** | `.jpg` `.jpeg` | MIME `image/jpeg` | 腾讯云 OCR API | 最常见图片格式 |
| **图片 — BMP** | `.bmp` | MIME `image/bmp` | 腾讯云 OCR API | 较少见，但 OCR 支持 |
| **图片 — TIFF** | `.tiff` `.tif` | MIME `image/tiff` | 腾讯云 OCR API | 扫描仪常用格式 |
| **图片 — WebP** | `.webp` | MIME `image/webp` | → 转 PNG → OCR | 部分邮件客户端使用 |
| **纯文本** | `.txt` | MIME `text/plain` | 直接读取 UTF-8/GBK | 最简单，自动检测编码 |
| **RTF** | `.rtf` | MIME `application/rtf` / `text/rtf` | `rtf-parser` npm 包提取文本 | 部分 HR 系统导出格式 |
| **HTML** | `.html` `.htm` | MIME `text/html` | 去除标签 → 保留文本 | 邮件正文直接作为简历内容 |
| **压缩包 — ZIP** | `.zip` | MIME `application/zip` | 解压 → 逐个处理内部文件 | 批量简历打包投递 |
| **压缩包 — RAR** | `.rar` | MIME `application/x-rar-compressed` | `unrar` 解压 → 逐个处理 | 较少见 |
| **Apple Pages** | `.pages` | MIME `application/x-iwork-pages-sffpages` | → 解压 ZIP 结构 → 提取 preview.pdf | Mac 用户可能使用 |

#### 6.9.2 格式识别与分发逻辑

```javascript
// cloud-functions/email-scanner/format-router.js — 格式识别 + 解析策略分发

const FORMAT_HANDLERS = {
  'application/pdf':                          { strategy: 'pdfjs',      label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 
                                              { strategy: 'mammoth',    label: 'DOCX' },
  'application/msword':                       { strategy: 'word-extractor', label: 'DOC' },  // ⚠️ 纯JS方案，非antiword CLI
  'image/png':                                { strategy: 'ocr',        label: 'PNG' },
  'image/jpeg':                               { strategy: 'ocr',        label: 'JPG' },
  'image/bmp':                                { strategy: 'ocr',        label: 'BMP' },
  'image/tiff':                               { strategy: 'ocr',        label: 'TIFF' },
  'image/webp':                               { strategy: 'convert-ocr', label: 'WebP' },
  'text/plain':                               { strategy: 'plaintext',  label: 'TXT' },
  'application/rtf':                          { strategy: 'rtf',        label: 'RTF' },
  'text/rtf':                                 { strategy: 'rtf',        label: 'RTF' },
  'text/html':                                { strategy: 'html',       label: 'HTML' },
  'application/zip':                          { strategy: 'archive',    label: 'ZIP' },
  'application/x-rar-compressed':             { strategy: 'archive',    label: 'RAR' },
  'application/x-iwork-pages-sffpages':       { strategy: 'pages',      label: 'Pages' },
};

function detectFormat(filename, mimeType) {
  // ① 先按 MIME 类型匹配
  if (FORMAT_HANDLERS[mimeType]) {
    return FORMAT_HANDLERS[mimeType];
  }
  
  // ② MIME 未识别 → 按扩展名推断
  const ext = filename.split('.').pop().toLowerCase();
  const extMap = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'bmp': 'image/bmp', 'tiff': 'image/tiff', 'tif': 'image/tiff',
    'webp': 'image/webp', 'txt': 'text/plain',
    'rtf': 'application/rtf', 'html': 'text/html', 'htm': 'text/html',
    'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
    'pages': 'application/x-iwork-pages-sffpages',
  };
  
  const mappedMime = extMap[ext];
  if (mappedMime && FORMAT_HANDLERS[mappedMime]) {
    return FORMAT_HANDLERS[mappedMime];
  }
  
  // ③ 完全未识别 → 标记为未知，人工处理
  return { strategy: 'unknown', label: 'UNKNOWN' };
}

async function extractText(buffer, filename, mimeType) {
  const format = detectFormat(filename, mimeType);
  
  switch (format.strategy) {
    case 'pdfjs':
      return await extractPdfText(buffer);        // PDF.js 提取
    
    case 'mammoth':
      return await extractDocxText(buffer);        // Mammoth.js 提取
    
    case 'word-extractor':
      return await extractDocText(buffer);         // word-extractor npm 包（纯JS，SCF沙箱兼容）
    
    case 'ocr':
      return await callTencentOCR(buffer);         // 腾讯云 OCR
    
    case 'convert-ocr':
      // WebP → sharp 转 PNG → OCR
      const png = await convertToPng(buffer);      // sharp 库转换
      return await callTencentOCR(png);
    
    case 'plaintext':
      return await readPlainText(buffer);          // 自动检测 UTF-8/GBK/GB2312
    
    case 'rtf':
      return await extractRtfText(buffer);         // rtf-parser npm 包
    
    case 'html':
      return stripHtmlTags(buffer.toString('utf-8')); // 去标签留文本
    
    case 'archive':
      return await extractArchive(buffer);         // 解压 → 逐个处理内部文件
    
    case 'pages':
      return await extractPagesText(buffer);       // 解压 ZIP → 提取 preview.pdf
    
    default:
      throw new Error(`不支持的文件格式: ${format.label}`);
  }
}
```

#### 6.9.3 压缩包递归处理

```javascript
// ZIP/RAR 压缩包可能内含多份简历，需递归处理

async function extractArchive(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  
  const results = [];
  for (const [filename, file] of Object.entries(zip.files)) {
    if (file.dir) continue;  // 跳过目录
    
    // 跳过系统文件
    if (filename.startsWith('__MACOSX') || filename.startsWith('.')) continue;
    
    const fileBuffer = await file.async('nodebuffer');
    const mimeType = guessMimeType(filename);
    
    // 递归：压缩包内的压缩包
    if (mimeType === 'application/zip') {
      const nested = await extractArchive(fileBuffer);
      results.push(...nested);
      continue;
    }
    
    const text = await extractText(fileBuffer, filename, mimeType);
    results.push({ filename, mimeType, text });
  }
  
  return results;  // 合并所有文件的文本 → 统一送入 DeepSeek 解析
}
```

#### 6.9.4 格式不支持时的处理

```javascript
// 无法识别的格式 → 记录到 ParseQueue，标记 failed + 原因
// 通知专员手动上传

if (format.strategy === 'unknown') {
  await db.collection('ParseQueue').add({
    fileId: upload.fileID,
    fileName: filename,
    source: 'email',
    status: 'failed',
    failReason: `不支持的文件格式: ${mimeType}（文件名: ${filename}）`,
    createdAt: new Date()
  });
  
  // 通知专员（见 6.10 节）
  await notifyRecruiter(config.userId, {
    type: 'parse_failed',
    fileName: filename,
    reason: '文件格式不支持，请手动上传'
  });
}
```

### 6.10 简历解析结果通知专员 🆕

#### 6.10.1 业务场景

邮件自动归集是**后台静默运行**的——专员配好邮箱后就不用管了。但问题在于：
- 简历解析成功了，专员不知道系统里多了新候选人
- 简历解析失败了（格式不支持/OCR 识别差/DeepSeek 超时），专员不知道需要手动介入
- 一段时间没收新简历，专员不知道是没投递还是扫描停了

> **需要一个轻量的通知机制**，让专员知道系统在做什么、有什么结果、什么需要人工处理。

#### 6.10.2 通知数据模型

```javascript
// 新增集合：ParseNotification
ParseNotification {
  id,
  userId:         string,        // 通知给哪个专员（EmailConfig.userId）
  type:           'parse_success' | 'parse_failed' | 'scan_summary',
  parseQueueId:   string | null,  // 关联的 ParseQueue 记录
  candidateId:    string | null,  // 解析成功时关联的 Candidate ID
  candidateName:  string | null,  // 解析出的姓名
  
  title:          string,         // "新简历解析成功：张三 — CC岗"
  detail:         string,         // "来自 BOSS直聘邮件，已自动创建候选人档案"
  status:         'unread' | 'read',
  
  createdAt:      timestamp
}
```

#### 6.10.3 通知触发时机

```
邮件扫描流程（每10分钟）：
  
  IMAP 收取邮件 → 下载附件 → 上传云存储 → 写入 ParseQueue
                                              │
                                              ▼
                                    ┌─────────────────────┐
                                    │  简历解析管线          │
                                    │                     │
                                    │  ① OCR/文本提取      │
                                    │  ② DeepSeek 结构化   │
                                    │  ③ 创建 Candidate    │
                                    │                     │
                                    │  ✅ 成功 →            │
                                    │  创建 ParseNotification│
                                    │  type: parse_success  │
                                    │  含候选人姓名+岗位     │
                                    │                     │
                                    │  ❌ 失败 →            │
                                    │  创建 ParseNotification│
                                    │  type: parse_failed   │
                                    │  含失败原因+建议操作   │
                                    └─────────────────────┘
                                              │
                            ┌─────────────────┴─────────────┐
                            ▼                               ▼
                    每 30 分钟汇总                   每日 9:00 汇总
                    （增量通知）                     （日报摘要）
                    仅通知本轮新解析                  今日解析 X 份
                    的结果                            成功 Y / 失败 Z
```

#### 6.10.4 前端通知展示

**Dashboard "解析通知"卡片**（专员视角）：

```
┌──────────────────────────────────────────────┐
│  简历解析通知                        [全部已读] │
│                                              │
│  ✅ 新简历：张三 — CC岗                        │
│     来自 BOSS直聘邮件 · 2分钟前                │
│     [查看候选人]                               │
│                                              │
│  ✅ 新简历：李四 — CR岗                        │
│     来自 BOSS直聘邮件 · 15分钟前               │
│     [查看候选人]                               │
│                                              │
│  ❌ 解析失败：resume_20260615.pdf              │
│     文件格式不支持 · 1小时前                    │
│     [手动上传]                                 │
│                                              │
│  ────── 今晨 9:00 日报 ──────                 │
│  📊 昨日解析：12 份 / 成功 10 / 失败 2         │
└──────────────────────────────────────────────┘
```

**通知徽章**：侧边栏或顶栏显示未读通知数量红点。

#### 6.10.5 通知清理策略

| 条件 | 操作 |
|------|------|
| 专员点击"查看候选人" | 该条通知标记为 `read` |
| 专员点击"全部已读" | 所有通知标记为 `read` |
| 通知超过 30 天 | 定时任务自动清理（云函数 `cleanup-old-notifications`） |
| 日报摘要 | 永不自动清理，保留最近 90 天 |

#### 6.10.6 关键设计决策

| 决策 | 说明 |
|------|------|
| **通知不弹窗** | 不打断工作。红点徽章 + Dashboard 卡片展示 |
| **日报摘要** | 每天 9:00 自动生成昨日汇总，专员一眼看到工作量 |
| **失败通知立即展示** | 解析失败需要专员介入，优先展示 |
| **30 天自动清理** | 控制通知集合大小，避免无限膨胀 |

---

## §6.11 解析队列处理器（parse-queue-processor）🆕 阻塞修复

> **修复背景**（专家审查第4回）：email-scanner 云函数只负责收取邮件并写入 ParseQueue，但没有任何云函数负责消费 ParseQueue 中的待处理条目。resume-parser-proxy 只能被前端手动调用，format-router.js 定义了 15 种格式提取能力但在 email-scanner 主流程中从未被调用。
>
> **后果**：邮件自动归集后，简历附件永远停留在 ParseQueue（status: "pending"），不会进入文本提取 → DeepSeek 解析 → 创建 Candidate 的后续流程。核心功能不可用。
>
> **修复**：新增 `parse-queue-processor` 云函数作为 ParseQueue 的消费者，定时触发，完成从文本提取到通知专员的完整后处理链路。

### 6.11.1 架构定位

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────────┐
│   email-scanner      │     │  ParseQueue 集合      │     │  parse-queue-processor   │
│   （每10分钟触发）     │────→│  （解耦缓冲层）        │────→│  （每5分钟触发）           │
│                      │     │                      │     │                          │
│  IMAP 收取邮件        │     │  status: "pending"    │     │  ① 取 pending 条目        │
│  附件下载 + 云存储     │     │  fileId, fileHash     │     │  ② 下载文件 → 文本提取    │
│  写入 ParseQueue      │     │  sourceEmailId        │     │  ③ 调 resume-parser-proxy │
│  （status: pending）  │     │  retryCount           │     │  ④ 创建 Candidate         │
└──────────────────────┘     └──────────────────────┘     │  ⑤ 更新 ParseQueue + 通知 │
                                                          └──────────────────────────┘
```

> **为什么要分开**：IMAP 连接（网络I/O密集）与 AI 解析（CPU+API调用密集）解耦。email-scanner 保持 60s 超时（IMAP 连接+附件下载），parse-queue-processor 使用 180s 超时（OCR + DeepSeek API 两次远程调用 + 格式路由）。分开后各自独立扩缩、独立重试、独立排障。

### 6.11.2 触发与并发控制

| 项目 | 设置 |
|------|------|
| 触发方式 | 定时触发器（每 5 分钟） |
| 超时 | 180s |
| 内存 | 512MB（需载入 pdfjs-dist + mammoth + word-extractor） |
| 每次处理上限 | 20 条（防止单次触发超时，剩余条目下次触发继续处理） |
| 查询排序 | `createdAt ASC`（先进先出，确保早到的简历优先解析） |

```javascript
// cloud-functions/parse-queue-processor/index.js

const cloudbase = require('@cloudbase/node-sdk');

// format-router.js 可复用 email-scanner 中的实现（实际部署时作为共享模块或复制到本云函数）
const { detectFormat, extractText } = require('./format-router.js');

exports.main = async (event, context) => {
  const app = cloudbase.init({ env: process.env.ENV_ID });
  const db = app.database();
  const _ = db.command;

  const startTime = Date.now();
  const MAX_DURATION = 150_000; // 150 秒后不再取新条目，留 30 秒余量写结果

  // ① 查询待处理条目（pending + 到达重试时间的 retry）
  const { data: items } = await db.collection('ParseQueue')
    .where({
      status: _.in(['pending', 'retry']),
      nextRetryAt: _.or([_.exists(false), _.lte(new Date())])
    })
    .orderBy('createdAt', 'asc')
    .limit(20)
    .get();

  if (items.length === 0) {
    return { processed: 0, message: '无待处理条目' };
  }

  const results = { total: items.length, done: 0, failed: 0, retried: 0 };

  for (const item of items) {
    // 超时保护：剩余时间不足 30 秒时停止处理新条目
    if (Date.now() - startTime > MAX_DURATION) {
      console.log(`⏱ 剩余时间不足，已处理 ${results.done + results.failed}/${results.total}，剩余条目下次触发继续`);
      break;
    }

    try {
      // ② 标记为 parsing（防止重复处理）
      await db.collection('ParseQueue').doc(item._id).update({
        status: 'parsing',
        parseStartedAt: new Date()
      });

      // ③ 从云存储下载文件
      const fileBuffer = await app.downloadFile({ fileID: item.fileId });

      // ④ 格式识别 + 文本提取（复用 format-router.js，15 种格式）
      const mimeInfo = detectFormat(item.fileName, item.mimeType || 'application/octet-stream');
      if (mimeInfo.strategy === 'unknown') {
        throw new Error(`不支持的文件格式: ${item.fileName}`);
      }
      const extractedText = await extractText(fileBuffer, item.fileName, mimeInfo.mimeType);

      if (!extractedText || extractedText.trim().length < 10) {
        throw new Error('文本提取结果过短，可能文件为空或损坏');
      }

      // ⑤ 调用 resume-parser-proxy（同环境云函数间调用，无网络开销）
      const parseResult = await app.callFunction({
        name: 'resume-parser-proxy',
        data: {
          text: extractedText,
          fileName: item.fileName,
          source: item.source
        }
      });

      if (!parseResult.result || parseResult.result.error) {
        throw new Error(`DeepSeek 解析失败: ${parseResult.result?.error || '未知错误'}`);
      }

      const candidateData = parseResult.result;

      // ⑥ 创建 Candidate 记录
      const candidateRes = await db.collection('Candidate').add({
        name: candidateData.name,
        phone: candidateData.phone,
        email: candidateData.email,
        currentCompany: candidateData.currentCompany,
        currentPosition: candidateData.currentPosition,
        education: candidateData.education,
        skills: candidateData.skills,
        resumeText: extractedText,
        resumeFileId: item.fileId,
        source: item.source,
        parseConfidence: candidateData.confidence || 'medium',
        duplicateCheckHash: item.fileHash,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // ⑦ 创建 Application 记录（初始阶段）
      await db.collection('Application').add({
        candidateId: candidateRes.id,
        jobId: candidateData.suggestedJobId || null,
        stage: 'resume',
        status: 'active',
        funnel: [{
          stage: 'resume',
          enteredAt: new Date(),
          source: item.source === 'email' ? 'email_auto' : item.source
        }],
        ownerId: item.userId || null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // ⑧ 更新 ParseQueue 为 done
      await db.collection('ParseQueue').doc(item._id).update({
        status: 'done',
        parsedCandidateId: candidateRes.id,
        processedAt: new Date()
      });

      // ⑨ 创建成功通知
      await db.collection('ParseNotification').add({
        userId: item.userId || null,
        type: 'parse_success',
        parseQueueId: item._id,
        candidateId: candidateRes.id,
        candidateName: candidateData.name,
        title: `新简历解析成功：${candidateData.name}`,
        detail: item.source === 'email' ? '来自邮箱自动归集，已自动创建候选人档案' : '已自动创建候选人档案',
        status: 'unread',
        createdAt: new Date()
      });

      results.done++;
      console.log(`✅ ${item.fileName} → ${candidateData.name}`);

    } catch (err) {
      console.error(`❌ ${item.fileName}: ${err.message}`);

      const newRetryCount = (item.retryCount || 0) + 1;
      const retryable = isRetryableError(err.message);

      if (retryable && newRetryCount < 3) {
        // 可重试（OCR/DeepSeek 超时等临时故障）→ 退回 pending，延迟重试
        const backoffMinutes = Math.pow(2, newRetryCount) * 5; // 5, 10, 20 分钟指数退避
        await db.collection('ParseQueue').doc(item._id).update({
          status: 'pending',
          retryCount: newRetryCount,
          lastError: err.message,
          nextRetryAt: new Date(Date.now() + backoffMinutes * 60_000)
        });
        results.retried++;
      } else {
        // 不可重试（格式不支持/文件损坏）或重试耗尽 → 标记 failed + 通知专员
        await db.collection('ParseQueue').doc(item._id).update({
          status: 'failed',
          retryCount: newRetryCount,
          failReason: err.message,
          processedAt: new Date()
        });

        await db.collection('ParseNotification').add({
          userId: item.userId || null,
          type: 'parse_failed',
          parseQueueId: item._id,
          candidateId: null,
          candidateName: item.fileName,
          title: `简历解析失败：${item.fileName}`,
          detail: `失败原因：${err.message}${!retryable ? '（格式不支持，请手动上传）' : '（已重试 ' + newRetryCount + ' 次，请手动处理）'}`,
          status: 'unread',
          createdAt: new Date()
        });
        results.failed++;
      }
    }
  }

  // ⑩ 自检：如果连续多次触发零产出，记录告警
  if (results.done === 0 && results.failed === 0) {
    console.log('⚠️ 本次触发零产出，检查是否有异常');
  }

  return {
    processed: results.total,
    done: results.done,
    failed: results.failed,
    retried: results.retried,
    duration: Date.now() - startTime
  };
};

// 判断是否为可重试错误（临时性故障）
function isRetryableError(message) {
  const retryablePatterns = [
    /timeout/i, /ETIMEDOUT/i, /ECONNRESET/i,
    /rate.?limit/i, /too many requests/i,
    /OCR.*fail/i, /temporary/i
  ];
  return retryablePatterns.some(p => p.test(message));
}
```

### 6.11.3 重试策略

| 重试次数 | 退避间隔 | 状态流转 | 说明 |
|----------|----------|----------|------|
| 0 → 1 | 5 分钟 | pending → parsing → pending | 首次重试，快速恢复 |
| 1 → 2 | 10 分钟 | pending → parsing → pending | 第二次重试 |
| 2 → 3 | 20 分钟 | pending → parsing → pending/failed | 最后一次重试，仍失败则标记 failed |
| 3+ | — | failed | 重试耗尽，通知专员手动上传 |

### 6.11.4 与其他模块的依赖关系

```
parse-queue-processor
  ├── 上游依赖：ParseQueue 集合（email-scanner 写入）
  ├── 下游产出：Candidate + Application + ParseNotification
  ├── 横向调用：resume-parser-proxy（云函数间调用）
  ├── 复用模块：format-router.js（从 email-scanner 复制或抽取为共享模块）
  └── 监控告警：连续零产出 > 1 小时 → ErrorLog + Dashboard 告警
```

### 6.11.5 关键设计决策

| 决策 | 说明 |
|------|------|
| **独立云函数，非内联到 email-scanner** | IMAP 连接与 AI 解析解耦，各自独立超时和重试 |
| **5 分钟间隔** | 与 email-scanner 的 10 分钟形成 2:1 消费比，ParseQueue 不会积压 |
| **每次最多 20 条** | 防止单次触发超时（180s 内平均每条 9s），剩余自动顺延 |
| **FIFO 排序** | createdAt ASC 确保早到的简历优先解析 |
| **指数退避重试** | 5→10→20 分钟，最多 3 次，避免临时故障导致永久失败 |
| **云函数间调用** | parse-queue-processor 通过 callFunction() 调用 resume-parser-proxy，API Key 不出云函数环境 |
| **format-router.js 复用** | 复制到 parse-queue-processor 目录，保持与 email-scanner 中的实现同步 |
---

## 七、招聘漏斗数据模型设计 🆕

### 7.1 业务背景

新励成的招聘数据链路是一个**12 步漏斗**（含 1 个可选节点）：

```
简历 → 有效简历 → 邀约 → [已确认面试] → 初试 → 初试通过 → 复试 → 复试通过 → 终试 → 终试通过 → Offer → 入职
                              ↑
                        可选节点（专员手动确认）
```

每个步骤之间是依赖关系：后续节点不能早于前序节点存在。漏斗数据是管理决策的核心依据。

> 🆕 **为什么增加"已确认面试"节点？** 实际招聘中，邀约和初试到场之间还有专员与候选人反复沟通确认面试时间的步骤。缺少这个节点导致无法区分"未回应"和"明确拒绝"两种邀约失败场景，邀约到初试的转化率被严重低估。`inviteConfirmed` 为可选节点（专员手动标记），不强制所有流程经过。

### 7.2 核心需求

| 需求 | 说明 |
|------|------|
| **标准化漏斗数据** | 12 个漏斗节点的时间戳数据（含1个可选节点：已确认面试），一环扣一环 |
| **差异化面试轮次** | CC、LTC负责人、讲师 → 3 轮面试；CR、人事出纳、TMK → 2 轮面试（跳过终试） |
| **跳阶段自动回填** | 专员延迟录入时（如候选人已到终试才录入），自动补全前面所有阶段数据 |
| **数据一致性校验** | 自动检测漏斗数据的完整性，防止"通过人数 > 参试人数"等逻辑矛盾 |

### 7.3 业界参考

| 系统 | 管道配置 | 漏斗处理 |
|------|----------|----------|
| **Greenhouse** | 每个岗位独立的面试计划（Interview Plan），支持 2-6 轮自定义 | Milestone 机制统一不同管道的漏斗指标 |
| **Lever** | 统一管道，所有岗位共用，但面试计划可 per-posting | 阶段级联计算转化率 |
| **Moka** | 支持按岗位类型预设面试流程模板 | 预置漏斗看板，自动计算 |

> 参考 Greenhouse 的 **Job-Specific Interview Plan** 模型，每个 Job 可配置独立的面试轮次。

### 7.4 数据模型

> **设计原则**：漏斗数据不可独立存储。Application 是唯一的真相来源（Single Source of Truth），漏斗时间戳嵌入 Application 文档。更新 Application.stage 的同时原子化更新 Application.funnel。参考 Greenhouse / Lever 的做法——一条 Application 记录包含其完整的漏斗生命周期。

```javascript
// Application.funnel — 漏斗时间戳直接嵌入 Application
// 单一真相来源，杜绝双轨不一致
Application {
  id,
  candidateId:     FK → candidates
  jobId:           FK → jobs

  // 当前位置（看板展示用）
  stage:           'resume' | 'valid' | 'invite' | ... | 'onboard'

  // 漏斗数据（统计用，与 stage 原子化同步更新）
  funnel: {
    resumeAt:           timestamp,   // 简历入库
    validAt:            timestamp,   // 标记为有效简历
    inviteAt:           timestamp,   // 邀约面试
    inviteConfirmedAt:  timestamp,   // 🆕 已确认面试（可选节点，专员手动标记）
    interview1At:       timestamp,   // 初试到场
    interview1PassAt: timestamp,  // 初试通过
    interview2At:    timestamp,   // 复试到场
    interview2PassAt: timestamp,  // 复试通过
    interview3At:    timestamp,   // 终试到场（2轮岗位恒为 null）
    interview3PassAt: timestamp,  // 终试通过（2轮岗位恒为 null）
    offerAt:         timestamp,   // 发Offer
    onboardAt:       timestamp,   // 入职
  }

  // 回填追踪
  funnelMeta: {
    entrySource:     'manual' | 'auto_backfill'
    backfillStages:  ['resume','valid',...]
    backfillAt:      timestamp
    backfillBy:      userId
  }

  // ... 其他 Application 字段（ownerId, visibility, history 等）
}

// Job.interviewRounds 决定 Application.funnel 中哪些节点活跃
Job {
  ...
  interviewRounds: 2 | 3
  // interviewRounds=3 → interview3At/interview3PassAt 正常使用
  // interviewRounds=2 → interview3At/interview3PassAt 恒为 null
}
```

### 7.5 按岗位差异化的漏斗路径

| 岗位 | 轮次 | 活跃漏斗节点 |
|------|------|-------------|
| **CC** | 3 轮 | 简历→有效→邀约→[已确认]→初试→初试通过→复试→复试通过→**终试→终试通过**→Offer→入职 |
| **LTC负责人** | 3 轮 | 同上 |
| **讲师** | 3 轮 | 同上 |
| **CR** | 2 轮 | 简历→有效→邀约→[已确认]→初试→初试通过→复试→复试通过→~~终试~~→Offer→入职 |
| **人事出纳** | 2 轮 | 同上 |
| **TMK** | 2 轮 | 同上 |

> `[已确认]` 为可选节点（`inviteConfirmedAt`），专员手动标记候选人确认参加面试后填写。不强制要求，不影响漏斗流转。

### 7.6 跳阶段自动回填逻辑

#### 核心原则

> **回填必须有锚点。** 没有真实日期的漏斗数据是不可信的。回填策略的底线是：面试节点必须有人工输入的日期作为锚点，否则拒绝回填。

#### 回填策略分级

| 漏斗节点 | 策略 | 说明 |
|----------|------|------|
| `resumeAt` | 自动填当前时间 | 简历进入系统的时间就是现在，可接受 |
| `validAt` | 自动填当前时间 | 标记为有效的时间，可接受 |
| `inviteAt` | 自动填当前时间 | 邀约动作的时间，可接受 |
| `inviteConfirmedAt` | 自动填当前时间 | 确认面试的时间，可接受（正常流程中由专员手动标记） |
| **`interview1At`（初试到场）** | **⛔ 强制专员手动输入日期** | **必须提供一个真实的历史日期作为锚点** |
| `interview1PassAt` | 自动推算：锚点日期 + 1-3 天 | 初试通过通常在初试后很快出结果 |
| `interview2At` | 自动推算：锚点日期 + N 天 | 根据岗位轮次递推 |
| `interview2PassAt` | 自动推算 |
| `interview3At` | 自动推算（3轮岗位） |
| `interview3PassAt` | 自动推算（3轮岗位） |
| `offerAt` | 自动填当前时间 | 通常是最近发生的事 |
| `onboardAt` | 自动填当前时间 | 通常是最近发生的事 |

> **为什么 `interview1At` 是锚点？** 初试是所有后续面试的起点。有了初试日期，后续节点可以合理递推。如果没有，整个漏斗的时间线就失去了参照。

#### 回填流程（含锚点校验）

```
用户设置候选人状态为"终试通过"
          │
          ▼
┌──────────────────────────────────────────┐
│ ① 获取 Job.interviewRounds              │
│    确定该岗位的完整漏斗序列              │
│                                          │
│ ② 读取当前 Application.funnel           │
│    检查哪些节点已完成                    │
│                                          │
│ ③ 计算缺失节点                          │
│    所有 < target 的 null 节点 = missing  │
│                                          │
│ ④ 判断是否需要锚点                      │
│    missing 包含 'interview1' ？          │
│    ├── 是 → 弹出锚点输入对话框 ──────────│
│    │   "请填写初试日期（必填）：          │
│    │    [____年__月__日]                  │
│    │    系统将以此日期推算后续节点。"     │
│    │    用户输入 → anchorDate = 输入值    │
│    ├── 否 → 已有初试日期，跳过此步       │
│                                          │
│ ⑤ 弹出确认对话框                        │
│    "检测到该候选人此前未记录以下阶段：   │
│     🔵 简历 ✓（自动，当前时间）          │
│     🔵 有效简历 ✓（自动）               │
│     🔵 邀约 ✓（自动）                   │
│     🟡 初试 → 📅 2026-03-15（你填的）    │
│     🟢 初试通过 → 📅 2026-03-16（推算）  │
│     🟢 复试 → 📅 2026-03-20（推算）      │
│     🟢 复试通过 → 📅 2026-03-21（推算）  │
│     🟢 终试 → 📅 2026-03-25（推算）      │
│     🟢 终试通过 → 📅 2026-03-26（推算）   │
│                                          │
│     🔵=自动  🟡=你填的  🟢=推算         │
│     请确认以上日期是否正确。"            │
│                                          │
│ ⑥ 用户确认 → 原子化更新                  │
│    写入 Application.stage + funnel      │
│    funnelMeta.entrySource='auto_backfill'│
│    funnelMeta.anchorDate=用户输入的日期   │
│    funnelMeta.backfillStages=[...]       │
└──────────────────────────────────────────┘
```

#### 核心代码

```javascript
// services/pipeline-engine.js

const AUTO_FILL_STAGES = ['resume','valid','invite','inviteConfirmed'];  // 直接填当前时间
const ANCHOR_REQUIRED_STAGES = ['interview1'];          // 必须人工输入

function getFullFunnelSequence(interviewRounds) {
  const base = ['resume','valid','invite','inviteConfirmed',
                'interview1','interview1Pass',
                'interview2','interview2Pass'];
  if (interviewRounds === 3) {
    base.push('interview3','interview3Pass');
  }
  base.push('offer','onboard');
  return base;
}

function needsManualAnchor(missingStages) {
  return ANCHOR_REQUIRED_STAGES.some(s => missingStages.includes(s));
}

function computeDerivedDates(anchorDate, stageIndex, sequence) {
  // 从锚点日期向后递推每个面试阶段
  // 初试通过: +1~3天  |  复试: +3~7天  |  复试通过: +1~3天
  // 终试: +3~7天  |  终试通过: +1~3天  |  Offer: +0天(当前)
  // 实际实现时根据公司历史招聘周期数据调整间隔
  const intervals = {
    'interview1Pass': { days: 2, maxDays: 3 },
    'interview2':     { days: 4, maxDays: 7 },
    'interview2Pass': { days: 2, maxDays: 3 },
    'interview3':     { days: 4, maxDays: 7 },
    'interview3Pass': { days: 2, maxDays: 3 },
    'offer':          { days: 0 },  // 填当前时间
    'onboard':        { days: 0 },  // 填当前时间
  };
  
  const derived = {};
  let base = new Date(anchorDate);
  for (let i = stageIndex + 1; i < sequence.length; i++) {
    const key = sequence[i];
    const interval = intervals[key];
    if (interval && interval.days > 0) {
      base = new Date(base.getTime() + interval.days * 86400000);
    } else {
      base = new Date();  // offer/onboard 用当前时间
    }
    derived[key + 'At'] = base.toISOString();
  }
  return derived;
}

async function applyBackfill(applicationId, targetStage, anchorDate, userId) {
  const app = await db.collection('Application').doc(applicationId).get();
  const job = await db.collection('Job').doc(app.data.jobId).get();
  const sequence = getFullFunnelSequence(job.data.interviewRounds);
  const targetIdx = sequence.indexOf(targetStage);
  
  // 分类处理：自动填 / 锚点 / 推导
  const updates = {};
  
  for (let i = 0; i <= targetIdx; i++) {
    const key = sequence[i] + 'At';
    if (app.data.funnel[key]) continue;  // 已有值，跳过
    
    if (AUTO_FILL_STAGES.includes(sequence[i])) {
      updates['funnel.' + key] = new Date().toISOString();  // 当前时间
    } else if (sequence[i] === 'interview1') {
      updates['funnel.' + key] = anchorDate;                 // 用户输入的锚点
    } else {
      // 推导节点在 computeDerivedDates 中统一处理
    }
  }
  
  // 从锚点推导后续节点
  const derived = computeDerivedDates(anchorDate, sequence.indexOf('interview1'), sequence);
  Object.assign(updates, 
    Object.fromEntries(Object.entries(derived).map(([k,v]) => ['funnel.' + k, v]))
  );
  
  // 标记回填
  updates['funnelMeta.entrySource'] = 'auto_backfill';
  updates['funnelMeta.anchorDate'] = anchorDate;
  updates['funnelMeta.backfillStages'] = missingStages;
  updates['funnelMeta.backfillAt'] = new Date().toISOString();
  updates['funnelMeta.backfillBy'] = userId;
  updates.stage = targetStage;
  updates.updatedAt = new Date().toISOString();
  
  await db.collection('Application').doc(applicationId).update(updates);
  // ✅ 锚点锚定 + 推导递推 = 时间线有参照，时效数据可信
}
```

### 7.7 数据一致性保障机制

#### 7.7.1 写入铁律（funnel 字段只增不删）

```
┌──────────────────────────────────────────────────────┐
│                Application 文档写入规则               │
├──────────────────────────────────────────────────────┤
│                                                      │
│  stage（当前位置）:                                   │
│    ✅ 可前进、可后退、可自由修改                       │
│    ✅ 每次拖拽都更新                                  │
│                                                      │
│  funnel.*At（漏斗时间戳）:                            │
│    ❌ 只写一次：字段为 null 时才写入（首次到达）       │
│    ❌ 已有时绝不覆盖                                  │
│    ❌ 后退时不删除                                    │
│    ❌ 客户端不允许直接写 funnel，必须通过              │
│       pipeline-engine 统一入口                        │
│                                                      │
│  history[]（完整轨迹）:                               │
│    ✅ 追记所有阶段变更（前进+后退+回填）               │
│    ✅ 重复经过同一节点时追加新记录                     │
│                                                      │
│  示例：候选人复试没通过，退回初试重来                  │
│    funnel.interview2At = "周二 09:00" ← 保留          │
│    funnel.interview1At = "周一 10:00" ← 保留          │
│    stage = "初试"                    ← 更新           │
│    history.push({from:"复试",to:"初试",reason:"未通过"})│
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 7.7.2 三种场景验证

| 场景 | stage 行为 | funnel 行为 | history 行为 | 结果 |
|------|-----------|------------|-------------|------|
| 正常前进：初试→初试通过→复试 | 依次更新 | funnel.*At 逐个首次写入 | 追记每条变更 | ✅ |
| 后退重来：复试→初试→初试通过 | 更新为"初试"，再更新为"初试通过" | funnel 不变（已有时间戳），新初试通过时间**不覆盖** | 追记回退+再前进，含原因 | ✅ |
| 专员误操作拖错后纠正 | 回退再前进 | funnel 不变 | 追记误操作+纠正 | ✅ |
| 跳阶段录入：直接到终试通过 | 设为"终试通过" | 所有缺失节点批量写入（标记回填） | 追记一条批量回填记录 | ✅ |

#### 7.7.3 数据校验规则（完整版）

```javascript
// services/pipeline-engine.js

function validateFunnelIntegrity(application) {
  const seq = ['resume','valid','invite','inviteConfirmed',
               'interview1','interview1Pass',
               'interview2','interview2Pass',
               'interview3','interview3Pass',
               'offer','onboard'];
  const f = application.funnel;
  const errors = [];
  
  // ─── 规则1: 通过 ≤ 参试（逻辑一致性） ───
  const checks = [
    { pass: 'interview1PassAt', test: 'interview1At', label: '初试' },
    { pass: 'interview2PassAt', test: 'interview2At', label: '复试' },
    { pass: 'interview3PassAt', test: 'interview3At', label: '终试' },
  ];
  for (const c of checks) {
    if (f[c.pass] && !f[c.test]) {
      errors.push(`❌ ${c.label}通过时间存在但${c.label}出席时间缺失`);
    }
  }
  
  // ─── 规则2: 后续不早于前序（时间线校验） ───
  for (let i = 1; i < seq.length; i++) {
    if (f[seq[i] + 'At'] && f[seq[i-1] + 'At'] &&
        new Date(f[seq[i] + 'At']) < new Date(f[seq[i-1] + 'At'])) {
      errors.push(`❌ ${seq[i]} 时间 (${f[seq[i]+'At']}) 早于 ${seq[i-1]} (${f[seq[i-1]+'At']})`);
    }
  }
  
  // ─── 规则3: funnel 不被意外覆盖（写入保护校验） ───
  // 在写入前执行：如果字段已有值，拒绝覆盖
  function shouldWriteFunnelField(application, fieldName) {
    const existing = application.funnel[fieldName];
    if (existing) {
      console.warn(`⚠️ funnel.${fieldName} 已有值 ${existing}，拒绝覆盖`);
      return false;
    }
    return true;
  }
  
  // ─── 规则4: stage 与 funnel 一致性检查 ───
  // 如果 stage 在某个节点，对应的 funnel 必须有值
  const stageToFunnelMap = {
    'resume':    'resumeAt',
    'valid':     'validAt',
    'invite':    'inviteAt',
    'inviteConfirmed': 'inviteConfirmedAt',
    'interview1':     'interview1At',
    'interview1Pass': 'interview1PassAt',
    'interview2':     'interview2At',
    'interview2Pass': 'interview2PassAt',
    'interview3':     'interview3At',
    'interview3Pass': 'interview3PassAt',
    'offer':    'offerAt',
    'onboard':  'onboardAt',
  };
  
  const expectedField = stageToFunnelMap[application.stage];
  if (expectedField && !f[expectedField]) {
    errors.push(`⚠️ stage=${application.stage} 但 funnel.${expectedField} 为空，可能数据不同步`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    hasBackfill: application.funnelMeta?.entrySource === 'auto_backfill'
  };
}
```

#### 7.7.4 回填数据可信度标记

报表中自动回填数据**单独统计**，不混入手动数据：

```javascript
// funnel-report.js 中的分区统计
function calculateFunnelMetrics(jobId, dateRange) {
  const apps = await db.collection('Application')
    .where({ jobId, status: 'active' })
    .get();

  const manual = apps.data.filter(x => x.funnelMeta?.entrySource !== 'auto_backfill');
  const backfilled = apps.data.filter(x => x.funnelMeta?.entrySource === 'auto_backfill');

  return {
    // 手动数据（高可信度）
    manual: { resumeCount: ..., validCount: ..., /* ... */ },
    // 回填数据（低可信度，单独展示）
    backfilled: { resumeCount: ..., validCount: ..., /* ... */ },
    // 合计
    total: { resumeCount: ..., validCount: ..., /* ... */ },
    // 可信度比例
    backfillRatio: (backfilled.length / apps.data.length * 100).toFixed(1) + '%'
  };
}
```

> 仪表盘展示时，回填比例 > 20% 时显示黄色警告："当前报表中有 X% 的数据为自动回填，时效性可能不准确"。
```

### 7.8 报表层设计

报表直接从 Application 集合聚合（单一真相来源）：

```javascript
// services/funnel-report.js

async function calculateFunnelMetrics(jobId, dateRange) {
  const apps = await db.collection('Application')
    .where({ jobId, status: 'active' })  // 排除已归档/删除
    .where({ createdAt: _.gte(dateRange.start).lte(dateRange.end) })
    .get();

  const f = apps.data;

  return {
    resumeCount:         f.filter(x => x.funnel?.resumeAt).length,
    validCount:          f.filter(x => x.funnel?.validAt).length,
    inviteCount:         f.filter(x => x.funnel?.inviteAt).length,
    inviteConfirmedCount: f.filter(x => x.funnel?.inviteConfirmedAt).length,
    interview1Count:     f.filter(x => x.funnel?.interview1At).length,
    interview1PassCount: f.filter(x => x.funnel?.interview1PassAt).length,
    interview2Count:    f.filter(x => x.funnel?.interview2At).length,
    interview2PassCount: f.filter(x => x.funnel?.interview2PassAt).length,
    interview3Count:    f.filter(x => x.funnel?.interview3At).length,
    interview3PassCount: f.filter(x => x.funnel?.interview3PassAt).length,
    offerCount:         f.filter(x => x.funnel?.offerAt).length,
    onboardCount:       f.filter(x => x.funnel?.onboardAt).length,

    // 自动回填数据单独统计（不混入手动数据）
    autoBackfillCount:  f.filter(x => x.funnelMeta?.entrySource === 'auto_backfill').length,

    // 10 个转化率
    validRate:    ...,  // 有效/简历
    inviteRate:   ...,  // 邀约/有效
    inviteConfirmedRate: ...,  // 🆕 确认面试/邀约（衡量邀约质量）
    interview1PassRate: ...,  // 初试通过/初试
    interview2PassRate: ...,  // 复试通过/复试
    interview3PassRate: ...,  // 终试通过/终试
    offerRate:    ...,  // Offer/终试通过（2轮岗位用复试通过作分母）
    onboardRate:  ...,  // 入职/Offer
  };
}
```

### 7.9 关键设计决策

| # | 决策 | 说明 |
|---|------|------|
| 1 | **漏斗嵌入 Application（单一真相来源）** | 废除独立 `CandidateFunnel` 集合。`Application.funnel` 与 `Application.stage` 在同一文档原子化更新，杜绝双轨不一致。参考 Greenhouse/Lever 标准做法 |
| 2 | **按岗位配置面试轮次** | `Job.interviewRounds` 决定漏斗包含哪些节点，参考 Greenhouse 的 Job-Specific Interview Plan |
| 3 | **增加"已确认面试"可选节点** 🆕 | `inviteConfirmedAt` 填补邀约→初试间的业务断点。专员手动标记，不强制使用。解决"邀约后确认率"无法统计和邀约转化率被低估的问题 |
| 4 | **跳阶段回填（锚点+递推策略）** | 前置节点自动填当前时间；初试日期强制人工输入作为锚点；后续面试节点从锚点递推。杜绝"三个月前的事被标成今天" |
| 5 | **回填前用户确认** | 弹窗展示待回填节点列表（区分🔵自动/🟡你填的/🟢推算），用户确认后执行，防止误操作 |
| 6 | **报表直接聚合 Application** | 查询 Application 集合（`status: 'active'`），过滤已归档记录，无跨集合不一致风险 |
| 7 | **云函数聚合层（防大数据量卡死）** | 报表不走前端直查数据库，全部通过云函数在服务端聚合后返回精简结果。高频报表预计算缓存，低频报表实时聚合+分页 |

---

### 7.10 报表聚合层设计（大数据量场景）🆕

#### 7.10.1 问题本质

> **一个专员月收 300+ 简历，5 个专员一年就是 18,000 条 Application。前端全量拉取 + JS filter() 会在浏览器端造成几十 MB 数据传输和内存计算，4G 网络下页面直接卡死。**

CloudBase 文档数据库（类 MongoDB）擅长单文档 CRUD，但不支持 SQL 的 `GROUP BY`、`JOIN`、聚合管道。复杂报表查询必须借助中间层完成。

| 报表场景 | 数据量（1年5专员） | 前端直接查 | 云函数聚合 |
|----------|-------------------|-----------|-----------|
| "CC部门本月漏斗" | ~500 条 Application | 拉全量 → 几十 MB → 浏览器卡 | 云函数过滤 → 返回 ~2KB 统计结果 |
| "全部岗位×全部月份交叉报表" | ~18,000 条 | 拉全量 → 浏览器必死 | 云函数聚合 → 返回 ~5KB JSON |
| "招聘趋势图（12个月）" | ~18,000 条 | 同上 | 预计算缓存 → ~3KB，<100ms |

#### 7.10.2 解决方案架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     报表聚合层架构                                │
│                                                                 │
│  前端报表页                                                      │
│      │                                                          │
│      │ ① 发起查询请求（岗位/部门/时间范围）                        │
│      ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              云函数 report-aggregator                     │  │
│  │                                                          │  │
│  │  ② 先查 ReportCache（预计算缓存）                          │  │
│  │     ├── 命中且未过期 → 直接返回（<100ms）                  │  │
│  │     └── 未命中 → ③ 执行实时聚合                           │  │
│  │                                                          │  │
│  │  ③ 实时聚合流程：                                         │  │
│  │     a. 根据查询条件确定需要哪些 Job ID                     │  │
│  │     b. 分批查询 Application（每批 500 条）                 │  │
│  │     c. Node.js 服务端聚合 → 统计结果                       │  │
│  │     d. 写入 ReportCache（供后续查询）                      │  │
│  │     e. 返回精简结果给前端                                  │  │
│  │                                                          │  │
│  │  ④ 返回结果格式：                                         │  │
│  │     { stats: {...}, meta: { totalApps, cacheHit, ... } } │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        云函数 report-cache-warmer（定时触发）              │  │
│  │                                                          │  │
│  │  每天凌晨 2:00 执行：                                      │  │
│  │  • 预计算所有活跃岗位的当日漏斗数据                         │  │
│  │  • 预计算所有部门的月度转化率                               │  │
│  │  • 写入 ReportCache 集合                                  │  │
│  │  • 删除 7 天前的过期缓存                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  ReportCache 集合                          │  │
│  │                                                          │  │
│  │  { cacheKey: "job:cc:funnel:2026-06",                    │  │
│  │    data: { resumeCount, validCount, ..., rates },         │  │
│  │    computedAt, expiresAt, dataVersion }                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.10.3 云函数实现

```javascript
// cloud-functions/report-aggregator/index.js

const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init();
const db = app.database();
const _ = db.command;

// 单次查询最多返回条数（CloudBase 限制 1000，用满以减少网络往返）
const BATCH_SIZE = 1000;

exports.main = async (event, context) => {
  const { type, filters } = event;
  // type: 'job_funnel' | 'dept_monthly' | 'trend' | 'overview'
  // filters: { jobId?, departmentId?, dateFrom?, dateTo? }

  // ① 查询缓存
  const cacheKey = buildCacheKey(type, filters);
  const cached = await db.collection('ReportCache')
    .where({ cacheKey, expiresAt: _.gte(new Date()) })
    .get();
  
  if (cached.data.length > 0) {
    return { ...cached.data[0].data, _cacheHit: true };
  }

  // ② 未命中，执行实时聚合
  let result;
  switch (type) {
    case 'job_funnel':
      result = await aggregateJobFunnel(filters);
      break;
    case 'dept_monthly':
      result = await aggregateDeptMonthly(filters);
      break;
    case 'trend':
      result = await aggregateTrend(filters);
      break;
    case 'overview':
      result = await aggregateOverview(filters);
      break;
  }

  // ③ 写入缓存（TTL 30 分钟，高频报表）
  await db.collection('ReportCache').add({
    cacheKey,
    data: result,
    computedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30分钟过期
    dataVersion: 1
  });

  return { ...result, _cacheHit: false };
};

// ─── 核心聚合函数 ───

async function aggregateJobFunnel(filters) {
  const { jobId, dateFrom, dateTo } = filters;
  
  // 分批拉取 Application（避免一次拉太多）
  let allApps = [];
  let offset = 0;
  while (true) {
    const batch = await db.collection('Application')
      .where({
        jobId,
        status: 'active',
        'funnel.resumeAt': _.gte(new Date(dateFrom)).lte(new Date(dateTo))
      })
      .skip(offset)
      .limit(BATCH_SIZE)
      .get();
    
    allApps = allApps.concat(batch.data);
    if (batch.data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  // 服务端聚合（Node.js 内存中，不对浏览器造成压力）
  const f = allApps;
  const result = {
    resumeCount:         f.filter(x => x.funnel?.resumeAt).length,
    validCount:          f.filter(x => x.funnel?.validAt).length,
    inviteCount:         f.filter(x => x.funnel?.inviteAt).length,
    inviteConfirmedCount: f.filter(x => x.funnel?.inviteConfirmedAt).length,
    interview1Count:     f.filter(x => x.funnel?.interview1At).length,
    interview1PassCount: f.filter(x => x.funnel?.interview1PassAt).length,
    interview2Count:    f.filter(x => x.funnel?.interview2At).length,
    interview2PassCount: f.filter(x => x.funnel?.interview2PassAt).length,
    interview3Count:    f.filter(x => x.funnel?.interview3At).length,
    interview3PassCount: f.filter(x => x.funnel?.interview3PassAt).length,
    offerCount:         f.filter(x => x.funnel?.offerAt).length,
    onboardCount:       f.filter(x => x.funnel?.onboardAt).length,
    autoBackfillCount:  f.filter(x => x.funnelMeta?.entrySource === 'auto_backfill').length,
    
    // 转化率
    rates: {
      validRate:    percent(f.filter(x => x.funnel?.validAt).length, f.filter(x => x.funnel?.resumeAt).length),
      inviteRate:   percent(f.filter(x => x.funnel?.inviteAt).length, f.filter(x => x.funnel?.validAt).length),
      inviteConfirmedRate: percent(f.filter(x => x.funnel?.inviteConfirmedAt).length, f.filter(x => x.funnel?.inviteAt).length),
      interview1PassRate: percent(f.filter(x => x.funnel?.interview1PassAt).length, f.filter(x => x.funnel?.interview1At).length),
      interview2PassRate: percent(f.filter(x => x.funnel?.interview2PassAt).length, f.filter(x => x.funnel?.interview2At).length),
      interview3PassRate: percent(f.filter(x => x.funnel?.interview3PassAt).length, f.filter(x => x.funnel?.interview3At).length),
      offerRate:   percent(f.filter(x => x.funnel?.offerAt).length, 
        f.filter(x => x.funnel?.interview3PassAt || x.funnel?.interview2PassAt).length),
      onboardRate: percent(f.filter(x => x.funnel?.onboardAt).length, f.filter(x => x.funnel?.offerAt).length),
    },
    
    // 回填数据单独标记
    backfillRatio: percent(
      f.filter(x => x.funnelMeta?.entrySource === 'auto_backfill').length, 
      f.length
    ),
    
    meta: { totalApps: f.length, dateFrom, dateTo, computedAt: new Date().toISOString() }
  };
  
  return result;
}

async function aggregateDeptMonthly(filters) {
  const { departmentId, year, month } = filters;
  
  // 第一步：找到该部门下所有 Job
  const jobs = await db.collection('Job')
    .where({ department: departmentId, status: 'active' })
    .field({ _id: true, title: true })
    .get();
  
  const jobIds = jobs.data.map(j => j._id);
  
  // 第二步：分批拉取这些 Job 的 Application
  let allApps = [];
  let offset = 0;
  while (true) {
    const batch = await db.collection('Application')
      .where({
        jobId: _.in(jobIds),
        status: 'active'
      })
      .skip(offset)
      .limit(BATCH_SIZE)
      .get();
    
    allApps = allApps.concat(batch.data);
    if (batch.data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  // 第三步：按 Job 分组聚合
  const byJob = {};
  for (const app of allApps) {
    const jid = app.jobId;
    if (!byJob[jid]) byJob[jid] = { total: 0, interview1Pass: 0, interview2Pass: 0, interview3Pass: 0, offer: 0, onboard: 0 };
    byJob[jid].total++;
    if (app.funnel?.interview1PassAt) byJob[jid].interview1Pass++;
    if (app.funnel?.interview2PassAt) byJob[jid].interview2Pass++;
    if (app.funnel?.interview3PassAt) byJob[jid].interview3Pass++;
    if (app.funnel?.offerAt) byJob[jid].offer++;
    if (app.funnel?.onboardAt) byJob[jid].onboard++;
  }

  return {
    department: departmentId,
    period: `${year}-${String(month).padStart(2, '0')}`,
    jobs: jobs.data.map(j => ({
      jobId: j._id,
      title: j.title,
      stats: byJob[j._id] || { total: 0, interview1Pass: 0, interview2Pass: 0, interview3Pass: 0, offer: 0, onboard: 0 }
    })),
    meta: { totalApps: allApps.length, cacheWarm: false }
  };
}

function percent(numerator, denominator) {
  if (!denominator || denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}
```

#### 7.10.4 缓存预热云函数

```javascript
// cloud-functions/report-cache-warmer/index.js

const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init();
const db = app.database();

exports.main = async (event, context) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  // 获取所有活跃岗位
  const jobs = await db.collection('Job')
    .where({ status: 'active' })
    .field({ _id: true, title: true, department: true })
    .get();

  const results = [];
  
  for (const job of jobs.data) {
    // 调用聚合函数计算本月漏斗
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const cacheKey = `job:${job._id}:funnel:${monthStart.split('T')[0]}`;
    
    // 分批拉取本月 Application
    let allApps = [];
    let offset = 0;
    while (true) {
      const batch = await db.collection('Application')
        .where({
          jobId: job._id,
          status: 'active',
          'funnel.resumeAt': cloudbase.db().command.gte(new Date(monthStart))
        })
        .skip(offset).limit(1000)
        .get();
      allApps = allApps.concat(batch.data);
      if (batch.data.length < 1000) break;
      offset += 1000;
    }

    // 聚合计算（同 report-aggregator 的逻辑）
    const stats = computeFunnelStats(allApps);
    
    // 写入缓存（24小时过期）
    await db.collection('ReportCache')
      .where({ cacheKey }).remove();  // 删除旧缓存
    
    await db.collection('ReportCache').add({
      cacheKey,
      data: stats,
      computedAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      dataVersion: 1
    });
    
    results.push({ jobId: job._id, title: job.title, cacheKey, done: true });
  }

  // 清理 7 天前的过期缓存
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cleanupResult = await db.collection('ReportCache')
    .where({ expiresAt: cloudbase.db().command.lte(sevenDaysAgo) })
    .remove();

  return {
    success: true,
    jobsProcessed: results.length,
    cachesCleaned: cleanupResult.deleted || 0,
    timestamp: now.toISOString()
  };
};

function computeFunnelStats(apps) {
  const f = apps;
  return {
    resumeCount:         f.filter(x => x.funnel?.resumeAt).length,
    validCount:          f.filter(x => x.funnel?.validAt).length,
    inviteCount:         f.filter(x => x.funnel?.inviteAt).length,
    inviteConfirmedCount: f.filter(x => x.funnel?.inviteConfirmedAt).length,
    interview1Count:     f.filter(x => x.funnel?.interview1At).length,
    interview1PassCount: f.filter(x => x.funnel?.interview1PassAt).length,
    interview2Count:    f.filter(x => x.funnel?.interview2At).length,
    interview2PassCount: f.filter(x => x.funnel?.interview2PassAt).length,
    interview3Count:    f.filter(x => x.funnel?.interview3At).length,
    interview3PassCount: f.filter(x => x.funnel?.interview3PassAt).length,
    offerCount:         f.filter(x => x.funnel?.offerAt).length,
    onboardCount:       f.filter(x => x.funnel?.onboardAt).length,
    totalApps: f.length
  };
}
```

#### 7.10.5 数据库索引设计

> ⚠️ **CloudBase 需要为聚合查询创建复合索引，否则云函数内查询也会超时。**

```javascript
// 部署时在 CloudBase 控制台或初始化脚本中创建以下索引：

// Application 集合复合索引（按优先级排列）
// 索引1：按岗位+状态+漏斗时间查询（最常用）
//   jobId (升序) + status (升序) + funnel.resumeAt (升序)
// 索引2：按状态+漏斗时间查询（全局报表）
//   status (升序) + funnel.resumeAt (升序)
// 索引3：按岗位+状态查询（看板数据，不含时间筛选时用）
//   jobId (升序) + status (升序)

// Job 集合索引
// 索引4：按部门+状态查询
//   department (升序) + status (升序)

// ReportCache 集合索引
// 索引5：按过期时间查询（缓存清理用）
//   expiresAt (升序)
```

#### 7.10.6 前端调用方式

```javascript
// services/funnel-report.js — 前端侧（轻量，只调云函数）

import cloudbase from './cloudbase.js';

export async function getJobFunnel(jobId, dateRange) {
  // ✅ 通过云函数聚合，不直接查数据库
  const result = await cloudbase.callFunction({
    name: 'report-aggregator',
    data: {
      type: 'job_funnel',
      filters: {
        jobId,
        dateFrom: dateRange.start,
        dateTo: dateRange.end
      }
    }
  });
  
  return result.result;  // 已聚合好的统计数据（~2KB）
}

export async function getDeptMonthly(departmentId, year, month) {
  const result = await cloudbase.callFunction({
    name: 'report-aggregator',
    data: {
      type: 'dept_monthly',
      filters: { departmentId, year, month }
    }
  });
  
  return result.result;
}

export async function getDashboardOverview() {
  // 仪表盘总览 — 优先走缓存
  const result = await cloudbase.callFunction({
    name: 'report-aggregator',
    data: {
      type: 'overview',
      filters: {}
    }
  });
  
  return result.result;
}
```

#### 7.10.7 性能对比

| 场景 | 数据量 | 前端直查数据库 | 云函数聚合 | 云函数+缓存 |
|------|--------|-------------|-----------|------------|
| 单岗位当月漏斗 | 200条 | ~3s（拉全量 Application） | ~0.8s | **~0.1s** |
| 部门月度交叉报表 | 3,000条 | ❌ 浏览器卡死 | ~2s | **~0.3s** |
| 全部岗位趋势（12月） | 18,000条 | ❌ 浏览器必死 | ~8s | **~0.5s**（分批预热） |
| 仪表盘总览 | 全量 | ❌ | ~3s | **~0.1s** |

#### 7.10.8 费用估算

| 项目 | 用量 | 费用 |
|------|------|------|
| report-aggregator 调用 | ~200次/天（报表查询） | ¥0（免费额度内） |
| report-cache-warmer 调用 | 1次/天（凌晨执行） | ¥0 |
| 云函数执行时间 | ~30,000 GB-秒/月 | ¥0（免费额度 40万） |
| **合计** | | **¥0/月** |

> 全部在 CloudBase 免费额度内，不增加任何费用。

#### 7.10.9 关键设计决策

| 决策 | 说明 |
|------|------|
| **报表不走前端直查** | 所有聚合查询通过云函数，前端只收精简统计结果（<10KB），永远不传输未聚合的 Application 列表 |
| **三级缓存策略** | ReportCache（预计算缓存 24h TTL）→ 云函数内存聚合（30min TTL）→ 实时分批聚合 |
| **分批拉取** | 云函数内单次查询上限 500 条，超过则分页拉取后在 Node.js 内存聚合 |
| **凌晨预热** | 每日 2:00 自动预热所有活跃岗位的当月漏斗数据，确保用户早上打开秒出结果 |
| **过期清理** | 自动清理 7 天前的缓存，控制 ReportCache 集合大小 |

---

### 7.11 候选人结束状态设计 🆕

#### 7.11.1 设计初衷

漏斗不只有前进。实际招聘中，大部分候选人最终是**离开流程**而非走到入职。缺少标准化的结束状态会导致：

| 问题 | 说明 |
|------|------|
| 看板混乱 | 已淘汰/放弃的候选人和活跃候选人混在一起，专员不知道哪些需要跟进 |
| 报表盲区 | 无法统计面试淘汰率、Offer 拒绝率等关键招聘质量指标 |
| 重复投递 | 候选人再次投递时，看不到历史淘汰/放弃原因，可能重蹈覆辙 |

#### 7.11.2 结束状态分类

```
                    Application.status
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
     active            rejected           withdrawn
   （流程中—看板）    （公司淘汰）        （候选人放弃）
```

| status | 含义 | 谁触发 | 典型场景 |
|--------|------|--------|----------|
| `active` | 流程进行中 | — | 正常显示在看板管道中 |
| `rejected` | 公司方拒绝 | 专员 | 简历不合适、面试未通过 |
| `withdrawn` | 候选人放弃 | 专员（代记录） | 不接受薪资、已接其他Offer、未到场 |

#### 7.11.3 结束阶段（endStage）

`endStage` 记录候选人结束时所处的漏斗阶段，精确到节点：

| endStage | 含义 | 可用 status |
|----------|------|-------------|
| `resume` | 简历阶段 | `rejected` |
| `valid` | 有效简历阶段 | `rejected`, `withdrawn` |
| `invite` | 已邀约 | `rejected`, `withdrawn` |
| `inviteConfirmed` | 已确认面试 | `withdrawn` |
| `interview1` | 初试 | `rejected`, `withdrawn` |
| `interview1Pass` | 初试通过 | `withdrawn` |
| `interview2` | 复试 | `rejected`, `withdrawn` |
| `interview2Pass` | 复试通过 | `withdrawn` |
| `interview3` | 终试 | `rejected`, `withdrawn` |
| `interview3Pass` | 终试通过 | `withdrawn` |
| `offer` | Offer 阶段 | `rejected`, `withdrawn` |
| `onboard` | 已入职 | `withdrawn`（入职后离职） |

> `rejected` 只出现在面试节点前后（公司基于面试结果淘汰）；`withdrawn` 可出现在任意节点（候选人随时可能放弃）。

#### 7.11.4 结束原因预设选项

##### 淘汰原因（rejected）— 专员选择

| value | label | 说明 |
|-------|-------|------|
| `resume_not_match` | 简历不符合要求 | 教育背景、工作经验等基本条件不满足 |
| `interview_failed` | 面试表现不佳 | 面试中专业技能或综合素质未达预期 |
| `salary_too_high` | 薪资期望过高 | 候选人期望薪资超出岗位预算 |
| `position_filled` | 岗位已招满 | 该岗位已完成招聘或暂停 |
| `other_rejected` | 其他原因 | 专员自行备注 |

##### 放弃原因（withdrawn）— 专员选择

| value | label | 说明 |
|-------|-------|------|
| `accepted_other_offer` | 已接受其他 Offer | 候选人选择了其他公司的机会 |
| `salary_not_satisfied` | 薪资不满意 | 候选人认为薪资待遇不符合预期 |
| `location_unsuitable` | 工作地点不合适 | 通勤距离、城市等因素 |
| `position_mismatch` | 岗位与预期不符 | 实际工作内容与候选人期望不一致 |
| `no_show` | 未到场面试 | 约定的面试时间未出现 |
| `unreachable` | 无法联系 | 多次尝试电话/微信均无回应 |
| `personal_reason` | 个人原因 | 家庭、健康等私人因素 |
| `other_withdrawn` | 其他原因 | 专员自行备注（选此项弹出文本框） |

#### 7.11.5 专员操作流程

```
专员在看板中右键点击候选人卡片
        │
        ├── "淘汰此候选人" ──→ 弹出对话框：
        │     当前阶段：初试
        │     淘汰原因：[下拉选择 ▼]
        │       ○ 简历不符合要求
        │       ○ 面试表现不佳
        │       ○ 薪资期望过高
        │       ○ 岗位已招满
        │       ○ 其他原因 → [文本框]
        │     [确认淘汰] [取消]
        │     → status='rejected', endStage=当前stage, endedAt=now
        │     → 卡片从看板移除，历史记录追加一条
        │
        ├── "候选人放弃" ──→ 弹出对话框：
        │     当前阶段：Offer
        │     放弃原因：[下拉选择 ▼]
        │       ○ 已接受其他 Offer
        │       ○ 薪资不满意
        │       ○ 工作地点不合适
        │       ...（8个选项）
        │     [确认放弃] [取消]
        │     → status='withdrawn', endStage=当前stage, endedAt=now
        │     → 卡片从看板移除，历史记录追加一条
        │
        └── "重新激活"（仅已结束的候选人可见）
             → status='active'，回到原 endStage
             → 重新出现在看板管道中
```

#### 7.11.6 数据显示

**看板管道**：只显示 `status='active'` 的候选人。

**"已结束"列表**（新页面或 CandidateList 中的 Tab）：

```
┌─────────────────────────────────────────────────────────┐
│  已结束候选人                                            │
│  [全部] [淘汰] [放弃]                          🔍 搜索   │
│                                                         │
│  📋 张三 — CC岗 — 复试淘汰（面试表现不佳）— 2026-06-10  │
│  🚫 李四 — CR岗 — 放弃Offer（已接受其他Offer）— 2026-06-09│
│  📋 王五 — 讲师岗 — 简历淘汰（简历不符合要求）— 2026-06-08│
│  🚫 赵六 — TMK岗 — 未到场（未到场面试）— 2026-06-07     │
│                                                         │
│  每条记录可点击查看详情，可"重新激活"回到流程              │
└─────────────────────────────────────────────────────────┘
```

**报表指标新增**：

```javascript
// 漏斗报表增加淘汰/放弃指标
{
  // ... 原有漏斗指标 ...

  // 🆕 退出指标
  rejectedCount:  f.filter(x => x.status === 'rejected').length,
  withdrawnCount: f.filter(x => x.status === 'withdrawn').length,
  
  // 🆕 各阶段淘汰率
  rejectionRates: {
    resumeRejectRate,    // 简历淘汰率
    interview1RejectRate, // 初试淘汰率
    interview2RejectRate, // 复试淘汰率
    interview3RejectRate, // 终试淘汰率
    offerRejectRate,     // Offer 淘汰率（公司方）
  },
  
  // 🆕 各阶段放弃率
  withdrawalRates: {
    inviteWithdrawRate,   // 邀约后放弃率（未到场/无法联系）
    interview2WithdrawRate,
    interview3WithdrawRate,
    offerWithdrawRate,    // Offer 被拒率（候选人方）
    onboardWithdrawRate,  // 入职后流失率
  },
}
```

#### 7.11.7 数据模型变更总结

```javascript
// Application 新增字段（仅 4 个，改动极小）
Application {
  // ... 现有字段全部不变 ...

  status:    'active',      // 'active' | 'rejected' | 'withdrawn' ，默认 active
  endStage:  null,          // 结束时的 stage 值，active 状态为 null
  endReason: null,          // 预设值或专员备注，active 状态为 null
  endedAt:   null,          // 结束时间戳，active 状态为 null
}
```

> **设计原则**：结束信息是**快照**（记录结束那一刻的状态），`history` 中同时追加一条操作记录保证可追溯。重新激活时 `endStage/endReason/endedAt` 清空为 null，`status` 回 `active`。

#### 7.11.8 关键设计决策

| 决策 | 说明 |
|------|------|
| **结束状态二分类** | `rejected`（公司淘汰）和 `withdrawn`（候选人放弃）分开，报表中可分别统计 |
| **预设原因 + 其他** | 淘汰 5 个预设、放弃 8 个预设，各有一个"其他"选项供专员手写备注 |
| **endStage 精确记录** | 记录结束时的精确漏斗节点，而非粗粒度的"面试阶段"，方便统计各阶段流失率 |
| **可重新激活** | 已结束的候选人可手动改回 active，防止误操作不可逆 |
| **不影响现有字段** | 仅新增 4 个字段，现有漏斗、回填、审批逻辑全部不受影响 |

---

### 7.12 候选人跟进记录设计 🆕

#### 7.12.1 设计初衷

专员日常大量沟通——打电话约面试、微信跟进 Offer、邮件发资料。这些沟通如果没有留痕，人一多就记不住谁说过什么、什么时候该再次跟进。

> 这是一个**轻量记录**功能，不是 CRM 系统。只记录沟通摘要和下次跟进时间，不需要复杂的日程管理。

#### 7.12.2 数据模型

```javascript
// Application.communicationLogs[] — 嵌入 Application 文档
communicationLogs: [{
  id:           string,
  type:         'phone' | 'wechat' | 'email' | 'onsite' | 'other',
  //             电话    |  微信     |  邮件   |  当面    |  其他

  direction:    'outbound' | 'inbound',
  //             专员主动联系  | 候选人联系专员
  
  summary:      string,        // 沟通摘要（必填，自由文本）
  result:       string | null, // 沟通结论（选填，如"候选人表示下周三有空"）
  followUpAt:   timestamp | null, // 下次跟进时间（选填，到期前提醒专员）

  createdBy:    userId,
  createdAt:    timestamp
}]
```

#### 7.12.3 专员操作界面

**候选人详情页 → "沟通记录" Tab**：

```
┌─────────────────────────────────────────────────────────┐
│  沟通记录                                    [+ 新增记录] │
│                                                         │
│  📞 电话（我联系的）— 2026-06-15 14:30                    │
│     约面试时间，候选人说下周三下午有空                      │
│     结论：初试定在 6/18 下午 2:00                         │
│     ⏰ 下次跟进：—                                       │
│                                                         │
│  💬 微信（候选人联系我）— 2026-06-14 09:15                │
│     候选人询问岗位具体职责                                  │
│     结论：已发 JD 截图，候选人表示感兴趣                    │
│     ⏰ 下次跟进：2026-06-16                               │
│                                                         │
│  📧 邮件（我联系的）— 2026-06-10 11:00                    │
│     发送复试通知和公司介绍资料                              │
│     结论：—                                               │
│     ⏰ 下次跟进：—                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**新增记录弹窗**：

```
┌──────────────────────────────────────┐
│  新增沟通记录                         │
│                                      │
│  沟通方式：[电话 ▼]                   │
│  发起方：  ○ 我联系候选人  ○ 候选人联系我│
│                                      │
│  沟通摘要：                           │
│  ┌────────────────────────────────┐  │
│  │ 跟候选人确认了面试时间，           │  │
│  │ 对方表示下周三有空...             │  │
│  └────────────────────────────────┘  │
│                                      │
│  沟通结论（选填）：                    │
│  ┌────────────────────────────────┐  │
│  │ 初试定在 6/18 下午 2:00         │  │
│  └────────────────────────────────┘  │
│                                      │
│  ⏰ 下次跟进时间：[选填，日历选择]     │
│                                      │
│     [保存] [取消]                     │
└──────────────────────────────────────┘
```

#### 7.12.4 跟进提醒

- 仪表盘（Dashboard）增加一个"待跟进"卡片：列出 `followUpAt <= today` 的候选人
- 超过跟进日期未处理 → 标红，提醒专员尽快联系

#### 7.12.5 数据模型变更总结

```javascript
// Application 新增字段（仅 1 个数组）
Application {
  // ... 现有字段全部不变 ...
  communicationLogs: [],  // 沟通记录数组，按时间倒序
}
```

> **设计原则**：沟通记录嵌入 Application（不建独立集合），与面试评价 `feedbacks` 同级。单条记录轻量（类型+摘要+可选跟进时间），快速录入不打断专员工作节奏。

#### 7.12.6 关键设计决策

| 决策 | 说明 |
|------|------|
| **嵌入 Application** | 不做独立集合，沟通记录跟随申请记录，查询候选人时一并加载 |
| **5 种沟通方式** | 电话/微信/邮件/当面/其他，覆盖专员日常场景 |
| **方向标注** | `outbound`（主动联系）/ `inbound`（被动响应），方便了解沟通主动权 |
| **可选跟进时间** | 非强制，专员自己决定要不要设提醒，不做复杂的日程管理 |
| **跟进提醒自动化** | 仪表盘"待跟进"卡片自动拉取超期未跟进的候选人 |

#### 7.12.7 ⚠️ 嵌入数组上限与文档膨胀防护 🟡 S1

> **风险**：`communicationLogs[]`、`history[]`、`feedbacks[]` 全部嵌入 Application 文档，无限制增长可能导致单文档过大。CloudBase 文档数据库单文档上限通常为 **16MB**。

**增长预估**：

| 数组 | 单条大小 | 高频场景预估 | 年增长量 |
|------|----------|-------------|----------|
| `history[]` | ~200B | 平均 8 次阶段变更/候选人 | ~1.6KB |
| `communicationLogs[]` | ~500B | 平均 15 次沟通/候选人 | ~7.5KB |
| `feedbacks[]` | ~400B | 平均 3 次面试评价/候选人 | ~1.2KB |
| **合计** | — | — | **~10KB/候选人** |

> 年均 30,000 条 Application 下，极端活跃候选人也远达不到 16MB（需 ~1600 次沟通记录）。但**不设上限仍是隐患**。

**防护措施**：

| 措施 | 说明 |
|------|------|
| **数组上限** | `communicationLogs[]` 保留最近 **200 条**、`history[]` 保留最近 **200 条**。超出后旧记录归档到独立集合或截断 |
| **文档大小监控** | `health-monitor` 云函数新增检查：扫描 Application 文档大小 Top-100，超过 1MB 的写入 ErrorLog 告警 |
| **归档策略兜底** | 配合 §7.10 数据归档：入职>6个月、结束>12个月的 Application 自动归档（`isArchived: true`），不参与日常查询 |

> **决策**：保持嵌入设计（查询效率高），通过上限+监控+归档三重防护避免膨胀。无需拆为独立集合。

---

### 7.13 批量操作设计 🆕

#### 7.13.1 设计初衷

月均 2,400-3,000 份简历流水，高频操作如果只能一个一个点，专员每天大量时间耗在重复点击上。

#### 7.13.2 批量操作清单

| # | 操作 | 适用场景 | 频率 |
|---|------|----------|------|
| **1** | **批量移动阶段** | 多人通过同一轮面试，统一拖拽/移动到下一阶段 | 🔴 高 |
| **2** | **批量淘汰** | 岗位关闭或一批候选人面试未通过，统一标记淘汰 | 🔴 高 |
| **3** | **批量放弃** | 一批候选人集体放弃（如岗位取消），统一标记放弃 | 🟡 中 |
| **4** | **批量导出 Excel** | 导出选中候选人名单给人事/用人部门 | 🔴 高 |
| **5** | **批量分配负责人** | 专员离职/调岗，候选人批量转给另一个专员 | 🟡 中 |
| **6** | **批量打标签** | 一批候选人统一打上"急招""内推"等标签 | 🟡 中 |
| **7** | **批量重新激活** | 已淘汰的候选人因岗位重开需要批量回到流程 | 🟡 中 |
| **8** | **批量标记邀约** | 已电话通知面试的候选人，统一标记为"已邀约" | 🟡 中 |
| **9** | **批量归档** | 入职超 3 个月的候选人从活跃列表批量移入归档 | 🟢 低 |
| **10** | **批量添加沟通记录** | 统一发面试通知后，给所有人加一条"已电话通知面试" | 🟡 中 |

#### 7.13.3 交互设计

**选择机制**：

```
看板管道（每个阶段列）         列表视图
┌──────────────────┐      ┌──────────────────────────┐
│ ☐ 初试 (45)      │      │ ☐ 全选  [已选中 8 人]     │
│                  │      │                          │
│ ☐ 张三 — CC岗    │      │ ☑ 张三 — CC — 初试       │
│ ☑ 李四 — CR岗    │      │ ☑ 李四 — CR — 初试       │
│ ☑ 王五 — 讲师岗  │      │ ☐ 赵六 — TMK — 复试      │
│ ☐ 赵六 — TMK岗   │      │ ☑ 钱七 — CC — 初试       │
│ ...              │      │ ...                      │
└──────────────────┘      └──────────────────────────┘
```

**选中后的操作栏**（页面底部浮现）：

```
┌──────────────────────────────────────────────────────────────┐
│  ☑ 已选中 8 人    [移至▼] [淘汰] [放弃] [导出] [分配▼] [更多▼] │
└──────────────────────────────────────────────────────────────┘
```

**确认机制**：

| 操作类型 | 确认方式 |
|----------|----------|
| 移动阶段 | 弹出对话框：选择目标阶段 → 如有缺失节点出示回填预览 → 确认 |
| 淘汰/放弃 | 弹出对话框：选择原因 → 所有选中人统一应用 → 确认（⚠ 不可撤回） |
| 导出 Excel | 不弹窗，直接下载 |
| 分配负责人 | 弹出下拉选人 → 确认 |
| 打标签 | 弹出标签选择器（多选） → 确认 |
| 添加沟通记录 | 弹出沟通记录对话框 → 所有选中人统一追加一条相同记录 |

#### 7.13.4 技术实现

```javascript
// services/batch-operations.js

import cloudbase from './cloudbase.js';
const db = cloudbase.database();
const _ = db.command;

// CloudBase 批量更新：where + _.in + update
// 单次最多 1000 条，超过自动分批

const BATCH_LIMIT = 100; // 单次批量操作上限（避免一次操作太多）

async function batchUpdateStage(ids, targetStage, anchorDate, userId) {
  // 分批处理，每批 100 条
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = ids.slice(i, i + BATCH_LIMIT);
    
    for (const id of batch) {
      // 每个候选人独立走 pipeline-engine（可能触发回填）
      await applyBackfill(id, targetStage, anchorDate, userId);
    }
  }
  
  return { success: true, processed: ids.length };
}

async function batchReject(ids, endReason, userId) {
  const now = new Date().toISOString();
  
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = ids.slice(i, i + BATCH_LIMIT);
    
    await db.collection('Application')
      .where({ _id: _.in(batch) })
      .update({
        status: 'rejected',
        endReason,
        endedAt: now,
        updatedAt: now
      });
  }
  
  return { success: true, processed: ids.length };
}

async function batchReassign(ids, newOwnerId, userId) {
  const now = new Date().toISOString();
  
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = ids.slice(i, i + BATCH_LIMIT);
    
    await db.collection('Application')
      .where({ _id: _.in(batch) })
      .update({
        ownerId: newOwnerId,
        updatedAt: now
      });
  }
  
  return { success: true, processed: ids.length };
}

async function batchAddTags(ids, tags, userId) {
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = ids.slice(i, i + BATCH_LIMIT);
    
    await db.collection('Application')
      .where({ _id: _.in(batch) })
      .update({
        tags: _.addToSet(...tags)  // 数组去重追加
      });
  }
  
  return { success: true, processed: ids.length };
}

async function batchExportExcel(ids) {
  // 逐个拉取 + 组装 → 导出（不更新数据库）
  const apps = [];
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = ids.slice(i, i + BATCH_LIMIT);
    const result = await db.collection('Application')
      .where({ _id: _.in(batch) })
      .get();
    apps.push(...result.data);
  }
  
  return exportToExcel(apps); // 复用 services/export-excel.js
}
```

#### 7.13.5 操作记录

所有批量操作自动写入 `AuditLog`，记录操作类型、影响数量和操作人：

```javascript
await db.collection('AuditLog').add({
  action: 'batch_reject',
  entityType: 'application',
  entityIds: ids,
  detail: { endReason, count: ids.length },
  operator: userId,
  timestamp: new Date().toISOString()
});
```

#### 7.13.6 关键设计决策

| 决策 | 说明 |
|------|------|
| **单次上限 100 条** | 防止专员误全选几千条执行不可逆操作；超过 100 条分次执行 |
| **分批写入** | CloudBase `_.in(batch)` 批量更新，每批 100 条并行处理。⚠️ S7：CloudBase `_.in()` 通常有元素上限（100-500），`where(...).update(...)` 的多文档更新行为需在阶段 4 开发时验证——如果只更新第一条匹配文档，改为逐条执行或事务批量写入 |
| **不可逆操作二次确认** | 淘汰/放弃操作弹窗确认并标注"不可撤回"，防止误操作 |
| **移动阶段独立走 pipeline-engine** | 批量移动不绕开漏斗引擎，每个人独立检查是否需要回填 |
| **操作记录全部入 AuditLog** | 批量操作的审计记录包含完整的 ID 清单，可追溯可回滚 |

---

### 7.14 重复简历检测与信息同步 🆕

#### 7.14.1 业务场景

8 个专员各自负责不同岗位，同一个候选人可能通过多个渠道被多次录入：

| 场景 | 示例 |
|------|------|
| **专员 A 手动录入** | 专员 A 在招聘会收到纸质简历，手动录入张三 → 创建 Candidate + Application |
| **专员 B 邮箱归集** | 张三又通过 BOSS 直聘投了另一个岗位，邮件归集到专员 B 的邮箱 → 系统自动解析 |
| **专员 C 再次录入** | 张三换了手机号再次投递，专员 C 手动录入 |

> **核心诉求**：不阻止重复录入（每个专员的工作流程不受影响），但系统必须**检测出是同一个人**，并**同步信息给管理员**。数据各自保留，但关联关系清晰。

#### 7.14.2 检测策略（三级匹配）

```
录入/解析新简历时，自动执行三级重复检测：

┌──────────────────────────────────────────────────────┐
│  ① 文件级去重（MD5 Hash）                             │
│     同一份文件已录入过 → 直接跳过，不创建重复记录       │
│     ParseQueue.fileHash 查重                         │
│                                                      │
│  ② 强匹配（手机号 OR 邮箱）                           │
│     手机号完全相同 → 极高概率是同一个人                │
│     邮箱完全相同 → 极高概率是同一个人                  │
│     → 标记为"高度疑似重复"                            │
│                                                      │
│  ③ 弱匹配（姓名 + 多维度交叉验证）                    │
│     姓名相同 + 满足以下 ≥2 个条件：                     │
│       • 手机号后4位相同（DeepSeek 解析出的部分手机号）    │
│       • 最高学历 + 毕业院校相同                         │
│       • 最近公司相同                                    │
│       • 同名但维度都不匹配 → 不视为重复                  │
│     → 标记为"可能重复，需人工确认"                     │
│                                                      │
│  ④ 排除列表（管理员确认"不是同一个人"）                 │
│     管理员标记后加入 DuplicateExclusion 集合             │
│     后续相同匹配自动跳过，防止误判重复告警               │
└──────────────────────────────────────────────────────┘
```

> **为什么不阻止录入？** 招聘场景下，同一候选人投递不同岗位是正常行为（今天投 CC，下个月投 CR）。阻止录入 = 阻断正常招聘流程。检测 + 标记 = 让数据自己说话。

#### 7.14.3 数据模型

```javascript
// Candidate 新增字段（最小改动）
Candidate {
  // ... 现有字段全部不变 ...

  // 🆕 重复检测字段
  duplicateGroupId:  string | null,   // 重复组 ID（同一个人关联在一起）
  duplicateOf:       string | null,   // 指向第一个 Candidate._id（本人为 null，重复者为原始 ID）
  duplicateScore:    'high' | 'medium' | null,  // 匹配置信度
  duplicateCheckedAt: timestamp | null, // 检测时间
}
```

**重复组示意**：

```
duplicateGroupId: "dup_20260615_001"

  Candidate-A (原始)
  ├── duplicateOf: null          ← 第一个录入的，不是重复
  ├── createdBy: 专员A
  ├── phone: 13800138000
  │
  Candidate-B (重复)
  ├── duplicateOf: Candidate-A._id  ← 指向原始
  ├── duplicateScore: "high"
  ├── createdBy: 专员B
  ├── phone: 13800138000          ← 手机号相同
  │
  Candidate-C (重复)
  ├── duplicateOf: Candidate-A._id
  ├── duplicateScore: "medium"
  ├── createdBy: 专员C
  ├── phone: null                  ← 换了手机号
  ├── name: "张三"                ← 但姓名+公司相同
```

#### 7.14.4 录入时检测流程

```
专员录入/邮件解析简历
        │
        ▼
┌─────────────────────────────────────────────┐
│ ① 计算文件 MD5 → 查 ParseQueue.fileHash     │
│    匹配？→ 文件已存在，跳过（不重复入库）       │
│    未匹配 → 继续                             │
│                                              │
│ ② 提取手机号 + 邮箱 → 查 Candidate 集合       │
│    手机号匹配？→ duplicateScore = "high"      │
│    邮箱匹配？  → duplicateScore = "high"      │
│    都不匹配 → 继续                            │
│                                              │
│ ③ 查姓名 + 最近公司/学历                      │
│    姓名+公司匹配？→ duplicateScore = "medium" │
│    都不匹配 → 唯一候选人，正常创建              │
│                                              │
│ ④ 发现重复 →                                 │
│    ├── 创建新 Candidate 记录                  │
│    ├── 设置 duplicateOf = 原始 Candidate._id  │
│    ├── 设置 duplicateGroupId                  │
│    └── 创建新 Application（归属当前专员）       │
│                                              │
│ ⑤ 通知当前专员：                              │
│    "该候选人于 2026-05-20 由专员A 录入过       │
│     （CC岗）。系统已创建新的申请记录，          │
│     管理员将收到重复候选人通知。"               │
│                                              │
│ ⑥ 写入 ParseNotification 通知管理员：         │
│    "检测到重复候选人：张三（专员A 和 专员B      │
│     分别录入）。[查看对比]"                    │
└─────────────────────────────────────────────┘
```

#### 7.14.5 核心代码

```javascript
// services/duplicate-detector.js — 前端/云函数共用

const _ = require('lodash');  // 仅云函数环境

async function detectDuplicate(candidateData, db) {
  const { phone, email, name, highestDegree, lastCompany } = candidateData;
  
  // ─── ① 强匹配：手机号 ───
  if (phone) {
    const phoneMatch = await db.collection('Candidate')
      .where({ phone })
      .limit(1)
      .get();
    
    if (phoneMatch.data.length > 0) {
      return {
        isDuplicate: true,
        score: 'high',
        matchField: 'phone',
        original: phoneMatch.data[0]
      };
    }
  }
  
  // ─── ② 强匹配：邮箱 ───
  if (email) {
    const emailMatch = await db.collection('Candidate')
      .where({ email })
      .limit(1)
      .get();
    
    if (emailMatch.data.length > 0) {
      return {
        isDuplicate: true,
        score: 'high',
        matchField: 'email',
        original: emailMatch.data[0]
      };
    }
  }
  
  // ─── ③ 弱匹配：姓名 + 多维度交叉验证（需 ≥2 个维度匹配） ───
  if (name) {
    const nameMatches = await db.collection('Candidate')
      .where({ name })
      .limit(10)
      .get();
    
    for (const c of nameMatches.data) {
      // 先查排除列表：管理员已确认不是同一个人 → 跳过
      const excluded = await db.collection('DuplicateExclusion')
        .where({
          candidateA: c._id,
          candidateB: candidateData._id,  // 双向检查
        })
        .count();
      if (excluded.total > 0) continue;
      
      let matchCount = 0;
      
      // 维度1：手机号后4位相同（DeepSeek 解析可能只保留部分手机号）
      const phoneSuffix = phone?.slice(-4);
      const cPhoneSuffix = c.phone?.slice(-4);
      if (phoneSuffix && cPhoneSuffix && phoneSuffix === cPhoneSuffix) {
        matchCount++;
      }
      
      // 维度2：最高学历 + 毕业院校相同
      if (highestDegree && c.parsedData?.education?.[0]?.degree === highestDegree
          && lastSchool && c.parsedData?.education?.[0]?.school === lastSchool) {
        matchCount++;
      }
      
      // 维度3：最近公司相同
      if (lastCompany && c.parsedData?.work_experience?.[0]?.company === lastCompany) {
        matchCount++;
      }
      
      // 需要 ≥2 个维度同时匹配（单维度匹配在重名情况下误判率过高）
      if (matchCount >= 2) {
        return { isDuplicate: true, score: 'medium', matchField: `name+${matchCount}dim`, original: c };
      }
    }
  }
  
  // ─── ④ 无匹配 ───
  return { isDuplicate: false, score: null, matchField: null, original: null };
}

async function handleDuplicateCandidate(candidateData, userId, db) {
  const result = await detectDuplicate(candidateData, db);
  
  if (!result.isDuplicate) return null;  // 唯一候选人，正常流程
  
  // 生成重复组 ID
  const groupId = result.original.duplicateGroupId 
    || `dup_${Date.now()}_${result.original._id.slice(-6)}`;
  
  // 如果是第一个重复，给原始记录也打上组 ID
  if (!result.original.duplicateGroupId) {
    await db.collection('Candidate').doc(result.original._id).update({
      duplicateGroupId: groupId
    });
  }
  
  return {
    duplicateOf: result.original._id,
    duplicateGroupId: groupId,
    duplicateScore: result.score,
    duplicateMatchField: result.matchField,
    duplicateCheckedAt: new Date().toISOString(),
    originalOwner: result.original.createdBy,
    originalCreatedAt: result.original.createdAt
  };
}
```

#### 7.14.6 管理员查看重复候选人

**Dashboard "重复候选人"卡片（管理员可见）**：

```
┌──────────────────────────────────────────────────────┐
│  重复候选人                                   [查看全部]│
│                                                      │
│  🔴 高度疑似（手机号相同）— 2 组                        │
│                                                      │
│  张三 — 138****8000                                  │
│  ├─ 专员A · CC岗 · 录入于 2026-05-20 · 初试阶段      │
│  ├─ 专员B · CR岗 · 录入于 2026-06-10 · 简历阶段      │
│  └─ [查看对比]  [合并候选人]                          │
│                                                      │
│  李四 — li***@qq.com                                 │
│  ├─ 专员A · 讲师岗 · 录入于 2026-06-01 · 复试阶段     │
│  ├─ 专员C · 讲师岗 · 录入于 2026-06-12 · 简历阶段     │
│  └─ [查看对比]  [合并候选人]                          │
│                                                      │
│  🟡 可能重复（姓名+公司相同）— 1 组                     │
│                                                      │
│  王五 — 某某教育·教学主管                              │
│  ├─ 专员B · TMK岗 · 录入于 2026-04-15 · 已入职        │
│  ├─ 专员D · CC岗 · 录入于 2026-06-08 · 终试阶段       │
│  └─ [查看对比]  [这不是同一个人]                       │
└──────────────────────────────────────────────────────┘
```

**对比视图**（点击"查看对比"）：

```
┌──────────────────────────────────────────────────────┐
│  候选人重复对比                                        │
│                                                      │
│  ┌─────────────────┐  ┌─────────────────┐           │
│  │  记录 A（原始）   │  │  记录 B（重复）   │           │
│  ├─────────────────┤  ├─────────────────┤           │
│  │  姓名：张三      │  │  姓名：张三      │           │
│  │  手机：138xxx   │  │  手机：138xxx   │           │
│  │  录入人：专员A   │  │  录入人：专员B   │           │
│  │  录入时间：5/20  │  │  录入时间：6/10  │           │
│  │  岗位：CC岗     │  │  岗位：CR岗     │           │
│  │  状态：初试     │  │  状态：简历     │           │
│  │  解析来源：手动  │  │  解析来源：邮件  │           │
│  └─────────────────┘  └─────────────────┘           │
│                                                      │
│  [合并为一个候选人]  [保持独立]  [这不是同一个人]       │
└──────────────────────────────────────────────────────┘
```

#### 7.14.7 合并操作

管理员确认是同一个人后，可执行合并：

```
合并操作：
  ① 保留原始 Candidate-A（信息更全的那个）
  ② Candidate-B 的 Application 全部重新关联到 Candidate-A
  ③ Candidate-B 标记为 merged（软删除，不物理删除）
  ④ 合并 Candidate-A 的信息（补充 B 有而 A 没有的字段）
  ⑤ 写入 AuditLog: "管理员将 Candidate-B 合并入 Candidate-A"
```

#### 7.14.8 关键设计决策

| 决策 | 说明 |
|------|------|
| **不阻止重复录入** | 同一候选人投不同岗位是正常业务行为，检测但不阻断 |
| **三级匹配策略** | 手机/邮箱→强匹配；姓名+公司/学历→弱匹配；MD5→文件去重 |
| **Candidate 独立保留** | 每个专员创建的 Candidate 不自动合并，数据各自完整 |
| **管理员可见 + 可控** | 重复检测结果只在管理员 Dashboard 集中展示；管理员决定合并或保留 |
| **专员收到提醒但不阻塞** | 专员录入时收到"可能重复"提示，但不影响正常录入流程 |
| **合并可追溯** | 合并操作记录 AuditLog，保留原始 Candidate 的软删除记录 |

---

### 7.15 数据归档策略 🆕

#### 7.15.1 问题

新励成年均 30,000+ 份简历 → 每年产生 30,000+ 条 Application 记录。3 年后数据库中将有 90,000+ 条 Application，其中 90% 以上是已结束或入职超半年的"冷数据"。虽然报表聚合通过云函数 + 缓存缓解了前端性能，但云函数自身聚合时间随数据量线性增长——3 年后一次 18,000 条的全量聚合可能耗时 10-15 秒，接近云函数 30 秒超时边界。

#### 7.15.2 归档策略

| 状态 | 条件 | 操作 |
|------|------|------|
| **活跃** | `status: 'active'` 或结束 < 6 个月 | 正常参与看板 + 报表聚合 |
| **已归档** | 入职 > 6 个月 或 结束 > 12 个月 | `isArchived: true`，不参与日常报表，可搜索查看 |
| **物理删除** | 归档后 > 24 个月 + 管理员手动触发 | 从数据库中物理删除（执行前自动备份快照） |

#### 7.15.3 数据模型变更

```javascript
// Application 新增字段
Application {
  // ... 现有字段全部不变 ...
  isArchived:   false,       // 是否已归档（默认 false）
  archivedAt:   null,        // 归档时间
  archivedBy:   null,        // 归档触发者（'system' | userId）
}
```

#### 7.15.4 年度归档云函数

```javascript
// cloud-functions/archive-old-applications/index.js

const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init();
const db = app.database();
const _ = db.command;

exports.main = async (event, context) => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  
  // 条件：入职超过6个月 OR 结束超过12个月 → 归档
  const archiveCondition = _.or([
    { status: 'active', 'funnel.onboardAt': _.lte(sixMonthsAgo) },
    { status: _.in(['rejected', 'withdrawn']), endedAt: _.lte(twelveMonthsAgo) }
  ]);
  
  // 分批归档（每批 500 条，防止云函数超时）
  let archivedCount = 0;
  const BATCH_SIZE = 500;
  
  while (true) {
    const batch = await db.collection('Application')
      .where({ ...archiveCondition, isArchived: false })
      .limit(BATCH_SIZE)
      .get();
    
    if (batch.data.length === 0) break;
    
    const ids = batch.data.map(d => d._id);
    await db.collection('Application')
      .where({ _id: _.in(ids) })
      .update({
        isArchived: true,
        archivedAt: now,
        archivedBy: 'system'
      });
    
    archivedCount += ids.length;
  }
  
  return {
    success: true,
    archivedCount,
    timestamp: now.toISOString()
  };
};
```

#### 7.15.5 对现有模块的影响

| 模块 | 变更 |
|------|------|
| **报表聚合** | 云函数查询默认加 `isArchived: false` 过滤；历史报表可按需包含归档数据 |
| **看板管道** | 已归档的 Application 不出现在看板（`status !== 'active'` 已保证） |
| **候选人搜索** | 搜索结果包含已归档候选人，但标注"已归档"标签 |
| **管理员设置页** | 新增"数据归档"Tab → 显示归档统计 + 手动触发归档 + 物理清理 |
| **AuditLog** | 归档操作记录 `action: 'archive'`，物理删除记录 `action: 'purge'` |

#### 7.15.6 性能预期

| 时间 | Application 总量 | 活跃数据 | 聚合耗时（云函数） | 归档后聚合耗时 |
|------|-----------------|----------|-------------------|---------------|
| 第1年 | ~30,000 | ~5,000 | ~3s | ~0.5s |
| 第2年 | ~60,000 | ~6,000 | ~6s | ~0.6s |
| 第3年 | ~90,000 | ~7,000 | ~10s | ~0.7s |

> **归档后聚合耗时基本恒定**（只扫描活跃数据），不会随年份线性增长。

---

### 7.16 专员离职数据移交设计 🆕

#### 7.16.1 业务场景

8 个专员的团队，人员流动是必然的。如果专员 A 离职时手上有 40 个活跃候选人（分布在初试到 Offer 各阶段），没有系统化的移交流程会导致：
- 候选人被遗忘，流程停滞
- 接手专员重复联系（候选人体验差）
- 招聘结果受损

#### 7.16.2 移交流程

```
管理员在"专员管理"页 → 选择离职专员 → 点击"数据移交"
          │
          ▼
┌──────────────────────────────────────────┐
│  专员「张三」数据移交                      │
│                                          │
│  📊 数据概览：                            │
│     • 活跃候选人：42 人                   │
│       - 初试阶段：12 人                   │
│       - 复试阶段：8 人                    │
│       - Offer 阶段：3 人                  │
│     • 邮箱配置：boss@company.com          │
│                                          │
│  选择接手专员：[李四 ▼]                    │
│                                          │
│  [取消]  [预览移交清单]                    │
└──────────────────────────────────────────┘
          │
          ▼ 预览移交清单
┌──────────────────────────────────────────┐
│  即将移交以下数据给专员「李四」：           │
│                                          │
│  ✅ 42 个活跃候选人（显示名单）             │
│  ✅ 1,247 条历史候选人（只读）             │
│  ❌ 邮箱配置 → 自动停用                   │
│  ❌ 审批中的变更请求 → 不变               │
│                                          │
│  ⚠️ 此操作不可撤回                        │
│  [确认移交]  [取消]                       │
└──────────────────────────────────────────┘
          │
          ▼ 执行移交
┌──────────────────────────────────────────┐
│  ① 批量更新 Application.ownerId          │
│     所有 status='active' 的 Application   │
│     ownerId: 张三 → 李四                  │
│     每条追加 history 记录                  │
│                                          │
│  ② 批量更新 Candidate.createdBy（可读）   │
│     Candidate 保留原 createdBy，追加      │
│     transferredTo: 李四                   │
│                                          │
│  ③ 停用邮箱配置                           │
│     EmailConfig.enabled = false           │
│     + 追加说明："专员离职，已停用"          │
│                                          │
│  ④ 发送通知给接手专员                      │
│     ParseNotification:                    │
│     "管理员已将专员张三的 42 个活跃候选人   │
│      移交给你。其中 3 人处于 Offer 阶段，   │
│      8 人处于复试阶段，请尽快跟进。"        │
│                                          │
│  ⑤ 写入 AuditLog                         │
│     操作人、时间、移交范围全部留痕          │
└──────────────────────────────────────────┘
```

#### 7.16.3 核心代码

```javascript
// services/handover.js

async function handoverRecruiter(fromUserId, toUserId, adminId) {
  const now = new Date().toISOString();
  
  // ① 查询所有活跃 Application
  let allApps = [];
  let offset = 0;
  while (true) {
    const batch = await db.collection('Application')
      .where({ ownerId: fromUserId, status: 'active' })
      .skip(offset).limit(500)
      .get();
    allApps = allApps.concat(batch.data);
    if (batch.data.length < 500) break;
    offset += 500;
  }
  
  // 按阶段分组统计
  const byStage = {};
  for (const app of allApps) {
    byStage[app.stage] = (byStage[app.stage] || 0) + 1;
  }
  
  // ② 批量更新 ownerId + 追加 history
  for (let i = 0; i < allApps.length; i += 100) {
    const batch = allApps.slice(i, i + 100);
    const ids = batch.map(a => a._id);
    
    await db.collection('Application')
      .where({ _id: db.command.in(ids) })
      .update({
        ownerId: toUserId,
        updatedAt: now,
        history: db.command.push([{
          action: 'owner_transferred',
          from: fromUserId,
          to: toUserId,
          by: adminId,
          at: now
        }])
      });
  }
  
  // ③ 停用邮箱配置
  await db.collection('EmailConfig')
    .where({ userId: fromUserId, enabled: true })
    .update({
      enabled: false,
      updatedAt: now
    });
  
  // ④ 通知接手专员
  const stageSummary = Object.entries(byStage)
    .map(([stage, count]) => `${count}人处于${stage}阶段`)
    .join('，');
  
  await db.collection('ParseNotification').add({
    userId: toUserId,
    type: 'handover',
    title: `专员交接：${allApps.length} 个活跃候选人已移交给你`,
    detail: `管理员已完成交接。其中 ${stageSummary}。请尽快查看并跟进。`,
    status: 'unread',
    createdAt: now
  });
  
  // ⑤ 审计日志
  await db.collection('AuditLog').add({
    action: 'recruiter_handover',
    entityType: 'application',
    entityIds: allApps.map(a => a._id),
    detail: { from: fromUserId, to: toUserId, count: allApps.length, byStage },
    operator: adminId,
    timestamp: now
  });
  
  return { success: true, count: allApps.length, byStage };
}
```

#### 7.16.4 关键设计决策

| 决策 | 说明 |
|------|------|
| **仅移交活跃候选人** | 已结束的候选人保留在离职专员名下，接手专员可通过搜索查看（Candidate 可读） |
| **Candidate 不修改 createdBy** | 保留原始创建人信息，通过 transferredTo 字段记录移交关系 |
| **邮箱自动停用** | 离职专员的邮箱配置自动停用，防止继续扫描私人邮箱 |
| **通知接手专员** | 清晰告知移交流量和各阶段分布，帮助快速了解工作量 |
| **不可撤回** | 执行前二次确认，执行后 AuditLog 留痕，不可撤回但可再次移交 |

---

### 7.17 岗位招聘周期告警 🆕

#### 7.17.1 问题

现有超期预警只针对单个候选人的阶段停留时间（如"初试停留超过 7 天"），缺少岗位维度的整体周期监控。对于业务管理而言，更需要知道：某个岗位挂了 60 天还没招到人？某个 Offer 阶段有候选人停留了 15 天未接受？

#### 7.17.2 告警规则

| 告警 | 触发条件 | 级别 | 通知对象 |
|------|----------|------|---------|
| **岗位长期空缺** | `Job.status='active'` 且 `createdAt > 60天` 且 `onboardCount = 0` | 🟡 warning | 管理员 + 岗位所属专员 |
| **Offer 阶段卡单** | 有候选人处于 Offer 阶段且 `stageEnteredAt > 15天` | 🟡 warning | 岗位所属专员 |
| **岗位严重超期** | `Job.status='active'` 且 `createdAt > 90天` 且 `onboardCount = 0` | 🔴 critical | 管理员 |
| **初试大量积压** | 某岗位初试阶段候选人 > 20 人 | 🟡 warning | 岗位所属专员 |

#### 7.17.3 实现方式

告警逻辑集成在 `health-monitor` 云函数中，每 30 分钟检查一次：

```javascript
// cloud-functions/health-monitor/index.js — 新增岗位周期检查

async function checkJobCycleAlerts(db) {
  const alerts = [];
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

  // ① 岗位长期空缺检查
  const oldJobs = await db.collection('Job')
    .where({
      status: 'active',
      createdAt: db.command.lte(sixtyDaysAgo)
    })
    .get();

  for (const job of oldJobs.data) {
    // 检查是否有入职记录
    const onboarded = await db.collection('Application')
      .where({ jobId: job._id, 'funnel.onboardAt': db.command.exists(true) })
      .count();
    
    if (onboarded.total === 0) {
      const daysOpen = Math.floor((now - new Date(job.createdAt)) / 86400000);
      const severity = daysOpen > 90 ? 'critical' : 'warning';
      
      alerts.push({
        type: 'job_vacancy',
        jobId: job._id,
        jobTitle: job.title,
        daysOpen,
        severity,
        message: `岗位「${job.title}」已挂出 ${daysOpen} 天，尚无入职。建议评估招聘策略或岗位需求。`
      });
    }
  }

  // ② Offer 阶段卡单检查
  const stalledOffers = await db.collection('Application')
    .where({
      status: 'active',
      stage: 'offer',
      stageEnteredAt: db.command.lte(fifteenDaysAgo)
    })
    .get();

  for (const app of stalledOffers.data) {
    const daysInOffer = Math.floor((now - new Date(app.stageEnteredAt)) / 86400000);
    alerts.push({
      type: 'offer_stalled',
      applicationId: app._id,
      candidateId: app.candidateId,
      daysInOffer,
      severity: 'warning',
      message: `候选人在 Offer 阶段已停留 ${daysInOffer} 天，建议跟进确认意向。`
    });
  }

  // ③ 写入告警到 ErrorLog（复用监控体系）
  for (const alert of alerts) {
    await db.collection('ErrorLog').add({
      type: 'heartbeat',
      source: 'health-monitor',
      message: alert.message,
      context: alert,
      severity: alert.severity,
      createdAt: now
    });
  }

  return alerts;
}
```

#### 7.17.4 Dashboard 展示

管理员 Dashboard "系统状态"卡片中追加岗位周期告警：

```
┌──────────────────────────────────────────────┐
│  ⚠️ 岗位周期告警                              │
│                                              │
│  🔴 CC岗 已挂出 95 天，尚无入职               │
│  🟡 LTC负责人岗 已挂出 68 天，尚无入职         │
│  🟡 候选人张三（Offer）已停留 18 天未接受       │
└──────────────────────────────────────────────┘
```

#### 7.17.5 关键设计决策

| 决策 | 说明 |
|------|------|
| **集成到 health-monitor** | 不新建独立云函数，与现有心跳检查共用定时触发器 |
| **告警不弹窗** | 通过 Dashboard 卡片展示，不打断专员工作 |
| **阈值可配置** | 60天/90天/15天 阈值可在系统配置页修改 |
| **不自动操作** | 告警只提醒，不自动淘汰候选人或不自动关闭岗位 |

### 7.18 看板管道查询性能优化 🟡 S4

> **风险**：看板管道是高频实时视图——专员每次打开看板都查 `Application WHERE ownerId=X AND status='active'`，管理员全量看板可能有 3000-5000 条活跃 Application。8 个专员同时刷新时，CloudBase QPS 需验证。

**优化措施**：

| 措施 | 说明 |
|------|------|
| **复合索引** | Application 集合增加 `ownerId + status` 复合索引（升序），覆盖看板查询 |
| **本地缓存** | Pinia Store 中缓存看板数据，5 分钟过期。专员在 5 分钟内切换页面不重复查询 |
| **管理员分页** | 管理员全量看板初始每列只加载前 20 张卡片，滚动到底部触发"加载更多" |
| **乐观更新** | 拖拽后立即在前端更新卡片位置，后台异步写数据库（失败回滚 + 提示） |

> 数据库索引在阶段 4（看板管道开发）创建。本地缓存在 `useApplicationStore.js` 中实现。

### 7.19 候选人数据管理（PIPL 合规）🟡 S3

> **法律要求**：《个人信息保护法》赋予个人对其数据的**查阅权、复制权、删除权**。系统需支持候选人数据的统一导出和删除。

#### 7.19.1 数据留存策略

| 留存阶段 | 条件 | 处理方式 |
|----------|------|----------|
| **活跃期** | Application 未结束 或 入职 < 6 个月 | 正常使用，完整数据 |
| **观察期** | 拒绝/放弃后 0-24 个月 | 保留数据但不再参与日常查询（`isArchived: true`） |
| **匿名化期** | 拒绝/放弃后 > 24 个月 | 保留统计价值（阶段流转次数等），删除个人标识信息（姓名→"已匿名"、手机号→null、邮箱→null） |
| **入职留存** | 入职后保留至离职 + 6 个月 | 作为员工档案保留，之后同观察期 |

#### 7.19.2 数据导出

管理员在设置页（或候选人详情页）→ "导出候选人数据"：
- 按手机号/邮箱搜索候选人
- 预览关联数据范围（Candidate + Application + communicationLogs + 简历文件ID）
- 一键导出为 JSON（含所有关联数据）
- 写入 AuditLog

#### 7.19.3 数据删除

管理员在设置页 → "候选人数据管理" → 搜索 → "请求删除"：
- **软删除**（数据库）：Candidate + Application 标记 `deleted: true`，不物理删除
- **云存储**：简历文件移至 `resumes/deleted/` 目录，7天后自动清理
- **恢复窗口**：软删除后 30 天内可恢复
- 写入 AuditLog（记录操作人、时间、删除原因）

> **实现时机**：此功能在阶段 6（审批+AI助手+配置）中与系统配置页一起实现。

---

## 八、数据初始化策略

> ⚠️ **V18 已部署但未正式使用，无需数据迁移。V2 以全新系统启动。**

V2 启动时只需初始化以下基础数据：

| 数据 | 来源 | 方式 |
|------|------|------|
| 管理员账号 | 手动创建 | CloudBase 控制台或初始化脚本 |
| 专员账号 | 管理员在系统中添加 | 账号管理页面 |
| 部门/岗位/管道配置 | 复用 V18 的配置定义 | 从 `config/constants.js` 加载 |
| AI 配置 | 新创建 | 系统配置页 |

### 8.2 初始化脚本

```javascript
// scripts/init-db.js — 首次部署时运行一次
// 1. 创建 admin 用户
// 2. 写入默认配置（部门树、管道阶段、岗位列表）
// 3. 创建 CloudBase 集合索引
```

---

## 九、变更审批机制 🆕

### 9.1 设计初衷

招聘系统中存在两类高风险操作，需要管理员把关：

| 操作 | 风险 | 后果 |
|------|------|------|
| 专员修改/删除招聘需求 | 数据造假、误删记录 | 招聘决策依据失真，历史数据不可追溯 |
| 专员增删改系统配置（岗位/城市/部门） | 一人改错，全员受影响 | 所有账号的下拉选项同步出错，修复代价大 |

> **候选人操作（录入/拖拽/编辑）不需要审批。** 那是专员的日常工作，靠 `AuditLog` + `Application.history` 追溯就够。把每个候选人操作都审批会让管理员被淹死。

### 9.2 运行方式（通俗版）

> 专员可以**提**变更，但不能**生效**变更。只有管理员点"通过"，变更才真正写进数据库。就像服务员可以写菜单建议，菜单最终是老板拍板。

```
                    ┌──────────────────────┐
  专员操作           │   PendingChanges 表   │        管理员审核
  (不直接生效)       │   (暂存区)            │        (唯一能生效)
                    │                       │
  改需求截止日期 ──→ │  记录1: 改Job         │ ──→ 通过? → 写入 Job 表
  删一个岗位    ──→ │  记录2: 删岗位        │ ──→ 通过? → 写回 Config
  新增一个城市  ──→ │  记录3: 加城市        │ ──→ 通过? → 写回 Config
  改岗位职责    ──→ │  记录4: 改详情        │ ──→ 通过? → 写回 Config
                    │                       │
                    └──────────────────────┘
```

### 9.3 完整流程

```
① 专员操作（不生效）
   专员在系统里修改了某个招聘需求的截止日期
   → 系统弹出："你的修改已提交，等待管理员审核"
   → 专员自己看到的页面：数据还是旧的（暂不生效）
   → 其他专员看到的：也是旧的

② 管理员收到通知
   管理员打开审核页面，看到待审批列表：
   ┌─────────────────────────────────────────┐
   │  待审批变更                               │
   │                                          │
   │  📋 A专员 修改了 CC岗 的截止日期           │
   │     原值: 2026-06-30                     │
   │     新值: 2026-07-15                     │
   │     提交时间: 今天 15:00                  │
   │     [通过] [驳回]                         │
   │                                          │
   │  📋 B专员 申请新增岗位「新媒体运营」        │
   │     提交时间: 今天 14:30                  │
   │     [通过] [驳回]                         │
   └─────────────────────────────────────────┘

③ 管理员审核
   ├── 通过 → 系统自动写入正式数据，全员可见
   └── 驳回 → 撤销，专员收到通知"你的修改被驳回"
```

### 9.4 数据模型

```javascript
// CloudBase 集合：PendingChanges
PendingChanges {
  id,
  type:             'job' | 'config',        // 只审批这两类
  action:           'create' | 'update' | 'delete',
  entityType:       'job' | 'position' | 'department' | 'city' | 'channel',
  entityId:         string,                   // 被修改的实体 ID
  before:           { ... },                  // 变更前数据快照（用于对比）
  after:            { ... },                  // 变更后数据
  status:           'pending' | 'approved' | 'rejected',
  submittedBy:      userId,
  submittedAt:      timestamp,
  reviewedBy:       userId,                   // 审核人
  reviewedAt:       timestamp,
  reviewComment:    string                    // 驳回原因
}
```

### 9.5 权限控制

| 角色 | 可操作 |
|------|--------|
| **专员** | 提交变更（写入 PendingChanges），查看自己的提交记录 |
| **管理员** | 审批变更（通过/驳回），查看所有人的提交记录 |

> 管理员的操作**不需要审批**，直接生效。

### 9.6 为什么不审批候选人操作

| 对比维度 | Job/Config 变更 | 候选人操作 |
|----------|----------------|-----------|
| 操作频率 | 偶尔 | 每天数十次 |
| 影响范围 | 所有用户 | 单个候选人 |
| 误操作代价 | 高（全局污染） | 低（可修正） |
| 追溯方式 | 审批 | AuditLog + history |

> 候选人操作靠审计日志就够了，不需要审批拖慢工作节奏。

### 9.7 实施成本

| 组件 | 说明 |
|------|------|
| `PendingChanges` 集合 | CloudBase 文档数据库，1 个集合 |
| `usePendingChangeStore.js` | Pinia store：提交变更 + 列表查询 |
| `AdminReviewPage.vue` | 管理员审核页（列表 + 对比 + 通过/驳回） |
| 提交变更对话框 | 专员端的确认弹窗，展示变更内容 |

> 整个模块预计 **1 天**完成（含前后端），远轻于原计划的模糊"审批中心"。

### 9.8 Job 删除的级联处理策略 🆕

#### 9.8.1 问题

专员可以申请删除 Job（通过 PendingChanges 审批），但一个 Job 下可能已有大量 Application 记录。如果物理删除 Job，所有关联 Application 的 `jobId` 变成悬空引用（dangling reference），报表按岗位聚合时会丢失这些数据，破坏数据完整性。

#### 9.8.2 方案：软删除 + 级联标记

```
Job 删除流程（管理员审批通过后执行）：

① Job 执行软删除（设置 status: 'deleted'，不物理删除文档）
   ├── deletedAt = 当前时间
   ├── deletedBy = 审批管理员
   └── 原 status 快照到 previousStatus 字段

② 查询所有关联的活跃 Application
   └── db.collection('Application')
        .where({ jobId: deletedJob._id, status: 'active' })
        .get()

③ 对所有活跃 Application 执行级联操作：
   ├── status → 保持原值（专员需手动处理）
   ├── 追加 history 记录：
   │   { action: 'job_deleted', at: now, jobTitle: deletedJob.title }
   ├── originalJobId = jobId（快照原值，供历史报表追溯）
   └── jobTitle 快照到 application（原岗位名称保留）

④ 通知所有受影响的专员：
   └── ParseNotification 写入：
       "岗位「CC岗」已被管理员删除。你有 X 个活跃候选人在此岗位下，
        请手动将他们移动到其他岗位或标记结束。"

⑤ 写入 AuditLog：
   └── { action: 'job_soft_delete', jobId, affectedApplications: count }
```

#### 9.8.3 已删除岗位的显示策略

| 视图 | 行为 |
|------|------|
| **看板管道** | 不显示已删除岗位的列 |
| **候选人列表** | 关联已删除岗位的候选人正常显示，岗位名显示为"CC岗（已删除）" |
| **报表** | 已删除岗位的数据在历史报表中保留（按 `originalJobId` 聚合），当前报表默认过滤 |
| **管理员设置页** | "已归档岗位"列表中可见，支持恢复（改回 `status: 'active'`） |

#### 9.8.4 为什么是软删除而不是物理删除

| 维度 | 物理删除 | ✅ 软删除 |
|------|----------|-----------|
| **数据完整性** | Application.jobId 变悬空引用，报表崩溃 | 数据归属可追溯，报表按 originalJobId 聚合 |
| **可恢复性** | 误删不可恢复（即使有备份也需全量回滚） | 管理员可一键恢复岗位 |
| **审计追溯** | 消失的岗位无迹可寻 | AuditLog + Job 文档保留完整删除记录 |
| **实施复杂度** | 需级联处理数百条 Application | 仅改一个字段，Application 追加一条 history |

> **软删除岗位的物理清理**：系统运行 2-3 年后，如果已删除岗位的 Application 全部已结束且超过 24 个月，管理员可在"数据归档"页手动触发物理清理。这不是日常操作，也不自动化。

---

## 十、数据库安全规则设计 🆕

### 10.1 问题本质

> ⚠️ **CloudBase 匿名登录下，任何人拿到 `envId` 就能绕过前端直接读写数据库。** 当前设计只在前端代码里做了查询过滤，攻击者只需在浏览器 Console 中输入 `db.collection('Application').get()` 即可拉取全部数据。必须在 CloudBase 控制台配置**集合级权限规则**，在数据库层拦截未授权访问。

### 10.2 权限模型

系统有三种角色，安全规则基于 `auth.uid` 和文档 `ownerId` 控制：

| 角色 | 标识 | 权限级别 |
|------|------|----------|
| **管理员** | `role === 'admin'` | 全量读写所有集合 |
| **专员** | `role === 'recruiter'` | 读写自己的数据 + 读公共数据（Job/Config） |
| **系统（云函数）** | 服务端调用，绕过安全规则 | 全量读写（仅限云函数，前端不可达） |

### 10.3 集合级安全规则

> 📍 **部署位置**：CloudBase 控制台 → 数据库 → 集合 → 权限设置 → 自定义安全规则

#### Application 集合（核心数据，最严格）

```json
{
  "read": "auth.uid != null && (doc.ownerId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')",
  "write": "auth.uid != null && (doc.ownerId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')"
}
```

> **规则说明**：专员只能读写自己（`ownerId`）的 Application；管理员可读写全部。`get()` 函数跨集合查 Users 表确认角色。

#### Candidate 集合

```json
{
  "read": "auth.uid != null",
  "write": "auth.uid != null && (doc.createdBy == auth.uid || get('database.Users.' + auth.uid).role == 'admin')"
}
```

> **规则说明**：所有登录用户可查看候选人基本信息（便于跨岗位协作和重复检测）；但**写权限严格限制**：专员只能修改自己创建的 Candidate 记录，管理员可修改全部。防止专员 A 修改/覆盖专员 B 搜集的候选人信息。

> ⚠️ **数据脱敏要求**：前端查询 Candidate 列表时，对非本人创建的 Candidate，手机号中间4位、邮箱@前3位做脱敏处理（如 `138****8000`、`abc***@qq.com`）。仅在用户进入详情页且为本人创建或管理员时展示完整信息。符合《个人信息保护法》数据最小化原则。

#### Job 集合（公共配置级保护）

```json
{
  "read": "auth.uid != null",
  "create": "get('database.Users.' + auth.uid).role == 'admin'",
  "update": "get('database.Users.' + auth.uid).role == 'admin'",
  "delete": false
}
```

> **规则说明**：所有人可读（看板/报表需要）；仅管理员可增删改（配合第九章的 PendingChanges 审批流）。`delete: false` 禁止前端物理删除——Job 删除必须通过云函数执行软删除（`status: 'deleted'`），详见 §9.8。专员通过提交 PendingChanges 间接修改。

#### Users 集合

```json
{
  "read": "auth.uid != null && (doc._openid == auth.uid || get('database.Users.' + auth.uid).role == 'admin')",
  "write": "get('database.Users.' + auth.uid).role == 'admin'"
}
```

> **规则说明**：用户只能读自己的信息；仅管理员可增删改用户。`_openid` 是 CloudBase 匿名登录自动生成的用户标识。

#### EmailConfig 集合（高敏感）

```json
{
  "read": "auth.uid != null && doc.userId == auth.uid",
  "write": "auth.uid != null && doc.userId == auth.uid"
}
```

> **规则说明**：邮箱密码加密存储，专员只能读写自己的邮箱配置。管理员通过云函数管理所有邮箱。

#### PendingChanges 集合

```json
{
  "read": "auth.uid != null",
  "create": "auth.uid != null",
  "update": "get('database.Users.' + auth.uid).role == 'admin'",
  "delete": "get('database.Users.' + auth.uid).role == 'admin'"
}
```

> **规则说明**：所有人可查看审批列表、提交变更；仅管理员可审批（update status）或删除。

#### AuditLog 集合（只读）

```json
{
  "read": "get('database.Users.' + auth.uid).role == 'admin'",
  "write": false
}
```

> **规则说明**：审计日志仅管理员可查看，前端不可写入（写入由云函数/后端 SDK 完成）。

#### ReportCache 集合（只读）

```json
{
  "read": "auth.uid != null",
  "write": false
}
```

> **规则说明**：缓存数据所有人可读，仅云函数可写。

#### ParseQueue 集合

```json
{
  "read": "auth.uid != null",
  "write": false
}
```

> **规则说明**：解析队列前端只读，写入由 email-scanner 云函数完成。

#### ErrorLog 集合（详见第十二章监控告警）

```json
{
  "read": "get('database.Users.' + auth.uid).role == 'admin'",
  "write": "auth.uid != null"
}
```

> **规则说明**：所有人可上报错误；仅管理员可查看。

### 10.4 安全规则测试矩阵

| 测试场景 | 专员A | 专员B | 管理员 | 未登录 |
|----------|-------|-------|--------|--------|
| 读取自己的 Application | ✅ | ✅ | ✅ | ❌ |
| 读取别人的 Application | ❌ | ❌ | ✅ | ❌ |
| 修改别人的 Application | ❌ | ❌ | ✅ | ❌ |
| 直接修改 Job | ❌ | ❌ | ✅ | ❌ |
| 读取所有 Job | ✅ | ✅ | ✅ | ❌ |
| 读取所有 Candidate | ✅ | ✅ | ✅ | ❌ |
| 修改自己创建的 Candidate | ✅ | ✅ | ✅ | ❌ |
| 修改别人创建的 Candidate | ❌ | ❌ | ✅ | ❌ |
| 读取 AuditLog | ❌ | ❌ | ✅ | ❌ |
| 读取 ReportCache | ✅ | ✅ | ✅ | ❌ |
| 直接写 AuditLog | ❌ | ❌ | ❌ | ❌ |

### 10.5 云函数特权

云函数通过 `@cloudbase/node-sdk` 的 `admin SDK` 方式初始化，**绕过安全规则**，拥有全量读写权限：

```javascript
// cloud-functions/*/index.js 中的初始化方式
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({
  env: 'your-env-id'
  // 云函数环境自动注入管理员权限，无需配置 secret
});
const db = app.database();
// db 拥有全部集合的完整读写权限，不受安全规则限制
```

> ⚠️ **关键**：云函数初始化使用 `@cloudbase/node-sdk`（非前端 `@cloudbase/js-sdk`），自动获得管理员级数据库权限。前端 js-sdk 受安全规则约束。这是 CloudBase 的权限边界设计。

### 10.6 关键设计决策

| 决策 | 说明 |
|------|------|
| **前端 js-sdk 受限，云函数 node-sdk 不受限** | CloudBase 原生能力，前端请求受安全规则检查，云函数请求绕过规则 |
| **Application 按 ownerId 隔离** | 专员只能看自己的候选人，管理员看全部 |
| **Job 前端只读** | 变更必须走 PendingChanges 审批流，配合第九章两层写入 |
| **AuditLog/ReportCache/ParseQueue 前端只读或不可写** | 敏感数据和缓存数据只能由云函数写入 |
| **Users 表基于 _openid 识别** | 匿名登录的唯一标识，防止用户冒用 |

### 10.7 ⚠️ `get()` 跨集合查询的循环依赖验证 🔴 B3 阻塞项

> **风险发现**（专家审查第4回）：上述安全规则中大量使用了 `get('database.Users.' + auth.uid).role` 来做跨集合角色查询。此设计存在两个风险，**必须在阶段 1 部署安全规则后立即验证**。

#### 10.7.1 风险分析

| 风险 | 描述 | 最坏后果 |
|------|------|----------|
| **循环依赖** | Application 规则依赖 Users 集合 → Users 集合的 read 规则是 `_openid == auth.uid \|\| admin` → 如果安全规则引擎不是以特权模式执行 `get()`，则普通专员无法通过 Users 的 read 检查 → Application 权限检查失败 | 全部专员读写被拒绝，系统不可用 |
| **性能瓶颈** | 每次 Application/Candidate/Job 读写触发一次 Users 查询。看板拖拽、批量操作等高频场景下，安全规则层 `get()` 调用可能成为瓶颈 | 看板拖拽响应变慢，批量操作超时 |

#### 10.7.2 验证步骤（阶段 1 必须执行）

```
① 在 CloudBase 控制台部署 §10.3 的安全规则
② 使用专员账号登录，打开浏览器 Console
③ 执行 db.collection('Application').where({ownerId: 'self'}).get()
   → 确认能正常返回自己的数据
④ 执行 db.collection('Application').get()（不带 where）
   → 确认返回空或仅自己的数据（非全量）
⑤ 执行 db.collection('Job').get()
   → 确认所有专员能正常读取 Job 列表
```

> **验证通过标准**：专员能读写自己的数据、管理员能读写全部、专员不能读写他人数据。如果验证失败 → 立即切换到备用方案。

#### 10.7.3 备用方案：自定义登录 auth ticket 注入角色

如果 CloudBase 安全规则引擎的 `get()` 受目标集合规则限制，改用自定义登录方案：

```javascript
// 新增云函数：cloud-functions/auth-proxy/index.js
// 登录时生成带角色的 auth ticket，将 role 注入 auth.custom
exports.main = async (event, context) => {
  const { userId, password } = event;
  const user = await db.collection('Users').doc(userId).get();
  
  // CloudBase 自定义登录 ticket，将 role 注入
  const ticket = cloudbase.auth().createTicket(userId, {
    refresh: 3600 * 1000,
    custom: { role: user.data.role }  // ← role 随 auth 一起下发
  });
  return { ticket };
};

// 安全规则改为直接读 auth.custom.role（无需跨集合 get()）：
{
  "read": "auth.uid != null && (doc.ownerId == auth.uid || auth.custom.role == 'admin')",
  "write": "auth.uid != null && (doc.ownerId == auth.uid || auth.custom.role == 'admin')"
}
```

> **决策**：优先使用 §10.3 的 `get()` 方案（更简单，无需额外云函数）。阶段 1 验证后如果失败则切到备用方案。备用方案新增一个 `auth-proxy` 云函数（约 50 行，1-2 小时工作量）。

### 10.8 ⚠️ 云存储访问控制 🟡 S2

> **风险发现**：§10.3 的 10 条安全规则仅覆盖数据库集合，**未覆盖云存储**。邮件附件简历上传后生成的 `fileID` 如果被其他登录用户知晓，可通过 CloudBase SDK 直接下载他人的简历文件（含全部个人隐私——手机号、邮箱、工作经历等）。

#### 10.8.1 存储分区策略

```
cloudbase云存储/
├── resumes/                       # 简历文件（私有，按 ownerId 分区）
│   ├── {ownerId}/                 # 每个专员一个子目录
│   │   ├── {hash}_{filename}      # MD5去重后的文件名
│   │   └── ...
│   └── unowned/                   # 邮件扫描归集的简历（扫描专员为 owner）
├── backups/                       # 数据库备份（仅管理员/云函数可访问）
│   ├── daily/
│   ├── weekly/
│   └── manual/
└── public/                        # 公开文件（logo等）
```

#### 10.8.2 访问控制实现

```javascript
// 上传时按 ownerId 分区存储
const cloudPath = `resumes/${ownerId}/${hash}_${filename}`;
await cloudbase.uploadFile({ cloudPath, fileContent: buffer });

// 下载时通过云函数代理（检查权限后返回临时下载链接）
// cloud-functions/resume-download-proxy/index.js
exports.main = async (event, context) => {
  const { fileID } = event;
  const { userInfo } = context;
  
  // 从 fileID 中解析 ownerId
  const ownerId = fileID.split('/')[1];  // resumes/{ownerId}/...
  
  // 权限检查：只有文件 owner 或 admin 可下载
  if (userInfo.uid !== ownerId && userInfo.custom.role !== 'admin') {
    return { success: false, error: '无权下载此文件' };
  }
  
  // 生成临时下载链接（有效期 5 分钟）
  const result = await cloudbase.getTempFileURL({
    fileList: [fileID],
    maxAge: 300  // 5分钟
  });
  
  return { success: true, url: result.fileList[0].tempFileURL };
};
```

#### 10.8.3 关键决策

| 决策 | 说明 |
|------|------|
| **按 ownerId 分区** | 简历文件路径含专员 ID，方便权限判断和批量清理 |
| **下载走云函数代理** | 不直接暴露 fileID，云函数检查权限后返回临时链接（5分钟有效） |
| **云存储安全规则兜底** | CloudBase 控制台配置云存储安全规则：`resumes/{ownerId}/**` 仅 `auth.uid == ownerId` 或管理员可读 |

---

## 十一、数据库自动备份设计 🆕

### 11.1 问题本质

> ⚠️ **CloudBase 文档数据库无自动备份功能。** 数据误删（专员选错批量淘汰）、云函数 Bug 导致数据损坏、恶意操作——这些场景下如果没有备份，数据永久丢失不可恢复。

### 11.2 备份策略（三级）

| 级别 | 方式 | 频率 | 保留 |
|------|------|------|------|
| **每日全量备份** | 云函数导出所有集合 → 存云存储 | 每天凌晨 3:00 | 最近 30 天 |
| **每周归档备份** | 同全量备份，单独目录 | 每周日 | 最近 12 周 |
| **手动备份** | 管理员在系统设置页一键触发 | 按需 | 永久保留（手动管理） |

### 11.3 云函数实现

```javascript
// cloud-functions/db-backup/index.js

const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init();
const db = app.database();

// 需要备份的集合列表
const COLLECTIONS = [
  'Application', 'Candidate', 'Job', 'Users',
  'EmailConfig', 'PendingChanges', 'AuditLog',
  'ParseQueue', 'ReportCache', 'ErrorLog'
];

exports.main = async (event, context) => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];     // 2026-06-15
  const hourStr = String(now.getHours()).padStart(2, '0');
  const timestamp = `${dateStr}_${hourStr}00`;
  
  // 确定备份类型（每日 / 每周 / 手动）
  const backupType = event.type || 'daily';  // 'daily' | 'weekly' | 'manual'
  const folder = backupType === 'weekly'
    ? `backups/weekly/${dateStr}`
    : backupType === 'manual'
      ? `backups/manual/${timestamp}`
      : `backups/daily/${dateStr}`;

  const results = [];
  const BATCH_SIZE = 1000;

  for (const collectionName of COLLECTIONS) {
    try {
      // 分批拉取集合全部数据
      let allDocs = [];
      let offset = 0;
      
      while (true) {
        const batch = await db.collection(collectionName)
          .skip(offset)
          .limit(BATCH_SIZE)
          .get();
        
        allDocs = allDocs.concat(batch.data);
        if (batch.data.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }

      // 序列化为 JSON，上传到云存储
      const jsonContent = JSON.stringify(allDocs, null, 2);
      const buffer = Buffer.from(jsonContent, 'utf-8');
      
      const uploadResult = await app.uploadFile({
        cloudPath: `${folder}/${collectionName}.json`,
        fileContent: buffer
      });

      results.push({
        collection: collectionName,
        count: allDocs.length,
        fileId: uploadResult.fileID,
        size: buffer.length
      });
    } catch (error) {
      // 备份失败记录到 ErrorLog，不中断其他集合的备份
      await db.collection('ErrorLog').add({
        type: 'cloudFunction',
        source: 'db-backup',
        message: `备份 ${collectionName} 失败: ${error.message}`,
        stack: error.stack,
        severity: 'critical',
        createdAt: new Date()
      });
      
      results.push({
        collection: collectionName,
        error: error.message
      });
    }
  }

  // 清理过期备份（30 天前的每日备份）
  if (backupType === 'daily') {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oldDateStr = thirtyDaysAgo.toISOString().split('T')[0];
    
    try {
      const deleteResult = await app.deleteFile({
        fileList: [`backups/daily/${oldDateStr}/`]
      });
      // 注意：CloudBase 批量删除文件需要逐个指定 fileID
      // 实际部署时通过 listFiles + deleteFile 组合实现
    } catch (e) {
      // 过期文件可能已被手动清理，忽略错误
    }
  }

  return {
    success: true,
    backupType,
    timestamp: now.toISOString(),
    folder,
    totalCollections: COLLECTIONS.length,
    results
  };
};
```

### 11.4 数据恢复流程

```
紧急恢复场景：专员误操作淘汰了 50 个候选人
          │
          ▼
┌──────────────────────────────────────────┐
│ ① 管理员打开系统设置页 → "数据恢复"       │
│                                          │
│ ② 选择恢复日期：2026-06-14（昨天备份）    │
│    → 系统下载云存储中的备份文件              │
│    → 展示预览：Application 集合有 1,247 条  │
│                                          │
│ ③ 选择恢复方式：                          │
│    ○ 查看对比（只读，先看再决定）            │
│    ○ 恢复指定文档（按 ID 恢复部分数据）       │
│    ○ 全量回滚（⚠ 覆盖当前全部数据）          │
│                                          │
│ ④ 确认 → 写入数据库 → 记录 AuditLog       │
│    操作人、时间、恢复范围全部留痕             │
└──────────────────────────────────────────┘
```

> ⚠️ **恢复不是一键覆盖。** 全量回滚前系统会先做一次"恢复前快照"（手动备份），确保即使恢复出错也能回退。

### 11.5 成本估算

| 项目 | 估算 |
|------|------|
| 每日备份数据量 | ~5-20 MB（取决于 Application 数量） |
| 云存储占用（30天） | ~150-600 MB |
| 云函数执行时间 | ~30-60 秒/天 |
| **费用** | **¥0/月**（全部在免费额度内） |

### 11.6 关键设计决策

| 决策 | 说明 |
|------|------|
| **三级备份策略** | 每日保留 30 天 + 每周保留 12 周 + 手动永久保留，覆盖从误操作到灾难恢复的所有场景 |
| **全量导出 JSON** | 简单可靠，恢复无需依赖任何特殊工具，任何能读 JSON 的环境都能恢复 |
| **备份失败不中断** | 单个集合导出失败记录 ErrorLog 继续下一个，不因一个集合的问题丢失全部备份 |
| **恢复前快照** | 每次恢复操作前先做一次手动备份，确保可回退 |
| **过期自动清理** | 30 天前的备份自动删除，控制存储成本 |

---

## 十二、监控告警体系设计 🆕

### 12.1 问题本质

> ⚠️ **当前设计零监控。** 云函数执行失败、邮件扫描停止、DeepSeek API 余额耗尽——系统停了没人知道，直到专员发现"怎么好几天没收新简历了"。招聘系统一旦停摆，候选人流失无法挽回。

### 12.2 监控架构

```
┌──────────────────────────────────────────────────────────┐
│                    监控告警体系                             │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  health-monitor 云函数（每 30 分钟自动触发）        │   │
│  │                                                    │   │
│  │  ① 心跳检查：调 email-scanner/report-aggregator   │   │
│  │     确认所有云函数可正常响应                         │   │
│  │                                                    │   │
│  │  ② API 余额检查：调 DeepSeek API / 腾讯云 OCR      │   │
│  │     确认 API Key 有效 + 余额充足                    │   │
│  │                                                    │   │
│  │  ③ 错误统计：查 ErrorLog 最近 1 小时的错误数         │   │
│  │     超过阈值 → 标记告警                             │   │
│  │                                                    │   │
│  │  ④ 扫描延迟检查：查 EmailConfig.lastScanAt          │   │
│  │     超过 30 分钟未扫描 → 邮件归集可能停了             │   │
│  │                                                    │   │
│  │  ⑤ 写入 HeartbeatLog，更新管理员仪表盘               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ErrorLog 集合 — 所有异常统一写入                    │   │
│  │                                                    │   │
│  │  来源：云函数 try/catch | 前端全局错误捕获           │   │
│  │        | API 调用超时 | 数据校验失败                 │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  管理员仪表盘 — 实时状态面板                         │   │
│  │                                                    │   │
│  │  🟢 云函数正常  🟢 DeepSeek API  🟢 邮件扫描       │   │
│  │  📊 今日解析: 23份  ⚠️ 今日错误: 2次               │   │
│  │  💰 DeepSeek 余额: ¥48.50                          │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 12.3 云函数实现

```javascript
// cloud-functions/health-monitor/index.js

const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init();
const db = app.database();

exports.main = async (event, context) => {
  const now = new Date();
  const status = {
    timestamp: now.toISOString(),
    cloudFunctions: {},
    apis: {},
    errorStats: {},
    scanStatus: {},
    overall: 'healthy'  // 'healthy' | 'degraded' | 'critical'
  };

  // ─── ① 心跳检查：调用其他云函数确认可用 ───
  const functionChecks = [
    { name: 'report-aggregator', testData: { type: 'overview', filters: {} } },
    { name: 'resume-parser-proxy', testData: { resumeText: 'ping', systemPrompt: 'reply ok' } }
  ];

  for (const fn of functionChecks) {
    try {
      const result = await app.callFunction({
        name: fn.name,
        data: fn.testData
      });
      status.cloudFunctions[fn.name] = {
        status: 'ok',
        latency: Date.now() - now.getTime() + 'ms'
      };
    } catch (error) {
      status.cloudFunctions[fn.name] = {
        status: 'error',
        message: error.message
      };
      status.overall = 'degraded';
      
      await db.collection('ErrorLog').add({
        type: 'heartbeat',
        source: 'health-monitor',
        message: `云函数 ${fn.name} 心跳失败: ${error.message}`,
        severity: status.overall === 'critical' ? 'critical' : 'warning',
        createdAt: now
      });
    }
  }

  // ─── ② DeepSeek API 余额检查 ───
  try {
    // DeepSeek API 不提供直接余额查询接口
    // 通过发一个最小请求（1 token）来验证 Key 有效 + 不被限流
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      })
    });
    
    if (response.ok) {
      status.apis.deepseek = { status: 'ok' };
    } else if (response.status === 402) {
      status.apis.deepseek = { status: 'error', message: '余额不足' };
      status.overall = 'critical';
    } else {
      status.apis.deepseek = { status: 'error', message: `HTTP ${response.status}` };
    }
  } catch (error) {
    status.apis.deepseek = { status: 'error', message: error.message };
    status.overall = 'degraded';
  }

  // ─── ③ 错误统计（最近 1 小时） ───
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recentErrors = await db.collection('ErrorLog')
    .where({
      createdAt: db.command.gte(oneHourAgo),
      severity: db.command.in(['critical', 'warning'])
    })
    .count();
  
  status.errorStats = {
    recentErrors: recentErrors.total,
    threshold: 10,
    alert: recentErrors.total > 10
  };
  
  if (recentErrors.total > 10) {
    status.overall = status.overall === 'healthy' ? 'degraded' : status.overall;
  }

  // ─── ④ 邮件扫描延迟检查 ───
  const emailConfigs = await db.collection('EmailConfig')
    .where({ enabled: true })
    .get();
  
  let stalledScanners = 0;
  for (const config of emailConfigs.data) {
    const lastScan = new Date(config.lastScanAt || 0);
    const minutesSinceLastScan = (now - lastScan) / 60000;
    
    if (minutesSinceLastScan > 30) {
      stalledScanners++;
    }
  }
  
  status.scanStatus = {
    totalEnabled: emailConfigs.data.length,
    stalled: stalledScanners,
    alert: stalledScanners > 0
  };
  
  if (stalledScanners > 0) {
    status.overall = 'degraded';
  }

  // ─── ⑤ 写入心跳记录 ───
  await db.collection('HeartbeatLog').add({
    timestamp: now,
    overall: status.overall,
    details: status
  });

  return status;
};
```

### 12.4 前端全局错误捕获

```javascript
// main.js — Vue 3 全局错误处理

import { createApp } from 'vue';
import cloudbase from './services/cloudbase.js';

const app = createApp(App);

// Vue 级错误捕获
app.config.errorHandler = async (err, instance, info) => {
  console.error('前端错误:', err);
  
  // 异步写入 ErrorLog（不阻塞 UI）
  try {
    await cloudbase.database().collection('ErrorLog').add({
      type: 'client',
      source: 'frontend',
      message: err.message,
      stack: err.stack,
      context: {
        component: instance?.$options?.name || 'unknown',
        info,
        url: window.location.href,
        userAgent: navigator.userAgent
      },
      severity: 'warning',
      createdAt: new Date()
    });
  } catch (e) {
    // ErrorLog 写入失败也不能阻塞用户，静默处理
  }
};

// 未捕获的 Promise 错误
window.addEventListener('unhandledrejection', (event) => {
  cloudbase.database().collection('ErrorLog').add({
    type: 'client',
    source: 'frontend',
    message: `Unhandled Promise: ${event.reason?.message || event.reason}`,
    stack: event.reason?.stack,
    severity: 'warning',
    createdAt: new Date()
  }).catch(() => {});
});

app.mount('#app');
```

### 12.5 管理员监控仪表盘

在 DashboardPage 中增加一个"系统状态"卡片（仅管理员可见）：

```
┌──────────────────────────────────────────────┐
│  系统状态                          [刷新]      │
│                                              │
│  🟢 所有系统正常                              │
│                                              │
│  云函数状态            API 状态               │
│  ├─ report-aggregator  🟢 正常              │
│  ├─ email-scanner      🟢 正常              │
│  ├─ db-backup          🟢 正常              │
│  └─ health-monitor     🟢 正常              │
│                                              │
│  API 余额                                   │
│  ├─ DeepSeek    🟢 ¥48.50 余额              │
│  └─ 腾讯云OCR   🟢 正常                      │
│                                              │
│  邮件扫描                                   │
│  ├─ 已配置: 5 个邮箱                         │
│  └─ 上次扫描: 2 分钟前                       │
│                                              │
│  📊 今日解析: 23 份                          │
│  ⚠️ 今日错误: 2 次                   [查看]  │
│  📦 上次备份: 2026-06-15 03:00 ✅           │
└──────────────────────────────────────────────┘
```

### 12.6 告警通知

| 级别 | 触发条件 | 通知方式 |
|------|----------|----------|
| **Critical** | DeepSeek 余额耗尽 / 全部云函数不可用 | 管理员登录时 Dashboard 红色横幅 + 浏览器 Notification |
| **Warning** | 单云函数异常 / 邮件扫描停滞 | 管理员 Dashboard 黄色提示 |
| **Info** | 备份失败 / 单次 API 超时 | 静默写入 ErrorLog，不出弹窗 |

> **设计原则**：不引入短信/邮件/钉钉等外部队列通知（增加复杂度和成本）。利用管理员每天必看的 Dashboard 作为唯一的告警通道。V2.1 如有需要再接入企业微信通知。

### 12.7 关键设计决策

| 决策 | 说明 |
|------|------|
| **Dashboard 即告警中心** | 不做独立告警系统，管理员每天打开 Dashboard 就能看到系统状态 |
| **心跳 30 分钟间隔** | 平衡及时性和云函数调用成本 |
| **ErrorLog 写入不阻塞** | 前端错误捕获异步写入，失败静默处理 |
| **DeepSeek 余额主动探测** | DeepSeek 无余额查询 API，通过发最小请求（1 token）验证 |
| **不引入外部队列通知** | V2 阶段靠 Dashboard 告警，V2.1 按需接入企业微信 |

---

## 十三、多环境部署策略 🆕

### 13.1 问题本质

> ⚠️ **当前设计只有一套 CloudBase 环境。** 开发和测试直接在正式环境操作——误删数据、云函数 Bug、配置错误都会直接冲击生产系统。必须拆分 dev/prod 双环境，开发测试在 dev 环境，确认无误后再部署到 prod。

### 13.2 双环境架构

```
┌──────────────────────────────────────────────────────┐
│                  CloudBase 控制台                       │
│                                                      │
│  ┌─────────────────────────┐  ┌───────────────────┐ │
│  │  recruit-dev (开发环境)   │  │  recruit-prod     │ │
│  │                         │  │  (正式环境)        │ │
│  │  • 文档数据库（测试数据）  │  │  • 文档数据库      │ │
│  │  • 云存储（测试文件）     │  │  • 云存储（正式文件）│ │
│  │  • 云函数（dev版本）      │  │  • 云函数（prod版） │ │
│  │  • 静态托管 dev.xxx.com  │  │  • 静态托管 x.com  │ │
│  │  • 匿名登录（测试用）     │  │  • 匿名登录（正式） │ │
│  └─────────────────────────┘  └───────────────────┘ │
│         ▲                          ▲                 │
│         │ 开发/测试                 │ 正式使用          │
│         │                          │                 │
│    开发人员                    专员/管理员             │
└──────────────────────────────────────────────────────┘
```

### 13.3 环境变量配置

```javascript
// src/config/env.js — 根据域名自动切换环境

const ENV_CONFIG = {
  // 开发环境（本地开发 localhost + dev 子域名）
  dev: {
    envId: 'recruit-dev-xxxxx',        // CloudBase 环境 ID
    deepSeekFunction: 'resume-parser-proxy-dev',
    reportFunction: 'report-aggregator-dev',
    logLevel: 'debug',
    features: {
      emailScanner: true,
      aiChat: true,
      batchOps: true
    }
  },
  // 正式环境
  prod: {
    envId: 'recruit-prod-xxxxx',       // CloudBase 环境 ID（不同于 dev）
    deepSeekFunction: 'resume-parser-proxy',
    reportFunction: 'report-aggregator',
    logLevel: 'error',                  // 只记录错误
    features: {
      emailScanner: true,
      aiChat: true,
      batchOps: true
    }
  }
};

// 自动检测：localhost 或包含 dev 的域名 → dev 环境
function detectEnv() {
  const host = window.location.hostname;
  if (host === 'localhost' || host.includes('127.0.0.1') || host.startsWith('dev.')) {
    return 'dev';
  }
  return 'prod';
}

const currentEnv = detectEnv();
export const envConfig = ENV_CONFIG[currentEnv];
export const isDev = currentEnv === 'dev';
export const isProd = currentEnv === 'prod';
```

### 13.4 CloudBase SDK 初始化（支持多环境）

```javascript
// services/cloudbase.js

import cloudbase from '@cloudbase/js-sdk';
import { envConfig, isDev } from '@/config/env.js';

const app = cloudbase.init({
  env: envConfig.envId,
  region: 'ap-guangzhou'
});

// 开发环境在 Console 打印环境标识，防止误操作
if (isDev) {
  console.log(
    `%c🔧 当前环境：开发环境 (${envConfig.envId})%c\n操作不会影响正式数据`,
    'background: #f90; color: #000; padding: 4px 8px; font-size: 14px;',
    ''
  );
}

export default app;
```

### 13.5 部署流水线

```
代码提交 → 部署流程
                │
    ┌───────────┴───────────┐
    ▼                       ▼
  dev 环境                prod 环境
  (自动部署)              (手动触发)
    │                       │
    │ ① git push →          │ ① 确认 dev 测试通过
    │ ② Vite build          │ ② 手动触发 prod 部署
    │    --mode development  │    --mode production
    │ ③ 部署到 dev 静态托管   │ ③ 部署到 prod 静态托管
    │ ④ 部署 dev 云函数      │ ④ 部署 prod 云函数
    │ ⑤ 在 dev 环境冒烟测试  │ ⑤ 监控 30 分钟确认无异常
    │                       │ ⑥ 标记本次部署版本号
```

> **原则**：dev 环境允许自动部署（提高开发效率）；prod 环境必须手动触发 + 冒烟测试通过后部署。

### 13.6 环境间数据隔离

| 操作 | dev 环境 | prod 环境 |
|------|----------|-----------|
| 数据库读写 | 测试数据，可随意增删改 | 正式数据，受安全规则保护 |
| 邮箱扫描 | 可配置测试邮箱 | 专员真实邮箱 |
| DeepSeek API | 使用独立的测试 API Key（额度小） | 正式 API Key |
| 简历解析 | 解析结果存入 dev 数据库 | 解析结果存入 prod 数据库 |
| 管理后台操作 | 无影响 | 真实生效 |

### 13.7 部署回滚方案

```
紧急回滚场景：prod 部署后发现严重 Bug
          │
          ▼
┌──────────────────────────────────────────┐
│ ① CloudBase 静态托管 → 版本管理          │
│    选择上一个正常版本 → 一键回滚          │
│    （CloudBase 自动保留最近 10 个版本）    │
│                                          │
│ ② 云函数 → 版本管理                      │
│    选择上一个正常版本的函数代码 → 回滚     │
│    （CloudBase 自动保留最近 10 个版本）    │
│                                          │
│ ③ 数据库 → 无需回滚                      │
│    前端静态资源回滚不影响数据              │
│    如云函数 Bug 导致脏数据 → 从备份恢复    │
│    （参考第十一章数据库备份）              │
│                                          │
│ ④ 验证回滚成功 → 记录 AuditLog           │
└──────────────────────────────────────────┘
```

> CloudBase 静态托管和云函数都自带版本管理，回滚只需在控制台点击"回滚到上一版本"。

### 13.8 关键设计决策

| 决策 | 说明 |
|------|------|
| **dev/prod 双环境** | 最低成本的环境隔离，无需额外付费（两个环境都在免费额度内） |
| **域名自动检测** | `localhost` / `dev.` 前缀 → dev；其余 → prod。不依赖手动改代码切换 |
| **dev 自动部署，prod 手动触发** | 开发效率与生产安全的平衡 |
| **CloudBase 自带版本回滚** | 不自己造回滚方案，利用平台能力 |

---

## 十四、用户体验与适配设计 🆕

### 14.1 空状态设计

> ⚠️ **当前设计假设系统已有数据。** 首次部署后，所有页面都是空的——看板无卡片、列表无数据、图表无曲线。没有空状态引导，用户面对白屏不知道从哪开始。

#### 14.1.1 各页面空状态

**看板管道（空）**：
```
┌──────────────────────────────────────────────────┐
│                                                  │
│              📋 还没有候选人                       │
│                                                  │
│        上传第一份简历或配置邮箱自动归集              │
│        简历将自动出现在看板管道中                   │
│                                                  │
│         [📤 上传简历]    [📧 配置邮箱]             │
│                                                  │
└──────────────────────────────────────────────────┘
```

**候选人列表（空）**：
```
┌──────────────────────────────────────────────────┐
│                                                  │
│              👤 还没有候选人记录                    │
│                                                  │
│    上传简历后，解析出的候选人信息将显示在这里          │
│                                                  │
│              [📤 上传第一份简历]                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

**数据分析（空）**：
```
┌──────────────────────────────────────────────────┐
│                                                  │
│              📊 还没有足够的数据                    │
│                                                  │
│    至少需要 5 个候选人进入流程后，                    │
│    漏斗图和趋势图才会生成                           │
│                                                  │
│         当前进度：0/5 候选人                       │
│                                                  │
└──────────────────────────────────────────────────┘
```

**招聘需求（空）**：
```
┌──────────────────────────────────────────────────┐
│                                                  │
│              📌 还没有招聘需求                      │
│                                                  │
│    创建第一个招聘需求，开始您的招聘流程               │
│                                                  │
│         [➕ 创建招聘需求]                          │
│                                                  │
└──────────────────────────────────────────────────┘
```

#### 14.1.2 空状态组件设计

```vue
<!-- components/common/EmptyState.vue -->

<template>
  <div class="empty-state">
    <div class="empty-state__icon">{{ icon }}</div>
    <h3 class="empty-state__title">{{ title }}</h3>
    <p class="empty-state__description">{{ description }}</p>
    <div class="empty-state__actions" v-if="$slots.actions">
      <slot name="actions" />
    </div>
    <div class="empty-state__footer" v-if="footer">
      {{ footer }}
    </div>
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: '📋' },
  title: { type: String, required: true },
  description: { type: String, required: true },
  footer: { type: String, default: '' }
});
</script>
```

#### 14.1.3 首次配置向导

新系统首次打开时，展示 3 步引导：

```
┌──────────────────────────────────────────────────┐
│  🎉 欢迎使用新励成招聘管理系统！                     │
│                                                  │
│  让我们完成 3 个步骤，开始高效招聘：                  │
│                                                  │
│  ┌─────┐     ┌─────┐     ┌─────┐                │
│  │ ①   │ ──→ │ ②   │ ──→ │ ③   │                │
│  │ 创建 │     │ 配置 │     │ 导入 │                │
│  │ 岗位 │     │ 邮箱 │     │ 简历 │                │
│  └─────┘     └─────┘     └─────┘                │
│                                                  │
│  步骤 1/3：创建第一个招聘需求                       │
│  ┌────────────────────────────────────────────┐  │
│  │  岗位名称：[___________]                     │  │
│  │  所属部门：[请选择 ▼]                        │  │
│  │  招聘人数：[___]                             │  │
│  │  面试轮次：○ 2轮  ○ 3轮                     │  │
│  │                                            │  │
│  │  [跳过，稍后设置]    [下一步 →]              │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  💡 所有步骤都可以跳过，随时在设置中补全             │
└──────────────────────────────────────────────────┘
```

> **设计原则**：向导**可跳过**、**可分步完成**。不强制用户一次性配完。管理员在"设置→新手向导"中可随时重新打开。

### 14.2 移动端适配策略

#### 14.2.1 问题

看板（Kanban）是水平滚动的多列布局，在手机屏幕上体验极差——左右滑动看板列和浏览器前进后退手势冲突，卡片信息被压缩到看不清。

#### 14.2.2 解决方案：自动视图切换

```
屏幕宽度 ≥ 768px（桌面/平板横屏）：
  → 看板模式（多列水平滚动）
  → 列表模式（用户可手动切换）

屏幕宽度 < 768px（手机/平板竖屏）：
  → 自动切换为列表模式
  → 隐藏"看板"切换按钮
  → 列表每行显示：姓名 + 岗位 + 当前阶段 + 停留天数
  → 点击进入详情页，详情页内可拖拽切换阶段（用下拉选择替代拖拽）
```

#### 14.2.3 实现方式

```javascript
// composables/useResponsive.js

import { ref, onMounted, onUnmounted } from 'vue';

export function useResponsive() {
  const isMobile = ref(false);
  const viewMode = ref('kanban');  // 'kanban' | 'list'

  function checkScreen() {
    const wasMobile = isMobile.value;
    isMobile.value = window.innerWidth < 768;
    
    // 从桌面切到手机 → 自动切列表
    if (!wasMobile && isMobile.value && viewMode.value === 'kanban') {
      viewMode.value = 'list';
    }
    // 从手机切回桌面 → 恢复看板
    if (wasMobile && !isMobile.value) {
      viewMode.value = 'kanban';
    }
  }

  onMounted(() => {
    checkScreen();
    window.addEventListener('resize', checkScreen);
  });

  onUnmounted(() => {
    window.removeEventListener('resize', checkScreen);
  });

  return { isMobile, viewMode };
}
```

#### 14.2.4 移动端列表卡片设计

```
┌────────────────────────────────────┐
│  张三              CC岗 · 初试      │
│  📅 停留 3 天    ⚠️ 即将超期        │
│  🏷️ 急招 内推                      │
├────────────────────────────────────┤
│  李四              CR岗 · 复试      │
│  📅 停留 1 天                      │
│  🏷️ —                             │
├────────────────────────────────────┤
│  王五              讲师岗 · 邀约     │
│  📅 停留 7 天    🔴 已超期          │
│  🏷️ —                             │
└────────────────────────────────────┘

点击卡片 → 进入详情页（全屏）
详情页底部：固定操作栏
  [上一步▼] [下一步▼] [淘汰] [放弃] [···]
```

#### 14.2.5 移动端其他适配

| 页面 | 桌面端 | 移动端 |
|------|--------|--------|
| 看板管道 | SortableJS 拖拽多列 | 列表 + 详情页下拉切换阶段 |
| Dashboard | 4 列统计卡片 | 2 列网格 |
| 数据分析 | 图表并排 | 图表纵向堆叠，可滑动 |
| 批量操作 | 复选框 + 底部操作栏 | 长按选中 + 底部弹出操作栏 |
| 简历上传 | 拖拽区域 | 点击上传（调用手机文件选择器） |
| 侧边栏 | 始终展开 | 汉堡菜单，滑出覆盖层 |

### 14.3 关键设计决策

| 决策 | 说明 |
|------|------|
| **空状态不是空白页** | 每个空页面提供明确的操作引导，降低首次使用门槛 |
| **首次配置向导可跳过** | 不强制，降低新用户上手压力 |
| **移动端自动切列表** | `window.innerWidth < 768px` 自动切换，用户无感知 |
| **移动端不准拖拽** | 用手势冲突不可避免，用下拉选择替代 |
| **详情页全屏** | 移动端卡片点击进入全屏详情，利用全部屏幕空间 |
| **不引入 PWA/离线** | V2 阶段不做离线支持，需要网络连接（用户在办公室使用） |

### 14.3 桌面端键盘快捷键 🆕

看板拖拽在桌面端是核心交互，但高频操作（淘汰、移动阶段）使用右键菜单效率偏低。为熟练用户提供键盘快捷键，提升日常操作速度。

#### 快捷键映射

| 快捷键 | 操作 | 说明 |
|--------|------|------|
| `Space` | 快速查看候选人详情 | 选中卡片后按空格弹出详情面板 |
| `Ctrl/Cmd + →` | 移动到下一阶段 | 进入下一个漏斗节点 |
| `Ctrl/Cmd + ←` | 移动到上一阶段 | 回退到上一个漏斗节点 |
| `E` | 淘汰候选人 | 弹出淘汰对话框（选择原因） |
| `W` | 标记放弃 | 弹出放弃对话框（选择原因） |
| `A` | 标记为已确认面试 | 快捷标记 `inviteConfirmed` |
| `Esc` | 关闭弹窗/取消选择 | 关闭当前对话框或取消卡片选中 |
| `?` | 显示快捷键帮助 | 弹出快捷键速查表 |

#### 实现方式

```javascript
// composables/useKeyboardShortcuts.js

import { onMounted, onUnmounted } from 'vue';

const SHORTCUTS = {
  'Space':       { action: 'openDetail',     label: '查看详情' },
  'ArrowRight':  { action: 'moveForward',    label: '下一阶段',  ctrl: true },
  'ArrowLeft':   { action: 'moveBackward',   label: '上一阶段',  ctrl: true },
  'KeyE':        { action: 'reject',         label: '淘汰' },
  'KeyW':        { action: 'withdraw',       label: '放弃' },
  'KeyA':        { action: 'confirmInvite',  label: '确认面试' },
  'Escape':      { action: 'closePanel',     label: '关闭' },
  'Slash':       { action: 'showHelp',       label: '快捷键帮助', shift: true },
};

export function useKeyboardShortcuts(callbacks) {
  function handleKeydown(e) {
    // 不在输入框内响应快捷键
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    for (const [key, def] of Object.entries(SHORTCUTS)) {
      const code = e.code || e.key;
      const needCtrl = def.ctrl && !(e.ctrlKey || e.metaKey);
      const needShift = def.shift && !e.shiftKey;
      
      if (code === key && !needCtrl && !needShift) {
        e.preventDefault();
        if (callbacks[def.action]) callbacks[def.action]();
        return;
      }
    }
  }
  
  onMounted(() => window.addEventListener('keydown', handleKeydown));
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
}
```

#### 关键设计决策

| 决策 | 说明 |
|------|------|
| **不拦截输入框** | 在 input/textarea 内正常输入，不触发快捷键 |
| **Ctrl/Cmd 双键支持** | 阶段移动需按 Ctrl（Windows）或 Cmd（Mac）+ 方向键，防止误触 |
| **首次使用引导** | 首次进入看板页时，右下角弹出"💡 试试键盘快捷键？按 ? 查看"提示 |
| **? 弹出速查表** | 任何时候按 `?` 弹出快捷键浮层，列出所有快捷键 |

---

## 十五、实施计划

### 阶段 1：基础设施 + 登录布局（2 天）
- [ ] 初始化 Vue 3 + Vite 项目，配置 Pinia、Vue Router
- [ ] 搭建 CloudBase SDK 封装层（`services/cloudbase.js`）
- [ ] 创建 CloudBase 集合和索引（含 EmailConfig、ParseQueue 🆕）
- [ ] 🆕 配置数据库安全规则（10条集合级权限，防止数据库裸奔）
- [ ] ⚠️ 🔴 B3：验证安全规则 `get()` 跨集合查询是否可用（按 §10.7.2 步骤测试；失败则切到 auth-proxy 备用方案）
- [ ] 🆕 部署 `db-backup` 云函数 + 每日凌晨 3:00 定时触发器
- [ ] 🆕 部署 `health-monitor` 云函数 + 每 30 分钟定时触发器
- [ ] 注册腾讯云 OCR API Key；在 CloudBase 控制台配置云函数环境变量 `DEEPSEEK_API_KEY`
- [ ] 复制你现有的 CSS 变量体系
- [ ] 登录页 + 角色选择 + 侧边栏导航 + 权限路由守卫
- [ ] 🆕 前端全局错误捕获（main.js → ErrorLog 集合）

> 🎯 **里程碑**：管理员能登录，看到完整的空壳子框架。备份和监控已在后台运行。

### 阶段 2：简历录入 + 解析（2-3 天）⭐ 风险前置
- [ ] 文件上传组件（ResumeUploader.vue，保留拖拽+粘贴）
- [ ] 实现 `services/resume-parser.js`（PDF.js + 腾讯云OCR + **调云函数**解析）
- [ ] 🆕 编写 `cloud-functions/resume-parser-proxy/` 云函数（持有 DeepSeek API Key，前端不可见）
- [ ] 🆕 在 CloudBase 控制台配置云函数环境变量 `DEEPSEEK_API_KEY`
- [ ] 解析结果预览 + 手动修正（ParseResultView.vue）
- [ ] 候选人信息录入表单（CandidateForm.vue）
- [ ] 解析置信度标记（高/中/低，用户可知哪些字段需核查）
- [ ] 每日解析计数器（成本监控）
- [ ] 🆕 重复简历检测逻辑（`services/duplicate-detector.js`：文件Hash/手机邮箱/姓名+公司 三级匹配）
- [ ] 🆕 重复检测通知（专员录入时的提示 + 管理员 Dashboard 重复候选人卡片）

> 🎯 **里程碑**：上传简历 → 云函数代理解析 → 返回结构化JSON → 存入 CloudBase。核心链路跑通，API Key 零泄露。重复简历自动检测。

### 阶段 3：邮箱自动归集（2 天）🆕
- [ ] 🆕 编写 `cloud-functions/email-scanner/format-router.js`（15 种格式自动识别+分发+压缩包递归处理）
- [ ] 编写 `cloud-functions/email-scanner/` 云函数（IMAP 连接 + 附件下载 + 去重）
- [ ] 🆕 编写 `cloud-functions/parse-queue-processor/` 云函数（消费 ParseQueue → 文本提取 → 调 resume-parser-proxy → 创建 Candidate + Application → 通知专员，含指数退避重试）
- [ ] 实现 `services/email-scanner.js` 前端配置管理
- [ ] 邮箱配置页（EmailConfigPage.vue）—— 选择邮箱类型、输入账号+授权码、启用/停用
- [ ] 部署云函数 + 定时触发器（每 10 分钟）+ 🆕 **parse-queue-processor 云函数 + 定时触发器（每 5 分钟）**
- [ ] 编写邮箱配置的 AES-256-GCM + PBKDF2 加密存储
- [ ] 🆕 解析结果通知机制（ParseNotification 集合 + 通知写入逻辑 + 日报摘要生成）

> 🎯 **里程碑**：专员配好QQ邮箱 → email-scanner 自动收取简历 → ParseQueue → parse-queue-processor 自动消费解析 → Candidate 自动创建 → 通知专员。邮件→候选人的全链路闭环。

### 阶段 4：数据模型 + 看板管道 + 漏斗引擎 + 批量操作 + 聚合层（5-7 天）⭐ 核心交互
- [ ] 实现 Store 层（Candidate/Job/Application）—— Application 包含 funnel 字段 🆕
- [ ] CloudBase CRUD 封装（读/写/更新/删除，含 _version 乐观锁，Application 文档级原子更新）
- [ ] 🆕 管道流转引擎（pipeline-engine.js）：
  - 漏斗序列定义（getFullFunnelSequence）
  - 跳阶段自动回填（findMissingStages + applyBackfill → 更新 Application.funnel）
  - 数据一致性校验（validateFunnelIntegrity → 读取 Application.funnel）
  - 按岗位差异化面试轮次（读取 Job.interviewRounds）
  - ⚠️ Application.stage 与 Application.funnel 原子化同步（同一文档更新，杜绝双轨）
- [ ] 🆕 CloudBase 数据库索引创建（Application: jobId+status+funnel, Job: department+status）
- [ ] KanbanBoard.vue（SortableJS 拖拽 + 按岗位动态显示/隐藏列）
- [ ] CandidateCard.vue（卡片：姓名/岗位/停留天数/预警标识）
- [ ] 🆕 阶段切换确认对话框（自动检测回填需求 + 展示回填预览）
- [ ] 🆕 候选人结束状态操作（看板右键菜单：淘汰/放弃 → 选择预设原因 → 移出看板）
- [ ] 🆕 "已结束"候选人列表（CandidateList 中增加 Tab：活跃/已淘汰/已放弃，可重新激活）
- [ ] 🆕 候选人详情页"沟通记录"Tab（新增记录弹窗：方式+方向+摘要+结论+下次跟进时间）
- [ ] 🆕 批量操作引擎（services/batch-operations.js + 看板勾选 + 底部操作栏 + 10种批量操作）
- [ ] V2 先做"在线优先"：网络断开时提示"A当前离线，操作无法保存"；离线能力推迟到 V2.1

> 🎯 **里程碑**：拖拽变换阶段 → 自动回填缺失节点 → 数据完整入库。

### 阶段 5：工作台 + 数据分析（2-3 天）
- [ ] Dashboard 统计卡片 + 🆕 "待跟进"提醒卡片（自动拉取超期未跟进的候选人）
- [ ] 🆕 编写 cloud-functions/report-aggregator 云函数（聚合查询：按岗位/部门/趋势/总览）
- [ ] 🆕 编写 cloud-functions/report-cache-warmer 云函数（每日凌晨自动预热）
- [ ] 🆕 部署聚合云函数 + 预热定时触发器
- [ ] 🆕 漏斗图（12节点转化率可视化 + 按岗位切换，数据来自云函数聚合结果 <10KB）
- [ ] 趋势图（按时间维度的漏斗转化趋势）
- [ ] 招聘需求概览
- [ ] 数据分析页（所有图表通过云函数拿数据，不直查数据库）
- [ ] 🆕 漏斗报表（services/funnel-report.js → 调云函数 → 拿聚合结果 → 前端只做渲染，含淘汰率+放弃率）
- [ ] 报表导出（Excel/CSV/Word）

> 🎯 **里程碑**：大数据量下报表秒出（云函数聚合+缓存，前端只收精简结果）。

### 阶段 6：审批 + AI助手 + 知识库 + 配置（3 天）🆕
- [ ] 🆕 变更审批（轻量两层写入）：
  - PendingChanges 集合 + usePendingChangeStore
  - 专员端提交变更对话框（展示变更内容 → 确认提交）
  - 管理员审核页 AdminReviewPage（列表 + 变更前后对比 + 通过/驳回）
  - 审批通过后自动写入 Job/Config 正式表
  - ⚠️ 仅审批 Job 和 Config，不审批候选人操作
- [ ] 🆕 公司知识库与 RAG 系统：
  - CompanyProfile 集合 + 设置页"公司信息"Tab（含 changeLog 自动记录）
  - KnowledgeBase 集合 + 设置页"知识库"Tab（列表/搜索/分类/编辑/审核/归档）
  - RecruitmentInsight 集合 + 设置页"历史洞察"Tab
  - AI 助手 RAG 检索增强生成流程（意图识别 → 知识检索 → 组装 Prompt → 生成）
  - `web-search-agent` 云函数（AI 网络搜索 → draft 条目 → 管理员审核）
  - 知识反馈闭环（用户采纳→useCount+1，用户修改→提示沉淀）
- [ ] 历史数据导入：
  - 导入向导页 /import（文件上传 → 列映射 → 预览 → 去重策略 → 导入）
  - 预置列映射模板（BOSS直聘/智联/猎聘）
  - 导入完成后自动触发历史洞察计算
- [ ] 系统配置页（含岗位周期告警阈值配置等）
- [ ] BOSS 数据导入（独立于历史导入，走 BOSS 直聘 API）

### 阶段 7：测试 + 部署（3 天）
- [ ] 单元测试（pipeline-engine / matching-engine / store / email-scanner 🆕）
- [ ] 端到端测试（录入→管道流转→入职→报表）
- [ ] 初始化脚本（管理员账号 + 默认配置写入 CloudBase）
- [ ] 部署上线（Vite build → CloudBase 静态托管 + 云函数部署 🆕）

### 阶段 8：文档 + 归档（1 天）
- [ ] 用户操作手册（含看板模式新用户引导说明 + 邮箱配置指南 🆕）
- [ ] 变更日志
- [ ] 沉淀到知识库

> **预估总计**：22-28 个工作日（阶段 4 核心交互占比最大 5-7 天；阶段 6 新增知识库+RAG+历史数据导入 +1天；阶段 2/3 增加云函数部署和 IMAP 调试时间；阶段 7 增加多环境部署和冒烟测试）

---

## 十六、关键设计决策记录

| # | 决策 | 选项 A | 选项 B | 选择 | 理由 |
|----|------|--------|--------|------|------|
| 1 | 前端框架 | vanilla JS | **Vue 3** | ✅ Vue 3 | 看板拖拽+组件复用，vanilla 手写成本过高 |
| 2 | 数据主源 | localStorage | **CloudBase** | ✅ CloudBase | V18 的 localStorage 为主源是同步 bug 的根源 |
| 3 | 简历解析 | 浏览器端 Tesseract | **DeepSeek + 腾讯云OCR** | ✅ API组合 | 中文OCR 70%→95%，提取准确率 50%→85%，零服务器 |
| 3.1 | API Key 安全 | 前端直调 DeepSeek，Key 打包进 dist/ | **云函数代理（resume-parser-proxy）** | ✅ 云函数代理 | API Key 仅存云函数环境变量，前端代码/git/打包产物中不可见；Key 轮换无需重新部署 |
| 4 | 数据模型 | 扁平 Candidate | **Candidate↔Application↔Job** | ✅ 三层 | 同一候选人可投多岗，需求驱动管道 |
| 5 | 管道交互 | 列表+下拉 | **看板拖拽** | ✅ 看板 | 参考 Lever，行业标准交互 |
| 6 | 冲突解决 | 手写1100行合并逻辑 | **CloudBase 服务端时间戳+版本号** | ✅ 服务端 | 不依赖客户端时钟，代码从1100行→50行 |
| 7 | 邮箱归集 | 手动下载上传 | **CloudBase SCF + IMAP 自动扫描** | ✅ 云函数 | IMAP 协议通用性强；基于 BOSS直聘邮件特征过滤；每月 ¥0 |
| 8 | 漏斗数据模型 | 无漏斗概念 | **Application.funnel 嵌入式存储（单一真相来源）** | ✅ 嵌入式漏斗 | 废除独立 CandidateFunnel，stage 与 funnel 原子化更新，参考 Greenhouse/Lever 标准 |
| 9 | 变更审批 | 无管控机制 | **PendingChanges 两层写入（专员提交→管理员审核）** | ✅ 轻量审批 | 仅审批 Job 和 Config 的增删改；候选人操作靠 AuditLog 追溯，不审批 |
| 10 | 报表聚合 | 前端直查数据库，大数据量卡死浏览器 | **云函数聚合 + ReportCache 预计算** | ✅ 三层缓存 | 报表全部通过云函数在服务端聚合；高频报表凌晨预热；前端只收 <10KB 统计结果 |
| 11 | 结束状态 | 无淘汰/放弃标记，历史数据丢失 | **Application.status + endStage + endReason 预设选项** | ✅ 二分类预设 | rejected（公司淘汰5选项）和 withdrawn（候选人放弃8选项），精确记录结束节点，可重新激活 |
| 12 | 沟通记录 | 专员沟通无留痕，人多久忘 | **Application.communicationLogs[] 嵌入数组** | ✅ 轻量记录 | 5种沟通方式+方向标注+可选跟进时间，仪表盘"待跟进"卡片自动提醒 |
| 13 | 批量操作 | 高频重复操作只能一个一个点，效率低 | **10种批量操作 + 选中浮现操作栏** | ✅ 批量引擎 | 单次上限100条，分批写入；移动走pipeline-engine，淘汰走二次确认，全部入AuditLog |
| 14 | 数据库安全 | 匿名登录下数据库裸奔，任何人都可读写 | **集合级安全规则（10条）+ §10.7 get()循环依赖验证** | ✅ 权限矩阵 + 备用方案已准备 | Application 按 ownerId 隔离；Job 前端只读；AuditLog 仅管理员可读；云函数绕过规则全量读写 |
| 15 | 数据库备份 | CloudBase 无自动备份，误删不可恢复 | **db-backup 云函数（三级策略）** | ✅ 三级备份 | 每日全量(30天)+每周归档(12周)+手动永久；全量导出JSON存云存储；恢复前先快照 |
| 16 | 监控告警 | 系统停摆无人知晓 | **health-monitor 云函数 + ErrorLog 集合 + Dashboard 面板** | ✅ Dashboard即告警中心 | 每30分钟心跳检查+API余额探测+错误统计；前端全局错误捕获；不引入外部队列通知 |
| 17 | 多环境部署 | 开发测试直接操作生产数据 | **dev/prod 双环境 + 域名自动检测** | ✅ 双环境隔离 | dev 自动部署、prod 手动触发；CloudBase 自带版本回滚；两套独立环境均在免费额度内 |
| 18 | IMAP 密码加密 | AES 密钥明文存环境变量 | **PBKDF2 派生密钥 + 双变量隔离** | ✅ 派生密钥方案 | 100,000 次迭代 SHA-256 派生；MASTER_SECRET 和 SALT 分离存放；支持在线密钥轮换 |
| 19 | 空状态设计 | 首次打开全是空白页，用户不知从哪开始 | **空状态引导 + 3步配置向导** | ✅ 空状态即引导 | 每个空页面提供操作入口；向导可跳过可分步；随时可在设置中重新打开 |
| 20 | 移动端适配 | 看板在手机上体验差 | **自动视图切换（<768px → 列表）** | ✅ 响应式降级 | 移动端拖拽改下拉选择；详情页全屏；不上 PWA/离线 |
| 21 | 邮件附件格式 | 只支持 PDF/Word/图片，其他格式丢失 | **15种格式全覆盖（含 RTF/HTML/压缩包/Pages）** | ✅ 全格式路由 | format-router.js 按 MIME+扩展名自动分发；压缩包递归解压；不支持的格式通知专员 |
| 22 | 解析结果通知 | 后台静默解析，专员不知道结果 | **ParseNotification 通知 + Dashboard 卡片 + 日报摘要** | ✅ 不弹窗通知 | 成功/失败分别通知；红点徽章；每日9:00日报；30天自动清理 |
| 23 | 重复简历检测 | 专员A和B分别录入同一人，数据孤岛 | **三级匹配（文件Hash/手机邮箱/姓名+公司）+ 重复组 + 管理员合并** | ✅ 检测不阻断 | 不阻止重复录入；管理员Dashboard集中展示；支持合并或标记"不是同一个人" |
| 24 | 已确认面试节点 🆕 | 邀约→初试之间缺少"候选人已确认参加"的状态，邀约转化率被低估 | **增加 inviteConfirmedAt 可选漏斗节点** | ✅ 可选节点 | 专员手动标记；回填时自动填充；报表新增"邀约确认率"指标；不强制使用，不影响正常流转 |
| 25 | Job 删除级联处理 🆕 | 物理删除 Job 导致 Application.jobId 变悬空引用，报表数据完整性被破坏 | **软删除（status:'deleted'）+ 关联 Application 标记 + 管理员恢复** | ✅ 软删除 | 禁止物理删除；关联 Application 保存 originalJobId；已删除岗位在报表中保留历史数据；支持一键恢复 |
| 26 | 🆕 知识库存储方式 | CloudBase 文档数据库 | 独立向量数据库（Pinecone/Milvus） | ✅ CloudBase 文档数据库 | KnowledgeBase 条目数 <1000，关键词+标签匹配足够；免费额度远超需求；避免引入新基础设施 |
| 27 | 🆕 AI 网络搜索写入策略 | 搜索后直接 published | draft + sourceVerified=false + 管理员审核 | ✅ draft + 审核 | AI 搜来的信息可能不准/过时/有偏见；人工审核是知识质量的守门员 |
| 28 | 🆕 知识检索方式 | 关键词+标签匹配 | 向量语义检索（Embedding） | ✅ 关键词+标签 | 条目数小无需向量检索；未来条目增长到 5000+ 可升级；关键词匹配成本为零 |
| 29 | 🆕 CompanyProfile 存储模型 | 单例文档 | 多版本存储（历史记录表） | ✅ 单例 + changeLog 数组 | 公司信息全局唯一，单例最简单；changeLog 完整记录变更历史，满足可追溯需求 |
| 30 | 🆕 历史数据导入去重策略 | 仅手机号去重 | 手机号+邮箱双重匹配，三种策略可选 | ✅ 双重匹配 + 三策略 | 与现有 Candidate 查重逻辑一致（§7.14）；给用户跳过/覆盖/全部导入的选择权 |
| 31 | 🔴 ParseQueue 消费模型 | 在 email-scanner 中内联解析（收取+解析耦合） | **独立 parse-queue-processor 云函数（收取与解析解耦）** | ✅ 独立云函数 | IMAP连接与AI解析解耦，各自独立超时（60s vs 180s）和重试；5分钟消费间隔 vs 10分钟收取间隔形成 2:1 消费比；ParseQueue 作为解耦缓冲层防止积压 |

---

## 十七、风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| DeepSeek API JSON 模式偶发空返回 | 低 | 中 | 前端重试机制（最多2次），失败降级为手动录入 |
| 腾讯云 OCR 调用超限 | 低 | 低 | 免费额度 1000次/月，超出按量付费，费用极低 |
| CloudBase 聚合查询能力不足（大数据量） | 高 | 高 | **已解决：云函数聚合层**。报表不走前端直查，全部通过云函数在服务端分批聚合 + ReportCache 预计算。前端只收 <10KB 统计结果。即使每年 18,000+ 条数据，报表秒出 |
| 数据库安全规则未配置（匿名登录裸奔） | 高 | 高 | **已解决：集合级权限规则**。Application 按 ownerId 隔离，Job 前端只读，AuditLog 仅管理员可读。部署阶段 1 在控制台配置 |
| 数据库无自动备份（误删不可恢复） | 高 | 高 | **已解决：db-backup 云函数**。每日全量备份存云存储，保留 30 天。恢复前先快照确保可回退 |
| 系统停摆无人知晓（零监控） | 高 | 高 | **已解决：health-monitor + ErrorLog**。每 30 分钟心跳检查+API 余额探测，Dashboard 即告警中心 |
| CloudBase API 限流 | 中 | 中 | 增加重试+退避，localStorage兜底 |
| 🆕 sharp/原生模块云函数不兼容 | 中 | 中 | sharp 依赖 libvips C 库，CloudBase Node.js 沙箱可能加载失败。优先用 CloudBase 云存储自带的图片处理能力（缩略图/格式转换）；如不满足需求改用纯 JS 方案（Node 18+ 内置 canvas API）；降级策略：图片直接传 OCR 不做预处理，仅增加少量 OCR 费用 |
| 数据迁移丢失 | 低 | 高 | 迁移前自动备份 JSON，提供一键回滚 |
| 用户习惯变更（看板） | 中 | 中 | 保留列表视图切换；新用户首次进入展示动图引导 |
| DeepSeek API 临时不可用 | 低 | 中 | 增加超时保护 + 错误提示，不阻塞手动录入 |
| IMAP 连接失败（邮箱配置错误） | 中高 | 中 | 配置页增加"测试连接"按钮；失败采用指数退避重试（10分→30分→1小时）；Dashboard 告警 + 专员可见状态 |
| IMAP 搜索语法不兼容（FROM 通配符无效） | 中 | 高 | **已解决：改为代码中 JS 过滤发件人**。拉取全部未读邮件 → 代码中匹配招聘平台域名（@zhipin.com等），不依赖 IMAP SEARCH FROM |
| QQ邮箱授权码过期 / IMAP 频率限制 | 中 | 中 | 云函数检测到连续失败时 Dashboard 告警；24小时零产出自动通知管理员；EmailConfigPage 展示最近成功扫描时间和错误信息 |
| 漏斗数据不一致（回填错误） | 中 | 高 | 严格校验规则：通过≤参试、后序不早前序；回填操作记录 AuditLog 可追溯 |
| 专员不理解漏斗操作 | 中 | 中 | 首次使用弹窗引导；阶段切换时实时展示漏斗数据变化预览 |
| 🆕 AI 知识库信息不准确（网络搜索） | 中 | 高 | AI 搜来的条目默认 draft + sourceVerified=false，必须管理员审核后才能被 RAG 检索；手动录入的条目优先于网络搜索 |
| 🆕 历史数据导入去重失误（重复候选人） | 中 | 中 | 导入前预览可发现明显重复；导入后利用现有 duplicate-detection 做二次扫描；支持手动合并 |
| 🆕 知识库条目膨胀导致检索变慢 | 低 | 低 | 初期 <1000 条关键词匹配无性能问题；预留 relevance/useCount 字段为未来排序优化；条目增长到 5000+ 时升级向量检索 |
| 🆕 AI 助手生成内容不符合公司调性 | 中 | 低 | CompanyProfile 作为 System Prompt 约束 AI 输出；知识库条目经管理员审核确保一致性；useCount 机制自动识别高质量知识 |

---

## 十八、下一步

本规划书对应五步法**第 3 步（架构规划）**。关键决策：

1. **技术选型**：Vue 3 + CloudBase + DeepSeek + 腾讯云OCR ✅
2. **零服务器架构**：全部通过 API + 云函数调用，无运维负担 ✅
3. **三层知识体系**：CompanyProfile（公司人设）+ KnowledgeBase（知识条目）+ RecruitmentInsight（历史洞察）→ RAG 检索增强生成 ✅
3. **API Key 安全**：DeepSeek Key 走云函数代理（resume-parser-proxy），前端不可见 ✅ 🆕
4. **数据模型**：Candidate↔Application↔Job 三层 + Application.funnel 嵌入式漏斗 + EmailConfig + ParseQueue + PendingChanges ✅
5. **邮箱归集**：CloudBase SCF + IMAP 自动扫描，BOSS直聘简历零手动搬运 ✅
6. **漏斗数据**：12节点（含1个可选）嵌入 Application，锚点+递推回填，按岗位差异化面试轮次 ✅
7. **变更审批**：PendingChanges 两层写入，仅审批 Job 和 Config，候选人操作靠 AuditLog ✅
8. **报表聚合层**：云函数聚合 + ReportCache 预计算 + 凌晨预热，大数据量报表秒出 ✅ 🆕
9. **候选人结束状态**：rejected（淘汰5选项）/ withdrawn（放弃8选项），预设原因+可重新激活 ✅ 🆕
10. **候选人跟进记录**：communicationLogs 嵌入 Application，5种方式+方向标注+跟进提醒 ✅ 🆕
11. **批量操作**：10种批量操作 + 选中浮现操作栏 + 分批写入 + AuditLog 全追溯 ✅ 🆕
12. **数据库安全规则**：10条集合级权限规则，Application 按 ownerId 隔离，Job 前端只读；含 §10.7 get()循环依赖验证方案 ✅ 🆕
13. **数据库自动备份**：db-backup 云函数，三级策略（每日30天 + 每周12周 + 手动），全量JSON存云存储 ✅ 🆕
14. **监控告警体系**：health-monitor 云函数 + ErrorLog 集合 + Dashboard 状态面板，30分钟心跳，前端错误捕获 ✅ 🆕
15. **多环境部署**：dev/prod 双环境 + 域名自动检测，dev 自动部署，prod 手动触发 ✅ 🆕
16. **IMAP 密码加密升级**：PBKDF2 派生密钥 + 双变量隔离，支持在线轮换 ✅ 🆕
17. **空状态 + 首次向导**：每个空页面操作引导 + 3步配置向导（可跳过），降低首次使用门槛 ✅ 🆕
18. **移动端适配**：<768px 自动切换列表视图，拖拽改下拉选择，详情页全屏 ✅ 🆕
19. **邮件附件全格式**：15种格式覆盖（PDF/Word/DOC/图片/RTF/HTML/ZIP/RAR/Pages等），自动识别+分发 ✅ 🆕
20. **解析结果通知**：ParseNotification 通知专员，成功/失败分别处理，每日9:00日报摘要 ✅ 🆕
21. **重复简历检测**：三级匹配（Hash/手机邮箱/姓名+公司），检测不阻断，管理员可查看+合并 ✅ 🆕
22. **无需数据迁移**：V18 未正式使用，V2 全新启动 ✅
23. **实施节奏**：8 阶段，20-25 个工作日，风险前置，核心交互阶段占比最大 ✅
24. **已确认面试节点**：邀请与初试间增加可选节点 inviteConfirmedAt，专员手动标记，解决邀约转化率被低估问题 ✅
25. **Job 软删除**：禁止物理删除岗位，采用 status:'deleted' 软删除 + 关联 Application 标记 originalJobId + 管理员一键恢复，保证数据完整性 ✅

确认后进入**第 4 步——分模块实施**。
