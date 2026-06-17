/**
 * email-config.js — 邮箱配置服务
 *
 * 封装 EmailConfig 的 CRUD 操作和 IMAP 连接测试。
 * 密码在浏览器端加密后存储，云函数端解密后使用。
 */

import cloudbase from './cloudbase';
import { encryptPassword } from './crypto-browser';

const db = cloudbase.db;

/**
 * 获取当前用户的所有邮箱配置
 * @returns {Promise<Array>}
 */
export async function getEmailConfigs() {
  const result = await db().collection('EmailConfig').get();
  return result.data || [];
}

/**
 * 获取单个邮箱配置
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getEmailConfig(id) {
  try {
    const result = await db().collection('EmailConfig').doc(id).get();
    return result.data?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * 创建邮箱配置
 * @param {object} config - { email, imapHost, imapPort, imapUser, imapPassword(明文), filterRules, enabled, userId }
 * @returns {Promise<object>} 创建的配置
 */
export async function createEmailConfig(config) {
  // 加密密码后存储
  const encryptedPassword = await encryptPassword(config.imapPassword);

  const doc = {
    userId: config.userId,
    email: config.email,
    imapHost: config.imapHost || 'imap.qq.com',
    imapPort: config.imapPort || 993,
    imapUser: config.imapUser || config.email,
    imapPassword: encryptedPassword,
    filterRules: config.filterRules || {},
    enabled: config.enabled !== false,
    failureCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db().collection('EmailConfig').add(doc);
  return { ...doc, _id: result.id };
}

/**
 * 更新邮箱配置
 * @param {string} id - 配置 ID
 * @param {object} updates - 要更新的字段（如果包含 imapPassword，需先加密）
 * @returns {Promise<void>}
 */
export async function updateEmailConfig(id, updates) {
  const updateData = { ...updates, updatedAt: new Date() };

  // 如果更新密码，先加密
  if (updateData.imapPassword && updateData.imapPassword.length < 50) {
    // 长度 < 50 说明是明文密码，需要加密
    updateData.imapPassword = await encryptPassword(updateData.imapPassword);
  }

  await db().collection('EmailConfig').doc(id).update(updateData);
}

/**
 * 删除邮箱配置
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteEmailConfig(id) {
  await db().collection('EmailConfig').doc(id).remove();
}

/**
 * 更新邮箱启用状态
 * @param {string} id
 * @param {boolean} enabled
 */
export async function toggleEmailConfig(id, enabled) {
  await db().collection('EmailConfig').doc(id).update({
    enabled,
    updatedAt: new Date(),
  });
}

/**
 * 测试 IMAP 连接
 * @param {object} config - { imapHost, imapPort, imapUser, imapPassword(明文) }
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function testImapConnection(config) {
  // 加密密码后传给云函数
  const encryptedPassword = await encryptPassword(config.imapPassword);

  const cloudbaseModule = await import('./cloudbase');
  const result = await cloudbaseModule.default.callFunction('email-scanner', {
    action: 'test',
    config: {
      email: config.email,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapUser: config.imapUser || config.email,
      imapPassword: encryptedPassword,
    },
  });

  return result.result || { success: false, message: '未知错误' };
}

/**
 * 触发手动邮箱扫描
 * @returns {Promise<object>}
 */
export async function triggerManualScan() {
  const cloudbaseModule = await import('./cloudbase');
  const result = await cloudbaseModule.default.callFunction('email-scanner', {
    action: 'scan',
  });
  return result.result || { success: false };
}
