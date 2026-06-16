# CloudBase 数据库初始化指南

> 环境 ID: `xlc-recruit-d1gmbx8gybc8a3565`
> 在 CloudBase 控制台 → 数据库 中逐个创建集合

## 一、创建集合（14 个）

| # | 集合名 | 索引 1 | 索引 2 | 说明 |
|---|--------|--------|--------|------|
| 1 | `Users` | `_openid` 升序, 唯一 | — | 用户表 |
| 2 | `Job` | `department` 升序 + `status` 升序 | — | 招聘岗位 |
| 3 | `Candidate` | `phone` 升序 | `email` 升序 | 候选人 |
| 4 | `Application` | `ownerId` 升序 + `status` 升序 | `jobId` 升序 + `status` 升序 | 申请记录（核心） |
| 5 | `EmailConfig` | `userId` 升序, 唯一 | — | 邮箱配置 |
| 6 | `ParseQueue` | `status` 升序 + `createdAt` 升序 | `fileHash` 升序 | 解析队列 |
| 7 | `ParseNotification` | `userId` 升序 + `status` 升序 + `createdAt` 降序 | — | 解析通知 |
| 8 | `AuditLog` | `createdAt` 降序 | `userId` 升序 | 审计日志 |
| 9 | `PendingChanges` | `status` 升序 + `submittedAt` 升序 | — | 变更审批 |
| 10 | `CompanyProfile` | —（单例，仅一条） | — | 公司画像 |
| 11 | `KnowledgeBase` | `category` 升序 + `status` 升序 | `createdAt` 降序 | 知识库 |
| 12 | `RecruitmentInsight` | `type` 升序 | — | 招聘洞察 |
| 13 | `DuplicateExclusion` | `candidateA` 升序 | `candidateB` 升序 | 重复排除 |
| 14 | `ReportCache` | `reportType` 升序 + `expiresAt` 升序 | — | 报表缓存 |
| 15 | `ErrorLog` | `createdAt` 降序 | `severity` 升序 + `createdAt` 降序 | 错误日志 |

### 创建方法

1. 打开 [CloudBase 控制台](https://console.cloud.tencent.com/tcb)
2. 选择环境 `xlc-recruit-d1gmbx8gybc8a3565`
3. 左侧菜单 → 数据库 → 集合管理 → 新建集合
4. 创建后 → 索引管理 → 新建索引

## 二、安全规则配置

> 注意：`get()` 跨集合查询可能存在循环依赖，部署后需按 §10.7.2 步骤验证

依次为每个集合配置（控制台 → 数据库 → 集合 → 权限设置 → 自定义安全规则）：

### Application
```json
{
  "read": "auth.uid != null && (doc.ownerId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')",
  "write": "auth.uid != null && (doc.ownerId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')"
}
```

### Candidate
```json
{
  "read": "auth.uid != null",
  "write": "auth.uid != null && (doc.createdBy == auth.uid || get('database.Users.' + auth.uid).role == 'admin')"
}
```

### Job
```json
{
  "read": "auth.uid != null",
  "create": "get('database.Users.' + auth.uid).role == 'admin'",
  "update": "get('database.Users.' + auth.uid).role == 'admin'",
  "delete": false
}
```

### Users
```json
{
  "read": "auth.uid != null && (doc._openid == auth.uid || get('database.Users.' + auth.uid).role == 'admin')",
  "write": "get('database.Users.' + auth.uid).role == 'admin'"
}
```

### EmailConfig
```json
{
  "read": "auth.uid != null && (doc.userId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')",
  "write": "auth.uid != null && (doc.userId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')"
}
```

### PendingChanges
```json
{
  "read": "auth.uid != null",
  "create": "auth.uid != null",
  "update": "get('database.Users.' + auth.uid).role == 'admin'",
  "delete": false
}
```

### AuditLog
```json
{
  "read": "get('database.Users.' + auth.uid).role == 'admin'",
  "write": false
}
```

### ReportCache
```json
{
  "read": "auth.uid != null",
  "write": false
}
```

### ParseQueue
```json
{
  "read": "auth.uid != null",
  "write": false
}
```

### ErrorLog
```json
{
  "read": "get('database.Users.' + auth.uid).role == 'admin'",
  "write": "auth.uid != null"
}
```

## 三、云函数部署

在项目目录下执行：

```bash
cd recruit-tracker-v2

# 安装 CloudBase CLI（如未安装）
npm install -g @cloudbase/cli

# 登录
tcb login

# 部署全部云函数
tcb fn deploy db-backup
tcb fn deploy health-monitor
```

## 四、环境变量

在 CloudBase 控制台 → 云函数 → 环境变量中配置：

| 变量名 | 说明 | 何时需要 |
|--------|------|---------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 阶段 2（简历解析） |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址（默认 https://api.deepseek.com） | 阶段 2 |
| `TENCENT_OCR_SECRET_ID` | 腾讯云 OCR SecretId | 阶段 2 |
| `TENCENT_OCR_SECRET_KEY` | 腾讯云 OCR SecretKey | 阶段 2 |
| `IMAP_MASTER_SECRET` | IMAP 密码加密主密钥（64 位 hex） | 阶段 3（邮箱归集） |
| `IMAP_KEY_SALT` | IMAP 密码加密盐值（32 位 hex） | 阶段 3 |
| `ENV_ID` | CloudBase 环境 ID | 全部云函数 |

## 五、匿名登录开启

控制台 → 用户管理 → 登录设置 → 开启匿名登录

## 六、B3 验证步骤

部署安全规则后，按规划书 §10.7.2 步骤验证 `get()` 跨集合查询是否可用：

1. 在 Users 表中创建测试用户记录（`_openid` 为当前匿名用户的 uid，role 为 'admin'）
2. 前端尝试读取 Application 集合
3. 观察是否报权限错误
4. 如 `get()` 不生效 → 切换到 auth-proxy 云函数备用方案
