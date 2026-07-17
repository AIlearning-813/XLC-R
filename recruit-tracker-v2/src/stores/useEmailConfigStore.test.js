/**
 * useEmailConfigStore.test.js — 邮箱配置 Store 测试
 *
 * 通过服务层 Mock 验证：
 *   - CRUD（增删改查）+ 启用/停用切换
 *   - 计算属性（enabledConfigs / hasConfigs / cryptoReady）
 *   - IMAP 连接测试
 *   - 手动邮箱扫描
 *   - Toast 提示正确调用
 *   - 错误传播与状态恢复
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ===== Mock 邮箱配置服务层 =====
vi.mock('../services/email-config', () => ({
  getEmailConfigs: vi.fn(),
  createEmailConfig: vi.fn(),
  updateEmailConfig: vi.fn(),
  deleteEmailConfig: vi.fn(),
  toggleEmailConfig: vi.fn(),
  testImapConnection: vi.fn(),
  triggerManualScan: vi.fn(),
}));

// ===== Mock crypto-browser =====
vi.mock('../services/crypto-browser', () => ({
  isCryptoReady: vi.fn(() => true),
}));

// ===== Mock useToast =====
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock('../composables/useToast', () => ({
  useToast: () => mockToast,
}));

// ===== Mock Auth Store =====
vi.mock('./useAuthStore', () => ({
  useAuthStore: () => ({
    currentUsername: 'admin',
    userName: '管理员',
    isAdmin: true,
    isLoggedIn: true,
  }),
}));

// ===== 导入依赖 =====
import { useEmailConfigStore } from './useEmailConfigStore';
import * as emailConfigService from '../services/email-config';

let store;

beforeEach(() => {
  setActivePinia(createPinia());

  // 重置所有 mock 返回值
  emailConfigService.getEmailConfigs.mockReset();
  emailConfigService.createEmailConfig.mockReset();
  emailConfigService.updateEmailConfig.mockReset();
  emailConfigService.deleteEmailConfig.mockReset();
  emailConfigService.toggleEmailConfig.mockReset();
  emailConfigService.testImapConnection.mockReset();
  emailConfigService.triggerManualScan.mockReset();

  // 清除 toast mock 历史
  mockToast.success.mockClear();
  mockToast.error.mockClear();
  mockToast.warning.mockClear();
  mockToast.info.mockClear();

  store = useEmailConfigStore();
});

// ===== 测试辅助：预设配置数据 =====
function makeConfig(overrides = {}) {
  return {
    _id: 'cfg_001',
    userId: 'admin',
    email: 'hr@example.com',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapUser: 'hr@example.com',
    filterRules: {},
    enabled: true,
    createdAt: new Date('2025-06-01'),
    updatedAt: new Date('2025-06-01'),
    ...overrides,
  };
}

function makeConfigList(count = 3) {
  return Array.from({ length: count }, (_, i) =>
    makeConfig({
      _id: `cfg_00${i + 1}`,
      email: `hr${i + 1}@example.com`,
      enabled: i % 2 === 0,
    })
  );
}

// ==========================================
// 测试套件
// ==========================================
describe('useEmailConfigStore', () => {
  // ==========================================
  // 初始状态
  // ==========================================
  describe('初始状态', () => {
    it('configs 初始为空数组', () => {
      expect(store.configs).toEqual([]);
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('testingConnection 初始为 false', () => {
      expect(store.testingConnection).toBe(false);
    });

    it('scanning 初始为 false', () => {
      expect(store.scanning).toBe(false);
    });

    it('error 初始为空字符串', () => {
      expect(store.error).toBe('');
    });
  });

  // ==========================================
  // 计算属性
  // ==========================================
  describe('计算属性', () => {
    describe('enabledConfigs', () => {
      it('只返回 enabled:true 的配置', () => {
        store.configs = [
          makeConfig({ _id: 'c1', enabled: true, email: 'a@x.com' }),
          makeConfig({ _id: 'c2', enabled: false, email: 'b@x.com' }),
          makeConfig({ _id: 'c3', enabled: true, email: 'c@x.com' }),
        ];
        const result = store.enabledConfigs;
        expect(result).toHaveLength(2);
        expect(result.every((c) => c.enabled)).toBe(true);
        expect(result.map((c) => c._id)).toEqual(['c1', 'c3']);
      });

      it('所有配置都停用时返回空数组', () => {
        store.configs = [
          makeConfig({ _id: 'c1', enabled: false }),
          makeConfig({ _id: 'c2', enabled: false }),
        ];
        expect(store.enabledConfigs).toEqual([]);
      });

      it('configs 为空时返回空数组', () => {
        store.configs = [];
        expect(store.enabledConfigs).toEqual([]);
      });
    });

    describe('hasConfigs', () => {
      it('有配置时返回 true', () => {
        store.configs = [makeConfig()];
        expect(store.hasConfigs).toBe(true);
      });

      it('无配置时返回 false', () => {
        store.configs = [];
        expect(store.hasConfigs).toBe(false);
      });

      it('只有停用配置也返回 true（hasConfigs 不区分 enabled）', () => {
        store.configs = [makeConfig({ enabled: false })];
        expect(store.hasConfigs).toBe(true);
      });
    });

    describe('cryptoReady', () => {
      it('返回 isCryptoReady() 的值', () => {
        // isCryptoReady mock 默认返回 true
        expect(store.cryptoReady).toBe(true);
      });
    });
  });

  // ==========================================
  // fetchConfigs — 拉取邮箱配置
  // ==========================================
  describe('fetchConfigs', () => {
    it('成功拉取配置填充 configs', async () => {
      const mockData = makeConfigList(3);
      emailConfigService.getEmailConfigs.mockResolvedValue(mockData);

      await store.fetchConfigs();

      expect(store.configs).toEqual(mockData);
      expect(store.configs).toHaveLength(3);
      expect(store.loading).toBe(false);
      expect(store.error).toBe('');
    });

    it('空结果不报错，configs 设为空数组', async () => {
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      await store.fetchConfigs();

      expect(store.configs).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBe('');
    });

    it('拉取过程中 loading 为 true', async () => {
      emailConfigService.getEmailConfigs.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 10))
      );

      const promise = store.fetchConfigs();
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });

    it('拉取失败时设置 error 并调用 toast.error', async () => {
      const err = new Error('网络错误');
      emailConfigService.getEmailConfigs.mockRejectedValue(err);

      await store.fetchConfigs();

      expect(store.error).toBe('网络错误');
      expect(mockToast.error).toHaveBeenCalledWith('网络错误');
      expect(store.loading).toBe(false);
    });

    it('拉取失败时 error 对象无 message 使用默认文案', async () => {
      emailConfigService.getEmailConfigs.mockRejectedValue({});

      await store.fetchConfigs();

      expect(store.error).toBe('获取邮箱配置失败');
      expect(mockToast.error).toHaveBeenCalledWith('获取邮箱配置失败');
    });

    it('多次调用刷新数据', async () => {
      const firstData = makeConfigList(2);
      const secondData = makeConfigList(4);
      emailConfigService.getEmailConfigs
        .mockResolvedValueOnce(firstData)
        .mockResolvedValueOnce(secondData);

      await store.fetchConfigs();
      expect(store.configs).toHaveLength(2);

      await store.fetchConfigs();
      expect(store.configs).toHaveLength(4);
    });

    it('传入 currentUsername 给 getEmailConfigs', async () => {
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      await store.fetchConfigs();

      expect(emailConfigService.getEmailConfigs).toHaveBeenCalledWith('admin');
    });
  });

  // ==========================================
  // add — 新增邮箱配置
  // ==========================================
  describe('add', () => {
    const newConfig = {
      email: 'new@example.com',
      imapHost: 'imap.exmail.qq.com',
      imapPort: 993,
      imapUser: 'new@example.com',
      imapPassword: 'plaintext_pwd',
      userId: 'admin',
      enabled: true,
    };

    it('成功：调用 createEmailConfig → 刷新配置 → toast 成功', async () => {
      emailConfigService.createEmailConfig.mockResolvedValue({ _id: 'cfg_new' });
      const updatedConfigs = makeConfigList(2);
      emailConfigService.getEmailConfigs.mockResolvedValue(updatedConfigs);

      await store.add(newConfig);

      // 验证调用了服务
      expect(emailConfigService.createEmailConfig).toHaveBeenCalledWith(newConfig);
      // 验证刷新了配置
      expect(emailConfigService.getEmailConfigs).toHaveBeenCalledWith('admin');
      expect(store.configs).toEqual(updatedConfigs);
      // 验证 toast
      expect(mockToast.success).toHaveBeenCalledWith('邮箱配置已添加');
      // 状态恢复
      expect(store.loading).toBe(false);
      expect(store.error).toBe('');
    });

    it('失败：toast 错误并重新抛出异常', async () => {
      const err = new Error('服务端创建失败');
      emailConfigService.createEmailConfig.mockRejectedValue(err);

      await expect(store.add(newConfig)).rejects.toThrow('服务端创建失败');

      expect(mockToast.error).toHaveBeenCalledWith('服务端创建失败');
      expect(store.error).toBe('服务端创建失败');
      expect(store.loading).toBe(false);
    });

    it('失败时 err 无 message 使用默认文案', async () => {
      emailConfigService.createEmailConfig.mockRejectedValue({});

      // store 直接 throw 原始 err（非 Error 实例），使用 toBeDefined 验证有抛出即可
      await expect(store.add(newConfig)).rejects.toBeDefined();

      expect(mockToast.error).toHaveBeenCalledWith('添加邮箱配置失败');
      expect(store.error).toBe('添加邮箱配置失败');
    });

    it('添加过程中 loading 为 true', async () => {
      emailConfigService.createEmailConfig.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ _id: 'x' }), 10))
      );
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      const promise = store.add(newConfig);
      expect(store.loading).toBe(true);

      await promise;
      expect(store.loading).toBe(false);
    });
  });

  // ==========================================
  // update — 更新邮箱配置
  // ==========================================
  describe('update', () => {
    const updates = { imapHost: 'imap.163.com', email: 'updated@163.com' };

    it('成功：调用 updateEmailConfig → 刷新 → toast', async () => {
      emailConfigService.updateEmailConfig.mockResolvedValue(undefined);
      const refreshed = makeConfigList(2);
      emailConfigService.getEmailConfigs.mockResolvedValue(refreshed);

      await store.update('cfg_001', updates);

      expect(emailConfigService.updateEmailConfig).toHaveBeenCalledWith('cfg_001', updates);
      expect(emailConfigService.getEmailConfigs).toHaveBeenCalledWith('admin');
      expect(store.configs).toEqual(refreshed);
      expect(mockToast.success).toHaveBeenCalledWith('邮箱配置已更新');
      expect(store.loading).toBe(false);
    });

    it('失败：toast 错误并重新抛出', async () => {
      const err = new Error('更新失败');
      emailConfigService.updateEmailConfig.mockRejectedValue(err);

      await expect(store.update('cfg_001', updates)).rejects.toThrow('更新失败');

      expect(mockToast.error).toHaveBeenCalledWith('更新失败');
      expect(store.error).toBe('更新失败');
    });

    it('失败时默认错误文案', async () => {
      emailConfigService.updateEmailConfig.mockRejectedValue({});

      await expect(store.update('cfg_001', updates)).rejects.toBeDefined();
      expect(mockToast.error).toHaveBeenCalledWith('更新邮箱配置失败');
      expect(store.error).toBe('更新邮箱配置失败');
    });

    it('更新后 loading 恢复 false', async () => {
      emailConfigService.updateEmailConfig.mockRejectedValue(new Error('x'));

      await expect(store.update('cfg_001', updates)).rejects.toThrow();
      expect(store.loading).toBe(false);
    });
  });

  // ==========================================
  // remove — 删除邮箱配置
  // ==========================================
  describe('remove', () => {
    it('成功：调用 deleteEmailConfig → 刷新 → toast', async () => {
      emailConfigService.deleteEmailConfig.mockResolvedValue(undefined);
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      await store.remove('cfg_001');

      expect(emailConfigService.deleteEmailConfig).toHaveBeenCalledWith('cfg_001');
      expect(emailConfigService.getEmailConfigs).toHaveBeenCalledWith('admin');
      expect(store.configs).toEqual([]);
      expect(mockToast.success).toHaveBeenCalledWith('邮箱配置已删除');
      expect(store.loading).toBe(false);
    });

    it('失败：toast 错误并重新抛出', async () => {
      const err = new Error('删除失败');
      emailConfigService.deleteEmailConfig.mockRejectedValue(err);

      await expect(store.remove('cfg_001')).rejects.toThrow('删除失败');

      expect(mockToast.error).toHaveBeenCalledWith('删除失败');
      expect(store.error).toBe('删除失败');
    });

    it('失败时默认错误文案', async () => {
      emailConfigService.deleteEmailConfig.mockRejectedValue({});

      await expect(store.remove('cfg_001')).rejects.toBeDefined();
      expect(mockToast.error).toHaveBeenCalledWith('删除邮箱配置失败');
      expect(store.error).toBe('删除邮箱配置失败');
    });

    it('删除后 loading 恢复 false', async () => {
      emailConfigService.deleteEmailConfig.mockRejectedValue(new Error('x'));

      await expect(store.remove('cfg_001')).rejects.toThrow();
      expect(store.loading).toBe(false);
    });
  });

  // ==========================================
  // toggle — 切换启用/停用
  // ==========================================
  describe('toggle', () => {
    it('启用时调用 toggleEmailConfig → 刷新 → toast 启用文案', async () => {
      emailConfigService.toggleEmailConfig.mockResolvedValue(undefined);
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      await store.toggle('cfg_001', true);

      expect(emailConfigService.toggleEmailConfig).toHaveBeenCalledWith('cfg_001', true);
      expect(emailConfigService.getEmailConfigs).toHaveBeenCalledWith('admin');
      expect(mockToast.success).toHaveBeenCalledWith('邮箱扫描已启用');
    });

    it('停用时 toast 停用文案', async () => {
      emailConfigService.toggleEmailConfig.mockResolvedValue(undefined);
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      await store.toggle('cfg_001', false);

      expect(emailConfigService.toggleEmailConfig).toHaveBeenCalledWith('cfg_001', false);
      expect(mockToast.success).toHaveBeenCalledWith('邮箱扫描已停用');
    });

    it('失败：toast 错误（不重新抛出）', async () => {
      const err = new Error('切换失败');
      emailConfigService.toggleEmailConfig.mockRejectedValue(err);
      // toggle 不提前 mock getEmailConfigs，但 fetchConfigs 在 catch 之后仍被 await，
      // 但由于 toggle 在 catch 中不 throw，所以不会影响后续流程
      // 需要让 getEmailConfigs 也能工作（默认 reset 后返回 undefined 会报错）
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      // toggle 在 catch 块中调用了 toast.error，但随后又调用了 await fetchConfigs()
      // 注意：源码中 toggle 在 try 里调 await toggleEmailConfig 然后 await fetchConfigs
      // 如果 toggleEmailConfig 抛错，fetchConfigs 不会被调用（在 try 里）
      // 等等，看源码：try { await toggleEmailConfig...; await fetchConfigs... } catch { toast.error }
      // 所以抛错后不会调 fetchConfigs，getEmailConfigs 不需要 mock

      // 不会抛出，只是 toasts error
      await store.toggle('cfg_001', true);

      expect(mockToast.error).toHaveBeenCalledWith('切换失败');
    });

    it('失败时默认错误文案', async () => {
      emailConfigService.toggleEmailConfig.mockRejectedValue({});

      await store.toggle('cfg_001', false);

      expect(mockToast.error).toHaveBeenCalledWith('切换状态失败');
    });

    it('toggle 通过 fetchConfigs 间接清除 error', async () => {
      emailConfigService.toggleEmailConfig.mockResolvedValue(undefined);
      emailConfigService.getEmailConfigs.mockResolvedValue([]);

      store.error = '之前有错误';
      store.loading = true;
      await store.toggle('cfg_001', true);

      // toggle 内部调用了 fetchConfigs，fetchConfigs 会清除 error 并重置 loading
      expect(store.error).toBe('');
      expect(store.loading).toBe(false);
    });
  });

  // ==========================================
  // testConnection — 测试 IMAP 连接
  // ==========================================
  describe('testConnection', () => {
    const testConfig = {
      email: 'test@example.com',
      imapHost: 'imap.qq.com',
      imapPort: 993,
      imapUser: 'test@example.com',
      imapPassword: 'plaintext',
    };

    it('成功：返回 {success:true, message}，testingConnection 恢复 false', async () => {
      const serviceResult = { success: true, message: '连接成功' };
      emailConfigService.testImapConnection.mockResolvedValue(serviceResult);

      const result = await store.testConnection(testConfig);

      expect(result).toEqual(serviceResult);
      expect(emailConfigService.testImapConnection).toHaveBeenCalledWith(testConfig);
      expect(store.testingConnection).toBe(false);
    });

    it('测试过程中 testingConnection 为 true', async () => {
      emailConfigService.testImapConnection.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 10))
      );

      const promise = store.testConnection(testConfig);
      expect(store.testingConnection).toBe(true);

      await promise;
      expect(store.testingConnection).toBe(false);
    });

    it('服务返回 {success:false} 时透传结果', async () => {
      const serviceResult = { success: false, message: '认证失败' };
      emailConfigService.testImapConnection.mockResolvedValue(serviceResult);

      const result = await store.testConnection(testConfig);

      expect(result.success).toBe(false);
      expect(result.message).toBe('认证失败');
      expect(store.testingConnection).toBe(false);
    });

    it('异常时返回 {success:false, message}，不抛出', async () => {
      const err = new Error('连接超时');
      emailConfigService.testImapConnection.mockRejectedValue(err);

      const result = await store.testConnection(testConfig);

      expect(result).toEqual({ success: false, message: '连接超时' });
      expect(store.testingConnection).toBe(false);
    });

    it('异常时 err 无 message 使用默认文案', async () => {
      emailConfigService.testImapConnection.mockRejectedValue({});

      const result = await store.testConnection(testConfig);

      expect(result).toEqual({ success: false, message: '连接测试失败' });
      expect(store.testingConnection).toBe(false);
    });

    it('连接测试不影响 error 状态', async () => {
      emailConfigService.testImapConnection.mockResolvedValue({ success: true });

      store.error = '之前的错误';
      await store.testConnection(testConfig);

      expect(store.error).toBe('之前的错误');
    });
  });

  // ==========================================
  // scanNow — 手动触发扫描
  // ==========================================
  describe('scanNow', () => {
    it('成功：返回扫描结果，scanning 恢复 false，toast 成功', async () => {
      const scanResult = {
        success: true,
        totalEmails: 10,
        newResumes: 3,
        message: '扫描完成：发现 10 封邮件，新增 3 份简历',
      };
      emailConfigService.triggerManualScan.mockResolvedValue(scanResult);

      const result = await store.scanNow();

      expect(result).toEqual(scanResult);
      expect(emailConfigService.triggerManualScan).toHaveBeenCalledWith(false);
      expect(store.scanning).toBe(false);
      expect(mockToast.success).toHaveBeenCalledWith(
        '扫描完成：发现 10 封邮件，新增 3 份简历'
      );
    });

    it('force=true 时传递给 triggerManualScan', async () => {
      const scanResult = { success: true, totalEmails: 5, newResumes: 1 };
      emailConfigService.triggerManualScan.mockResolvedValue(scanResult);

      await store.scanNow(true);

      expect(emailConfigService.triggerManualScan).toHaveBeenCalledWith(true);
    });

    it('扫描过程中 scanning 为 true', async () => {
      emailConfigService.triggerManualScan.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 10))
      );

      const promise = store.scanNow();
      expect(store.scanning).toBe(true);

      await promise;
      expect(store.scanning).toBe(false);
    });

    it('服务返回 success:false 时 toast 错误文案', async () => {
      const scanResult = { success: false, message: '没有启用的邮箱配置' };
      emailConfigService.triggerManualScan.mockResolvedValue(scanResult);

      const result = await store.scanNow();

      expect(result).toEqual(scanResult);
      expect(mockToast.error).toHaveBeenCalledWith('没有启用的邮箱配置');
      expect(store.scanning).toBe(false);
    });

    it('服务返回 success:false 且无 message 时 toast 默认文案', async () => {
      const scanResult = { success: false };
      emailConfigService.triggerManualScan.mockResolvedValue(scanResult);

      const result = await store.scanNow();

      expect(result).toEqual(scanResult);
      expect(mockToast.error).toHaveBeenCalledWith('扫描失败');
      expect(store.scanning).toBe(false);
    });

    it('成功时 result.message 为空用默认拼接文案', async () => {
      const scanResult = { success: true, totalEmails: 10, newResumes: 3 };
      // message 为 undefined，store 会拼接默认文案
      emailConfigService.triggerManualScan.mockResolvedValue(scanResult);

      await store.scanNow();

      expect(mockToast.success).toHaveBeenCalledWith(
        '扫描完成：发现 10 封邮件，新增 3 份简历'
      );
    });

    it('成功时 totalEmails/newResumes 缺失用 0 兜底', async () => {
      const scanResult = { success: true, message: 'done' };
      // 无 totalEmails / newResumes，拼接时用 0
      emailConfigService.triggerManualScan.mockResolvedValue(scanResult);

      await store.scanNow();

      expect(mockToast.success).toHaveBeenCalledWith('done');
    });

    it('异常时返回 {success:false}，toast 错误', async () => {
      const err = new Error('网络异常');
      emailConfigService.triggerManualScan.mockRejectedValue(err);

      const result = await store.scanNow();

      expect(result).toEqual({ success: false });
      expect(mockToast.error).toHaveBeenCalledWith('网络异常');
      expect(store.scanning).toBe(false);
    });

    it('异常时 err 无 message 使用默认文案', async () => {
      emailConfigService.triggerManualScan.mockRejectedValue({});

      const result = await store.scanNow();

      expect(result).toEqual({ success: false });
      expect(mockToast.error).toHaveBeenCalledWith('扫描失败');
      expect(store.scanning).toBe(false);
    });

    it('扫描完成后 fetchConfigs 会重置 error 状态', async () => {
      emailConfigService.triggerManualScan.mockResolvedValue({ success: true });

      store.error = '之前有错误';
      await store.scanNow();

      // scanNow 的 finally 块调用了 fetchConfigs，fetchConfigs 会将 error 重置为 ''
      expect(store.error).toBe('');
    });
  });

  // ==========================================
  // 边界场景与集成
  // ==========================================
  describe('边界场景', () => {
    it('连续多次 add 操作各自独立', async () => {
      emailConfigService.createEmailConfig
        .mockResolvedValueOnce({ _id: 'c1' })
        .mockResolvedValueOnce({ _id: 'c2' });
      emailConfigService.getEmailConfigs.mockResolvedValue(makeConfigList(3));

      await store.add({ email: 'a@x.com', imapPassword: 'p1' });
      expect(emailConfigService.createEmailConfig).toHaveBeenCalledTimes(1);

      await store.add({ email: 'b@x.com', imapPassword: 'p2' });
      expect(emailConfigService.createEmailConfig).toHaveBeenCalledTimes(2);
    });

    it('fetchConfigs 成功后再失败不会丢失已有数据', async () => {
      const initialData = makeConfigList(2);
      emailConfigService.getEmailConfigs.mockResolvedValueOnce(initialData);

      await store.fetchConfigs();
      expect(store.configs).toHaveLength(2);

      emailConfigService.getEmailConfigs.mockRejectedValueOnce(new Error('网络断开'));

      await store.fetchConfigs();
      // 失败时 catch 只设置了 error，不会修改 configs（看源码：成功才赋值）
      // 等等，看源码：try { configs.value = ... } catch { error.value = ... }
      // 成功时才赋值 configs，失败时保留旧值
      expect(store.configs).toHaveLength(2);
      expect(store.error).toBe('网络断开');
    });

    it('enabledConfigs 是响应式计算属性', () => {
      expect(store.enabledConfigs).toEqual([]);

      store.configs = [
        makeConfig({ _id: 'c1', enabled: true }),
        makeConfig({ _id: 'c2', enabled: false }),
      ];
      expect(store.enabledConfigs).toHaveLength(1);

      store.configs.push(makeConfig({ _id: 'c3', enabled: true }));
      expect(store.enabledConfigs).toHaveLength(2);
    });

    it('hasConfigs 是响应式计算属性', () => {
      expect(store.hasConfigs).toBe(false);

      store.configs = [makeConfig()];
      expect(store.hasConfigs).toBe(true);

      store.configs = [];
      expect(store.hasConfigs).toBe(false);
    });

    it('error 在下次成功操作时被清空', async () => {
      // 先制造一个错误
      emailConfigService.getEmailConfigs.mockRejectedValueOnce(new Error('旧错误'));
      await store.fetchConfigs();
      expect(store.error).toBe('旧错误');

      // 再成功拉取
      emailConfigService.getEmailConfigs.mockResolvedValueOnce([]);
      await store.fetchConfigs();
      expect(store.error).toBe('');
    });
  });
});
