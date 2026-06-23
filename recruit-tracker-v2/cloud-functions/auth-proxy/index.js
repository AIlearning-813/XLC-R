/**
 * auth-proxy — 用户认证与账号管理云函数
 *
 * 职责：
 *   1. login — 验证账号密码，返回角色和名称（含暴力破解防护）+ 服务端签名会话令牌
 *   2. verifySession — 验证会话令牌完整性（防 localStorage 篡改）
 *   3. listUsers — 管理员列出所有用户
 *   4. addUser — 管理员添加新用户
 *   5. deleteUser — 管理员删除用户
 *   6. resetPassword — 管理员重置用户密码
 *   7. seedDefaultUsers — 初始化默认账号（首次部署时调用）
 *
 * 密码使用 PBKDF2-SHA256 哈希存储，永不存明文
 * 默认密码通过环境变量 XLC_INIT_PASSWORD 注入，无环境变量时自动生成随机密码
 *
 * P1-5 修复：登录时生成服务端 HMAC-SHA256 签名会话令牌，防止客户端 localStorage 篡改。
 *   令牌格式：base64(username|role|name|expiry).base64(HMAC-SHA256(signingKey, payload))
 *   验证时重新计算签名比对，签名不匹配或过期则拒绝。
 */
const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

// PBKDF2 参数
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha256';

// 暴力破解防护参数
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 分钟

// P1-5 会话签名参数
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时
const SESSION_SIGNING_KEY = process.env.MASTER_SECRET || 'default-dev-key-change-in-production';

/** 生成指定长度的随机密码 */
function generateRandomPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

/** 获取初始密码：环境变量 > 随机生成 */
function getInitPassword() {
  return process.env.XLC_INIT_PASSWORD || generateRandomPassword();
}

// 默认账号列表（密码来自环境变量，部署时设置）
const DEFAULT_USERS = [
  { username: 'admin', role: 'admin', name: '管理员' },
  { username: '王莉', role: 'recruiter', name: '王莉' },
  { username: '卢思颖', role: 'recruiter', name: '卢思颖' },
  { username: '刘滢滢', role: 'recruiter', name: '刘滢滢' },
  { username: '麦欣瑜', role: 'recruiter', name: '麦欣瑜' },
  { username: '章蓓蓓', role: 'recruiter', name: '章蓓蓓' },
  { username: '高艺', role: 'recruiter', name: '高艺' },
  { username: '杨紫莹', role: 'recruiter', name: '杨紫莹' },
  { username: '高艳翠', role: 'recruiter', name: '高艳翠' },
];

// ===== 密码工具函数 =====

/** 生成随机盐值 */
function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

/** 哈希密码 */
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString('hex');
}

/** 验证密码 */
function verifyPassword(password, salt, storedHash) {
  const hash = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

// ===== P1-5 会话签名 =====

/**
 * 生成服务端签名会话令牌
 *
 * 格式：base64(payload).base64(signature)
 * payload = username|role|name|expiryTimestamp
 * signature = HMAC-SHA256(signingKey, payload)
 *
 * HMAC 签名确保客户端无法伪造会话令牌（即使知道 payload 格式），
 * 因为没有 MASTER_SECRET 签名密钥无法生成有效签名。
 */
function generateSessionToken(username, role, name) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${username}|${role}|${name}|${expiry}`;
  const signature = crypto.createHmac('sha256', SESSION_SIGNING_KEY).update(payload).digest('base64');
  const payloadB64 = Buffer.from(payload).toString('base64');
  return `${payloadB64}.${signature}`;
}

/**
 * 验证会话令牌
 * @returns {{ valid: false, error: string } | { valid: true, username: string, role: string, name: string, expiry: number }}
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: '令牌不能为空' };
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: '令牌格式无效' };
    }

    const payload = Buffer.from(parts[0], 'base64').toString('utf-8');
    const providedSig = parts[1];

    // 验证签名
    const expectedSig = crypto.createHmac('sha256', SESSION_SIGNING_KEY).update(payload).digest('base64');
    if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
      return { valid: false, error: '签名不匹配，令牌可能被篡改' };
    }

    // 解析 payload
    const fields = payload.split('|');
    if (fields.length !== 4) {
      return { valid: false, error: '令牌载荷格式无效' };
    }

    const [username, role, name, expiryStr] = fields;
    const expiry = parseInt(expiryStr, 10);

    if (isNaN(expiry) || Date.now() > expiry) {
      return { valid: false, error: '令牌已过期' };
    }

    return { valid: true, username, role, name, expiry };
  } catch (err) {
    return { valid: false, error: `令牌解析失败：${err.message}` };
  }
}

// ===== 管理员权限校验 =====

/** 验证调用者是否为管理员 */
async function verifyAdmin(callerUsername) {
  if (!callerUsername) return false;
  try {
    const { data } = await db.collection('Users')
      .where({ username: callerUsername, role: 'admin' })
      .limit(1)
      .get();
    return data && data.length > 0;
  } catch (err) {
    console.error('[auth-proxy] 校验管理员失败:', err.message);
    return false;
  }
}

// ===== 核心操作 =====

/** 登录（含暴力破解防护：5 次失败锁定 15 分钟） */
async function handleLogin(params) {
  const { username, password } = params;

  if (!username || !password) {
    return { success: false, error: '请输入账号和密码' };
  }

  const trimmedUsername = username.trim();

  try {
    const { data } = await db.collection('Users')
      .where({ username: trimmedUsername })
      .limit(1)
      .get();

    if (!data || data.length === 0) {
      // 固定耗时，防止用户名枚举
      await new Promise((r) => setTimeout(r, 500));
      return { success: false, error: '账号或密码错误' };
    }

    const user = data[0];

    // 检查是否被锁定
    if (user.lockedUntil && Date.now() < user.lockedUntil) {
      const remainingMin = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return {
        success: false,
        error: `账户已被临时锁定，请 ${remainingMin} 分钟后再试`,
        locked: true,
        remainingMinutes: remainingMin,
      };
    }

    // 验证密码
    if (!verifyPassword(password, user.salt, user.passwordHash)) {
      const newAttempts = (user.loginAttempts || 0) + 1;
      const updateData = { loginAttempts: newAttempts };

      // 超过最大尝试次数 → 锁定账户
      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = Date.now() + LOCK_DURATION_MS;
        console.log(`[auth-proxy] 账户已锁定: ${trimmedUsername}（${newAttempts} 次失败）`);
      }

      await db.collection('Users').doc(user._id).update(updateData);

      // 人工延迟，增加暴力破解成本
      await new Promise((r) => setTimeout(r, 500));

      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        return {
          success: false,
          error: `密码错误次数过多，账户已锁定 15 分钟`,
          locked: true,
        };
      }

      return { success: false, error: '账号或密码错误' };
    }

    // 登录成功 → 重置失败计数和锁定状态
    if (user.loginAttempts > 0 || user.lockedUntil) {
      await db.collection('Users').doc(user._id).update({
        loginAttempts: 0,
        lockedUntil: null,
      });
    }

    console.log(`[auth-proxy] 登录成功: ${user.username} (${user.role})`);

    // P1-5：生成服务端签名会话令牌（防 localStorage 篡改）
    const sessionToken = generateSessionToken(user.username, user.role, user.name);

    return {
      success: true,
      data: {
        username: user.username,
        role: user.role,
        name: user.name,
        sessionToken,  // 🆕 服务端 HMAC-SHA256 签名令牌
      },
    };
  } catch (err) {
    console.error('[auth-proxy] 登录失败:', err.message);
    return { success: false, error: `登录失败: ${err.message}` };
  }
}

/** 列出所有用户（管理员） */
async function handleListUsers(params) {
  const { callerUsername } = params;

  if (!(await verifyAdmin(callerUsername))) {
    return { success: false, error: '无权限，仅管理员可查看用户列表' };
  }

  try {
    const { data } = await db.collection('Users')
      .field({ username: true, role: true, name: true, createdAt: true })
      .orderBy('createdAt', 'asc')
      .get();

    return { success: true, data };
  } catch (err) {
    console.error('[auth-proxy] 列出用户失败:', err.message);
    return { success: false, error: `查询失败: ${err.message}` };
  }
}

/** 添加用户（管理员） */
async function handleAddUser(params) {
  const { callerUsername, username, password, role, name } = params;

  if (!(await verifyAdmin(callerUsername))) {
    return { success: false, error: '无权限，仅管理员可添加用户' };
  }

  if (!username || !password) {
    return { success: false, error: '账号和密码不能为空' };
  }

  if (password.length < 8) {
    return { success: false, error: '密码至少 8 位' };
  }

  if (!['admin', 'recruiter'].includes(role)) {
    return { success: false, error: '角色只能是 admin 或 recruiter' };
  }

  const trimmedUsername = username.trim();

  try {
    // 检查是否已存在
    const { data: existing } = await db.collection('Users')
      .where({ username: trimmedUsername })
      .limit(1)
      .get();

    if (existing && existing.length > 0) {
      return { success: false, error: `账号「${trimmedUsername}」已存在` };
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);

    await db.collection('Users').add({
      username: trimmedUsername,
      passwordHash,
      salt,
      role,
      name: name || trimmedUsername,
      createdAt: new Date(),
      createdBy: callerUsername,
    });

    console.log(`[auth-proxy] 用户已添加: ${trimmedUsername} (${role})`);

    return { success: true, message: `已添加用户「${trimmedUsername}」` };
  } catch (err) {
    console.error('[auth-proxy] 添加用户失败:', err.message);
    return { success: false, error: `添加失败: ${err.message}` };
  }
}

/** 删除用户（管理员） */
async function handleDeleteUser(params) {
  const { callerUsername, username } = params;

  if (!(await verifyAdmin(callerUsername))) {
    return { success: false, error: '无权限，仅管理员可删除用户' };
  }

  if (!username) {
    return { success: false, error: '请指定要删除的账号' };
  }

  if (username === callerUsername) {
    return { success: false, error: '不能删除自己的账号' };
  }

  try {
    const { data } = await db.collection('Users')
      .where({ username })
      .limit(1)
      .get();

    if (!data || data.length === 0) {
      return { success: false, error: `账号「${username}」不存在` };
    }

    await db.collection('Users').doc(data[0]._id).remove();

    console.log(`[auth-proxy] 用户已删除: ${username}`);

    return { success: true, message: `已删除用户「${username}」` };
  } catch (err) {
    console.error('[auth-proxy] 删除用户失败:', err.message);
    return { success: false, error: `删除失败: ${err.message}` };
  }
}

/** 重置密码（管理员） */
async function handleResetPassword(params) {
  const { callerUsername, username, newPassword } = params;

  if (!(await verifyAdmin(callerUsername))) {
    return { success: false, error: '无权限，仅管理员可重置密码' };
  }

  if (!username || !newPassword) {
    return { success: false, error: '账号和新密码不能为空' };
  }

  if (newPassword.length < 8) {
    return { success: false, error: '新密码至少 8 位' };
  }

  try {
    const { data } = await db.collection('Users')
      .where({ username })
      .limit(1)
      .get();

    if (!data || data.length === 0) {
      return { success: false, error: `账号「${username}」不存在` };
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(newPassword, salt);

    await db.collection('Users').doc(data[0]._id).update({ passwordHash, salt });

    console.log(`[auth-proxy] 密码已重置: ${username}`);

    return { success: true, message: `已重置「${username}」的密码` };
  } catch (err) {
    console.error('[auth-proxy] 重置密码失败:', err.message);
    return { success: false, error: `重置失败: ${err.message}` };
  }
}

/** 修改自己的密码（所有用户可用） */
async function handleChangePassword(params) {
  const { username, oldPassword, newPassword } = params;

  if (!username || !oldPassword || !newPassword) {
    return { success: false, error: '账号、旧密码和新密码不能为空' };
  }

  if (newPassword.length < 8) {
    return { success: false, error: '新密码至少 8 位' };
  }

  try {
    const { data } = await db.collection('Users')
      .where({ username })
      .limit(1)
      .get();

    if (!data || data.length === 0) {
      return { success: false, error: '账号不存在' };
    }

    const user = data[0];

    // 验证旧密码
    if (!verifyPassword(oldPassword, user.salt, user.passwordHash)) {
      return { success: false, error: '旧密码错误' };
    }

    // 更新为新密码
    const salt = generateSalt();
    const passwordHash = hashPassword(newPassword, salt);

    await db.collection('Users').doc(user._id).update({ passwordHash, salt });

    console.log(`[auth-proxy] 密码已修改: ${username}`);

    return { success: true, message: '密码修改成功' };
  } catch (err) {
    console.error('[auth-proxy] 修改密码失败:', err.message);
    return { success: false, error: `修改失败: ${err.message}` };
  }
}

/** 验证会话令牌（P1-5：防 localStorage 篡改） */
async function handleVerifySession(params) {
  const { sessionToken } = params;

  if (!sessionToken) {
    return { success: false, error: '缺少会话令牌' };
  }

  const result = verifySessionToken(sessionToken);

  if (!result.valid) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: {
      username: result.username,
      role: result.role,
      name: result.name,
      expiry: result.expiry,
    },
  };
}

/** 确保 Users 集合存在，不存在则创建 */
async function ensureUsersCollection() {
  try {
    await db.createCollection('Users');
    console.log('[auth-proxy] Users 集合已创建');
  } catch (err) {
    // 集合已存在时会报错，忽略
    if (!err.message.includes('already exist') && !err.message.includes('已存在')) {
      console.warn('[auth-proxy] 创建 Users 集合警告:', err.message);
    }
  }
}

/** 初始化默认账号（仅当 Users 集合为空时） */
async function handleSeedDefaults() {
  try {
    // 确保集合存在
    await ensureUsersCollection();

    const { data } = await db.collection('Users').limit(1).get();

    if (data && data.length > 0) {
      return { success: true, message: '账号已存在，跳过初始化', skipped: true };
    }

    const initPassword = getInitPassword();
    const created = [];
    for (const user of DEFAULT_USERS) {
      const salt = generateSalt();
      const passwordHash = hashPassword(initPassword, salt);

      await db.collection('Users').add({
        username: user.username,
        passwordHash,
        salt,
        role: user.role,
        name: user.name,
        createdAt: new Date(),
        createdBy: 'system',
        loginAttempts: 0,
      });
      created.push(user.username);
    }

    console.log(`[auth-proxy] 初始化完成，创建了 ${created.length} 个默认账号`);
    return {
      success: true,
      message: `已创建 ${created.length} 个默认账号，初始密码为: ${initPassword}（请立即修改）`,
      created,
      initPassword, // 仅首次返回，后续不再可见
    };
  } catch (err) {
    console.error('[auth-proxy] 初始化失败:', err.message);
    return { success: false, error: `初始化失败: ${err.message}` };
  }
}

// ===== 主入口 =====

exports.main = async (event, context) => {
  const { action, ...params } = event;

  console.log(`[auth-proxy] 收到请求: action=${action}`);

  switch (action) {
    case 'login':
      return handleLogin(params);
    case 'verifySession':
      return handleVerifySession(params);
    case 'listUsers':
      return handleListUsers(params);
    case 'addUser':
      return handleAddUser(params);
    case 'deleteUser':
      return handleDeleteUser(params);
    case 'resetPassword':
      return handleResetPassword(params);
    case 'changePassword':
      return handleChangePassword(params);
    case 'seedDefaults':
      return handleSeedDefaults();
    default:
      return { success: false, error: `未知操作: ${action}` };
  }
};
