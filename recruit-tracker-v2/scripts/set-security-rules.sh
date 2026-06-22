#!/bin/bash
# 批量设置 CloudBase 数据库安全规则
ENV="xlc-recruit-d1gmbx8gybc8a3565"
DB="database.User"  # CloudBase 中集合名是 User（单数）

echo "🔐 开始设置安全规则..."

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

# 1. User
set_rule "User" '{"read":"auth.uid != null && (doc._openid == auth.uid || get('\''database.User'\'' + auth.uid).role == '\''admin'\'')","write":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''"}'

# 2. Job
set_rule "Job" '{"read":"auth.uid != null","create":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''","update":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''","delete":false}'

# 3. Candidate
set_rule "Candidate" '{"read":"auth.uid != null","write":"auth.uid != null && (doc.createdBy == auth.uid || get('\''database.User'\'' + auth.uid).role == '\''admin'\'')"}'

# 4. Application
set_rule "Application" '{"read":"auth.uid != null && (doc.ownerId == auth.uid || get('\''database.User'\'' + auth.uid).role == '\''admin'\'')","write":"auth.uid != null && (doc.ownerId == auth.uid || get('\''database.User'\'' + auth.uid).role == '\''admin'\'')"}'

# 5. EmailConfig
set_rule "EmailConfig" '{"read":"auth.uid != null && (doc.userId == auth.uid || get('\''database.User'\'' + auth.uid).role == '\''admin'\'')","write":"auth.uid != null && (doc.userId == auth.uid || get('\''database.User'\'' + auth.uid).role == '\''admin'\'')"}'

# 6. PendingChanges
set_rule "PendingChanges" '{"read":"auth.uid != null","create":"auth.uid != null","update":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''","delete":false}'

# 7. AuditLog
set_rule "AuditLog" '{"read":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''","write":false}'

# 8. ReportCache
set_rule "ReportCache" '{"read":"auth.uid != null","write":false}'

# 9. ParseQueue
set_rule "ParseQueue" '{"read":"auth.uid != null","write":false}'

# 10. ErrorLog
set_rule "ErrorLog" '{"read":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''","write":"auth.uid != null"}'

# 额外：新集合
echo "📝 额外集合..."
set_rule "CompanyProfile" '{"read":"auth.uid != null","write":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''"}'
set_rule "KnowledgeBase" '{"read":"auth.uid != null","write":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''"}'
set_rule "RecruitmentInsight" '{"read":"auth.uid != null","write":"get('\''database.User'\'' + auth.uid).role == '\''admin'\''"}'

echo ""
echo "🎯 安全规则设置完成！"

# 验证
echo ""
echo "📊 验证结果："
tcb permission get collection --env-id "$ENV" 2>&1 | grep -E "(Resource|Permission|SecurityRule)" | head -30
