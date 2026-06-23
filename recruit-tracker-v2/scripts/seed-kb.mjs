/**
 * 知识库种子导入（Node.js 独立脚本）
 *
 * 策略：写命令到临时文件，通过 bash -c "$(cat file)" 传给 tcb CLI。
 * 这样 JSON 不经过 Windows cmd.exe 的转义，避免乱码问题。
 *
 * 运行：node scripts/seed-kb.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';
const ENTRIES_FILE = join(__dirname, 'knowledge-entries.json');
// 使用 /tmp/ 而非 os.tmpdir()，因为 bash 的 cat 需要 Unix 路径
const TEMP_DIR = '/tmp/kb_seed_' + Date.now();

// 读取条目
const entries = JSON.parse(readFileSync(ENTRIES_FILE, 'utf-8'));
console.log(`📖 读取到 ${entries.length} 条知识条目\n`);
console.log(`临时目录: ${TEMP_DIR}\n`);

mkdirSync(TEMP_DIR, { recursive: true });

const now = new Date().toISOString();
let success = 0;
let fail = 0;
let skip = 0;

console.log('🚀 开始逐条写入...\n');

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const shortTitle = entry.title.length > 48
    ? entry.title.slice(0, 45) + '...'
    : entry.title;
  const label = `[${String(i + 1).padStart(2, '0')}/${entries.length}] ${shortTitle}`;
  process.stdout.write(label.padEnd(65) + ' ');

  try {
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

    // 写命令到临时文件
    const tempFile = join(TEMP_DIR, `entry_${String(i).padStart(3, '0')}.json`);
    writeFileSync(tempFile, JSON.stringify(cmd), 'utf-8');

    // 关键：通过 bash -c 执行，利用 bash 的 $(cat file) 传递 JSON
    // 这样 JSON 内容不会经过 Windows cmd.exe 的转义
    const bashCmd = `npx tcb db nosql execute --env-id ${ENV_ID} --json --command "$(cat ${tempFile})"`;
    const result = execSync(bashCmd, {
      encoding: 'utf-8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: 'bash',   // <-- 关键：使用 bash 而不是默认的 cmd.exe
    });

    // 判断结果
    const cleaned = result.replace(/\s/g, '');
    if (cleaned.includes('"ok":1') || cleaned.includes('"ok":{"$numberDouble":"1.0"}')) {
      console.log('✅');
      success++;
    } else if (cleaned.includes('duplicate') || cleaned.includes('E11000')) {
      console.log('⏭️  重复跳过');
      skip++;
    } else {
      console.log('⚠️  未知结果');
      fail++;
    }
  } catch (err) {
    const stderr = (err.stderr || err.message || '').toString();
    const stdout = (err.stdout || '').toString();
    const combined = (stdout + stderr).replace(/\s/g, '');

    if (combined.includes('"ok":1') || combined.includes('"ok":{"$numberDouble":"1.0"}')) {
      // tcb CLI 输出到 stderr 导致 exitCode != 0，但实际成功
      console.log('✅');
      success++;
    } else if (combined.includes('duplicate') || combined.includes('E11000')) {
      console.log('⏭️  重复跳过');
      skip++;
    } else {
      const shortErr = stderr.slice(0, 60).replace(/\n/g, ' ');
      console.log(`❌ ${shortErr}`);
      fail++;
    }
  }

  // 每 5 条暂停一下
  if ((i + 1) % 5 === 0 && i < entries.length - 1) {
    await new Promise(r => setTimeout(r, 600));
  }
}

// 清理临时文件
try { rmSync(TEMP_DIR, { recursive: true }); } catch (e) { /* ignore */ }

console.log('\n═══════════════════════════════════════');
console.log('      知识库种子写入完成');
console.log('═══════════════════════════════════════');
console.log(`  ✅ 新增: ${success} 条`);
console.log(`  ⏭️  跳过: ${skip} 条`);
console.log(`  ❌ 失败: ${fail} 条`);
console.log('═══════════════════════════════════════\n');

if (success > 0) {
  console.log('💡 知识条目已写入，AI 招聘助手现在可以检索这些内容。');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
