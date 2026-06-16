/* 新励成招聘管理系统 V2.0 — 认证 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';

export const useAuthStore = defineStore('auth', () => {
  // 状态
  const currentUser = ref(null);       // CloudBase 用户对象
  const userRole = ref(null);          // 'admin' | 'recruiter'
  const userName = ref('');            // 显示名称
  const loginState = ref('idle');      // 'idle' | 'loading' | 'error'

  // 计算属性
  const isLoggedIn = computed(() => !!currentUser.value);
  const isAdmin = computed(() => userRole.value === 'admin');

  // 初始化 CloudBase 匿名登录
  async function initAuth() {
    loginState.value = 'loading';
    try {
      const auth = cloudbase.auth({ persistence: 'local' });
      const loginState = await auth.getLoginState();

      if (!loginState) {
        // 匿名登录
        await auth.anonymousAuthProvider().signIn();
        const newState = await auth.getLoginState();
        currentUser.value = newState.user;
      } else {
        currentUser.value = loginState.user;
      }
      loginState.value = 'idle';
      return true;
    } catch (err) {
      console.error('CloudBase 登录失败:', err);
      loginState.value = 'error';
      return false;
    }
  }

  // 选择角色（管理员 / 专员）
  function selectRole(role, displayName = '') {
    userRole.value = role;
    userName.value = displayName || (role === 'admin' ? '管理员' : '招聘专员');
  }

  // 登出
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
    loginState.value = 'idle';
  }

  return {
    currentUser,
    userRole,
    userName,
    loginState,
    isLoggedIn,
    isAdmin,
    initAuth,
    selectRole,
    logout,
  };
});
