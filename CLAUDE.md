# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**新励成招聘管理系统 V2.0** — 从 V18 的单文件 HTML（11,497行，342个全局函数）重构为 Vue 3 模块化 SPA。

### 当前状态：规划完成，尚未开始编码

- 规划文档：`recruit-tracker-v2-plan.md`（18 章，31 件关键决策，4 轮专家评审通过）
- 实施规范：`recruit-tracker-v2-implementation.md`（14 章，纯执行参考）
- V18 参考源码（只读参考，不修改）：`c:\Users\28689\WorkBuddy\20260423102025\recruit-tracker.html`
- V18 已部署但**未正式使用** → 无需数据迁移，V2 全新启动
- 🆕 RAG 公司知识库系统：CompanyProfile + KnowledgeBase + RecruitmentInsight 三层知识体系

## 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Vue 3 + Vite |
| 状态管理 | Pinia |
| UI 拖拽 | SortableJS（看板管道） |
| 图表 | Chart.js 4.x |
| 后端数据库 | CloudBase 文档数据库（腾讯云，已购买） |
| 文件存储 | CloudBase 云存储 |
| 部署 | CloudBase 静态托管 |
| 简历 OCR | 腾讯云 OCR API（中文 95%+） |
| AI 服务 | DeepSeek API v4-flash（简历解析 ¥0.015/份 + RAG 增强 ¥0.005/次） |
| 知识库 | 🆕 RAG 检索增强生成（CompanyProfile + KnowledgeBase + RecruitmentInsight） |

## 架构原则

### Clean Architecture 四层模型

```
视图层 (UI Layer)        → 页面 + 组件，纯展示
业务逻辑层 (Services)     → 纯函数，无 UI 依赖，可单测
数据访问层 (Store)        → Pinia store，封装 CloudBase 读写
API 通信层 (DataClient)   → CloudBase SDK + 腾讯云OCR + DeepSeek API + RAG 检索
```

### 数据模型（14 个集合 🆕）

- **Job**（职位）— 招聘需求
- **Candidate**（候选人）— 个人信息 + 简历解析结果
- **Application**（申请记录）— 连接 Candidate 和 Job，含 12 步漏斗
- 🆕 **CompanyProfile** — AI 的公司人设，全局唯一
- 🆕 **KnowledgeBase** — RAG 知识条目（9 种分类）
- 🆕 **RecruitmentInsight** — 历史招聘规律自动提炼

### 同步模型（彻底重做）

- CloudBase = **唯一数据源**（V18 是反过来把 localStorage 当主库）
- localStorage 降级为**只读缓存 + 离线兜底**
- `_version` 字段乐观锁 — 同步代码从 1100 行缩减到 ~50 行
- `updatedAt` 由服务端生成，**不依赖客户端时钟**

## 实施计划（8阶段，22-28天）

1. **基础设施 + 登录布局**（2天）— Vue 3 项目初始化、CloudBase SDK、登录/侧边栏
2. **简历录入 + 解析**（2-3天）⭐ 风险前置 — DeepSeek + 腾讯云OCR 核心链路
3. **邮箱自动归集**（2天）— IMAP 扫描 + 云函数
4. **数据模型 + 看板管道**（5-7天）⭐ 核心交互 — SortableJS 拖拽、12步漏斗
5. **工作台 + 数据分析**（2-3天）— Dashboard、漏斗图、趋势图
6. **审批 + AI助手 + 知识库 + 配置**（3天）🆕 — RAG 检索增强生成、历史数据导入
7. **测试 + 部署**（3天）— 单测、E2E、多环境部署
8. **文档 + 归档**（1天）— 用户手册、知识库沉淀

## 下一步

等待用户确认后进入阶段 1——初始化 Vue 3 + Vite 项目结构，搭建登录和布局框架。

## 持续使用的命令

待项目创建后补充（`npm run dev`、`npm run build`、`npm run test` 等）。
