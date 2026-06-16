# 阶段验收冒烟测试清单

> **用途**：每个开发阶段完成后，逐项执行此清单。全部通过则该阶段验收合格，方可进入下一阶段。
> **原则**：一次冒烟测试（30分钟）可以同时暴露多个隐藏问题，避免层层递进踩坑。

---

## 通用检查（每个阶段必做）

### 1. 认证与权限
- [ ] 匿名登录成功，CloudBase auth.getLoginState() 返回用户对象
- [ ] 角色选择（管理员/专员）正常切换
- [ ] 路由守卫：未登录 → LoginPage，admin-only 路由 → 专员被重定向
- [ ] 安全规则验证（对每个集合执行 CRUD）

### 2. CloudBase SDK 连通性
- [ ] `db()` 返回非 null 实例
- [ ] `auth()` 返回非 null 实例
- [ ] `storage()` 返回非 null 实例
- [ ] `callFunction('health-monitor')` 返回健康状态
- [ ] 对已在安全规则中允许的集合执行一次 `add` + `get` + `update` + `remove`

### 3. 云函数验证
- [ ] 调用每个已部署的云函数一次，验证返回值结构
- [ ] 检查云函数日志（CloudBase 控制台），确认无未捕获异常
- [ ] 验证环境变量实际生效值（非配置文件中的值，而是运行时的 `process.env.xxx`）

### 4. 前端构建
- [ ] `npm run dev` 无报错启动
- [ ] `npm run build` 无报错，dist/ 产出合理大小
- [ ] 浏览器控制台无红色错误（`console.error` 除外）

---

## 阶段专用检查

### 阶段 1：基础设施 + 登录布局
- [ ] 登录页 → 角色选择 → Dashboard 完整流程
- [ ] 侧边栏所有导航项可点击，路由正确跳转
- [ ] Dashboard 4 张统计卡片渲染正常
- [ ] 全局错误捕获生效（故意抛出一个错误，验证 ErrorLog 写入）
- [ ] CSS 变量体系：primary / gray / spacing 系列变量生效

### 阶段 2：简历录入 + 解析
- [ ] 上传 PDF → 文本提取成功（PDF.js）
- [ ] 上传 DOCX → 文本提取成功（Mammoth.js）
- [ ] 上传 TXT → 文本直接读取成功
- [ ] 上传图片格式 → 正确提示"浏览器端暂不支持"
- [ ] 上传超大文件（>20MB）→ 正确拒绝
- [ ] AI 解析成功（DeepSeek 返回结构化 JSON）
- [ ] 解析结果预览各组正确展示
- [ ] 字段编辑修正功能可用（点击编辑 → 修改 → 提交）
- [ ] 岗位下拉加载正常（Job 集合有数据）
- [ ] 创建 Candidate + Application 成功，验证数据库写入
- [ ] AuditLog 写入成功（通过 write-audit-log 云函数）
- [ ] 重复检测：上传同一份文件两次 → exact match 拦截
- [ ] 重复检测：上传不同文件但手机号相同 → high match 提示
- [ ] ParseCorrectionBank 修正记录写入成功
- [ ] 扫描件 PDF（无文本层 <20 字符）→ 正确提示
- [ ] 空文件 / 损坏文件 → 正确错误提示
- [ ] 文件上传失败 → 用户收到区分提示

### 阶段 3：邮箱自动归集
- [ ] EmailConfig CRUD 正常（新增/编辑/删除邮箱配置）
- [ ] IMAP 连接测试（验证授权码、TLS 握手）
- [ ] email-scanner 云函数手动触发，验证邮件拉取 + 附件下载
- [ ] ParseQueue 条目自动创建（source: "email"）
- [ ] parse-queue-processor 消费队列正确（文本提取 → 解析 → 创建 Candidate）
- [ ] Message-ID 去重生效（同一封邮件不重复处理）
- [ ] ParseNotification 通知专员
- [ ] 15 种格式的 format-router 路由正确
- [ ] 多邮箱扫描间隔控制（5-10秒间隔）
- [ ] 扫描失败指数退避重试

### 阶段 4：数据模型 + 看板管道
- [ ] 看板列按阶段正确渲染
- [ ] 拖拽 CandidateCard 到新阶段 → Application 更新正确
- [ ] 漏斗时间戳自动写入（`funnel.xxxAt`）
- [ ] history 数组追加流转记录
- [ ] 跳阶段回填逻辑正确
- [ ] 候选人详情页时间线展示
- [ ] 结束流程（rejected/withdrawn）→ endStage/endReason 正确
- [ ] 沟通记录新增/展示
- [ ] 面试评价录入/展示
- [ ] 批量操作可用

### 阶段 5：工作台 + 数据分析
- [ ] 统计卡片数据实时查询正确
- [ ] 漏斗图数据聚合正确
- [ ] 趋势图数据正确
- [ ] report-aggregator 云函数返回正确聚合数据
- [ ] report-cache-warmer 预热正确
- [ ] Excel/CSV 导出功能

### 阶段 6：审批 + AI 助手 + 知识库 + 配置
- [ ] SettingsPage 所有 Tab 可用
- [ ] Job CRUD + 变更审批流程完整
- [ ] CompanyProfile 编辑 + changeLog 记录
- [ ] KnowledgeBase 条目 CRUD + 审核流程
- [ ] RAG 检索增强生成可用
- [ ] 历史数据导入流程完整（CSV → 预览 → 列映射 → 导入）
- [ ] RecruitmentInsight 自动计算
- [ ] 配置变更审批（PendingChanges 两层写入）

---

## 冒烟测试执行记录

| 日期 | 阶段 | 执行人 | 通过项 | 失败项 | 发现的问题 | 修复后重新通过 |
|------|------|--------|--------|--------|-----------|---------------|
| 2026-06-16 | 阶段1+2 | — | — | — | — | — |

> 每次执行后填写一行记录，失败的项必须在"修复后重新通过"列打勾才能进入下一阶段。
