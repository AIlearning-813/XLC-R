/**
 * useEmailConfigStore.js — 邮箱配置状态管理
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getEmailConfigs,
  createEmailConfig,
  updateEmailConfig,
  deleteEmailConfig,
  toggleEmailConfig,
  testImapConnection,
  triggerManualScan,
} from '../services/email-config';
import { useAuthStore } from './useAuthStore';
import { isCryptoReady } from '../services/crypto-browser';
import { useToast } from '../composables/useToast';

export const useEmailConfigStore = defineStore('emailConfig', () => {
  const toast = useToast();
  const auth = useAuthStore();

  // 状态
  const configs = ref([]);
  const loading = ref(false);
  const testingConnection = ref(false);
  const scanning = ref(false);
  const error = ref('');

  // 计算
  const enabledConfigs = computed(() =>
    configs.value.filter((c) => c.enabled)
  );
  const hasConfigs = computed(() => configs.value.length > 0);
  const cryptoReady = computed(() => isCryptoReady());

  // 操作
  async function fetchConfigs() {
    loading.value = true;
    error.value = '';
    try {
      const username = auth.currentUsername;
      configs.value = username ? await getEmailConfigs(username) : [];
    } catch (err) {
      error.value = err.message || '获取邮箱配置失败';
      toast.error(error.value);
    } finally {
      loading.value = false;
    }
  }

  async function add(config) {
    loading.value = true;
    error.value = '';
    try {
      await createEmailConfig(config);
      await fetchConfigs();
      toast.success('邮箱配置已添加');
    } catch (err) {
      error.value = err.message || '添加邮箱配置失败';
      toast.error(error.value);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function update(id, updates) {
    loading.value = true;
    error.value = '';
    try {
      await updateEmailConfig(id, updates);
      await fetchConfigs();
      toast.success('邮箱配置已更新');
    } catch (err) {
      error.value = err.message || '更新邮箱配置失败';
      toast.error(error.value);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function remove(id) {
    loading.value = true;
    error.value = '';
    try {
      await deleteEmailConfig(id);
      await fetchConfigs();
      toast.success('邮箱配置已删除');
    } catch (err) {
      error.value = err.message || '删除邮箱配置失败';
      toast.error(error.value);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function toggle(id, enabled) {
    try {
      await toggleEmailConfig(id, enabled);
      await fetchConfigs();
      toast.success(enabled ? '邮箱扫描已启用' : '邮箱扫描已停用');
    } catch (err) {
      toast.error(err.message || '切换状态失败');
    }
  }

  async function testConnection(config) {
    testingConnection.value = true;
    try {
      const result = await testImapConnection(config);
      return result;
    } catch (err) {
      return { success: false, message: err.message || '连接测试失败' };
    } finally {
      testingConnection.value = false;
    }
  }

  async function scanNow(force = false) {
    scanning.value = true;
    try {
      const result = await triggerManualScan(force);
      if (result.success) {
        if (result.inProgress) {
          // 云函数超时但在后台继续运行
          toast.info(result.message);
        } else {
          toast.success(
            result.message || `扫描完成：发现 ${result.totalEmails || 0} 封邮件，新增 ${result.newResumes || 0} 份简历`
          );
        }
      } else {
        toast.error(result.message || '扫描失败');
      }
      return result;
    } catch (err) {
      toast.error(err.message || '扫描失败');
      return { success: false };
    } finally {
      scanning.value = false;
      // 刷新配置列表以显示最新扫描时间
      await fetchConfigs();
    }
  }

  return {
    configs,
    loading,
    testingConnection,
    scanning,
    error,
    enabledConfigs,
    hasConfigs,
    cryptoReady,
    fetchConfigs,
    add,
    update,
    remove,
    toggle,
    testConnection,
    scanNow,
  };
});
