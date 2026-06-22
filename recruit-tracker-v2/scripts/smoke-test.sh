#!/bin/bash
# 端到端冒烟测试 — CLI 版本
# 使用 tcb fn invoke 调用云函数，依赖 CLI 登录态（无需 API 密钥）
set -e

ENV="xlc-recruit-d1gmbx8gybc8a3565"
PASS=0
FAIL=0

check() {
  local label="$1"
  shift
  echo -n "  $label ... "
  if "$@" 2>&1 | grep -qE '"success":true|"success": true|"ok":true|"ok": 1'; then
    echo "✅"
    ((PASS++))
  else
    echo "❌"
    ((FAIL++))
  fi
}

check_fn() {
  local label="$1"
  local fn="$2"
  local data="$3"
  echo -n "  $label ... "
  # tcb fn invoke 输出包含 result 字段
  if npx tcb fn invoke "$fn" --data "$data" --env-id "$ENV" 2>&1 | grep -qE '"success":true|"ok": 1'; then
    echo "✅"
    ((PASS++))
  else
    echo "❌"
    ((FAIL++))
  fi
}

echo ""
echo "🧪 新励成招聘管理系统 V2.0 — 端到端冒烟测试 (CLI)"
echo "   环境: $ENV"
echo "   时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ── 云函数心跳 ──
echo "── 云函数心跳 ──"
check_fn "auth-proxy 可调用"        "auth-proxy"              '{"action":"seedDefaults"}'
check_fn "report-aggregator 可调用"  "report-aggregator"       '{"type":"overview"}'
check_fn "resume-parser-proxy 可调用" "resume-parser-proxy"    '{"resumeText":"测试"}'
check_fn "write-audit-log 可调用"    "write-audit-log"         '{"action":"smoke_test","entityType":"System","entityIds":["test"],"detail":{},"operator":"test"}'

# ── 集合可用性 ──
echo "── 集合可用性 ──"
for col in Users Job Candidate Application EmailConfig PendingChanges AuditLog ReportCache ParseQueue ErrorLog Config CommunicationLog ParseCorrectionBank ProcessingLock CompanyProfile KnowledgeBase RecruitmentInsight; do
  echo -n "  $col ... "
  if npx tcb db nosql execute --command "[{\"TableName\":\"$col\",\"CommandType\":\"COMMAND\",\"Command\":\"{\\\"count\\\":\\\"$col\\\"}\"}]" --env-id "$ENV" 2>&1 | grep -q '"ok"'; then
    echo "✅"
    ((PASS++))
  else
    echo "❌"
    ((FAIL++))
  fi
done

# ── 云函数列表对比 ──
echo "── 已部署云函数 ──"
EXPECTED_FNS=("auth-proxy" "get-file-url" "health-monitor" "db-backup" "parse-queue-processor" "email-scanner" "write-audit-log" "archive-old-applications" "report-aggregator" "rag-assistant-proxy" "web-search-agent" "history-insight-generator" "report-cache-warmer" "resume-parser-proxy")
for fn in "${EXPECTED_FNS[@]}"; do
  echo -n "  $fn ... "
  if npx tcb fn list --env-id "$ENV" 2>&1 | grep -q "\"$fn\""; then
    echo "✅"
    ((PASS++))
  else
    echo "❌"
    ((FAIL++))
  fi
done

# ── 汇总 ──
TOTAL=$((PASS + FAIL))
echo ""
echo "📊 结果: ✅ $PASS / ❌ $FAIL / 共 $TOTAL 项"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "⚠️  部分测试失败"
  exit 1
else
  echo "🎉 全部通过！系统核心链路正常。"
fi
