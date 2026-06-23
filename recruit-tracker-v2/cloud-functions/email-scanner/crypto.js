/**
 * crypto.js — 云函数端密码加解密模块
 *
 * 使用 Node.js 内置 crypto 模块实现 PBKDF2 密钥派生 + AES-256-GCM 加解密
 * 用于在云函数中加解密 EmailConfig 中存储的 IMAP 邮箱密码
 *
 * P0-1 安全重构：加密操作已从浏览器端移至云函数端。
 * MASTER_SECRET 和 SALT_PEPPER 仅存在于云函数环境变量（process.env），
 * 永不暴露到前端 JS bundle。
 *
 * 安全设计：
 *   - MASTER_SECRET 和 SALT_PEPPER 来自云函数环境变量（process.env）
 *   - 每次加密使用随机 Salt（16字节），确保相同明文产生不同密文
 *   - 存储格式：base64(salt(16B) + iv(12B) + ciphertext + authTag(16B))
 *   - 🆕 P0-1 密钥轮换：加密始终用新密钥，解密先试新密钥再试旧密钥（过渡期）
 */

const crypto = require('crypto');

// PBKDF2 参数
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = 'sha256';
const AES_KEY_LENGTH = 32; // 256 bits = 32 bytes
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16; // GCM 认证标签长度

/**
 * 使用 PBKDF2 派生 256-bit AES 密钥
 * @param {string} masterSecret - MASTER_SECRET 环境变量
 * @param {Buffer} salt - 随机盐（16 字节）
 * @param {string} pepper - SALT_PEPPER 环境变量
 * @returns {Buffer} 32 字节 AES-256 密钥
 */
function deriveKey(masterSecret, salt, pepper) {
  const keyMaterial = masterSecret + pepper;
  return crypto.pbkdf2Sync(keyMaterial, salt, PBKDF2_ITERATIONS, AES_KEY_LENGTH, PBKDF2_HASH);
}

/**
 * 获取加密密钥（从环境变量）
 * @returns {{ masterSecret: string, pepper: string }}
 * @throws {Error} 环境变量未配置时抛出
 */
function getSecrets() {
  const masterSecret = process.env.MASTER_SECRET || '';
  const pepper = process.env.SALT_PEPPER || '';

  if (!masterSecret || !pepper) {
    throw new Error('加密密钥未配置：请设置 MASTER_SECRET 和 SALT_PEPPER 环境变量');
  }

  return { masterSecret, pepper };
}

/**
 * 加密明文密码，返回可直接存储的 Base64 字符串
 *
 * @param {string} plaintext - 要加密的 IMAP 密码
 * @returns {string} Base64 编码的加密包：salt(16B) + iv(12B) + ciphertext + authTag(16B)
 */
function encrypt(plaintext) {
  if (!plaintext) {
    throw new Error('密码不能为空');
  }

  const { masterSecret, pepper } = getSecrets();

  // 生成随机盐和 IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // 派生密钥
  const key = deriveKey(masterSecret, salt, pepper);

  // 加密
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // 组合加密包：salt + iv + ciphertext + authTag
  const packageBuffer = Buffer.concat([salt, iv, encrypted, authTag]);

  return packageBuffer.toString('base64');
}

/**
 * 解密存储的加密密码（P0-1：支持密钥轮换过渡期）
 *
 * 解密策略：新密钥优先 → 旧密钥回退 → 都失败才抛错
 * 过渡期结束后（所有数据已迁移），可移除旧密钥回退逻辑。
 *
 * @param {string} storedPackage - Base64 编码的加密包
 * @returns {string} 解密后的明文密码
 * @throws {Error} 解密失败时抛出错误
 */
function decrypt(storedPackage) {
  if (!storedPackage) {
    throw new Error('加密数据不能为空');
  }

  // 兼容旧数据：如果以 PLAINTEXT: 开头，说明是新上传的明文
  if (storedPackage.startsWith('PLAINTEXT:')) {
    return storedPackage.slice('PLAINTEXT:'.length);
  }

  const { masterSecret, pepper } = getSecrets();

  // 解码 Base64
  const packageBuffer = Buffer.from(storedPackage, 'base64');

  // 提取各部分：salt(16) + iv(12) + ciphertext + authTag(16)
  if (packageBuffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('加密数据格式无效：长度不足');
  }

  const salt = packageBuffer.subarray(0, SALT_LENGTH);
  const iv = packageBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const encryptedData = packageBuffer.subarray(SALT_LENGTH + IV_LENGTH);
  const ciphertext = encryptedData.subarray(0, encryptedData.length - AUTH_TAG_LENGTH);
  const authTag = encryptedData.subarray(encryptedData.length - AUTH_TAG_LENGTH);

  /**
   * 尝试用指定密钥解密
   */
  function tryDecrypt(secret, pep) {
    const key = deriveKey(secret, salt, pep);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  }

  // 🆕 P0-1 密钥轮换：新密钥优先
  try {
    return tryDecrypt(masterSecret, pepper);
  } catch {
    // 新密钥解密失败，尝试旧密钥（过渡期）
  }

  // 回退：尝试旧密钥
  const oldMasterSecret = process.env.OLD_MASTER_SECRET;
  const oldSaltPepper = process.env.OLD_SALT_PEPPER;

  if (oldMasterSecret && oldSaltPepper) {
    try {
      const plaintext = tryDecrypt(oldMasterSecret, oldSaltPepper);
      console.log('[crypto] ⚠️ 使用旧密钥解密成功，建议运行密钥轮换迁移脚本');
      return plaintext;
    } catch {
      // 旧密钥也失败，继续抛出错误
    }
  }

  throw new Error('密码解密失败：密钥不匹配，请检查 MASTER_SECRET/SALT_PEPPER 环境变量，或运行密钥轮换迁移脚本');
}

module.exports = { encrypt, decrypt };
