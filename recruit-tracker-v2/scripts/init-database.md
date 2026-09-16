# CloudBase 数据库初始化指南

> 环境 ID: `xlc-recruit-d1gmbx8gybc8a3565`
> 最后更新：2026-06-23（P1-2 补充高频查询索引）

---

## 一、集合与索引清单（23 个集合，P1-2 新增 5 个索引）

| # | 集合名 | 权限预设 | 索引名 | 字段 | 方向 | 唯一 | 说明 |
|---|--------|---------|--------|------|------|------|------|
| 1 | **Users** | ADMINWRITE | `openid_unique` | `_openid` | ↑ 升序 | ✅ | |
| 2 | **Job** | ADMINWRITE | `dept_status` | `department` + `status` | ↑ 升序 + ↑ 升序 | ❌ | |
| 3 | **Candidate** | ADMINWRITE | `phone_idx` | `phone` | ↑ 升序 | ❌ | |
| 4 | **Candidate** | ADMINWRITE | `status_deleted` | `status` + `deletedAt` | ↑ 升序 + ↓ 降序 | ❌ | 🆕 P1-2：回收站查询 |
| 5 | **Candidate** | ADMINWRITE | `phone_hash` | `phoneHash` | ↑ 升序 | ❌ | 🆕 P1-2：HMAC 去重 |
| 6 | **Candidate** | ADMINWRITE | `email_hash` | `emailHash` | ↑ 升序 | ❌ | 🆕 P1-2：HMAC 去重 |
| 7 | **Application** | ADMINWRITE | `owner_status` | `ownerId` + `status` | ↑ 升序 + ↑ 升序 | ❌ | |
| 8 | **Application** | ADMINWRITE | `job_status` | `jobId` + `status` | ↑ 升序 + ↑ 升序 | ❌ | |
| 9 | **Application** | ADMINWRITE | `cand_status` | `candidateId` + `status` | ↑ 升序 + ↑ 升序 | ❌ | 🆕 P1-2：回收站关联恢复 |
| 10 | **EmailConfig** | ADMINWRITE | `user_unique` | `userId` | ↑ 升序 | ✅ | |
| 11 | **ParseQueue** | ADMINWRITE | `status_time` | `status` + `createdAt` | ↑ 升序 + ↑ 升序 | ❌ | |
| 12 | **ParseQueue** | ADMINWRITE | `source_config` | `sourceEmailConfigId` | ↑ 升序 | ❌ | 🆕 P1-2：强制重扫 |
| 13 | **ParseNotification** | ADMINWRITE | `user_status_time` | `userId` + `status` + `createdAt` | ↑ 升序 + ↑ 升序 + ↓ 降序 | ❌ | |
| 14 | **AuditLog** | ADMINWRITE | `time_desc` | `createdAt` | ↓ 降序 | ❌ | |
| 15 | **PendingChanges** | ADMINWRITE | `status_time` | `status` + `submittedAt` | ↑ 升序 + ↑ 升序 | ❌ | 集合名以代码里的 `db.collection('PendingChanges')` 为准 |
| 16 | **ErrorLog** | ADMINWRITE | `time_desc` | `createdAt` | ↓ 降序 | ❌ | |
| 17 | **ErrorLog** | ADMINWRITE | `severity_time` | `severity` + `createdAt` | ↑ 升序 + ↓ 降序 | ❌ | |
| 18 | **CompanyProfile** | ADMINWRITE | — | — | — | — | |
| 19 | **KnowledgeBase** | ADMINWRITE | `category_status` | `category` + `status` | ↑ 升序 + ↑ 升序 | ❌ | |
| 20 | **KnowledgeBase** | ADMINWRITE | `time_desc` | `createdAt` | ↓ 降序 | ❌ | |
| 21 | **RecruitmentInsight** | ADMINWRITE | `type_idx` | `type` | ↑ 升序 | ❌ | |
| 22 | **DuplicateExclusion** | ADMINWRITE | `candA` | `candidateA` | ↑ 升序 | ❌ | |
| 23 | **DuplicateExclusion** | ADMINWRITE | `candB` | `candidateB` | ↑ 升序 | ❌ | |
| 24 | **ReportCache** | ADMINWRITE | `type_expires` | `reportType` + `expiresAt` | ↑ 升序 + ↑ 升序 | ❌ | |
| 25 | **CommunicationLog** | ADMINWRITE | `cand_time` | `candidateId` + `createdAt` | ↑ 升序 + ↓ 降序 | ❌ | |
| 26 | **ParseCorrectionBank** | ADMINWRITE | `field_ov_cv` | `field` + `originalValue` + `correctedValue` | ↑ 升序 + ↑ 升序 + ↑ 升序 | ❌ | |
| 27 | **ProcessingLock** | ADMINWRITE | `lock_unique` | `lockKey` | ↑ 升序 | ✅ | |
| 28 | **Config** | ADMINWRITE | — | — | — | — | |
| 29 | **Application** | ADMINWRITE | `owner_status_updated` | `ownerId` + `status` + `updatedAt` + `_id` | ↑ 升序 + ↑ 升序 + ↓ 降序 + ↑ 升序 | ❌ | 🆕 D-2：专员三 Tab 分页 + 角标 |
| 30 | **Application** | ADMINWRITE | `status_updated` | `status` + `updatedAt` + `_id` | ↑ 升序 + ↓ 降序 + ↑ 升序 | ❌ | 🆕 D-2：admin 同上（admin 查询不带 ownerId，索引 29 用不上） |
| 31 | **Application** | ADMINWRITE | `owner_cand` | `ownerId` + `candidateId` | ↑ 升序 + ↑ 升序 | ❌ | 🆕 D-2：专员待分配聚合 `$match{ownerId}` + `$group by candidateId` |
| 32 | **Application** | ADMINWRITE | `cand` | `candidateId` | ↑ 升序 | ❌ | 🆕 D-2：admin 待分配聚合（全库作用域） |
| 33 | **Candidate** | ADMINWRITE | `owner_id` | `ownerId` + `_id` | ↑ 升序 + ↑ 升序 | ❌ | 🆕 D-2：专员 `|C_me|` 与孤儿交集的分块 count |

> **P1-2 新增 5 个索引**（#4-6, #9, #12）；**D-2 新增 5 个索引**（#29-33）。共 **31 个索引**（#18、#28 两个集合无索引）。
>
> ⚠️ **注意**：以上索引需在 CloudBase 控制台手动创建。NoSQL 文档数据库不支持通过 SDK 创建索引
> （`@cloudbase/node-sdk` 与 CLI 的 NoSQL 子命令均无创建索引能力）。
>
> ✅ **一致性由脚本校验**：`node scripts/deploy-indexes.cjs` 会输出控制台操作清单，并交叉比对本文档的
> 「集合名 + 索引名」集合；两者不一致时以非零码退出。改索引请改脚本里的 `INDEXES` 数组再同步本文档。
>
> **D-2 索引的方向不能改**：`updatedAt` 必须降序、`_id` 必须升序，与代码里的排序链
> （`.orderBy('updatedAt','desc').orderBy('_id','asc')`）逐位一致，否则会退化成 32MB 阻塞式内存排序。
> `ownerId` 必须最左（ESR 规则）：专员查询恒以 `ownerId = 我` 等值开头，放后面就只能按 `status` 前缀
> 扫全部专员的数据再逐条过滤。

---

## 二、安全规则（10 条）

### Users
```json
{
  "read": "auth.uid != null && (doc._openid == auth.uid || get('database.Users.' + auth.uid).role == 'admin')",
  "write": "get('database.Users.' + auth.uid).role == 'admin'"
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

### Candidate
```json
{
  "read": "auth.uid != null",
  "write": "auth.uid != null && (doc.createdBy == auth.uid || get('database.Users.' + auth.uid).role == 'admin')"
}
```

### Application
```json
{
  "read": "auth.uid != null && (doc.ownerId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')",
  "write": "auth.uid != null && (doc.ownerId == auth.uid || get('database.Users.' + auth.uid).role == 'admin')"
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

---

## 三、匿名登录
控制台 → 用户管理 → 登录设置 → 开启 **匿名登录**

## 四、环境变量（阶段 2 配置）
| 变量名 | 说明 |
|--------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `ENV_ID` | `xlc-recruit-d1gmbx8gybc8a3565` |

## 五、B3 验证（部署安全规则后执行）
1. 在 Users 表中手动创建一条记录：`{ _openid: "当前匿名用户uid", role: "admin" }`
2. 前端尝试读取 Application 集合 → 观察是否报权限错误
3. 如 `get()` 不生效 → 切换到 auth-proxy 云函数备用方案
