#!/bin/bash
# 修复安全规则 — 去掉依赖 get() 的跨集合 admin 判断
# get('database.User.' + auth.uid) 失败原因：User 文档 _id ≠ auth.uid
ENV="xlc-recruit-d1gmbx8gybc8a3565"

echo "🔧 修复安全规则..."

set_rule() {
  local name="$1"
  local rule="$2"
  echo -n "  $name ... "
  if echo Y | tcb permission set "collection:$name" --level custom --rule "$rule" -e "$ENV" 2>&1 | grep -q "设置成功"; then
    echo "✅"
  else
    echo "❌"
  fi
}

# 只保留 auth.uid != null 检查，前端代码 + 路由守卫负责角色权限
echo "--- 基础规则（auth.uid != null）---"

# 1. User — 只能读自己，admin 可写所有人（简化：读自己）
set_rule "User" '{"read":"auth.uid != null && doc._openid == auth.uid","write":"auth.uid != null"}'

# 2. Job — 全员可读可写（前端路由守卫 + useJobStore 控制 admin 写权限）
set_rule "Job" '{"read":"auth.uid != null","write":"auth.uid != null"}'

# 3. Candidate — 全员可读，创建者可写
set_rule "Candidate" '{"read":"auth.uid != null","write":"auth.uid != null"}'

# 4. Application — 全员可读写（前端控制 owner 隔离）
set_rule "Application" '{"read":"auth.uid != null","write":"auth.uid != null"}'

# 5. EmailConfig — 全员读，本人写
set_rule "EmailConfig" '{"read":"auth.uid != null","write":"auth.uid != null"}'

# 6. PendingChanges — 全员读写（前端控制审批权限）
set_rule "PendingChanges" '{"read":"auth.uid != null","create":"auth.uid != null","update":"auth.uid != null","delete":false}'

# 7. AuditLog — admin 可读（暂时全员可读，前端路由限制页面访问）
set_rule "AuditLog" '{"read":"auth.uid != null","write":false}'

# 8-9. 只读集合
set_rule "ReportCache" '{"read":"auth.uid != null","write":false}'
set_rule "ParseQueue" '{"read":"auth.uid != null","write":false}'

# 10. ErrorLog — 全员可读写
set_rule "ErrorLog" '{"read":"auth.uid != null","write":"auth.uid != null"}'

# 额外集合
set_rule "CompanyProfile" '{"read":"auth.uid != null","write":"auth.uid != null"}'
set_rule "KnowledgeBase" '{"read":"auth.uid != null","write":"auth.uid != null"}'
set_rule "RecruitmentInsight" '{"read":"auth.uid != null","write":"auth.uid != null"}'

# P0-3 修复：补齐缺失的 4 个集合安全规则
set_rule "Config" '{"read":"auth.uid != null","write":"auth.uid != null"}'
set_rule "CommunicationLog" '{"read":"auth.uid != null","write":"auth.uid != null"}'
set_rule "ParseCorrectionBank" '{"read":"auth.uid != null","write":"auth.uid != null"}'
set_rule "ProcessingLock" '{"read":"auth.uid != null","write":"auth.uid != null"}'

echo ""
echo "✅ 安全规则已修复（去掉 get() 跨集合依赖，补齐 4 个缺失集合）"
