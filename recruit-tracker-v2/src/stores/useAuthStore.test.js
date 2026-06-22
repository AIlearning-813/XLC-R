/**
 * useAuthStore.test.js — 认证 Store 测试（Mock CloudBase SDK）
 *
 * 验证：登录/登出/会话持久化/过期/签名/角色判断
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// vi.mock 会被提升到文件顶部，所以用 vi.hoisted() 提前声明变量
const { mockCloudbase, setLoginResult } = vi.hoisted(() => {
  let callFunctionResult = { success: true, data: { username: 'admin', role: 'admin', name: '管理员' } };
  let loggedIn = false;
  const cloudbase = {
    getApp: vi.fn(() => ({})),
    db: vi.fn(() => ({ collection: vi.fn() })),
    auth: vi.fn(() => ({
      getLoginState: vi.fn(async () => loggedIn ? { user: { uid: 'mock-uid' } } : null),
      anonymousAuthProvider: () => ({ signIn: vi.fn(async () => { loggedIn = true; }) }),
      signOut: vi.fn(async () => { loggedIn = false; }),
    })),
    storage: vi.fn(() => ({})),
    callFunction: vi.fn(async () => callFunctionResult),
    isReady: vi.fn(() => true),
  };
  return {
    mockCloudbase: cloudbase,
    setLoginResult: (success, data = {}) => {
      callFunctionResult = { success, data };
    },
  };
});

vi.mock('../services/cloudbase', () => ({ default: mockCloudbase }));

import { useAuthStore } from './useAuthStore';

let auth;
beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  auth = useAuthStore();
  setLoginResult(true, { username: 'admin', role: 'admin', name: '管理员' });
  vi.clearAllMocks();
});

describe('useAuthStore', () => {
  describe('初始状态', () => {
    it('未登录时 isLoggedIn 为 false', () => {
      expect(auth.isLoggedIn).toBe(false);
    });

    it('未登录时 isAdmin 为 false', () => {
      expect(auth.isAdmin).toBe(false);
    });

    it('未登录时 loginState 为 idle', () => {
      expect(auth.loginState).toBe('idle');
    });
  });

  describe('登录流程', () => {
    it('登录成功 → isLoggedIn 为 true', async () => {
      const ok = await auth.login('admin', '密码');
      expect(ok).toBe(true);
      expect(auth.isLoggedIn).toBe(true);
    });

    it('登录成功 → isAdmin 正确反映 admin 角色', async () => {
      await auth.login('admin', '密码');
      expect(auth.isAdmin).toBe(true);
    });

    it('招聘专员 → isAdmin 为 false', async () => {
      setLoginResult(true, { username: 'r1', role: 'recruiter', name: '专员' });
      await auth.login('r1', '密码');
      expect(auth.isAdmin).toBe(false);
      expect(auth.isLoggedIn).toBe(true);
    });

    it('登录失败 → isLoggedIn 仍为 false', async () => {
      setLoginResult(false, {});
      const ok = await auth.login('admin', '错误密码');
      expect(ok).toBe(false);
      expect(auth.isLoggedIn).toBe(false);
    });

    it('登录成功 → 会话保存到 localStorage', async () => {
      await auth.login('admin', '密码');
      const saved = localStorage.getItem('xlc_auth_session');
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved);
      expect(parsed.u).toBe('admin');
      expect(parsed.r).toBe('admin');
      expect(parsed.sig).toBeTruthy();
      expect(parsed.e).toBeGreaterThan(Date.now());
    });
  });

  describe('登出流程', () => {
    it('登出后 isLoggedIn 为 false', async () => {
      await auth.login('admin', '密码');
      await auth.logout();
      expect(auth.isLoggedIn).toBe(false);
      expect(auth.currentUsername).toBe('');
    });

    it('登出后 localStorage 被清除', async () => {
      await auth.login('admin', '密码');
      await auth.logout();
      expect(localStorage.getItem('xlc_auth_session')).toBeNull();
    });
  });
});
