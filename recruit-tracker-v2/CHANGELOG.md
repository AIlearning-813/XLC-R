# 变更日志

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
