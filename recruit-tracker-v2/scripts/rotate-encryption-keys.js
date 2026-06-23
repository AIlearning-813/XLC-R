/**
 * rotate-encryption-keys.js — 加密密钥轮换迁移脚本
 *
 * P0-1 修复：旧 VITE_MASTER_SECRET/VITE_SALT_PEPPER 已从 .env.local 中删除并轮换为新值。
 * 本脚本将数据库中所有 EmailConfig 的 imapPassword 用旧密钥解密，再用新密钥加密。
 *
 * 用法：
 *   1. 在 CloudBase 控制台为 email-scanner 云函数设置新的 MASTER_SECRET 和 SALT_PEPPER
 *   2. 临时将 OLD_MASTER_SECRET 和 OLD_SALT_PEPPER 也加入云函数环境变量（迁移期间）
 *   3. 部署并运行此脚本：node scripts/rotate-encryption-keys.js
 *   4. 验证后删除 OLD_MASTER_SECRET 和 OLD_SALT_PEPPER 环境变量
 *
 * 前提：当前目录为项目根目录，已安装 @cloudbase/node-sdk
 */

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');

// ===== 配置 =====
const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

// 旧密钥（已泄露，需轮换）
const OLD_MASTER_SECRET = '1b38f7c94f2b433b00c9dd3d2614b5bdc250e3f01a26592763d78dff09ca1503';
const OLD_SALT_PEPPER = 'ae8bacece837d352a6741ec7568c357a';

// 新密钥（从 cloud-functions/email-scanner/.env.example 获取）
const NEW_MASTER_SECRET = '81c27d0d0aaa88b66da95176850ab761ee206504f031d7b59c4ec4634e566f84';
const NEW_SALT_PEPPER = 'a8281deb8f90d2af831c9cf9336e42ec';

// PBKDF2 参数（与 crypto.js 一致）
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = 'sha256';
const AES_KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// ===== 加解密工具 =====

function deriveKey(masterSecret, salt, pepper) {
  const keyMaterial = masterSecret + pepper;
  return crypto.pbkdf2Sync(keyMaterial, salt, PBKDF2_ITERATIONS, AES_KEY_LENGTH, PBKDF2_HASH);
}

function decryptWith(storedPackage, masterSecret, pepper) {
  if (!storedPackage) throw new Error('加密数据不能为空');
  if (storedPackage.startsWith('PLAINTEXT:')) {
    return storedPackage.slice('PLAINTEXT:'.length);
  }

  const packageBuffer = Buffer.from(storedPackage, 'base64');
  if (packageBuffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('加密数据格式无效：长度不足');
  }

  const salt = packageBuffer.subarray(0, SALT_LENGTH);
  const iv = packageBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const encryptedData = packageBuffer.subarray(SALT_LENGTH + IV_LENGTH);
  const ciphertext = encryptedData.subarray(0, encryptedData.length - AUTH_TAG_LENGTH);
  const authTag = encryptedData.subarray(encryptedData.length - AUTH_TAG_LENGTH);

  const key = deriveKey(masterSecret, salt, pepper);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

function encryptWith(plaintext, masterSecret, pepper) {
  if (!plaintext) throw new Error('密码不能为空');

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterSecret, salt, pepper);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const packageBuffer = Buffer.concat([salt, iv, encrypted, authTag]);
  return packageBuffer.toString('base64');
}

// ===== 主逻辑 =====

async function main() {
  const app = cloudbase.init({ env: ENV_ID });
  const db = app.database();

  console.log('🔐 开始密钥轮换迁移...\n');

  // 1. 查询所有 EmailConfig 记录
  const { data: configs } = await db.collection('EmailConfig').limit(1000).get();

  if (!configs || configs.length === 0) {
    console.log('✅ 没有 EmailConfig 记录，无需迁移');
    return;
  }

  console.log(`📧 找到 ${configs.length} 条 EmailConfig 记录\n`);

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const failures = [];

  for (const config of configs) {
    try {
      if (!config.imapPassword) {
        console.log(`⏭️  [${config.email}] 无密码，跳过`);
        skipCount++;
        continue;
      }

      if (config.imapPassword.startsWith('PLAINTEXT:')) {
        console.log(`⏭️  [${config.email}] 明文密码，跳过（已是新格式）`);
        skipCount++;
        continue;
      }

      // 2. 用旧密钥解密
      let plaintext;
      try {
        plaintext = decryptWith(config.imapPassword, OLD_MASTER_SECRET, OLD_SALT_PEPPER);
      } catch (decryptErr) {
        // 可能已经用新密钥加密过了
        try {
          plaintext = decryptWith(config.imapPassword, NEW_MASTER_SECRET, NEW_SALT_PEPPER);
          console.log(`⏭️  [${config.email}] 已用新密钥加密，跳过`);
          skipCount++;
          continue;
        } catch {
          console.error(`❌ [${config.email}] 解密失败：${decryptErr.message}`);
          failCount++;
          failures.push({ email: config.email, error: `解密失败：${decryptErr.message}` });
          continue;
        }
      }

      // 3. 用新密钥加密
      const newEncrypted = encryptWith(plaintext, NEW_MASTER_SECRET, NEW_SALT_PEPPER);

      // 4. 更新数据库
      await db.collection('EmailConfig').doc(config._id).update({
        imapPassword: newEncrypted,
        updatedAt: new Date(),
      });

      console.log(`✅ [${config.email}] 密钥轮换成功`);
      successCount++;
    } catch (err) {
      console.error(`❌ [${config.email}] 处理失败：${err.message}`);
      failCount++;
      failures.push({ email: config.email, error: err.message });
    }
  }

  // 汇总
  console.log('\n📊 迁移完成：');
  console.log(`   成功：${successCount}`);
  console.log(`   跳过：${skipCount}`);
  console.log(`   失败：${failCount}`);

  if (failures.length > 0) {
    console.log('\n⚠️ 失败详情：');
    failures.forEach(f => console.log(`   - ${f.email}: ${f.error}`));
  }

  console.log('\n💡 下一步：');
  console.log('   1. 确认迁移结果无误');
  console.log('   2. 从 CloudBase 控制台删除 OLD_MASTER_SECRET 和 OLD_SALT_PEPPER 环境变量');
  console.log('   3. 仅保留 MASTER_SECRET 和 SALT_PEPPER（新值）');
}

main().catch(err => {
  console.error('迁移脚本异常：', err);
  process.exit(1);
});
