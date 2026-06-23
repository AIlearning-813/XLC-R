# 新励成招聘管理系统 V2.0 — 项目规划书

> 版本：V2.0 | 最后更新：2026-06-23 | 状态：开发中

---

## 目录

- [第一章 项目概述](#第一章-项目概述)
- [第二章 架构设计](#第二章-架构设计)
- [第三章 数据模型](#第三章-数据模型)
- [第四章 实施计划](#第四章-实施计划)
- [第五章 全面审计报告（2026-06-23）](#第五章-全面审计报告2026-06-23)
- [第六章 修复路线图](#第六章-修复路线图)

---

## 第一章 项目概述

### 1.1 项目背景

从 V18 单文件 HTML（11,497行，342个全局函数）重构为 Vue 3 模块化 SPA + CloudBase 云函数。

### 1.2 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Vue 3 + Vite |
| 状态管理 | Pinia |
| UI 拖拽 | SortableJS（看板管道） |
| 图表 | Chart.js 4.x |
| 后端数据库 | CloudBase 文档数据库（腾讯云） |
| 文件存储 | CloudBase 云存储 |
| 部署 | CloudBase 静态托管 |
| 简历 OCR | 腾讯云 OCR API |
| AI 服务 | DeepSeek API v4-flash |
| 知识库 | RAG 检索增强生成 |

### 1.3 部署环境

- **生产环境**：`xlc-recruit-d1gmbx8gybc8a3565`
- **访问地址**：`https://xlc-recruit-d1gmbx8gybc8a3565-1436974998.tcloudbaseapp.com`

---

## 第二章 架构设计

### 2.1 Clean Architecture 四层模型

```
视图层 (UI Layer)        → 页面 + 组件，纯展示
业务逻辑层 (Services)     → 纯函数，无 UI 依赖，可单测
数据访问层 (Store)        → Pinia store，封装 CloudBase 读写
API 通信层 (DataClient)   → CloudBase SDK + 腾讯云OCR + DeepSeek API
```

### 2.2 关键架构决策（31件）

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 前端框架 | Vue 3 + Composition API | 生态成熟，响应式系统优秀 |
| 2 | 状态管理 | Pinia | Vue 3 官方推荐，TypeScript 友好 |
| 3 | 唯一数据源 | CloudBase 文档数据库 | localStorage 降级为只读缓存 |
| 4 | 同步模型 | `_version` 字段乐观锁 | 从 V18 1100行同步代码缩减到~50行 |
| 5 | 拖拽看板 | SortableJS | 轻量，Vue 3 兼容 |
| 6 | 密码加密 | AES-256-GCM + PBKDF2 | 云函数端加密，密钥不暴露前端 |
| 7 | 简历解析 | 腾讯云OCR + DeepSeek | 中文95%+识别率 |
| 8 | IMAP 邮箱 | imapflow | 支持 QQ/163/企业邮箱 |
| 9 | 文件处理 | format-router 15种格式 | PDF/Word/RTF/图片/ZIP/RAR/Pages |
| 10 | 去重机制 | 三级递进（文件哈希→强匹配→交叉匹配） | 防重复录入 |
| 11 | 权限模型 | 服务端角色校验 | admin/recruiter 二级权限 |
| 12 | 审批流程 | 专员提交→管理员审批→自动执行 | 两层写入模型 |
| 13 | 面试轮次 | 岗位类型自适应 | CR/人事出纳/TMK 2轮，CC/LTC/讲师 3轮 |
| 14 | 软删除 | status='deleted' + 回收站 | 可恢复 |
| 15 | 审计日志 | write-audit-log 云函数 | 全操作追踪 |
| 16 | 报表缓存 | ReportCache 30分钟TTL | 减少数据库查询 |
| 17 | 缓存预热 | report-cache-warmer 每日凌晨 | 首屏秒开 |
| 18 | 邮件扫描频率 | 每10分钟（云函数定时触发器） | IMAP 拉取新简历 |
| 19 | 解析队列 | ParseQueue + ProcessingLock 分布式锁 | 多实例安全消费 |
| 20 | 知识库 | RAG 检索增强生成 | 关键字+标签匹配，三层知识体系 |
| 21 | AI 匹配 | 6维度加权评分 | 期望岗位20%/技能30%/经验20%/学历15%/地点10%/薪资5% |
| 22 | 批量操作 | 10种操作（移动/导出/分配/标记等） | 提升效率 |
| 23 | 数据导入 | 列映射预设 + Excel/CSV | 兼容多招聘平台格式 |
| 24 | 数据移交 | 专员离职批量转移 | 关联数据同步迁移 |
| 25 | 候选人收藏 | CandidateBookmark | 快速访问 |
| 26 | 沟通记录 | CommunicationLog | 候选人沟通历史 |
| 27 | 通知系统 | Notification + 缓冲写入 | 防日志风暴 |
| 28 | 错误捕获 | Vue/JS/Promise 三级全局捕获 | ErrorLog 集中存储 |
| 29 | 健康监控 | health-monitor 云函数 | 每小时检查数据库/存储/AI连通性 |
| 30 | 数据库备份 | db-backup 云函数 | 15个集合全量导出到云存储 |
| 31 | 多环境支持 | env.js 域名自动检测 | local/dev/prod |

### 2.3 云函数架构

| 云函数 | 超时 | 内存 | 触发器 | 职责 |
|--------|:----:|:----:|--------|------|
| email-scanner | 300s | 1024MB | 每30分钟 | IMAP拉取 + 写入ParseQueue |
| parse-queue-processor | 180s | 512MB | 每10分钟 | 消费ParseQueue + OCR + AI解析 |
| report-aggregator | 30s | 512MB | HTTP调用 | 11种报表聚合维度 |
| report-cache-warmer | 120s | 512MB | 每日凌晨2:00 | 预热报表缓存 |
| auth-proxy | 30s | 256MB | HTTP调用 | 登录验证 + 账号管理 |
| rag-assistant-proxy | 30s | 256MB | HTTP调用 | RAG检索增强生成 |
| resume-parser-proxy | 30s | 256MB | HTTP调用 | 简历解析代理 |
| health-monitor | 60s | 256MB | 每小时 | 系统健康检查 |
| db-backup | 300s | 512MB | 每日凌晨3:00 | 数据库全量备份 |
| archive-old-applications | 300s | 512MB | 每年1月1日 | 年度归档 |
| write-audit-log | 10s | 128MB | HTTP调用 | 审计日志写入 |
| get-file-url | 30s | 256MB | HTTP调用 | 云存储文件下载代理 |
| web-search-agent | 60s | 256MB | HTTP调用 | AI网络搜索 |
| history-insight-generator | 120s | 512MB | HTTP调用 | 历史洞察生成 |
| init-department-tree | 30s | 256MB | 手动 | 初始化部门树 |

---

## 第三章 数据模型

### 3.1 核心集合（14个）

| 集合 | 说明 | 关键字段 |
|------|------|---------|
| **Job** | 职位 | title, department, jobType, status, headcount, ownerId |
| **Candidate** | 候选人 | name, phone, email, parsedData, status, ownerId |
| **Application** | 申请记录 | candidateId, jobId, stage, status, funnel, ownerId, _version |
| **RecruitmentDemand** | 招聘需求 | title, department, headcount, status, linkedJobId |
| **EmailConfig** | 邮箱配置 | email, imapHost, imapPassword(加密), enabled, userId |
| **ParseQueue** | 解析队列 | source, fileUrl, status, retryCount, phoneHash, emailHash |
| **ReportCache** | 报表缓存 | cacheKey, result, expiresAt, computedAt |
| **ProcessingLock** | 分布式锁 | lockId, instanceId, expiresAt |
| **AuditLog** | 审计日志 | action, entityType, entityId, operator, timestamp |
| **PendingChange** | 变更审批 | changeType, entityId, status, submittedBy, reviewedBy |
| **CompanyProfile** | 公司人设 | AI的公司画像，全局唯一 |
| **KnowledgeBase** | 知识库 | title, content, category, tags |
| **RecruitmentInsight** | 招聘洞察 | cacheKey, insights, type |
| **Notification** | 通知 | userId, type, message, read |

### 3.2 关键索引

| 集合 | 索引名 | 字段 | 类型 |
|------|--------|------|------|
| EmailConfig | user_unique | userId | 唯一 |
| Application | job_stage | jobId + stage | 普通 |
| ParseQueue | status_idx | status | 普通 |
| ProcessingLock | lock_unique | lockId | 唯一 |
| RecruitmentInsight | type_idx | type | 普通 |
| AuditLog | entity_idx | entityType + entityId | 普通 |
| PendingChange | status_idx | status | 普通 |

### 3.3 同步模型

- CloudBase = **唯一数据源**（V18 是反过来把 localStorage 当主库）
- localStorage 降级为**只读缓存 + 离线兜底**
- `_version` 字段乐观锁 — 同步代码从 1100 行缩减到 ~50 行
- `updatedAt` 由服务端生成，**不依赖客户端时钟**

---

## 第四章 实施计划

### 4.1 八阶段实施

| 阶段 | 内容 | 天 | 状态 |
|:----:|------|:--:|:----:|
| 1 | 基础设施 + 登录布局 | 2d | ✅ 完成 |
| 2 | 简历录入 + 解析 | 2-3d | ✅ 完成 |
| 3 | 邮箱自动归集 | 2d | ✅ 完成 |
| 4 | 数据模型 + 看板管道 | 5-7d | ✅ 完成 |
| 5 | 工作台 + 数据分析 | 2-3d | ✅ 完成 |
| 6 | 审批 + AI助手 + 知识库 + 配置 | 3d | ✅ 完成 |
| 7 | 测试 + 部署 | 3d | ✅ 完成 |
| 8 | 文档 + 归档 | 1d | ✅ 完成 |

### 4.2 已部署云函数（15个）

email-scanner、parse-queue-processor、report-aggregator、report-cache-warmer、auth-proxy、rag-assistant-proxy、resume-parser-proxy、health-monitor、db-backup、archive-old-applications、write-audit-log、get-file-url、web-search-agent、history-insight-generator、init-department-tree

---

## 第五章 全面审计报告（2026-06-23）

> 审计团队：招聘系统专家、架构设计师、代码审核专家
> 审计范围：10 Store + 22 Service + 37 组件 + 12 云函数 + 17 测试文件

### 5.1 综合评分

| 专家 | 评分 | 权重 |
|------|:----:|:----:|
| 🏢 招聘系统专家 | **82** / 100 | 33.3% |
| 🏗️ 架构设计师 | **73** / 100 | 33.3% |
| 🔍 代码审核专家 | **68** / 100 | 33.3% |
| **综合总分** | **74.3** / 100 | — |

### 5.2 🏢 招聘系统专家 — 82/100

| 维度 | 得分 | 评价 |
|------|:----:|------|
| 招聘流程完整性 | 18/20 | 12步漏斗+差异化面试轮次设计优秀；缺少背调、试用期阶段 |
| 业务规则正确性 | 17/20 | 乐观锁+三级去重+审批流程严谨；软删除恢复逻辑不完善 |
| 用户体验设计 | 17/20 | 拖拽看板+批量操作+通知系统；移动端适配不足 |
| 数据驱动能力 | 17/20 | 11种报表维度+渠道分析+需求预警；缺少端到端周期指标 |
| 扩展性与合规 | 13/20 | 多岗位类型+数据移交+审计日志；缺少GDPR/个保法合规 |

**关键发现**：
- 🔴 无阻塞性问题
- 🟡 软删除恢复时 Application 状态未区分原始结束类型
- 🟡 `createWithApplication` 非真正事务
- 🟡 ParseQueue 分布式锁存在并发窗口
- 🟢 12步漏斗+三级去重+AI匹配引擎是行业最佳实践

### 5.3 🏗️ 架构设计师 — 73/100

| 维度 | 得分 | 评价 |
|------|:----:|------|
| 分层架构清晰度 | 16/20 | 四层模型定义清晰；组件目录重复，useSyncStore缺失 |
| 数据模型设计 | 15/20 | 三层关联模型成熟；updatedAt存客户端时间、索引覆盖不足 |
| 云函数架构 | 16/20 | 收取/解析分离+分布式锁+超时保护；依赖重复增加冷启动 |
| 同步与状态管理 | 14/20 | 乐观锁二次验证优秀；离线兜底未实现、会话签名偏弱 |
| 可扩展性与可运维性 | 12/20 | 多环境支持+健康监控+数据库备份；无CI/CD、无README |

**关键发现**：
- 🔴 离线兜底完全未实现（useSyncStore 不存在）
- 🔴 `updatedAt` 使用客户端时钟，违反设计原则
- 🔴 会话签名使用非密码学哈希，可被伪造
- 🟡 索引缺失 4 条关键路径
- 🟡 组件目录重复（candidate/candidates、report/reports）
- 🟢 分布式锁+乐观锁二次验证+秒级管道触发设计优秀

### 5.4 🔍 代码审核专家 — 68/100

| 维度 | 得分 | 评价 |
|------|:----:|------|
| 代码质量与可维护性 | 15/20 | 服务层纯函数设计典范；9个组件超500行，代码重复严重 |
| 错误处理与健壮性 | 13/20 | 全局错误捕获+乐观锁重试；大量空catch吞异常，策略不一致 |
| 安全性 | 14/20 | AES-256-GCM双密钥方案优秀；密钥泄露到前端bundle、无盐哈希 |
| 性能优化 | 13/20 | 游标分页+按需加载+cache；N+1查询、cache-warmer写空数据 |
| 测试质量 | 13/20 | Mock层完整+pipeline测试详尽；6个Store+9个Service无测试 |

**关键发现**：
- 🔴 `.env.local` 中 `VITE_MASTER_SECRET`/`VITE_SALT_PEPPER` 泄露到前端JS bundle
- 🔴 SHA-256 无盐哈希可被彩虹表反查手机号/邮箱
- 🔴 cache-warmer 写入空数据覆盖有效缓存
- 🔴 索引字段命名不一致（lockKey vs lockId）
- 🟡 审批事务顺序反了（先标记后执行）
- 🟡 重试判断使用黑名单策略（临时错误大多被误判为永久失败）
- 🟡 裸读 localStorage 绕过 Pinia 做管理员判断
- 🟢 pipeline-engine/matching-engine 纯函数设计 + CloudBase Mock 层完整

---

## 第六章 修复路线图

### 6.1 P0 — 投产阻塞（安全漏洞 / 数据风险）

| # | 事项 | 发现来源 | 工作量 |
|---|------|---------|:----:|
| 1 | **密钥泄露** — `VITE_MASTER_SECRET`/`VITE_SALT_PEPPER` 编译进前端JS，需删除+轮换 | 🔍 | 1h |
| 2 | **无盐哈希可被反查** — 手机号/邮箱SHA-256 改为 HMAC-SHA256 | 🔍 | 2h |
| 3 | **cache-warmer写空数据** — 预热时跳过空结果或执行真正聚合 | 🔍 | 2h |
| 4 | **离线兜底未实现** — 新建 useSyncStore + IndexedDB 离线队列 | 🏗️ | 4h |
| 5 | **updatedAt客户端时间** — 改为云函数端或CloudBase安全规则 `request.time` | 🏗️ | 2h |

### 6.2 P1 — 强烈建议（数据一致性 / 架构缺陷）

| # | 事项 | 发现来源 | 工作量 |
|---|------|---------|:----:|
| 6 | **软删除恢复逻辑** — 记录原始 Application 状态，恢复时按原状态 | 🏢 | 2h |
| 7 | **补充4条数据库索引** — Candidate.fileHash/email、Application.candidateId、ParseQueue.sourceEmailId+status | 🏗️🔍 | 1h |
| 8 | **审批事务顺序** — `usePendingChangeStore.review` 先执行后标记 | 🔍 | 1h |
| 9 | **重试白名单策略** — parse-queue-processor 只用明确不可重试的才标记 failed | 🔍 | 1h |
| 10 | **会话签名升级** — `signPayload` 改用 HMAC-SHA256 | 🏗️ | 1h |
| 11 | **索引字段统一** — ProcessingLock 的 lockKey → lockId | 🔍 | 0.5h |
| 12 | **RecruitmentInsight索引修正** — type_idx → cacheKey | 🏗️ | 0.5h |
| 13 | **createWithApplication事务** — 实现补偿回滚或两步创建 | 🏢 | 3h |
| 14 | **ParseQueue分布式锁加固** — 使用原子操作消除并发窗口 | 🏢 | 2h |
| 15 | **localStorage管辖判断** — CandidatesPage 改为 auth.isAdmin | 🔍 | 0.5h |
| 16 | **消除代码重复** — callAggregator/FUNNEL_STAGES/cacheKey 提取共享模块 | 🔍🏗️ | 2h |

### 6.3 P2 — 推荐优化（功能完善 / 体验提升）

| # | 事项 | 发现来源 | 工作量 |
|---|------|---------|:----:|
| 17 | **拆分超大组件** — 9个超500行，最严重 CandidateDetailPage 1554行 | 🔍 | 8h |
| 18 | **GDPR/个保法合规** — 数据保留期限、同意记录、删除请求状态字段 | 🏢 | 3h |
| 19 | **db-backup 完整实现** — 补充云函数逻辑+定时触发器 | 🏢🏗️ | 3h |
| 20 | **背景调查阶段** — Offer → 背调 → 入职 | 🏢 | 2h |
| 21 | **端到端周期指标** — 简历到入职平均天数 | 🏢 | 2h |
| 22 | **目录统一** — candidate/candidates、report/reports 合并 | 🏗️ | 1h |
| 23 | **云函数超时调整** — rag-assistant-proxy(30→60s)、report-aggregator(30→60s) | 🏗️🔍 | 0.5h |
| 24 | **密码输入组件化** — SystemConfigTab 用弹窗替代 prompt() | 🔍 | 0.5h |
| 25 | **URL脱敏写入** — error-capture.js 移除含 token 的完整 URL | 🔍 | 0.5h |
| 26 | **Dashboard冗余请求** — deep watch 触发2次 loadPeriodData 修复 | 🔍 | 0.5h |

### 6.4 P3 — 工程化提升（测试 / CI/CD / 文档）

| # | 事项 | 发现来源 | 工作量 |
|---|------|---------|:----:|
| 27 | **补充单元测试** — 6个Store + 9个Service + 全部云函数 | 🔍 | 16h |
| 28 | **CI/CD流水线** — GitHub Actions 自动化构建→测试→部署 | 🏗️ | 3h |
| 29 | **项目README** — 当前是Vite脚手架模板，需改写 | 🏗️ | 2h |
| 30 | **清理孤立目录** — cleanup-old-notifications/、resume-download-proxy/ | 🏗️ | 0.5h |
| 31 | **同比/环比分析** — aggregateTrend 增加 momChange/yoyChange | 🏢 | 3h |
| 32 | **批量候选人导入** — CSV/Excel 反向导入 | 🏢 | 3h |
| 33 | **移动端列表视图** — 看板在移动端降级为列表 | 🏢 | 4h |
| 34 | **统一异常处理策略** — 空catch块改为统一日志 | 🔍 | 2h |

### 6.5 执行建议

```
第一轮（本周）: P0 × 5   → 消除安全风险和投产阻塞
第二轮（下周）: P1 × 11  → 修复数据一致性和架构缺陷
第三轮（两周）: P2 × 10  → 功能完善和体验优化
第四轮（一个月）: P3 × 8 → 测试覆盖、CI/CD、文档
```

**完成 P0+P1 后，系统评分预计从 74.3 提升至 85+。**

---

## 附录 A：专家评分对比

| 评估维度 | 🏢招聘专家 | 🏗️架构师 | 🔍代码审核 |
|---------|:--------:|:-------:|:--------:|
| 流程/架构/代码质量 | 18/20 | 16/20 | 15/20 |
| 业务/数据/错误处理 | 17/20 | 15/20 | 13/20 |
| UX/云函数/安全性 | 17/20 | 16/20 | 14/20 |
| 数据/同步/性能 | 17/20 | 14/20 | 13/20 |
| 合规/运维/测试 | 13/20 | 12/20 | 13/20 |
| **总分** | **82** | **73** | **68** |

## 附录 B：三大亮点（三位专家一致认可）

1. **12步漏斗 + 差异化面试轮次 + 纯函数管道引擎** — 行业最佳实践的体现
2. **AES-256-GCM + PBKDF2 双密钥密码方案 + 乐观锁二次验证 + 三级去重体系** — 远超同类产品的安全设计
3. **parse-queue-processor 分布式锁 + email-scanner 秒级触发 + 超时保护** — 云函数架构设计成熟
