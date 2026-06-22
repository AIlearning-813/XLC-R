#!/bin/bash
# 一键初始化脚本 — 新励成招聘管理系统 V2.0
#
# 用途：全新环境首次部署时运行，按顺序完成所有初始化步骤。
#   1. 创建必备集合（如不存在）
#   2. 部署安全规则
#   3. 创建数据库索引
#   4. 初始化默认管理员和招聘专员账号
#   5. 写入默认系统配置
#   6. 部署全部云函数
#   7. 冒烟测试
#
# 使用方式：
#   bash scripts/init-all.sh

set -e

ENV_ID="xlc-recruit-d1gmbx8gybc8a3565"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo ""
echo "🚀 新励成招聘管理系统 V2.0 — 一键初始化"
echo "   环境: ${ENV_ID}"
echo "   时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ===== 步骤 1：创建必备集合 =====
echo "📦 步骤 1/7：创建必备集合..."
COLLECTIONS=("Config" "CommunicationLog" "ParseCorrectionBank" "ProcessingLock")
for col in "${COLLECTIONS[@]}"; do
  echo -n "  $col ... "
  if npx tcb db nosql execute --command "[{\"TableName\":\"$col\",\"CommandType\":\"COMMAND\",\"Command\":\"{\\\"create\\\":\\\"$col\\\"}\"}]" --env-id "$ENV_ID" 2>&1 | grep -q '"ok"'; then
    echo "✅"
  else
    echo "⚠️（可能已存在）"
  fi
done
echo ""

# ===== 步骤 2：部署安全规则 =====
echo "🔒 步骤 2/7：部署安全规则..."
bash "$SCRIPT_DIR/fix-security-rules.sh"
echo ""

# ===== 步骤 3：创建索引 =====
echo "📊 步骤 3/7：创建数据库索引..."
node "$SCRIPT_DIR/deploy-indexes.cjs"
echo ""

# ===== 步骤 4：初始化默认账号 =====
echo "👤 步骤 4/7：初始化默认账号..."
npx tcb fn invoke auth-proxy --data '{"action":"seedDefaults"}' --env-id "$ENV_ID" 2>&1 || true
echo ""

# ===== 步骤 5：写入默认配置 =====
echo "⚙️  步骤 5/7：写入默认系统配置..."
npx tcb fn invoke auth-proxy --data '{"action":"seedDefaults"}' --env-id "$ENV_ID" 2>&1 || true
echo "（Config 集合默认值由前端 useConfigStore 兜底，无需额外初始化）"
echo ""

# ===== 步骤 6：部署全部云函数 =====
echo "☁️  步骤 6/7：部署全部云函数..."
npx tcb fn deploy --all --env-id "$ENV_ID" --force 2>&1
echo ""

# ===== 步骤 7：冒烟测试 =====
echo "🧪 步骤 7/7：运行冒烟测试..."
node "$SCRIPT_DIR/smoke-test.cjs"
echo ""

echo "✅ 一键初始化完成！"
echo "   登录地址：https://${ENV_ID}.tcloudbaseapp.com"
echo "   管理员账号：admin"
echo "   初始密码：请查看 CloudBase 云函数日志（auth-proxy → seedDefaults）"
echo "   ⚠️  首次登录后请立即修改密码！"
echo ""
