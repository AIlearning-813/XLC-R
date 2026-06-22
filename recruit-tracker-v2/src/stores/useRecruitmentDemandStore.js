/* 新励成招聘管理系统 V2.0 — 招聘需求 Store */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import cloudbase from '../services/cloudbase';
import { initialVersion } from '../services/optimistic-lock';
import { useAuthStore } from './useAuthStore';
import { ownerFilter } from '../services/data-filter';

export const useRecruitmentDemandStore = defineStore('recruitmentDemand', () => {
  const demands = ref([]);
  const currentDemand = ref(null);
  const loading = ref(false);
  const error = ref('');

  const STATUS_LABELS = {
    pending: '待审批', active: '已生效', recruiting: '招聘中',
    completed: '已完成', closed: '已关闭', deleted: '已删除',
  };

  async function fetchAll(status = null) {
    const db = cloudbase.db();
    if (!db) return [];
    loading.value = true; error.value = '';
    try {
      const conditions = {};
      const of = ownerFilter(); if (of) conditions.ownerId = of.ownerId;
      if (status) conditions.status = status;
      else conditions.status = db.command.neq('deleted');

      const { data } = await db.collection('RecruitmentDemand')
        .where(conditions).orderBy('submittedAt', 'desc').limit(200).get();
      demands.value = data || [];
      return data || [];
    } catch (err) {
      error.value = err.message;
      return [];
    } finally { loading.value = false; }
  }

  async function fetchById(id) {
    const db = cloudbase.db();
    if (!db) return null;
    try {
      const { data } = await db.collection('RecruitmentDemand').doc(id).get();
      currentDemand.value = data?.[0] || null;
      return currentDemand.value;
    } catch (err) { error.value = err.message; return null; }
  }

  async function submit(demandData) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');
    const auth = useAuthStore();

    const normalized = {
      ...demandData,
      ownerId: demandData.ownerId || auth.currentUsername || 'system',
      submittedAt: new Date(),
      status: demandData.status || 'pending',
      linkedJobId: null,
      _version: initialVersion(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (!auth.isAdmin) {
      const { usePendingChangeStore } = await import('./usePendingChangeStore');
      return usePendingChangeStore().submitChange({
        type: 'recruitmentDemand', action: 'create', entityType: 'recruitmentDemand',
        entityLabel: normalized.title, after: normalized,
      });
    }

    // Admin direct: create demand + auto-create Job
    normalized.status = 'recruiting';
    const result = await db.collection('RecruitmentDemand').add(normalized);
    const { useJobStore } = await import('./useJobStore');
    try {
      // 从岗位类型配置读取职责和要求
      const { useConfigStore } = await import('./useConfigStore');
      const configStore = useConfigStore();
      await configStore.loadConfig();
      const jobTypeConfig = configStore.jobTypes[demandData.jobType] || {};

      const jobData = {
        title: normalized.title,
        department: normalized.department?.displayName || '',
        type: demandData.jobType || 'CC',
        headcount: normalized.headcount || 1,
        requirements: jobTypeConfig.requirements || '',
        responsibilities: jobTypeConfig.responsibilities || '',
        ownerId: normalized.ownerId,
        createdBy: normalized.ownerId,
        status: 'active',
      };
      const jobResult = await useJobStore().add(jobData);
      await db.collection('RecruitmentDemand').doc(result.id).update({ linkedJobId: jobResult._id || jobResult.id });
    } catch (e) { console.warn('[demandStore] 自动创建Job失败:', e.message); }
    demands.value.unshift({ ...normalized, _id: result.id });
    return { id: result.id, doc: normalized };
  }

  async function updateStatus(id, status) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');
    await db.collection('RecruitmentDemand').doc(id).update({ status, updatedAt: new Date() });
    const idx = demands.value.findIndex(d => d._id === id);
    if (idx !== -1) demands.value[idx].status = status;
  }

  async function softDelete(id) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');
    const auth = useAuthStore();
    if (!auth.isAdmin) {
      const { usePendingChangeStore } = await import('./usePendingChangeStore');
      return usePendingChangeStore().submitChange({
        type: 'recruitmentDemand', action: 'delete', entityType: 'recruitmentDemand',
        entityId: id, entityLabel: id, before: { status: 'active' },
        after: { status: 'deleted' },
      });
    }
    await db.collection('RecruitmentDemand').doc(id).update({ status: 'deleted', updatedAt: new Date() });
    demands.value = demands.value.filter(d => d._id !== id);
  }

  return { demands, currentDemand, loading, error, STATUS_LABELS, fetchAll, fetchById, submit, updateStatus, softDelete };
});
