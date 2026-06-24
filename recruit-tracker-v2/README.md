# 新励成招聘管理系统 V2.0

基于 Vue 3 + CloudBase 的模块化招聘流程管理系统，支持从简历投递到入职的全流程跟踪。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Vue 3 (Composition API) + Vite 8 |
| 状态管理 | Pinia 3 |
| UI 拖拽 | SortableJS（看板管道） |
| 图表 | Chart.js 4.x |
| 路由 | Vue Router 4 |
| 后端数据库 | 腾讯云 CloudBase 文档数据库 |
| 文件存储 | CloudBase 云存储 |
| 简历 OCR | 腾讯云 OCR API |
| AI 服务 | DeepSeek API（简历解析 + RAG 增强） |
| 部署 | CloudBase 静态托管 + 云函数 |

## 架构

```
视图层 (UI Layer)        → 页面 + 组件，纯展示
业务逻辑层 (Services)     → 纯函数，无 UI 依赖，可单测
数据访问层 (Store)        → Pinia store，封装 CloudBase 读写
API 通信层 (DataClient)   → CloudBase SDK + 腾讯云OCR + DeepSeek API
```

## 项目结构

```
recruit-tracker-v2/
├── src/
│   ├── components/        # 可复用组件
│   │   ├── common/        #   通用组件（InputDialog 等）
│   │   ├── candidates/    #   候选人相关（ResumePreview 等）
│   │   ├── layout/        #   布局组件（Sidebar, Header）
│   │   ├── pipeline/      #   管道看板组件
│   │   ├── reports/       #   报表组件
│   │   └── settings/      #   设置页组件
│   ├── views/             # 页面视图（16 个页面）
│   ├── stores/            # Pinia Store（13 个）
│   ├── services/          # 业务逻辑服务（22 个）
│   ├── router/            # 路由配置
│   └── config/            # 常量与配置
├── cloud-functions/       # CloudBase 云函数（16 个）
├── e2e/                   # Playwright E2E 测试
├── scripts/               # 工具脚本（种子数据、部署、冒烟测试）
└── __mocks__/             # 测试 Mock
```

## 核心功能

- **看板管道**：13 步招聘漏斗（简历→有效简历→邀约→初试→...→背调→入职），支持拖拽流转
- **简历解析**：上传简历自动 OCR + AI 解析，提取姓名、电话、邮箱、工作经历等
- **邮箱归集**：IMAP 自动扫描招聘平台邮箱，归集候选人简历
- **数据分析**：漏斗转化率、端到端周期、趋势图
- **AI 助手**：RAG 检索增强生成，基于公司知识库回答招聘问题
- **审批流程**：招聘专员提交变更 → 管理员审批
- **回收站**：软删除候选人可恢复
- **GDPR 合规**：数据同意管理、保留期限、匿名化、删除请求

## 数据模型

| 集合 | 说明 |
|------|------|
| Candidate | 候选人信息 + 简历解析结果 |
| Application | 申请记录（连接 Candidate ↔ Job） |
| Job | 职位需求 |
| Users | 用户（管理员/招聘专员） |
| AuditLog | 操作审计日志 |
| PendingChanges | 待审批变更 |
| EmailConfig | 邮箱扫描配置 |
| KnowledgeBase | RAG 知识条目 |
| CompanyProfile | 公司 AI 人设 |
| RecruitmentInsight | 历史招聘规律 |
| ParseCorrectionBank | 解析修正案例库 |
| ParseQueue | 简历解析队列 |
| ReportCache | 报表缓存 |

## 快速开始

### 前置条件

- Node.js 20+
- CloudBase 环境（已配置环境 ID：`xlc-recruit-d1gmbx8gybc8a3565`）

### 安装与运行

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 构建
npm run build

# 预览构建产物
npm run preview
```

### 测试

```bash
# 单元测试
npm test

# 单元测试（watch 模式）
npm run test:watch

# E2E 测试
npm run test:e2e

# E2E 测试（带 UI）
npm run test:e2e:ui
```

### 种子数据

```bash
# 初始化种子数据（安全模式，不清除已有数据）
npm run seed

# 强制重置数据
npm run seed:force
```

### 部署

```bash
# 部署到生产环境
npm run deploy

# 部署到开发环境
npm run deploy:dev
```

## 云函数

| 云函数 | 用途 | 超时 |
|--------|------|:----:|
| auth-proxy | 用户认证代理 | 30s |
| write-audit-log | 写入审计日志 | 10s |
| email-scanner | 邮箱自动扫描归集 | 60s |
| resume-parser-proxy | DeepSeek 简历解析 | 30s |
| parse-queue-processor | 解析队列处理 | 60s |
| get-file-url | 云存储文件获取 | 10s |
| report-aggregator | 报表数据聚合 | 60s |
| report-cache-warmer | 报表缓存预热 | 60s |
| db-backup | 数据库自动备份 | 300s |
| rag-assistant-proxy | RAG AI 助手代理 | 60s |
| health-monitor | 系统健康监控 | 30s |
| init-department-tree | 部门树初始化 | 10s |
| web-search-agent | 网络搜索代理 | 30s |
| archive-old-applications | 归档旧申请 | 60s |
| history-insight-generator | 历史洞察生成 | 120s |

## 管道阶段

```
简历 → 有效简历 → 邀约 → 已确认面试 → 初试 → 初试通过
→ 复试 → 复试通过 → 终试 → 终试通过 → Offer → 背景调查 → 入职
```

## License

Private — 新励成内部系统
