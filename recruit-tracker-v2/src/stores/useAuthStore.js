/* 新励成招聘管理系统 V2.0 — 认证 Store（服务端角色校验） */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';

export const useAuthStore = defineStore('auth', () => {
  // 状态
  const currentUser = ref(null);       // CloudBase 用户对象（匿名登录，提供 SDK 上下文）
  const userRole = ref(null);          // 'admin' | 'recruiter'（由服务端 auth-proxy 返回）
  const userName = ref('');            // 显示名称
  const currentUsername = ref('');     // 登录账号名，用于 ownerId 数据隔离
  const loginState = ref('idle');      // 'idle' | 'loading' | 'error'
  const loginError = ref('');          // 登录失败的具体原因

  // 计算属性
  const isLoggedIn = computed(() => !!currentUser.value && !!currentUsername.value);
  const isAdmin = computed(() => userRole.value === 'admin');

  // ===== 持久化 key =====
  const STORAGE_KEY = 'xlc_auth_session';
  const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时过期

  /** 简单签名：防止 localStorage 被手动篡改 */
  function signPayload(data) {
    const str = JSON.stringify(data) + STORAGE_KEY;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return hash.toString(36);
  }

  /** 从 localStorage 恢复登录态（含过期校验和签名校验） */
  function restoreSession() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const session = JSON.parse(saved);
        // 签名校验
        const expectedSig = signPayload({ u: session.u, r: session.r, n: session.n, e: session.e });
        if (session.sig !== expectedSig) {
          localStorage.removeItem(STORAGE_KEY);
          return false;
        }
        // 过期校验
        if (session.e && Date.now() > session.e) {
          localStorage.removeItem(STORAGE_KEY);
          return false;
        }
        if (session.u && session.r) {
          userRole.value = session.r;
          userName.value = session.n || session.u;
          currentUsername.value = session.u;
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /** 保存登录态到 localStorage（含过期时间和签名） */
  function saveSession() {
    try {
      const payload = {
        u: currentUsername.value,
        r: userRole.value,
        n: userName.value,
        e: Date.now() + SESSION_TTL_MS,
      };
      payload.sig = signPayload(payload);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) { /* ignore */ }
  }

  // ===== 初始化 =====

  /** 初始化 CloudBase 匿名登录（提供 SDK 上下文，真正的身份验证走 auth-proxy） */
  async function initSDK() {
    try {
      const auth = cloudbase.auth({ persistence: 'local' });
      if (!auth) {
        throw new Error('服务未初始化，请检查环境ID配置');
      }

      const loginResp = await auth.getLoginState();

      if (!loginResp) {
        await auth.anonymousAuthProvider().signIn();
        const newState = await auth.getLoginState();
        if (!newState) {
          throw new Error('登录后获取用户状态失败');
        }
        currentUser.value = newState.user;
      } else {
        currentUser.value = loginResp.user;
      }

      // 尝试从 localStorage 恢复用户身份（避免刷新后需要重新登录）
      if (loginResp || currentUser.value) {
        restoreSession();
      }

      return true;
    } catch (err) {
      console.error('CloudBase 初始化失败:', err);
      throw err;
    }
  }

  // ===== 登录 =====

  /** 账号密码登录 — 调 auth-proxy 云函数验证，角色由服务端返回 */
  async function login(username, password) {
    loginState.value = 'loading';
    loginError.value = '';

    try {
      // ① 先初始化 CloudBase SDK（匿名登录，提供调用云函数的能力）
      await initSDK();

      // ② 调用 auth-proxy 云函数验证账号密码
      const result = await cloudbase.callFunction('auth-proxy', {
        action: 'login',
        username,
        password,
      });

      if (!result.success) {
        loginState.value = 'error';
        loginError.value = result.error || '登录失败';
        return false;
      }

      // ③ 服务端返回真实角色和名称
      const { role, name, username: returnedUsername } = result.data;
      userRole.value = role;
      userName.value = name;
      currentUsername.value = returnedUsername;
      saveSession();  // 🆕 持久化登录态，刷新不丢
      loginState.value = 'idle';
      return true;
    } catch (err) {
      console.error('登录失败:', err);
      loginState.value = 'error';
      loginError.value = err.message || '登录过程中发生未知错误';
      return false;
    }
  }

  // ===== 登出 =====

  /** 登出 */
  async function logout() {
    try {
      const auth = cloudbase.auth({ persistence: 'local' });
      await auth.signOut();
    } catch (err) {
      console.warn('登出异常（可能已是匿名状态）:', err.message);
    }
    currentUser.value = null;
    userRole.value = null;
    userName.value = '';
    currentUsername.value = '';
    loginState.value = 'idle';
    localStorage.removeItem(STORAGE_KEY);  // 🆕 清除持久化登录态
  }

  // ===== 账号管理（仅管理员） =====

  /** 修改自己的密码（所有用户可用） */
  async function changeOwnPassword(oldPassword, newPassword) {
    const result = await cloudbase.callFunction('auth-proxy', {
      action: 'changePassword',
      username: currentUsername.value,
      oldPassword,
      newPassword,
    });
    if (!result.success) throw new Error(result.error);
    return result;
  }

  /** 获取所有用户列表 */
  async function fetchUsers() {
    const result = await cloudbase.callFunction('auth-proxy', {
      action: 'listUsers',
      callerUsername: currentUsername.value,
    });
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  /** 添加用户 */
  async function addUserAccount(username, password, role, name) {
    const result = await cloudbase.callFunction('auth-proxy', {
      action: 'addUser',
      callerUsername: currentUsername.value,
      username,
      password,
      role,
      name,
    });
    if (!result.success) throw new Error(result.error);
    return result;
  }

  /** 删除用户 */
  async function deleteUserAccount(username) {
    const result = await cloudbase.callFunction('auth-proxy', {
      action: 'deleteUser',
      callerUsername: currentUsername.value,
      username,
    });
    if (!result.success) throw new Error(result.error);
    return result;
  }

  /** 重置用户密码 */
  async function resetUserPassword(username, newPassword) {
    const result = await cloudbase.callFunction('auth-proxy', {
      action: 'resetPassword',
      callerUsername: currentUsername.value,
      username,
      newPassword,
    });
    if (!result.success) throw new Error(result.error);
    return result;
  }

  // ===== 初始化默认账号 =====

  /** 初始化默认账号（仅当 Users 集合为空时） */
  async function seedDefaultUsers() {
    const result = await cloudbase.callFunction('auth-proxy', {
      action: 'seedDefaults',
    });
    return result;
  }

  return {
    // 状态
    currentUser,
    userRole,
    userName,
    currentUsername,
    loginState,
    loginError,
    // 计算属性
    isLoggedIn,
    isAdmin,
    // 方法
    initSDK,
    login,
    logout,
    // 账号管理
    changeOwnPassword,
    fetchUsers,
    addUserAccount,
    deleteUserAccount,
    resetUserPassword,
    seedDefaultUsers,
  };
});
