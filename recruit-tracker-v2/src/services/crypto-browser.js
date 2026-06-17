/**
 * crypto-browser.js — 浏览器端密码加密模块
 *
 * 使用 Web Crypto API 实现 PBKDF2 密钥派生 + AES-256-GCM 加密
 * 用于在浏览器端加密 IMAP 邮箱密码后再存入 CloudBase
 *
 * 安全设计：
 *   - MASTER_SECRET 和 SALT_PEPPER 分离存放（Vite 环境变量）
 *   - 每次加密使用随机 Salt（16字节），确保相同明文产生不同密文
 *   - 存储格式：base64(salt + iv + authTag + ciphertext)
 */

// PBKDF2 参数
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = 'SHA-256';
const AES_KEY_LENGTH = 256;
const SALT_LENGTH = 16;  // 随机盐 16 字节
const IV_LENGTH = 12;    // GCM 推荐 96-bit IV

/**
 * 将字符串转为 Uint8Array
 */
function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

/**
 * 将 ArrayBuffer 转为 Base64 字符串
 */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 将 Base64 字符串转为 Uint8Array
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 使用 PBKDF2 派生 256-bit AES 密钥
 * @param {string} masterSecret - MASTER_SECRET 环境变量
 * @param {Uint8Array} salt - 随机盐
 * @param {string} pepper - SALT_PEPPER 环境变量
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(masterSecret, salt, pepper) {
  // 将 masterSecret + pepper 组合作为 PBKDF2 的密码材料
  const keyMaterial = stringToBytes(masterSecret + pepper);

  const importedKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    importedKey,
    {
      name: 'AES-GCM',
      length: AES_KEY_LENGTH,
    },
    false,
    ['encrypt']
  );
}

/**
 * 加密明文密码，返回可直接存储的 Base64 字符串
 *
 * @param {string} plaintext - 要加密的 IMAP 密码
 * @returns {Promise<string>} Base64 编码的加密包：salt(16B) + iv(12B) + ciphertext + authTag(16B)
 */
export async function encryptPassword(plaintext) {
  if (!plaintext) {
    throw new Error('密码不能为空');
  }

  const masterSecret = import.meta.env.VITE_MASTER_SECRET;
  const pepper = import.meta.env.VITE_SALT_PEPPER;

  if (!masterSecret || !pepper) {
    throw new Error('加密密钥未配置：请设置 VITE_MASTER_SECRET 和 VITE_SALT_PEPPER 环境变量');
  }

  // 生成随机盐和 IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // 派生密钥
  const key = await deriveKey(masterSecret, salt, pepper);

  // 加密
  const plaintextBytes = stringToBytes(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    plaintextBytes
  );

  // AES-GCM 的 encrypted 包含 ciphertext + 16字节 authTag（在末尾）
  // 组合最终的存储包：salt + iv + encrypted(ciphertext + authTag)
  const encryptedBytes = new Uint8Array(encrypted);
  const packageBytes = new Uint8Array(SALT_LENGTH + IV_LENGTH + encryptedBytes.length);

  packageBytes.set(salt, 0);
  packageBytes.set(iv, SALT_LENGTH);
  packageBytes.set(encryptedBytes, SALT_LENGTH + IV_LENGTH);

  return bufferToBase64(packageBytes.buffer);
}

/**
 * 检查加密环境是否就绪（MASTER_SECRET 和 SALT_PEPPER 是否已配置）
 * @returns {boolean}
 */
export function isCryptoReady() {
  const masterSecret = import.meta.env.VITE_MASTER_SECRET;
  const pepper = import.meta.env.VITE_SALT_PEPPER;
  return !!(masterSecret && pepper);
}
