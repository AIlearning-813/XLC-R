/**
 * email-config.js — 邮箱配置服务（安全重构版）
 *
 * P0-1 修复：密码加密已全部移至云函数端执行。
 * 浏览器端通过 HTTPS 将明文密码传给云函数，云函数端加密后存入数据库。
 * MASTER_SECRET 和 SALT_PEPPER 永不暴露到前端 JS bundle。
 *
 * 封装 EmailConfig 的 CRUD 操作和 IMAP 连接测试。
 */

import cloudbase from './cloudbase';

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
 * 创建邮箱配置（通过云函数，密码在服务端加密）
 * @param {object} config - { email, imapHost, imapPort, imapUser, imapPassword(明文), filterRules, enabled, userId }
 * @returns {Promise<object>} 创建的配置
 */
export async function createEmailConfig(config) {
  // 明文密码通过 HTTPS 传给云函数，云函数端加密后存储
  const result = await cloudbase.callFunction('email-scanner', {
    action: 'createConfig',
    config: {
      userId: config.userId,
      email: config.email,
      imapHost: config.imapHost || 'imap.qq.com',
      imapPort: config.imapPort || 993,
      imapUser: config.imapUser || config.email,
      imapPassword: config.imapPassword,  // 明文，云函数端加密
      filterRules: config.filterRules || {},
      enabled: config.enabled !== false,
    },
  });

  if (!result || !result.success) {
    throw new Error(result?.message || '创建邮箱配置失败');
  }

  return result.config || { _id: result.id };
}

/**
 * 更新邮箱配置（通过云函数，密码在服务端加密）
 * @param {string} id - 配置 ID
 * @param {object} updates - 要更新的字段（imapPassword 传明文）
 * @returns {Promise<void>}
 */
export async function updateEmailConfig(id, updates) {
  const updateData = { ...updates };

  // 如果没输入新密码（空字符串），删除该字段，避免覆盖已存储的加密密码
  if (!updateData.imapPassword || updateData.imapPassword.trim() === '') {
    delete updateData.imapPassword;
  }
  // 否则传明文，云函数端加密后存储

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
 * 删除邮箱配置（通过云函数）
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
  const result = await cloudbase.callFunction('email-scanner', {
    action: 'diagnose',
    config: {
      email: config.email,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapUser: config.imapUser || config.email,
      imapPassword: config.imapPassword,  // 明文
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
  const result = await cloudbase.callFunction('email-scanner', {
    action: 'test',
    config: {
      email: config.email,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapUser: config.imapUser || config.email,
      imapPassword: config.imapPassword,  // 明文
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
  try {
    const result = await cloudbase.callFunction(
      'email-scanner',
      { action: 'scan', force },
      { timeout: 120000 }  // HTTP 超时 120s（云函数端单邮箱 90s 预算 + 余量）
    );
    return result || { success: false };
  } catch (err) {
    // HTTP 超时 / 网络错误 → 云函数可能仍在后台运行，下次定时扫描会继续
    if (err.message?.includes('timeout') || err.message?.includes('TIMEOUT') || err.code === 'FUNCTION_TIME_LIMIT_EXCEEDED') {
      return {
        success: true,
        message: '扫描任务已提交，正在后台处理中。请稍后查看扫描结果。如邮件较多，可能需要多次扫描才能处理完所有邮件。',
        inProgress: true,
      };
    }
    return { success: false, message: err.message || '扫描失败' };
  }
}
