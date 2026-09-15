/**
 * useAuthStore.test.js — 认证 Store 测试（Mock CloudBase SDK）
 *
 * 验证：登录/登出/会话持久化/过期/签名/角色判断
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// vi.mock 会被提升到文件顶部，所以用 vi.hoisted() 提前声明变量
const { mockCloudbase, setLoginResult } = vi.hoisted(() => {
  let callFunctionResult = { success: true, data: { username: 'admin', role: 'admin', name: '管理员', sessionToken: 'mock-hmac-token' } };
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
// 取到被 mock 的模块引用本身，以便断言 callFunction 的调用参数
import cloudbaseMock from '../services/cloudbase';

let auth;
beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  auth = useAuthStore();
  // P1-5：必须包含 sessionToken，否则 saveSession 中 st 为 undefined
  setLoginResult(true, { username: 'admin', role: 'admin', name: '管理员', sessionToken: 'mock-hmac-token' });
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
      // P1-5：HMAC-SHA256 签名令牌使用 st 字段（替代旧版简单 sig）
      expect(parsed.st).toBe('mock-hmac-token');
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

  /**
   * 第 2 阶段加固（2026-09-14）：
   * 服务端已改为「只认 sessionToken，不再采信请求体里的 callerUsername」。
   * 若前端某天漏传令牌，管理员操作会直接失败；更糟的是若有人把 callerUsername 加回来
   * 当作兜底，等于把已验证的鉴权又退回成自称字段。这组断言把这两点钉死。
   */
  describe('特权操作的鉴权参数', () => {
    /**
     * 取出最近一次指定 action 的调用参数。
     * store 调用形式是 callFunction('auth-proxy', {action, ...})，
     * 载荷在第 2 个位置参数；这里按「哪个参数是带 action 的对象」来取，
     * 不写死下标，避免调用约定变化时测试假失败。
     */
    function lastPayloadFor(action) {
      const payloads = cloudbaseMock.callFunction.mock.calls
        .map((args) => args.find((a) => a && typeof a === 'object' && 'action' in a))
        .filter((p) => p && p.action === action);
      return payloads[payloads.length - 1];
    }

    const privilegedCalls = [
      ['listUsers', () => auth.fetchUsers()],
      ['addUser', () => auth.addUserAccount('新同事', 'password123', 'recruiter', '新同事')],
      ['deleteUser', () => auth.deleteUserAccount('新同事')],
      ['resetPassword', () => auth.resetUserPassword('王莉', 'newpassword123')],
      ['changePassword', () => auth.changeOwnPassword('旧密码', '新密码12345')],
    ];

    for (const [action, invoke] of privilegedCalls) {
      it(`${action} 携带登录时拿到的 sessionToken`, async () => {
        await auth.login('admin', '密码');
        await invoke();
        expect(lastPayloadFor(action).sessionToken).toBe('mock-hmac-token');
      });

      it(`${action} 不再传自称字段 callerUsername`, async () => {
        await auth.login('admin', '密码');
        await invoke();
        expect(lastPayloadFor(action)).not.toHaveProperty('callerUsername');
      });
    }

    it('登出后令牌被清空，特权调用携带空令牌（应由服务端拒绝）', async () => {
      await auth.login('admin', '密码');
      await auth.logout();
      await auth.fetchUsers();
      expect(lastPayloadFor('listUsers').sessionToken).toBeFalsy();
    });
  });
});
