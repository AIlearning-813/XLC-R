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

  /** 从 localStorage 恢复登录态 */
  function restoreSession() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const session = JSON.parse(saved);
        if (session.username && session.role) {
          userRole.value = session.role;
          userName.value = session.name || session.username;
          currentUsername.value = session.username;
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /** 保存登录态到 localStorage */
  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        username: currentUsername.value,
        role: userRole.value,
        name: userName.value,
      }));
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
