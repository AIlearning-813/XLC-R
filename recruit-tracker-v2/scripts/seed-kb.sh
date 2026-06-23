#!/bin/bash
# 知识库种子导入脚本
# 运行方式：bash scripts/seed-kb.sh

ENV_ID="xlc-recruit-d1gmbx8gybc8a3565"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRIES_FILE="$SCRIPT_DIR/knowledge-entries.json"

echo "🚀 知识库种子导入"
echo "环境: $ENV_ID"
echo "数据: $ENTRIES_FILE"
echo ""

# 用 node 一次性生成所有插入命令并执行
node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENV_ID = '$ENV_ID';
const entries = JSON.parse(fs.readFileSync('$ENTRIES_FILE', 'utf-8'));
const now = new Date().toISOString();

console.log('读取到 ' + entries.length + ' 条知识条目\n');

let success = 0, fail = 0;
const tempDir = '/tmp/kb_seed_' + Date.now();
fs.mkdirSync(tempDir, { recursive: true });

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const label = '[' + (i+1) + '/' + entries.length + '] ' + entry.title.slice(0, 50);
  process.stdout.write(label + ' ');

  try {
    const doc = {
      ...entry,
      useCount: 0,
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    };

    const cmd = JSON.stringify([{
      TableName: 'KnowledgeBase',
      CommandType: 'INSERT',
      Command: JSON.stringify({
        insert: 'KnowledgeBase',
        documents: [doc],
      }),
    }]);

    // 写入临时文件（避免 Windows shell 转义问题）
    const tempFile = path.join(tempDir, 'entry_' + i + '.json');
    fs.writeFileSync(tempFile, cmd);

    // 使用 cat 读取文件（绕过 shell 转义）
    const result = execSync(
      'npx tcb db nosql execute --env-id ' + ENV_ID + ' --json --command \"$(cat ' + tempFile + ')\"',
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    if (result.includes('\"ok\"')) {
      console.log('✅');
      success++;
    } else {
      console.log('❌');
      console.log('    ' + result.trim().split('\\n').pop().slice(0, 100));
      fail++;
    }
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    if (msg.includes('duplicate') || msg.includes('E11000')) {
      console.log('⏭️  已存在');
    } else {
      console.log('❌ ' + msg.slice(0, 80).replace(/\\n/g, ' '));
      fail++;
    }
  }

  if ((i + 1) % 5 === 0) {
    // 批量暂停
    const wait = require('child_process').execSync('sleep 0.5', { stdio: 'ignore' });
  }
}

// 清理临时文件
try { fs.rmSync(tempDir, { recursive: true }); } catch(e) {}

console.log('');
console.log('═══════════════════════════════════════');
console.log('      知识库种子写入完成');
console.log('═══════════════════════════════════════');
console.log('  ✅ 新增: ' + success + ' 条');
console.log('  ❌ 失败: ' + fail + ' 条');
console.log('═══════════════════════════════════════');
"