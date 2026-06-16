# 新励成招聘管理系统 V2.0 — 实施规范

> **面向对象**：开发人员  
> **用途**：实施阶段的执行依据，不含论证过程  
> **决策文档**：`recruit-tracker-v2-plan.md`（含完整讨论记录和设计决策）

---

## 目录

1. [项目概述](#一项目概述)
2. [技术栈](#二技术栈)
3. [系统架构](#三系统架构)
4. [前端模块结构](#四前端模块结构)
5. [简历解析](#五简历解析)
6. [邮箱自动归集](#六邮箱自动归集)
7. [招聘管道与漏斗](#七招聘管道与漏斗)
8. [报表系统](#八报表系统)
9. [审批与权限](#九审批与权限)
10. [数据安全与备份](#十数据安全与备份)
11. [监控运维](#十一监控运维)
12. [用户体验](#十二用户体验)
13. [实施计划](#十三实施计划)

---

## 一、项目概述

**新励成招聘管理系统 V2.0** — 从 V18 单文件 HTML 重构为 Vue 3 模块化 SPA。

**业务规模**：8 名招聘专员，月均 2,400-3,000 份简历（年约 30,000），6 种岗位类型（CC、LTC负责人、讲师 3 轮面试；CR、人事出纳、TMK 2 轮面试）。

**核心目标**：
- 看板式管道拖拽管理候选人流转
- 邮箱自动收取招聘平台简历 + AI 解析
- 12 步标准化漏斗数据，支持报表分析
- CloudBase 为唯一数据源，多专员数据隔离

---

## 二、技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Vue 3 + Vite + Vue Router |
| 状态管理 | Pinia |
| UI 拖拽 | SortableJS |
| 图表 | Chart.js 4.x |
| 数据库 | CloudBase 文档数据库（腾讯云） |
| 文件存储 | CloudBase 云存储 |
| 后端计算 | CloudBase 云函数 SCF（Node.js） |
| 部署 | CloudBase 静态托管 + 云函数 |
| 简历 OCR | 腾讯云 OCR API |
| 简历解析 | DeepSeek API v4-flash（Tool Use 模式） |
| 邮件协议 | IMAP（imapflow 库） |

---

## 三、系统架构

### 3.1 分层架构图

```
┌────────────────────────────────────────────────────────────────┐
│                       浏览器 (SPA)                              │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  视图层       Dashboard │ Pipeline(看板) │ Candidates    │   │
│  └─────────────────────┬──────────────────────────────────┘   │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │  业务逻辑层    PipelineEngine │ DuplicateDetector         │   │
│  └─────────────────────┬──────────────────────────────────┘   │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │  数据访问层    CandidateStore │ JobStore │ ApplicationStore│   │
│  └─────────────────────┬──────────────────────────────────┘   │
│  ┌─────────────────────▼──────────────────────────────────┐   │
│  │  API 通信层    CloudBase SDK │ 腾讯云OCR客户端           │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
          │                  │
┌─────────▼──────────┐ ┌─────▼────────┐
│  CloudBase (腾讯云)  │ │ 腾讯云OCR API │
│  • 文档数据库       │ │ 中文识别 95%+ │
│  • 云存储           │ └──────────────┘
│  • 静态托管         │
│  • 匿名登录         │
│  • 云函数 SCF ──────┼──→ 定时触发 ──→ 邮件扫描
│  • 云函数 SCF ──────┼──→ resume-parser-proxy ──→ DeepSeek API
└─────────────────────┘        ↑ API Key 仅存云函数环境变量
```

### 3.2 数据模型

```
Job (职位/需求)
├── _id, title, department, headcount, deadline, status
├── interviewRounds: 2 | 3
├── createdBy, createdAt, updatedAt

Candidate (候选人)
├── _id, name, phone, email, parsedData (简历解析结果)
├── duplicateGroupId, duplicateOf, duplicateScore
├── parseCorrections: [{field, originalValue, correctedValue, correctedBy, correctedAt}]
├── createdBy, createdAt, updatedAt

Application (申请记录) ←── 连接 Candidate 和 Job，单一真相来源
├── _id, candidateId, jobId
├── stage: 'resume'|'valid'|'invite'|'inviteConfirmed'|'interview1'|'interview1Pass'
│         |'interview2'|'interview2Pass'|'interview3'|'interview3Pass'|'offer'|'onboard'
├── stageEnteredAt
├── status: 'active' | 'rejected' | 'withdrawn'
├── endStage, endReason, endedAt
├── funnel: {
│     resumeAt, validAt, inviteAt, inviteConfirmedAt,
│     interview1At, interview1PassAt, interview2At, interview2PassAt,
│     interview3At, interview3PassAt, offerAt, onboardAt
│   }
├── funnelMeta: { entrySource, anchorDate, backfillStages, backfillAt, backfillBy }
├── ownerId, visibility
├── isArchived: false, archivedAt, archivedBy
├── history: [{fromStage, toStage, at, note}]
├── communicationLogs: [{id, type, direction, summary, result, followUpAt, createdBy, createdAt}]
├── feedbacks: [{stage, interviewer, rating, comment, createdAt}]
├── createdAt, updatedAt

Job (追加字段)
├── status: 'active' | 'deleted'  ← 软删除，禁止物理删除
├── deletedAt, deletedBy, previousStatus

AuditLog (操作审计)
├── _id, action, entityType, entityIds, detail, operator, timestamp

PendingChanges (变更审批)
├── _id, type: "job"|"config", action: "create"|"update"|"delete"
├── entityType, entityId, before, after
├── status: "pending"|"approved"|"rejected"
├── submittedBy, submittedAt, reviewedBy, reviewedAt, reviewComment

EmailConfig (邮箱配置)
├── _id, userId, email, imapHost, imapPort, imapUser, imapPassword (AES-256-GCM加密)
├── filterRules: { fromWhitelist, subjectKeywords }
├── scanInterval: 10, enabled: true
├── lastScanAt, lastSuccessfulScanAt, lastError, failureCount, nextRetryAt
├── createdAt, updatedAt

ParseQueue (解析队列)
├── _id, fileId, fileName, fileHash (MD5)
├── source: "email"|"manual"|"import", sourceEmailId
├── status: "pending"|"parsing"|"done"|"failed", retryCount
├── createdAt, processedAt

ParseNotification (解析通知)
├── _id, userId, type: "parse_success"|"parse_failed"|"scan_summary"|"handover"
├── parseQueueId, candidateId, candidateName
├── title, detail, status: "unread"|"read"
├── createdAt

DuplicateExclusion (重复排除列表)
├── _id, candidateA, candidateB
├── excludedBy, excludedAt

ParseCorrectionBank (解析修正案例库)
├── _id, field, originalValue, correctedValue, correctionCount, updatedAt

ErrorLog (错误日志)
├── _id, type: "cloudFunction"|"api"|"client"|"heartbeat"
├── source, message, stack, context, severity: "critical"|"warning"|"info"
├── createdAt

ReportCache (报表缓存)
├── _id, cacheKey, data, computedAt, expiresAt, dataVersion

HeartbeatLog (心跳记录)
├── _id, timestamp, overall, details

─── 公司知识库（RAG 三层体系）───

CompanyProfile (公司画像) ←── AI 的"公司人设"，全局唯一
├── _id: "singleton"
├── name, shortName, logo, description
├── industry, subIndustry, founded, size, website
├── locations: [{city, type, address}]
├── businessLines: [{name, description, revenueShare}]
├── culture: [string], benefits: [string]
├── recruitmentPhilosophy, employerBrand: {strengths, challenges}
├── changeLog: [{field, oldValue, newValue, changedAt, changedBy}]
├── updatedAt, updatedBy

KnowledgeBase (知识库条目) ←── RAG 核心检索源
├── _id, category (9种), title, content, structured
├── source: "manual"|"web_search"|"ai_extract"|"historical_infer"
├── sourceUrl, sourceVerified (AI搜索的默认false)
├── tags: [string], relevance, useCount, lastUsedAt
├── status: "published"|"draft"|"archived"
├── createdBy, createdAt, updatedAt

RecruitmentInsight (历史洞察缓存) ←── 系统自动提炼的招聘规律
├── _id, cacheKey (e.g. "insight:sales_manager")
├── data: {avgTimeToHire, avgCandidatesPerHire, topSources,
│         commonRejectReasons, successfulProfile, salaryRange}
├── computedAt, expiresAt, sourceJobIds
```

### 3.3 同步模型

```
界面操作 → Store(Pinia) → CloudBase SDK 直接读写 → 返回结果
               ↓
          localStorage（被动缓存：加速重复读取 + 离线兜底）
```

- CloudBase = 唯一数据源，`_version` 字段乐观锁防冲突
- `updatedAt` 由服务端生成，不依赖客户端时钟

### 3.4 云函数清单

| 云函数 | 触发方式 | 超时 | 内存 | 用途 |
|--------|---------|------|------|------|
| `resume-parser-proxy` | 前端按需调用 | 30s | 256MB | 代理 DeepSeek API，API Key 不出前端 |
| `email-scanner` | 定时触发器（每10分钟） | 60s | 256MB | IMAP 扫描 + 附件下载 + 去重 + 入解析队列 |
| `parse-queue-processor` | 定时触发器（每5分钟）🆕 | 180s | 512MB | 消费 ParseQueue → 文本提取 → 调 resume-parser-proxy → 创建 Candidate → 通知专员 |
| `report-aggregator` | 前端按需调用 | 30s | 512MB | 数据库聚合查询，返回精简统计结果 |
| `report-cache-warmer` | 定时触发器（每日凌晨2:00） | 120s | 512MB | 预热所有活跃岗位的当月漏斗数据 |
| `db-backup` | 定时触发器（每日凌晨3:00） | 300s | 512MB | 全量导出所有集合 JSON → 云存储 |
| `health-monitor` | 定时触发器（每30分钟） | 60s | 256MB | 心跳检查 + API余额探测 + 岗位周期告警 |
| `archive-old-applications` | 定时触发器（每年1月1日） | 300s | 512MB | 批量归档已结束/已入职的旧 Application |
| `web-search-agent` | 管理员手动触发（设置页） | 60s | 256MB | 搜索网上新励成相关信息 → KnowledgeBase draft 条目 |
| `history-insight-generator` | 历史数据导入后/每月 | 120s | 512MB | 分析历史招聘数据 → RecruitmentInsight |
| `rag-assistant-proxy` | 前端按需调用（AI助手） | 30s | 512MB | RAG 检索增强：知识检索 + Prompt组装 + DeepSeek生成 |

---

## 四、前端模块结构

```
src/
├── main.js                       # 入口：挂载 Vue、Pinia、路由 + 全局错误捕获
├── App.vue                       # 根组件（布局壳 + 侧边栏 + 路由出口）
│
├── config/
│   ├── constants.js              # 管道阶段、部门树、岗位列表、结束状态预设值
│   ├── default-settings.js       # 系统默认配置
│   └── env.js                    # 环境检测（dev/prod 自动切换）
│
├── stores/                       # Pinia 状态 + 数据访问
│   ├── useAuthStore.js
│   ├── useJobStore.js
│   ├── useCandidateStore.js
│   ├── useApplicationStore.js    # 核心：申请记录 + 管道状态 + 漏斗数据
│   ├── useConfigStore.js
│   ├── usePendingChangeStore.js
│   └── useSyncStore.js
│
├── services/                     # 纯业务逻辑，无 UI 依赖，可单测
│   ├── cloudbase.js              # CloudBase SDK 初始化 + CRUD 封装
│   ├── resume-parser.js          # 简历解析：文件提取 → 调 resume-parser-proxy 云函数
│   ├── email-scanner.js          # 邮箱配置管理
│   ├── pipeline-engine.js        # 管道流转 + 漏斗回填 + 数据校验
│   ├── matching-engine.js        # AI 匹配度计算
│   ├── duplicate-detector.js     # 三级重复检测
│   ├── batch-operations.js       # 10种批量操作
│   ├── funnel-report.js          # 报表查询（调 report-aggregator 云函数）
│   ├── handover.js               # 专员数据移交
│   ├── export-excel.js
│   ├── export-csv.js
│   └── audit.js                  # 审计日志记录
│
├── composables/                  # Vue 组合式函数
│   ├── useSearchDropdown.js
│   ├── usePagination.js
│   ├── useDateFilter.js
│   ├── useResponsive.js          # 响应式检测（<768px → 列表模式）
│   └── useKeyboardShortcuts.js   # 看板快捷键
│
├── components/
│   ├── layout/
│   │   ├── AppSidebar.vue
│   │   └── AppHeader.vue
│   ├── common/
│   │   ├── SearchDropdown.vue
│   │   ├── StatCard.vue
│   │   ├── DateFilterBar.vue
│   │   ├── FilterBar.vue
│   │   ├── ConfirmModal.vue
│   │   ├── ToastBadge.vue
│   │   └── EmptyState.vue        # 空状态引导组件
│   ├── pipeline/
│   │   ├── KanbanBoard.vue       # 看板（列=阶段，卡片=候选人）
│   │   ├── KanbanColumn.vue
│   │   ├── CandidateCard.vue     # 显示姓名/岗位/停留天数/预警标识
│   │   └── PipelineFunnel.vue    # 漏斗图（Chart.js）
│   ├── resume/
│   │   ├── ResumeUploader.vue
│   │   ├── ParseResultView.vue
│   │   └── CandidateForm.vue
│   └── analytics/
│       ├── TrendChart.vue
│       └── AchieveGauge.vue
│
├── views/
│   ├── LoginPage.vue
│   ├── DashboardPage.vue         # 工作台（统计卡片+待跟进+解析通知+系统状态）
│   ├── PipelinePage.vue          # 招聘管道看板（默认视图）
│   ├── CandidateListPage.vue     # 简历库（含"已结束"Tab）
│   ├── CandidateDetailPage.vue   # 候选人详情 + 沟通记录 Tab + 状态时间线
│   ├── ResumeImportPage.vue
│   ├── AnalyticsPage.vue
│   ├── NeedsPage.vue
│   ├── BossImportPage.vue
│   ├── EmailConfigPage.vue       # 邮箱配置 + 测试连接按钮
│   ├── AdminReviewPage.vue       # 管理员审核页
│   ├── AIChatPage.vue
│   └── SettingsPage.vue
│
├── utils/
│   ├── format.js
│   ├── validate.js
│   ├── id-generator.js
│   └── migration.js
│
└── assets/
    └── styles/
        ├── variables.css         # CSS 变量
        ├── base.css
        └── components.css

cloud-functions/
├── resume-parser-proxy/
│   ├── index.js
│   ├── package.json
│   └── config.json       # 环境变量: DEEPSEEK_API_KEY
├── email-scanner/
│   ├── index.js          # 主入口 + 重试策略
│   ├── imap-client.js    # IMAP 连接 + 邮件搜索 + 附件下载
│   ├── deduplicator.js   # Message-ID hash 去重
│   ├── format-router.js  # 15种格式识别+分发
│   ├── crypto.js         # AES-256-GCM + PBKDF2 加解密
│   ├── package.json      # 依赖: imapflow, @cloudbase/node-sdk
│   └── config.json       # 环境变量: IMAP_MASTER_SECRET, IMAP_KEY_SALT
	├── parse-queue-processor/   # 🆕 ParseQueue 消费者（每5分钟触发）
	│   ├── index.js          # 取 pending 条目 → 文本提取 → 调 resume-parser-proxy → 创建 Candidate → 通知专员
	│   ├── format-router.js  # 从 email-scanner 复制（15 种格式识别+提取）
	│   ├── package.json      # 依赖: @cloudbase/node-sdk, pdfjs-dist, mammoth, word-extractor
	│   └── config.json       # 超时180s, 内存512MB
├── report-aggregator/
│   ├── index.js
│   ├── aggregators.js
│   ├── cache.js
│   ├── package.json
│   └── config.json
├── report-cache-warmer/
│   ├── index.js
│   ├── package.json
│   └── config.json
├── db-backup/
│   ├── index.js
│   ├── package.json
│   └── config.json
├── health-monitor/
│   ├── index.js
│   ├── package.json
│   └── config.json
└── archive-old-applications/
    ├── index.js
    ├── package.json
    └── config.json
```

---

## 五、简历解析

### 5.1 解析流程

```
用户上传文件
    │
    ├─→ PDF → PDF.js 提取文本层（浏览器端）
    ├─→ DOCX → Mammoth.js 提取文本（浏览器端）
    ├─→ DOC → word-extractor npm 包提取（纯JS，SCF沙箱兼容）⚠️ 不可用 antiword
    ├─→ 图片(PNG/JPG/BMP/TIFF) → 腾讯云 OCR API
    ├─→ WebP → sharp/CB存储转 PNG → 腾讯云 OCR API（⚠️ sharp 可能不兼容，优先用 CloudBase 图片处理）
    ├─→ TXT → 直接读取（自动检测 UTF-8/GBK/GB2312）
    ├─→ RTF → rtf-parser npm 包提取
    ├─→ HTML → 去除标签保留文本
    ├─→ ZIP/RAR → 解压递归处理内部文件
    ├─→ Apple Pages → 解压 ZIP → 提取 preview.pdf
    │
    └─→ 文本汇总 → resume-parser-proxy 云函数 → DeepSeek API → 结构化 JSON
```

### 5.2 云函数：resume-parser-proxy

```javascript
// cloud-functions/resume-parser-proxy/index.js

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

exports.main = async (event, context) => {
  const { resumeText, systemPrompt } = event;

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      temperature: 0,
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
                  name: { type: 'string' },
                  gender: { type: 'string', enum: ['男', '女', null] },
                  phone: { type: 'string' },
                  email: { type: 'string' },
                  age: { type: 'integer' },
                  city: { type: 'string' },
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
                    degree: { type: 'string' },
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
};
```

### 5.3 前端调用

```javascript
// services/resume-parser.js — 不持有 API Key

import cloudbase from './cloudbase.js';

async function parseResumeWithDeepSeek(resumeText) {
  const result = await cloudbase.callFunction({
    name: 'resume-parser-proxy',
    data: { resumeText, systemPrompt: SYSTEM_PROMPT }
  });
  return result.result.success ? result.result.data : null;
}
```

### 5.4 解析修正反馈机制

专员在 `ParseResultView.vue` 修正解析结果后，修正数据存入 `Candidate.parseCorrections[]`。当某字段被修正 ≥10 次时，`resume-parser-proxy` 云函数自动将该修正案例作为 few-shot example 注入 system prompt。

```javascript
// cloud-functions/resume-parser-proxy/index.js — prompt 增强

const CORRECTION_DB = db.collection('ParseCorrectionBank');

async function buildSystemPrompt(basePrompt) {
  const stats = await CORRECTION_DB
    .where({ correctionCount: db.command.gte(10) })
    .orderBy('correctionCount', 'desc')
    .limit(5)
    .get();

  if (stats.data.length === 0) return basePrompt;

  const examples = stats.data.map(c =>
    `• "${c.originalValue}" 应识别为 "${c.correctedValue}"（${c.field}字段）`
  ).join('\n');

  return `${basePrompt}\n\n## 常见修正案例：\n${examples}`;
}
```

管理员在设置页可查看和管理修正案例库（查看/手动添加/删除/重置）。

### 5.5 成本

| 项目 | 单价 | 每份成本 |
|------|------|---------|
| 腾讯云 OCR | ¥0.01/次 | ¥0-0.01 |
| DeepSeek v4-flash | ¥1/百万tokens (入) + ¥2/百万tokens (出) | ¥0.003 |
| **合计** | | **约 ¥0.015/份** |

每月 500 份 ≈ ¥7.5。

---

## 六、邮箱自动归集

### 6.1 扫描流程

```
阶段 A：邮件收取（email-scanner 云函数，每 10 分钟触发）
│
├─→ ① 读取 EmailConfig 表，获取所有 enabled=true 的邮箱
│      跳过 nextRetryAt 未到的邮箱（指数退避中）
│
├─→ ② IMAP 连接（imapflow 库，SSL 993 端口）
│
├─→ ③ 拉取未读邮件（IMAP SEARCH UNSEEN）
│      ⚠️ 不在 SEARCH 中用 FROM 通配符（RFC 3501 不支持）
│      改为代码中 JavaScript 字符串匹配过滤发件人
│
├─→ ④ 过滤招聘平台邮件：
│      发件人域名匹配 @zhipin.com | @kanzhun.com | @zhaopin.com.cn | @liepin.com
│
├─→ ⑤ Message-ID 去重 → 下载附件 → MD5 hash → 云存储 → ParseQueue（status: "pending"）
│
├─→ ⑥ 标记已读（仅已处理的招聘邮件）
│
└─→ ⑦ 更新 EmailConfig.lastSuccessfulScanAt + 重置 failureCount

        ║  ParseQueue  ║
        ║  (解耦缓冲)   ║
        ╚══════════════╝
              │
              ▼
阶段 B：解析消费（parse-queue-processor 云函数，每 5 分钟触发）🆕
│
├─→ ① 查询 ParseQueue 中 status: "pending" 的条目（FIFO，每次最多 20 条）
│
├─→ ② 逐条处理：
│      ├─ 标记 status: "parsing"（防重复）
│      ├─ 下载文件 → format-router.js 识别格式 → 文本提取（15 种格式）
│      ├─ 调用 resume-parser-proxy 云函数 → DeepSeek 结构化解析
│      ├─ 创建 Candidate + Application 记录
│      ├─ 更新 ParseQueue status: "done" + parsedCandidateId
│      └─ 创建 ParseNotification 通知专员
│
├─→ ③ 失败处理：
│      ├─ 可重试（超时类）→ 指数退避 5→10→20 分钟，最多 3 次
│      └─ 不可重试（格式损坏）→ status: "failed" + failReason + 通知专员
│
└─→ ④ 超时保护：剩余 < 30s 时停止取新条目，剩余顺延下次触发
```

### 6.2 连接失败的重试策略

| 连续失败次数 | 重试间隔 | 告警 |
|-------------|---------|------|
| 1 | 10 分钟 | — |
| 2 | 30 分钟 | — |
| 3 | 1 小时 | 🟡 Dashboard 告警 |
| 4 | 4 小时 | 🟡 |
| 5+ | 4 小时 | 🔴 critical 告警 |
| 恢复成功后 | 回到 10 分钟 | 重置计数 |

### 6.3 邮箱配置与测试连接

专员在 **设置页 → 邮箱配置** 中：
- 选择邮箱类型（QQ邮箱 / 腾讯企业邮箱 / 其他）
- 输入邮箱账号 + 授权码（非登录密码）
- 点击 **"测试连接"** 按钮 → 触发云函数即时验证 IMAP 连接
- 常见错误自动诊断：授权码错误→提示获取步骤；端口错误→提示 993(SSL)；超时→提示检查服务器地址
- 测试成功后可查看连接状态（收件箱可访问、最近邮件数）
- 测试通过后点击"保存配置"才持久化

### 6.4 邮件附件支持的格式（15 种）

| 格式 | 解析策略 |
|------|----------|
| PDF | PDF.js 提取文本层 |
| DOCX | Mammoth.js 提取 |
| DOC | word-extractor npm 包（纯JS，SCF兼容）⚠️ 不可用 antiword CLI |
| PNG / JPG / BMP / TIFF | 腾讯云 OCR API |
| WebP | sharp 转 PNG → OCR（优先 CB 云存储图片处理，sharp 作备选） |
| TXT | 直接读取（自动检测编码） |
| RTF | rtf-parser npm 包 |
| HTML | 去除标签保留文本 |
| ZIP / RAR | 解压 → 递归处理内部文件 |
| Apple Pages | 解压 ZIP 结构 → 提取 preview.pdf |

格式识别由 `format-router.js` 完成：先按 MIME 类型匹配 → 再按扩展名推断 → 完全不识别标记为 failed 并通知专员。

### 6.5 IMAP 密码加密

```
加密流程：
  专员输入 IMAP 密码
      │
      ▼
  ① 生成随机 IV（16 字节）
  ② PBKDF2 派生密钥（100,000 迭代，SHA-256）：
     MASTER_SECRET (64-char hex) + SALT (32-char hex) → 256-bit AES key
     两个环境变量分离存放，单一泄露不导致密钥泄露
  ③ AES-256-GCM 加密
  ④ 存储格式：iv + tag + ciphertext（Base64）

密钥轮换：
  生成新 MASTER_SECRET + SALT → 更新云函数环境变量
  → 运行 key-rotation 脚本：旧密钥解密 → 新密钥加密 → 写回 → 验证 → 删除旧变量
```

### 6.6 解析结果通知

邮件归集是后台静默运行的。解析完成后通过 `ParseNotification` 集合通知专员：

| 通知类型 | 触发时机 | 展示位置 |
|----------|---------|---------|
| `parse_success` | 简历解析成功 + 创建 Candidate | Dashboard "解析通知"卡片 |
| `parse_failed` | 解析失败（格式不支持/超时等） | Dashboard "解析通知"卡片 |
| `scan_summary` | 每日 9:00 汇总昨日解析情况 | Dashboard "解析通知"卡片（日报区） |

- 通知不弹窗，用红点徽章 + Dashboard 卡片展示
- 点击"查看候选人"标记为已读
- 超过 30 天的通知自动清理

---

## 七、招聘管道与漏斗

### 7.1 漏斗阶段（12 步，含 1 个可选）

```
简历 → 有效简历 → 邀约 → [已确认面试] → 初试 → 初试通过
                                          → 复试 → 复试通过
                                                 → 终试 → 终试通过 → Offer → 入职
```

- `[已确认面试]` 为可选节点（`inviteConfirmedAt`），专员手动标记
- **3 轮面试岗位**（CC/LTC负责人/讲师）：全部节点活跃
- **2 轮面试岗位**（CR/人事出纳/TMK）：跳过终试相关节点（`interview3At` / `interview3PassAt` 恒为 null）

### 7.2 漏斗数据模型

漏斗时间戳嵌入 `Application.funnel`，与 `Application.stage` 在同一文档原子化更新：

```
更新 Application.stage → 同时更新 Application.funnel.*At（首次写入，永不覆盖）
```

- **stage**：可前进、可后退、可自由修改
- **funnel.*At**：只写一次（首次到达时写入），后退不删除，已有值绝不覆盖
- **history[]**：追记所有阶段变更（前进+后退+回填）

### 7.3 跳阶段回填

专员延迟录入时（如候选人已到终试才录入系统），自动回填前面阶段：

```
前置节点（resume/valid/invite/inviteConfirmed）：自动填当前时间
初试节点（interview1At）：⛔ 强制专员手动输入日期（锚点）
后续节点（interview1Pass~onboard）：从锚点日期递推
```

回填前弹出确认对话框，展示所有待回填节点（🔵自动 / 🟡你填的 / 🟢推算）。报表中回填数据单独标记，回填比例 > 20% 时显示警告。

### 7.4 数据校验

```javascript
function validateFunnelIntegrity(application) {
  // 规则1: 通过 ≤ 参试（面试通过时间不能早于出席时间）
  // 规则2: 后序不早前序（时间线校验）
  // 规则3: funnel 字段已有值 → 拒绝覆盖
  // 规则4: stage 与 funnel 一致性检查
}
```

### 7.5 按岗位差异化面试轮次

`Job.interviewRounds` 决定漏斗路径：

| 岗位 | 轮次 | 路径 |
|------|------|------|
| CC / LTC负责人 / 讲师 | 3 轮 | 完整 12 步 |
| CR / 人事出纳 / TMK | 2 轮 | 跳过终试（interview3 系列字段为 null） |

### 7.6 候选人结束状态

在看板中右键候选人卡片 → 选择结束操作：

| status | 含义 | 预设原因 |
|--------|------|---------|
| `rejected`（公司淘汰） | 简历不符合要求 / 面试表现不佳 / 薪资期望过高 / 岗位已招满 / 其他 |
| `withdrawn`（候选人放弃） | 已接受其他Offer / 薪资不满意 / 工作地点不合适 / 岗位与预期不符 / 未到场 / 无法联系 / 个人原因 / 其他 |

- 结束信息是快照：`endStage`（结束时所处阶段）+ `endReason` + `endedAt`
- 看板只显示 `status='active'`
- "已结束"列表可筛选淘汰/放弃，支持重新激活
- 报表新增淘汰率和放弃率指标

### 7.7 沟通记录

候选人详情页 → "沟通记录" Tab → 新增记录弹窗：

```
communicationLogs: [{
  id, type: 'phone'|'wechat'|'email'|'onsite'|'other',
  direction: 'outbound'|'inbound',
  summary, result, followUpAt,
  createdBy, createdAt
}]
```

- 轻量记录，不限沟通形式
- 可选填"下次跟进时间"，超期后 Dashboard "待跟进"卡片标红提醒

### 7.8 批量操作

看板/列表勾选候选人 → 页面底部浮现操作栏：

| 操作 | 确认方式 | 说明 |
|------|---------|------|
| 移动阶段 | 弹窗：选择目标 → 回填预览 → 确认 | 独立走 pipeline-engine |
| 淘汰/放弃 | 弹窗：选原因 → 确认（⚠ 不可撤回） | 统一应用给所有选中人 |
| 导出 Excel | 不弹窗，直接下载 | — |
| 分配负责人 | 弹窗：选接手专员 → 确认 | 用于调岗场景 |
| 重新激活 | 弹窗确认 | 已结束候选人回到看板 |
| 打标签 | 弹出标签选择器（多选） | 数组去重追加 |
| 添加沟通记录 | 弹出沟通记录对话框 | 统一追加相同记录 |
| 标记邀约 | 弹窗确认 | 批量标记 inviteConfirmed |

- 单次上限 100 条，超过分批执行
- 全部操作记录 AuditLog

### 7.9 重复简历检测

**三级匹配**：

| 级别 | 匹配条件 | 置信度 |
|------|---------|--------|
| ① 文件去重 | MD5 hash 相同 | 确定重复，直接跳过 |
| ② 强匹配 | 手机号完全相同 或 邮箱完全相同 | high |
| ③ 弱匹配 | 姓名相同 + ≥2 个维度匹配（手机后4位/学历+院校/最近公司） | medium |

- 重复检测**不阻止录入**（同一候选人投不同岗位是正常行为）
- 专员录入时收到"可能重复"提示
- 管理员 Dashboard "重复候选人"卡片集中展示，支持对比和合并
- 管理员标记"不是同一个人"后加入 `DuplicateExclusion`，后续自动跳过

### 7.10 数据归档

| 状态 | 条件 | 操作 |
|------|------|------|
| 活跃 | 结束 < 6 个月 或 入职 < 6 个月 | 正常参与看板+报表 |
| 已归档 | 入职 > 6 个月 或 结束 > 12 个月 | `isArchived: true`，报表默认过滤 |
| 物理删除 | 归档 > 24 个月 + 管理员手动触发 | 执行前自动备份快照 |

- 年度归档云函数 `archive-old-applications`：每年 1 月 1 日自动执行
- 报表聚合默认加 `isArchived: false`，聚合耗时保持恒定

### 7.11 专员离职数据移交

管理员在"专员管理"页 → 选择离职专员 → "数据移交"：

```
① 预览移交清单（活跃候选人数量 + 各阶段分布）
② 选择接手专员
③ 确认执行：
   - 批量更新 Application.ownerId（仅 active 状态）
   - 每条的 history 追加 owner_transferred 记录
   - 停用离职专员的 EmailConfig
   - 发送 ParseNotification 给接手专员
   - 写入 AuditLog
```

- Candidate 不修改 createdBy，追加 transferredTo 字段
- 仅移交活跃候选人，已结束的保留原状
- 邮箱配置自动停用

---

## 公司知识库与 RAG 检索增强生成系统

> AI 招聘助手的知识底座：三层知识体系 → RAG 检索增强 → 懂公司的 AI 建议

### 三层知识架构

```
AI 招聘助手 (写JD建议 / 筛选建议 / 薪资建议 / 沟通话术)
       │ RAG 检索增强生成
       ▼
知识库检索层（匹配最高相关度条目，组装增强 Prompt）
  ├── CompanyProfile     → 公司人设（System Prompt 注入）
  ├── KnowledgeBase      → 知识条目（语义匹配 Top-N）
  └── RecruitmentInsight → 历史规律（按岗位匹配）
```

### CompanyProfile — AI 的公司人设

```js
// 集合: CompanyProfile, _id = "singleton"（全局唯一）
// 管理入口: 设置页 → "公司信息" Tab → 表单编辑 → 自动记录 changeLog
{
  name: "新励成教育科技集团", shortName: "新励成",
  description: "...", industry: "教育培训", founded: 2005, size: "500-2000人",
  locations: [{city, type, address}],
  businessLines: [{name, description, revenueShare}],
  culture: ["以学员为中心", "持续创新", "团队协作"],
  benefits: ["五险一金", "带薪年假15天", "子女免费课程"],
  recruitmentPhilosophy: "我们寻找热爱教育、有成长心态的人才…",
  employerBrand: { strengths: [...], challenges: [...] },
  changeLog: [{field, oldValue, newValue, changedAt, changedBy}]
}
```

**使用方式**：每次 AI 助手请求时，读取 CompanyProfile 注入 System Prompt，确保 AI 输出符合公司定位。

### KnowledgeBase — RAG 核心检索源

```js
// 集合: KnowledgeBase，分类管理，关键词+标签匹配检索
{
  category: "company_culture" | "team_structure" | "salary_system"
         | "job_template" | "interview_question" | "competitor_info"
         | "industry_term" | "recruitment_tip" | "candidate_persona",
  title: "新励成教研团队架构说明",
  content: "全文可检索正文...",
  structured: { teamName, subTeams, headcount, ... },  // 可选
  source: "manual" | "web_search" | "ai_extract" | "historical_infer",
  sourceUrl: null | "https://...",
  sourceVerified: true,     // AI搜来的默认false，需管理员审核
  tags: ["教研", "团队"],
  relevance: "high" | "medium" | "low",
  useCount: 0,              // AI引用次数
  status: "published" | "draft" | "archived"
}
```

### RAG 检索增强生成流程

```
用户输入 → ①意图识别(DeepSeek 小请求) → ②知识检索(本地DB)
  → ③组装增强Prompt(CompanyProfile + Top-N KnowledgeBase + RecruitmentInsight)
  → ④DeepSeek生成(带知识上下文) → ⑤反馈沉淀(useCount+1 / 提示沉淀新条目)
```

### 云函数：web-search-agent

```js
// cloud-functions/web-search-agent/index.js
// 触发：管理员在设置页点击"搜索公司信息"
// 功能：搜索网上新励成信息 → KnowledgeBase draft 条目（sourceVerified=false）
// 管理员审核通过后 → published，才能被 RAG 检索
```

### 云函数：rag-assistant-proxy

```js
// cloud-functions/rag-assistant-proxy/index.js
// 触发：前端 AI 助手面板调用
// 流程：
//   1. 解析用户意图（DeepSeek，~200 tokens）
//   2. 检索 CompanyProfile（单例读取）
//   3. 检索 KnowledgeBase（关键词+标签匹配，返回 Top-5）
//   4. 检索 RecruitmentInsight（按岗位匹配）
//   5. 组装增强 Prompt → DeepSeek 生成
//   6. 返回生成结果 + 引用的知识来源
// 费用：约 ¥0.005/次
```

### 历史数据导入

```
管理员上传 CSV/Excel → 导入向导（/import 页面）
  ① 文件解析 + 前10行预览
  ② 列映射：CSV列 ↔ Candidate/Application 字段
  ③ 去重策略：跳过/覆盖/全部导入
  ④ 确认导入 → 批量写入（标记 entrySource="historical_import"）
→ 导入完成 → 自动触发 history-insight-generator 云函数
```

| 支持格式 | 解析方式 | 预置模板 |
|---------|---------|---------|
| CSV / Excel | SheetJS 客户端解析 | BOSS直聘/智联/猎聘 列映射模板 |
| JSON | 直接解析 | 通用模板 |

### 前端管理界面

| 页面/Tab | 功能 |
|----------|------|
| 设置 → 🏢 公司信息 | CompanyProfile 表单编辑，自动 changeLog |
| 设置 → 📚 知识库 | KnowledgeBase 列表/搜索/分类/编辑/审核/归档 |
| 设置 → 📊 历史洞察 | RecruitmentInsight 按岗位展示/刷新 |
| 设置 → 🌐 信息采集 | 触发 AI 网络搜索 → 审核 → 发布 |
| /import | 历史数据导入向导（三步流程） |
| AI 助手面板 | RAG 增强对话，展示引用知识来源 |

### 成本

| 操作 | 模型 | 预估费用 |
|------|------|---------|
| RAG 意图识别 | DeepSeek v4-flash | ¥0.0004/次 |
| RAG 增强生成 | DeepSeek v4-flash | ¥0.005/次 |
| AI 网络搜索（5维度） | DeepSeek-chat | ¥0.01/次 |
| 历史洞察计算 | DeepSeek v4-flash | ¥0.009/次 |
| **月度合计（AI助手30次/天）** | | **约 ¥5/月** |

---

## 八、报表系统

### 8.1 聚合架构

```
前端报表页
    │ ① 发起查询（岗位/部门/时间范围）
    ▼
report-aggregator 云函数
    │ ② 先查 ReportCache（命中且未过期 → <100ms 返回）
    └── 未命中 → ③ 分批查询 Application（每批 1000 条）
                 → Node.js 内存聚合
                 → 写入 ReportCache（30分钟 TTL）
                 → 返回精简结果（<10KB）
```

- 前端永远只接收已聚合的统计结果，不传输未聚合的 Application 列表
- `report-cache-warmer` 每日凌晨 2:00 预热所有活跃岗位的当月漏斗数据（24h TTL）
- 7 天前的缓存自动清理

### 8.2 数据库索引

```
Application 集合:
  索引1: jobId(升) + status(升) + funnel.resumeAt(升)
  索引2: status(升) + funnel.resumeAt(升)
  索引3: jobId(升) + status(升)

Job 集合:
  索引4: department(升) + status(升)

ReportCache 集合:
  索引5: expiresAt(升)
```

### 8.3 报表指标

**漏斗指标**（12 个计数 + 转化率）：
- resumeCount / validCount / inviteCount / inviteConfirmedCount
- interview1Count / interview1PassCount / interview2Count / interview2PassCount
- interview3Count / interview3PassCount / offerCount / onboardCount
- 8 个转化率（validRate → onboardRate，含 inviteConfirmedRate）

**退出指标**：
- rejectedCount / withdrawnCount
- 各阶段淘汰率 / 各阶段放弃率

**回填指标**：
- autoBackfillCount / backfillRatio

**岗位周期告警指标**（集成到 health-monitor）：
- 岗位 60 天无入职 → 警告 / 90 天 → 严重
- Offer 阶段候选人停留 > 15 天 → 警告
- 某岗位初试阶段积压 > 20 人 → 警告

---

## 九、审批与权限

### 9.1 变更审批

专员可**提交**变更，不能**生效**变更。只有管理员审核通过后才写入正式数据。

```
专员操作（不直接生效）
    │ 写入 PendingChanges 表
    ▼
管理员审核
    ├── 通过 → 写入 Job/Config 正式表 + 全员可见
    └── 驳回 → 撤销 + 通知专员
```

**审批范围**：仅 Job（招聘需求）和 Config（系统配置）的增删改。候选人操作靠 AuditLog 追溯，不审批。

### 9.2 Job 软删除

Job 不物理删除，采用软删除（`status: 'deleted'`）：

```
管理员审批通过删除 Job →
  ① Job.status = 'deleted', deletedAt = now, previousStatus = 原值
  ② 查询活跃 Application → 追加 history: {action: 'job_deleted'}
  ③ 通知受影响专员
  ④ 写 AuditLog
```

- 已删除岗位显示为"CC岗（已删除）"
- 报表中历史数据按 originalJobId 保留
- 管理员可一键恢复
- 前端 `Job.delete: false`（安全规则禁止前端物理删除）

### 9.3 数据库安全规则

| 集合 | read | write | 说明 |
|------|------|-------|------|
| Application | ownerId==auth.uid 或 admin | 同 read | 按所有者隔离 |
| Candidate | 所有登录用户 | createdBy==auth.uid 或 admin | 写权限限制；非创建者查看时手机/邮箱脱敏 |
| Job | 所有登录用户 | 仅 admin（create/update），delete 禁止 | 专员通过 PendingChanges 间接修改 |
| Users | _openid==auth.uid 或 admin | 仅 admin | 用户只能看自己 |
| EmailConfig | userId==auth.uid | userId==auth.uid | 专员只能管理自己的邮箱 |
| PendingChanges | 所有登录用户 | create: 所有 / update+delete: 仅 admin | 审批权在管理员 |
| AuditLog | 仅 admin | false（仅云函数写入） | 审计日志不可篡改 |
| ReportCache | 所有登录用户 | false（仅云函数写入） | 缓存只读 |
| ParseQueue | 所有登录用户 | false（仅云函数写入） | 队列只读 |
| ErrorLog | 仅 admin | 所有登录用户 | 所有人可上报错误 |

---

## 十、数据安全与备份

### 10.1 三级备份策略

| 级别 | 频率 | 保留 | 存储 |
|------|------|------|------|
| 每日全量 | 每天凌晨 3:00 | 30 天 | 云存储 `backups/daily/` |
| 每周归档 | 每周日 | 12 周 | 云存储 `backups/weekly/` |
| 手动备份 | 管理员按需触发 | 永久 | 云存储 `backups/manual/` |

- 全量导出 JSON，恢复无需特殊工具
- 恢复前先做"恢复前快照"，确保可回退
- 单个集合导出失败不中断其他集合的备份
- 过期备份自动清理

### 10.2 恢复流程

```
管理员 → 设置页 → 数据恢复 → 选择日期 → 预览备份内容
  → 选择恢复方式（查看对比/恢复指定文档/全量回滚）
  → 确认 → 写入数据库 → 记录 AuditLog
```

---

## 十一、监控运维

### 11.1 健康监控

`health-monitor` 云函数每 30 分钟执行：

| 检查项 | 方式 | 异常处理 |
|--------|------|---------|
| 云函数心跳 | 调 report-aggregator + resume-parser-proxy | ErrorLog + Dashboard 告警 |
| DeepSeek API | 发 1 token 最小请求验证 Key 有效 | 余额不足→critical |
| 错误统计 | 查 ErrorLog 最近 1 小时 critical+warning 数 | >10 条→告警 |
| 扫描延迟 | 查 EmailConfig.lastSuccessfulScanAt | >30 分钟→告警；>24 小时→critical |
| 岗位周期 | 查 Job 挂出天数 + Offer 卡单 | 见 §7.17 |

### 11.2 前端错误捕获

```javascript
// main.js
app.config.errorHandler = async (err, instance, info) => {
  await cloudbase.database().collection('ErrorLog').add({
    type: 'client', source: 'frontend',
    message: err.message, stack: err.stack,
    context: { component, url, userAgent },
    severity: 'warning', createdAt: new Date()
  });
};

window.addEventListener('unhandledrejection', (event) => {
  // 同样写入 ErrorLog
});
```

### 11.3 告警通知

| 级别 | 触发条件 | 通知方式 |
|------|----------|---------|
| Critical | DeepSeek 余额耗尽 / 全部云函数不可用 | Dashboard 红色横幅 + 浏览器 Notification |
| Warning | 单云函数异常 / 扫描停滞 / 岗位超期 | Dashboard 黄色提示 |
| Info | 备份失败 / 单次 API 超时 | 静默写入 ErrorLog |

Dashboard 是唯一的告警通道，不引入外部队列通知。

### 11.4 多环境部署

- **dev 环境**：`recruit-dev-xxxxx`，自动部署（git push → build → deploy），测试数据
- **prod 环境**：`recruit-prod-xxxxx`，手动触发部署，正式数据
- 域名自动检测：`localhost` / `dev.` 前缀 → dev；其余 → prod
- CloudBase 静态托管和云函数自带版本回滚（最近 10 个版本）

---

## 十二、用户体验

### 12.1 空状态设计

每个页面首次为空时，显示操作引导而非白屏：

```
看板（空）：📋 还没有候选人 → [📤 上传简历] [📧 配置邮箱]
列表（空）：👤 还没有候选人记录 → [📤 上传第一份简历]
分析（空）：📊 还没有足够的数据（当前进度：0/5）
需求（空）：📌 还没有招聘需求 → [➕ 创建招聘需求]
```

### 12.2 首次配置向导

新系统首次打开时展示 3 步引导（可跳过、可分步完成）：
1. 创建第一个招聘需求
2. 配置邮箱
3. 导入简历

随时在"设置→新手向导"中重新打开。

### 12.3 移动端适配

| 屏幕宽度 | 视图 | 交互 |
|----------|------|------|
| ≥ 768px（桌面） | 看板模式（多列水平滚动） | SortableJS 拖拽 |
| < 768px（手机） | 自动切换列表模式 | 详情页下拉选择切换阶段 |

- 移动端不提供拖拽（手势冲突），改用下拉选择
- 详情页全屏利用空间
- 不引入 PWA/离线

### 12.4 桌面端键盘快捷键

| 快捷键 | 操作 |
|--------|------|
| `Space` | 快速查看候选人详情 |
| `Ctrl/Cmd + →` | 移动到下一阶段 |
| `Ctrl/Cmd + ←` | 移动到上一阶段 |
| `E` | 淘汰候选人（弹窗选原因） |
| `W` | 标记放弃（弹窗选原因） |
| `A` | 标记为已确认面试 |
| `Esc` | 关闭弹窗/取消选择 |
| `?` | 显示快捷键帮助 |

- 输入框内不响应快捷键
- 首次进入看板页时右下角弹出快捷键提示

---

## 十三、实施计划

### 阶段 1：基础设施 + 登录布局（2 天）
- [ ] 初始化 Vue 3 + Vite 项目，配置 Pinia、Vue Router
- [ ] 搭建 CloudBase SDK 封装层
- [ ] 创建 CloudBase 集合和索引
- [ ] 配置数据库安全规则（10 条集合级权限）
- [ ] 部署 `db-backup` 云函数 + 每日凌晨 3:00 定时触发器
- [ ] 部署 `health-monitor` 云函数 + 每 30 分钟定时触发器
- [ ] 在 CloudBase 控制台配置云函数环境变量（DEEPSEEK_API_KEY、IMAP_MASTER_SECRET、IMAP_KEY_SALT）
- [ ] 前端全局错误捕获
- [ ] 登录页 + 角色选择 + 侧边栏导航 + 权限路由守卫

> 🎯 管理员能登录，看到完整的空壳子框架。备份和监控已在后台运行。

### 阶段 2：简历录入 + 解析（2-3 天）⭐ 风险前置
- [ ] 文件上传组件（ResumeUploader.vue，拖拽+粘贴）
- [ ] `services/resume-parser.js`（PDF.js + 腾讯云OCR + 调云函数解析）
- [ ] 编写 `resume-parser-proxy` 云函数
- [ ] 解析结果预览 + 手动修正（ParseResultView.vue）
- [ ] 候选人信息录入表单（CandidateForm.vue）
- [ ] 重复检测逻辑（三级匹配 + DuplicateExclusion）
- [ ] 重复检测通知（专员提示 + 管理员 Dashboard 卡片）

> 🎯 上传简历 → 云函数代理解析 → 结构化JSON → 存入 CloudBase。核心链路跑通。

### 阶段 3：邮箱自动归集（2 天）
- [ ] 编写 `format-router.js`（15 种格式识别+分发+压缩包递归）
- [ ] 编写 `email-scanner` 云函数（IMAP + 附件下载 + 去重 + 指数退避）
- [ ] 编写 `parse-queue-processor` 云函数 🆕（消费 ParseQueue → 文本提取 → 调 resume-parser-proxy → 创建 Candidate → 通知专员）
- [ ] 编写 `crypto.js`（AES-256-GCM + PBKDF2 加解密）
- [ ] 邮箱配置页（EmailConfigPage.vue + 测试连接按钮）
- [ ] 解析通知机制（ParseNotification + 每日 9:00 日报）
- [ ] 部署 email-scanner + parse-queue-processor 云函数 + 定时触发器（10分钟 + 5分钟）

> 🎯 专员配好邮箱 → email-scanner 自动收取 → ParseQueue → parse-queue-processor 消费解析 → Candidate 自动创建 → 通知专员。全链路闭环。

### 阶段 4：数据模型 + 看板管道 + 漏斗引擎 + 批量操作（5-7 天）⭐ 核心交互
- [ ] Store 层（Candidate/Job/Application）
- [ ] CloudBase CRUD 封装（含 _version 乐观锁）
- [ ] `pipeline-engine.js`（漏斗序列 + 回填 + 校验 + 差异化轮次）
- [ ] 数据库索引创建
- [ ] KanbanBoard.vue（SortableJS 拖拽 + 按岗位动态列）
- [ ] CandidateCard.vue（姓名/岗位/停留天数/预警标识）
- [ ] 阶段切换确认对话框（回填预览）
- [ ] 结束状态操作（右键菜单：淘汰/放弃）
- [ ] "已结束"候选人列表（可重新激活）
- [ ] 沟通记录（详情页 Tab）
- [ ] 批量操作引擎（10 种操作）
- [ ] 数据归档策略（isArchived + archive-old-applications 云函数）
- [ ] 专员移交功能（管理员触发）

> 🎯 拖拽变换阶段 → 自动回填 → 数据完整入库。所有核心交互就绪。

### 阶段 5：工作台 + 数据分析（2-3 天）
- [ ] Dashboard 统计卡片 + 待跟进提醒 + 解析通知卡片 + 系统状态面板
- [ ] `report-aggregator` 云函数（按岗位/部门/趋势/总览）
- [ ] `report-cache-warmer` 云函数
- [ ] 漏斗图（12 节点转化率可视化）
- [ ] 趋势图（按时间维度）
- [ ] 报表页（所有图表通过云函数拿数据）
- [ ] 报表导出（Excel/CSV）

> 🎯 大数据量下报表秒出。

### 阶段 6：审批 + AI助手 + 知识库 + 配置（3 天）
- [ ] PendingChanges 集合 + usePendingChangeStore
- [ ] 专员端提交变更对话框
- [ ] 管理员审核页 AdminReviewPage（列表 + 对比 + 通过/驳回）
- [ ] Job 软删除逻辑
- [ ] 公司知识库与 RAG 系统：
  - CompanyProfile 集合 + 设置页"公司信息"Tab（changeLog 自动记录）
  - KnowledgeBase 集合 + 设置页"知识库"Tab（CRUD + 审核 + 归档）
  - RecruitmentInsight 集合 + 设置页"历史洞察"Tab
  - `rag-assistant-proxy` 云函数（RAG 检索增强生成）
  - `web-search-agent` 云函数（AI网络搜索→draft→管理员审核）
  - AI 助手面板（展示引用知识来源 + 反馈按钮）
- [ ] 历史数据导入向导（/import 页面，三步流程）
- [ ] 系统配置页 + 修正案例库管理
- [ ] BOSS 数据导入

### 阶段 7：测试 + 部署（3 天）
- [ ] 单元测试（pipeline-engine / matching-engine / store / email-scanner / rag-assistant 🆕）
- [ ] 端到端测试（录入→管道流转→入职→报表 / AI助手 RAG 建议准确率 🆕）
- [ ] 初始化脚本（管理员账号 + CompanyProfile 默认配置 + 初始知识库条目写入 CloudBase）
- [ ] dev 环境冒烟测试
- [ ] prod 环境部署（手动触发 + 30 分钟监控确认）
- [ ] 移动端适配验证

### 阶段 8：文档 + 归档（1 天）
- [ ] 用户操作手册（含看板新用户引导 + 邮箱配置指南 + 快捷键速查 + 知识库管理指南 🆕）
- [ ] 变更日志
- [ ] 知识库条目最终沉淀（开发期积累的决策知识→KnowledgeBase）

> **预估总计**：22-28 个工作日（阶段 6 新增知识库+RAG+历史数据导入 +1天）

---

*实施规范版本：v1.1 | 编制日期：2026-06-15 | 更新：新增公司知识库与RAG系统 | 决策记录：recruit-tracker-v2-plan.md*
