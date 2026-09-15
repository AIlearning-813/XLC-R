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

// 会话令牌的签发/校验/授权判定（抽成可测模块，回归测试见 session-token.test.js）
const { createSessionTokenService, timingSafeStringEqual, VALID_ROLES } = require('./session-token');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

// PBKDF2 参数
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha256';

// 暴力破解防护参数
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 分钟

// ===== P1-5 会话签名 =====

const SESSION_SIGNING_KEY = process.env.MASTER_SECRET || '';

if (!SESSION_SIGNING_KEY) {
  // 原实现是 process.env.MASTER_SECRET || 'default-dev-key-change-in-production'。
  // 那个兜底串一旦生效，等于把签名密钥公开在源码里 —— 任何读过源码的人都能伪造
  // 任意角色的会话令牌，属于「沉默地不安全」。改为缺失即拒绝服务并大声告警。
  console.error(
    '[auth-proxy] 致命配置错误：环境变量 MASTER_SECRET 未配置。' +
    '会话令牌将无法签发/校验，登录不可用。请在 CloudBase 控制台为本函数配置 MASTER_SECRET。'
  );
}

/** 密钥缺失时的降级实现：一律拒绝，绝不退回默认串 */
const sessions = SESSION_SIGNING_KEY
  ? createSessionTokenService(SESSION_SIGNING_KEY)
  : {
      generate: () => { throw new Error('服务配置错误：缺少签名密钥 MASTER_SECRET'); },
      verify: () => ({ valid: false, error: '服务配置错误：缺少签名密钥' }),
      authorizeAdmin: () => ({ ok: false, error: '服务配置错误：缺少签名密钥' }),
      authorizeSelf: () => ({ ok: false, error: '服务配置错误：缺少签名密钥' }),
    };

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

// ===== 登录考勤埋点（管理员登录看板数据源：记录专员登录/活跃到 LoginLog）=====

/** 北京时区的 YYYY-MM-DD（不依赖进程 TZ：显式 +8h 平移后取 UTC getter） */
function formatDateKeyBeijing(ts = Date.now()) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 安静写入 LoginLog：集合不存在则懒创建后重试；写入失败仅告警，绝不抛出 */
async function addLoginLog(doc) {
  try {
    await db.collection('LoginLog').add(doc);
  } catch (err) {
    const m = (err && (err.message || '')).toLowerCase();
    if (m.includes('not exist') || m.includes('不存在')) {
      try {
        await db.createCollection('LoginLog');
      } catch (_) { /* 已存在则忽略 */ }
      try {
        await db.collection('LoginLog').add(doc);
      } catch (e2) {
        console.warn('[auth-proxy] LoginLog 写入失败:', e2.message);
      }
    } else {
      console.warn('[auth-proxy] LoginLog 写入失败:', err.message);
    }
  }
}

/** 记录一次手动登录成功（仅专员，每次成功登录写一条 type:'login'） */
async function recordLogin(user) {
  if (!user || user.role !== 'recruiter') return;
  const now = new Date();
  await addLoginLog({
    username: user.username,
    role: user.role,
    type: 'login',
    dateKey: formatDateKeyBeijing(now.getTime()),
    eventAt: now,
    createdAt: now,
  });
}

/** 记录当天首条会话活跃（仅专员；同天同账号已有 type:'active' 则不重复写） */
async function recordActiveIfNew(username, role) {
  if (!username || role !== 'recruiter') return;
  const now = new Date();
  const dateKey = formatDateKeyBeijing(now.getTime());
  try {
    const res = await db.collection('LoginLog')
      .where({ username, type: 'active', dateKey })
      .count();
    if (res && res.total > 0) return; // 当天已标记过活跃
    await addLoginLog({
      username,
      role,
      type: 'active',
      dateKey,
      eventAt: now,
      createdAt: now,
    });
  } catch (err) {
    console.warn('[auth-proxy] 活跃去重查询失败:', err.message);
  }
}

// ===== 调用者身份校验 =====

/**
 * 查库确认某账号当前是否为管理员。
 *
 * ⚠️ 它只回答「数据库里存不存在一个叫这个名字的管理员」，**不验证调用者是谁**。
 * 单靠它做鉴权等于没鉴权：请求体里的 callerUsername 是调用方自称的字段，
 * 任何人都能填 'admin'（这个用户名还硬编码在 DEFAULT_USERS 里，猜都不用猜）。
 * 管理员操作的唯一入口是下面的 requireAdmin。
 */
async function verifyAdmin(username) {
  if (!username) return false;
  try {
    const { data } = await db.collection('Users')
      .where({ username, role: 'admin' })
      .limit(1)
      .get();
    return data && data.length > 0;
  } catch (err) {
    console.error('[auth-proxy] 校验管理员失败:', err.message);
    return false;
  }
}

/**
 * 管理员操作的真实入口：先验令牌，再回查数据库。
 *
 * 两步缺一不可：
 *   1. authorizeAdmin 校验 HMAC 签名 —— 令牌无法伪造，身份可信；
 *      且令牌里的 username 是唯一可信的身份来源，绝不采信请求体里的自称字段
 *   2. verifyAdmin 回查数据库 —— 令牌里的角色是**签发时的快照**，
 *      账号可能已被删除或降级，而旧令牌尚未过期
 *
 * @returns {{ok:true, username: string, role: string, name: string} | {ok:false, error: string}}
 */
async function requireAdmin(params) {
  const auth = sessions.authorizeAdmin(params && params.sessionToken);
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!(await verifyAdmin(auth.username))) {
    return { ok: false, error: '无权限，账号状态已变更，请重新登录' };
  }

  return { ok: true, username: auth.username, role: auth.role, name: auth.name };
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
    const sessionToken = sessions.generate(user.username, user.role, user.name);

    // 🆕 登录考勤：记录 1 次手动登录（异步容错，失败绝不影响登录主流程）
    await recordLogin(user).catch((e) => console.warn('[auth-proxy] 记录登录失败:', e.message));

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
  const auth = await requireAdmin(params);
  if (!auth.ok) {
    return { success: false, error: auth.error };
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
  const auth = await requireAdmin(params);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { username, password, role, name } = params;

  if (!username || !password) {
    return { success: false, error: '账号和密码不能为空' };
  }

  if (password.length < 8) {
    return { success: false, error: '密码至少 8 位' };
  }

  if (!VALID_ROLES.includes(role)) {
    return { success: false, error: '角色只能是 admin 或 recruiter' };
  }

  const trimmedUsername = username.trim();

  // 会话令牌的载荷是 `username|role|name|expiry` 这种竖线分隔格式，
  // 字段里若含竖线会让令牌解析出错（该用户将永远登录不上）。在此拦掉。
  if ([trimmedUsername, name].some((v) => typeof v === 'string' && v.includes('|'))) {
    return { success: false, error: '账号和姓名不能包含竖线字符 |' };
  }

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
      createdBy: auth.username,  // 取自校验通过的令牌，而非请求体自称
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
  const auth = await requireAdmin(params);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { username } = params;

  if (!username) {
    return { success: false, error: '请指定要删除的账号' };
  }

  // 身份来自令牌，这条自删保护才是真的（原先比的是请求体自称的 callerUsername，可被绕过）
  if (username === auth.username) {
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
  const auth = await requireAdmin(params);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { username, newPassword } = params;

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

/**
 * 修改自己的密码（所有已登录用户可用）
 *
 * 必须持有效会话令牌，且令牌内用户名与被改账号一致。
 *
 * 原实现只校验 oldPassword，既不要求令牌、也没有失败计数，由此产生两个问题：
 *   1. 它是个无鉴权的密码预言机 —— 攻击者可无限次试密码，
 *      完全绕过 handleLogin 的「5 次失败锁 15 分钟」，那道防线形同虚设
 *   2. 猜中时返回值从「旧密码错误」变为「密码修改成功」，等于确认了正确密码
 * 要求持令牌之后，必须先成功登录才能走到这里，该通道即关闭。
 */
async function handleChangePassword(params) {
  const auth = sessions.authorizeSelf(params && params.sessionToken, params && params.username);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const username = auth.username;  // 身份取自令牌，不采信请求体
  const { oldPassword, newPassword } = params;

  if (!oldPassword || !newPassword) {
    return { success: false, error: '旧密码和新密码不能为空' };
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

  const result = sessions.verify(sessionToken);

  if (!result.valid) {
    return { success: false, error: result.error };
  }

  // 🆕 登录考勤：当天同账号首条会话活跃（去重标记，刷新多次只写 1 条）
  await recordActiveIfNew(result.username, result.role)
    .catch((e) => console.warn('[auth-proxy] 记录活跃失败:', e.message));

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

/**
 * 初始化默认账号（仅当 Users 集合为空时）。
 *
 * ⚠️ 这是唯一一个「无需既有身份就能造出管理员」的操作，因此绝不可对公网开放：
 * 环境重建后 Users 为空，任何人调用它都能创建 9 个默认账号并拿到初始密码，
 * 进而直接取得管理员权限。
 *
 * 现要求携带 bootstrapKey，与 MASTER_SECRET 常数时间比对。该密钥只存在于
 * 云函数环境变量与控制台，前端已移除全部调用入口。
 * 部署/重建环境时由运维执行一次：
 *   tcb fn invoke auth-proxy --params '{"action":"seedDefaults","bootstrapKey":"<MASTER_SECRET>"}'
 */
async function handleSeedDefaults(params) {
  const provided = (params && params.bootstrapKey) || '';
  if (!timingSafeStringEqual(provided, SESSION_SIGNING_KEY)) {
    console.warn('[auth-proxy] seedDefaults 被拒绝：部署密钥缺失或不匹配');
    return { success: false, error: '无权限：初始化需要正确的部署密钥' };
  }

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
      return handleSeedDefaults(params);
    default:
      return { success: false, error: `未知操作: ${action}` };
  }
};
