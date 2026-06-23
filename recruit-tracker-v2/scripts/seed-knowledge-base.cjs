/**
 * 知识库种子脚本（两步执行）
 *
 * 步骤 1（Node.js）：将 knowledge-entries.json 拆分为单条 MgoCommands JSON 文件
 * 步骤 2（bash）：逐条通过 tcb CLI 插入
 *
 * 完整运行方式：
 *   node scripts/seed-knowledge-base.cjs && bash scripts/seed-kb.sh
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';
const ENTRIES_FILE = path.join(__dirname, 'knowledge-entries.json');
const TMP_DIR = path.join(__dirname, '.tmp');

// ===== 步骤 1：生成临时 JSON 命令文件 =====
console.log('📖 步骤 1/2：准备插入命令...\n');

let entries;
try {
  entries = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf-8'));
} catch (err) {
  console.error('❌ 无法读取 knowledge-entries.json:', err.message);
  process.exit(1);
}

console.log(`   读取到 ${entries.length} 条知识条目`);

// 创建临时目录
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// 为每条生成插入命令文件
const now = new Date().toISOString();
let count = 0;

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const doc = {
    ...entry,
    useCount: 0,
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,
  };

  const cmd = [{
    TableName: 'KnowledgeBase',
    CommandType: 'INSERT',
    Command: JSON.stringify({
      insert: 'KnowledgeBase',
      documents: [doc],
    }),
  }];

  const fname = path.join(TMP_DIR, `entry_${String(i).padStart(3, '0')}.json`);
  fs.writeFileSync(fname, JSON.stringify(cmd), 'utf-8');
  count++;
}

console.log(`   已生成 ${count} 个临时命令文件 → ${TMP_DIR}`);

// ===== 步骤 2：bash 逐条插入 =====
console.log('\n🚀 步骤 2/2：bash 逐条写入...\n');

let success = 0;
let fail = 0;

// 使用 bash 执行循环（避免 Windows cmd.exe 的 JSON 转义问题）
const bashScript = `
success=0; fail=0;
for f in ${TMP_DIR.replace(/\\/g, '/')}/entry_*.json; do
  idx=$(basename "$f" .json | sed 's/entry_//')
  title=$(node -e "const c=JSON.parse(require('fs').readFileSync('$f','utf-8')); console.log(JSON.parse(c[0].Command).documents[0].title.slice(0,50))")
  printf "[%s] %-50s " "$idx" "$title"
  result=$(npx tcb db nosql execute --env-id ${ENV_ID} --json --command "$(cat "$f")" 2>&1)
  if echo "$result" | grep -q '"ok"'; then
    echo "✅"
    success=$((success + 1))
  else
    echo "❌"
    fail=$((fail + 1))
  fi
  sleep 0.3
done
echo ""
echo "✅ 新增: $success  ❌ 失败: $fail"
rm -rf ${TMP_DIR.replace(/\\/g, '/')}
`;

try {
  execSync(bashScript, {
    encoding: 'utf-8',
    timeout: 300000,
    stdio: 'inherit',
    shell: 'bash',
  });
} catch (err) {
  console.error('\n⚠️  部分条目写入失败');
  console.log('可重新运行此脚本重试（已成功的条目请先从 JSON 中移除）。');
  process.exit(1);
}

console.log('\n═══════════════════════════════════════');
console.log('      知识库种子写入完成');
console.log('═══════════════════════════════════════');
console.log('💡 AI 招聘助手现在可以检索这些知识条目。');
console.log('   进入「设置」→「知识库」可查看和管理。');
