#!/bin/bash
# 新励成招聘管理系统 V2.0 — 部署脚本
#
# 用法：
#   ./scripts/deploy.sh          # 构建 + 部署到当前环境
#   ./scripts/deploy.sh dev      # 构建 + 部署到 dev 环境
#   ./scripts/deploy.sh prod     # 构建 + 部署到 prod 环境
#   ./scripts/deploy.sh --build-only  # 仅构建不部署
#
# 前置条件：
#   1. 安装了 @cloudbase/cli: npm install -g @cloudbase/cli
#   2. 已登录: tcb login
#   3. .env.local 或 .env.production 已配置 VITE_CLOUDBASE_ENV_ID

set -euo pipefail

ENV="${1:-prod}"
BUILD_ONLY=false

if [ "$ENV" = "--build-only" ]; then
  BUILD_ONLY=true
  ENV="prod"
fi

echo "🚀 新励成招聘管理系统 V2.0 — 部署脚本"
echo "   目标环境: $ENV"
echo ""

# 1. 构建
echo "📦 开始构建..."
npm run build
echo "✅ 构建完成"
echo ""

if $BUILD_ONLY; then
  echo "📁 构建产物位于 dist/ 目录"
  exit 0
fi

# 2. 选择环境 ID
if [ "$ENV" = "dev" ]; then
  ENV_ID="${VITE_CLOUDBASE_ENV_ID_DEV:-}"
  if [ -z "$ENV_ID" ]; then
    # 尝试从 .env.development 读取
    if [ -f .env.development ]; then
      ENV_ID=$(grep VITE_CLOUDBASE_ENV_ID .env.development | cut -d'=' -f2)
    fi
  fi
else
  ENV_ID="${VITE_CLOUDBASE_ENV_ID:-}"
  if [ -z "$ENV_ID" ]; then
    if [ -f .env.production ]; then
      ENV_ID=$(grep VITE_CLOUDBASE_ENV_ID .env.production | cut -d'=' -f2)
    elif [ -f .env.local ]; then
      ENV_ID=$(grep VITE_CLOUDBASE_ENV_ID .env.local | cut -d'=' -f2)
    fi
  fi
fi

if [ -z "$ENV_ID" ]; then
  echo "❌ 未找到 CloudBase 环境 ID。"
  echo "   请设置环境变量 VITE_CLOUDBASE_ENV_ID 或在 .env.local 中配置。"
  exit 1
fi

echo "🎯 目标环境 ID: $ENV_ID"
echo ""

# 3. 部署到 CloudBase 静态托管
echo "📤 部署到 CloudBase 静态托管..."
tcb hosting deploy dist/ -e "$ENV_ID"
echo "✅ 部署完成"
echo ""

# 4. 显示部署结果
echo "🌐 访问地址:"
echo "   https://${ENV_ID}.tcloudbaseapp.com"
echo ""
echo "💡 提示："
echo "   - 如果页面未更新，请尝试 Ctrl+F5 强制刷新或添加 ?v=$(date +%s) 参数"
echo "   - 运行测试：npm test"
echo "   - 初始化种子数据：node scripts/seed-data.js"
