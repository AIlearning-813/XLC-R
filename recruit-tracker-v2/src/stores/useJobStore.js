/* 新励成招聘管理系统 V2.0 — 岗位 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { versionedUpdate, initialVersion, isVersionConflict, conflictMessage } from '../services/optimistic-lock';

export const useJobStore = defineStore('job', () => {
  // ===== 状态 =====
  const jobs = ref([]);
  const loading = ref(false);
  const error = ref('');

  // ===== 计算属性 =====
  const activeJobs = computed(() => jobs.value.filter(j => j.status === 'active'));
  const jobsByDepartment = computed(() => {
    const map = {};
    for (const job of activeJobs.value) {
      const dept = job.department || '未分配';
      if (!map[dept]) map[dept] = [];
      map[dept].push(job);
    }
    return map;
  });

  // ===== 操作 =====

  /**
   * 拉取所有活跃岗位
   */
  async function fetchActive() {
    const db = cloudbase.db();
    if (!db) {
      error.value = '数据库未初始化';
      return [];
    }

    loading.value = true;
    error.value = '';

    try {
      const result = await db.collection('Job')
        .where({ status: 'active' })
        .orderBy('createdAt', 'desc')
        .get();

      // 合并到本地缓存（去重）
      const fetched = result.data || [];
      const existingIds = new Set(jobs.value.map(j => j._id));
      for (const job of fetched) {
        if (!existingIds.has(job._id)) {
          jobs.value.push(job);
        }
      }

      return fetched;
    } catch (err) {
      console.error('[useJobStore] 拉取岗位失败:', err.message);
      error.value = err.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 根据 ID 获取岗位
   */
  function getById(id) {
    return jobs.value.find(j => j._id === id) || null;
  }

  /**
   * 新增岗位
   */
  async function add(jobData) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const doc = {
      ...jobData,
      status: jobData.status || 'active',
      _version: initialVersion(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('Job').add(doc);
    const newJob = { ...doc, _id: result.id };
    jobs.value.unshift(newJob);

    return newJob;
  }

  /**
   * 更新岗位
   */
  async function update(id, data) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 获取当前版本号
    const current = jobs.value.find(j => j._id === id);
    if (!current) throw new Error('岗位不存在');
    const expectedVersion = typeof current._version === 'number' ? current._version : 0;

    // 带版本锁更新
    const newVersion = await versionedUpdate('Job', id, expectedVersion, data);

    // 更新本地缓存
    const idx = jobs.value.findIndex(j => j._id === id);
    if (idx !== -1) {
      jobs.value[idx] = { ...jobs.value[idx], ...data, _version: newVersion, updatedAt: new Date() };
    }
  }

  /**
   * 软删除岗位（设为 inactive）
   */
  async function remove(id) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 获取当前版本号
    const current = jobs.value.find(j => j._id === id);
    if (!current) throw new Error('岗位不存在');
    const expectedVersion = typeof current._version === 'number' ? current._version : 0;

    const updateData = { status: 'inactive' };

    // 带版本锁更新
    const newVersion = await versionedUpdate('Job', id, expectedVersion, updateData);

    // 更新本地缓存
    const idx = jobs.value.findIndex(j => j._id === id);
    if (idx !== -1) {
      jobs.value[idx] = { ...jobs.value[idx], status: 'inactive', _version: newVersion, updatedAt: new Date() };
    }
  }

  /**
   * 检查是否有可用岗位
   */
  function hasActiveJobs() {
    return activeJobs.value.length > 0;
  }

  return {
    // state
    jobs,
    loading,
    error,
    // computed
    activeJobs,
    jobsByDepartment,
    // actions
    fetchActive,
    getById,
    add,
    update,
    remove,
    hasActiveJobs,
    // 乐观锁工具
    isVersionConflict,
    conflictMessage,
  };
});
