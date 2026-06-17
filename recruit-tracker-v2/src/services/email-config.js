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
 * @param {string} userId - 当前用户的 uid
 * @returns {Promise<Array>}
 */
export async function getEmailConfigs(userId) {
  try {
    const result = await db()
      .collection('EmailConfig')
      .where({ userId })
      .get();
    return result.data || [];
  } catch (err) {
    if (err.code === 'PERMISSION_DENIED' || err.message?.includes('403')) {
      console.warn('⚠️ EmailConfig 权限不足，请检查安全规则');
      return [];
    }
    throw err;
  }
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
 * 更新邮箱配置（通过云函数，绕过前端直接操作数据库的权限问题）
 * @param {string} id - 配置 ID
 * @param {object} updates - 要更新的字段（如果包含 imapPassword，需先加密）
 * @returns {Promise<void>}
 */
export async function updateEmailConfig(id, updates) {
  const updateData = { ...updates };

  // 如果没输入新密码（空字符串），删除该字段，避免覆盖已存储的加密密码
  if (!updateData.imapPassword || updateData.imapPassword.trim() === '') {
    delete updateData.imapPassword;
  } else if (updateData.imapPassword.length < 50) {
    // 明文密码（< 50 字符视为明文），需加密后存储
    updateData.imapPassword = await encryptPassword(updateData.imapPassword);
  }
  // 否则已是加密后的 base64 字符串（≥ 50 字符），直接使用

  const result = await cloudbase.callFunction('email-scanner', {
    action: 'updateConfig',
    id,
    updates: updateData,
  });

  if (!result || !result.success) {
    throw new Error(result?.message || '更新邮箱配置失败');
  }
}

/**
 * 删除邮箱配置（通过云函数，绕过前端直接操作数据库的权限问题）
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteEmailConfig(id) {
  const result = await cloudbase.callFunction('email-scanner', {
    action: 'deleteConfig',
    id,
  });

  if (!result || !result.success) {
    throw new Error(result?.message || '删除邮箱配置失败');
  }
}

/**
 * 诊断邮箱：测试连接 + 获取最近发件人列表
 * @param {object} config - { email, imapHost, imapPort, imapUser, imapPassword(明文) }
 * @returns {Promise<object>}
 */
export async function diagnoseEmail(config) {
  const encryptedPassword = await encryptPassword(config.imapPassword);

  const result = await cloudbase.callFunction('email-scanner', {
    action: 'diagnose',
    config: {
      email: config.email,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapUser: config.imapUser || config.email,
      imapPassword: encryptedPassword,
    },
  });

  return result || { success: false, message: '诊断失败' };
}

/**
 * 更新邮箱启用状态（通过云函数）
 * @param {string} id
 * @param {boolean} enabled
 */
export async function toggleEmailConfig(id, enabled) {
  await updateEmailConfig(id, { enabled });
}

/**
 * 测试 IMAP 连接
 * @param {object} config - { imapHost, imapPort, imapUser, imapPassword(明文) }
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function testImapConnection(config) {
  // 加密密码后传给云函数
  const encryptedPassword = await encryptPassword(config.imapPassword);

  const result = await cloudbase.callFunction('email-scanner', {
    action: 'test',
    config: {
      email: config.email,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapUser: config.imapUser || config.email,
      imapPassword: encryptedPassword,
    },
  });

  return result || { success: false, message: '未知错误' };
}

/**
 * 触发手动邮箱扫描
 * @param {boolean} force - 是否强制重扫（清除去重记录）
 * @returns {Promise<object>}
 */
export async function triggerManualScan(force = false) {
  const result = await cloudbase.callFunction('email-scanner', {
    action: 'scan',
    force,
  });
  return result || { success: false };
}
