/* 新励成招聘管理系统 V2.0 — 岗位 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { captureError } from '../services/error-capture';
import { handleError } from '../services/error-handler';
import { versionedUpdate, initialVersion, isVersionConflict, conflictMessage } from '../services/optimistic-lock';
import { normalizeJobData, validateJobData } from '../config/constants';
import { useAuthStore } from './useAuthStore';
import { usePendingChangeStore } from './usePendingChangeStore';
import { ownerFilter } from '../services/data-filter';

export const useJobStore = defineStore('job', () => {
  // ===== 状态 =====
  const jobs = ref([]);
  const loading = ref(false);
  const error = ref('');

  // ===== 计算属性 =====
  // 🔒 数据隔离：activeJobs 必须同时过滤 status 和 ownerId
  const activeJobs = computed(() => {
    const auth = useAuthStore();
    return jobs.value.filter(j => {
      if (j.status !== 'active') return false;
      if (auth.isAdmin) return true;
      return j.ownerId === auth.currentUsername;
    });
  });
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
      // 数据隔离：专员只看自己的岗位，管理员看全部
      const conditions = { status: 'active' };
      const of = ownerFilter();
      if (of) conditions.ownerId = of.ownerId;

      const result = await db.collection('Job')
        .where(conditions)
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
      handleError(err, { context: '拉取岗位列表' });
      error.value = err.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 根据 ID 获取岗位（🔒 含归属校验：非管理员只能获取自己的岗位）
   */
  function getById(id) {
    const job = jobs.value.find(j => j._id === id) || null;
    if (!job) return null;
    const auth = useAuthStore();
    if (!auth.isAdmin && job.ownerId !== auth.currentUsername) return null;
    return job;
  }

  /**
   * 新增岗位
   *
   * Admin：直接写入 Job 集合
   * Recruiter：提交到 PendingChanges，等待管理员审批
   */
  async function add(jobData) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // P1-7：校验必填字段
    const validation = validateJobData(jobData);
    if (!validation.valid) {
      throw new Error(`岗位缺少必填字段：${validation.missing.join('、')}`);
    }

    // P1-7：填充默认值（headcount, salaryRange, workCity, requirements, expiryDate）
    const normalized = normalizeJobData(jobData);

    const auth = useAuthStore();

    // Recruiter：走审批流程
    if (!auth.isAdmin) {
      const pendingStore = usePendingChangeStore();
      const result = await pendingStore.submitChange({
        type: 'job',
        action: 'create',
        entityType: 'job',
        entityId: '',
        entityLabel: jobData.title || jobData.name || '新岗位',
        after: {
          ...normalized,
          status: 'active',
          ownerId: jobData.ownerId || auth.currentUsername || 'system',
          createdBy: jobData.createdBy || auth.currentUsername || 'system',
        },
      });
      return { id: result.id, doc: result.doc, pending: true };
    }

    // Admin：直接写入
    const doc = {
      ...normalized,
      status: jobData.status || 'active',
      ownerId: jobData.ownerId || auth.currentUsername || 'system',
      createdBy: jobData.createdBy || auth.currentUsername || 'system',
      _version: initialVersion(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('Job').add(doc);
    const newJob = { ...doc, _id: result.id };
    jobs.value.unshift(newJob);

    // P2-2：审计日志
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'job_created',
        entityType: 'Job',
        entityIds: [result.id],
        detail: { title: jobData.title || jobData.name, type: jobData.type, department: jobData.department },
        operator: jobData.createdBy || 'system',
      });
    } catch (e) { console.warn('[useJobStore] 审计日志写入失败:', e.message); captureError('job_store', '审计日志写入失败', { message: e.message, context: 'add' }); }

    return newJob;
  }

  /**
   * 更新岗位
   *
   * Admin：直接更新 Job 集合
   * Recruiter：提交到 PendingChanges，等待管理员审批
   */
  async function update(id, data) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 获取当前状态
    const current = jobs.value.find(j => j._id === id);
    if (!current) throw new Error('岗位不存在');

    const auth = useAuthStore();

    // 🔒 数据隔离：非管理员只能更新自己的岗位
    if (!auth.isAdmin && current.ownerId !== auth.currentUsername) {
      throw new Error('无权修改此岗位');
    }

    // Recruiter：走审批流程
    if (!auth.isAdmin) {
      const pendingStore = usePendingChangeStore();
      const result = await pendingStore.submitChange({
        type: 'job',
        action: 'update',
        entityType: 'job',
        entityId: id,
        entityLabel: current.title || current.name || id,
        before: {
          title: current.title || current.name,
          type: current.type,
          department: current.department,
          headcount: current.headcount,
          salaryRange: current.salaryRange,
          workCity: current.workCity,
          requirements: current.requirements,
          status: current.status,
        },
        after: { ...data },
      });
      return { id: result.id, doc: result.doc, pending: true };
    }

    // Admin：直接更新
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
   *
   * Admin：直接软删除
   * Recruiter：提交到 PendingChanges，等待管理员审批
   */
  async function remove(id) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 获取当前状态
    const current = jobs.value.find(j => j._id === id);
    if (!current) throw new Error('岗位不存在');

    const auth = useAuthStore();

    // 🔒 数据隔离：非管理员只能更新自己的岗位
    if (!auth.isAdmin && current.ownerId !== auth.currentUsername) {
      throw new Error('无权修改此岗位');
    }

    // Recruiter：走审批流程
    if (!auth.isAdmin) {
      const pendingStore = usePendingChangeStore();
      const result = await pendingStore.submitChange({
        type: 'job',
        action: 'delete',
        entityType: 'job',
        entityId: id,
        entityLabel: current.title || current.name || id,
        before: {
          title: current.title || current.name,
          type: current.type,
          department: current.department,
          status: current.status,
        },
        after: { status: 'inactive', previousStatus: current.status || 'active', deletedAt: new Date() },
      });
      return { id: result.id, doc: result.doc, pending: true };
    }

    // Admin：直接软删除（P0-3 修复：统一使用 'inactive'，记录 previousStatus 和 deletedAt）
    const expectedVersion = typeof current._version === 'number' ? current._version : 0;

    const updateData = {
      status: 'inactive',
      previousStatus: current.status || 'active',
      deletedAt: new Date(),
      updatedAt: new Date(),
    };

    // 带版本锁更新
    const newVersion = await versionedUpdate('Job', id, expectedVersion, updateData);

    // P2-2：审计日志
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'job_deleted',
        entityType: 'Job',
        entityIds: [id],
        detail: { title: current.title || current.name, type: current.type },
        operator: 'system',
      });
    } catch (e) { console.warn('[useJobStore] 审计日志写入失败:', e.message); captureError('job_store', '审计日志写入失败', { message: e.message, context: 'remove' }); }

    // 更新本地缓存
    const idx = jobs.value.findIndex(j => j._id === id);
    if (idx !== -1) {
      jobs.value[idx] = { ...jobs.value[idx], ...updateData, _version: newVersion };
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
