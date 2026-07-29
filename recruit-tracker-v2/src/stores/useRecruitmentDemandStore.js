/* 新励成招聘管理系统 V2.0 — 招聘需求 Store */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import cloudbase from '../services/cloudbase';
import { initialVersion } from '../services/optimistic-lock';
import { useAuthStore } from './useAuthStore';
import { ownerFilter } from '../services/data-filter';
import { captureError } from '../services/error-capture';
import { createJobFromDemand } from '../services/demand-job-bridge';

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
      const doc = data?.[0] || null;
      // 权限检查：专员只能看自己的需求
      if (doc) {
        const of = ownerFilter();
        if (of && doc.ownerId !== of.ownerId) {
          // 无权访问，返回 null 并设置错误
          error.value = '无权访问此需求';
          return null;
        }
      }
      currentDemand.value = doc;
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

    // Admin direct: 先创建 Job，成功后创建 Demand（避免 Job 失败导致孤儿需求）
    const linkedJobId = await createJobFromDemand({
      title: normalized.title,
      jobType: demandData.jobType,
      department: demandData.department,
      headcount: normalized.headcount,
      jobRequirements: demandData.jobRequirements,
      ownerId: normalized.ownerId,
    });

    // Job 创建成功后创建 Demand，直接带 linkedJobId
    normalized.status = 'recruiting';
    normalized.linkedJobId = linkedJobId;
    const result = await db.collection('RecruitmentDemand').add(normalized);
    demands.value.unshift({ ...normalized, _id: result.id });
    return { id: result.id, doc: normalized };
  }

  async function updateStatus(id, status, { skipApproval = false } = {}) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');
    const auth = useAuthStore();
    const isAdmin = skipApproval || auth.isAdmin;

    // 🆕 专员操作：提交审批，管理员审批通过后由 executeChange 执行状态变更
    if (!isAdmin) {
      const { usePendingChangeStore } = await import('./usePendingChangeStore');
      const demand = demands.value.find(d => d._id === id) || {};
      return usePendingChangeStore().submitChange({
        type: 'recruitmentDemand',
        action: 'update',
        entityType: 'recruitmentDemand',
        entityId: id,
        entityLabel: demand.title || id,
        before: { status: demand.status || '' },
        after: { status },
      });
    }

    // 管理员：直接更新
    await db.collection('RecruitmentDemand').doc(id).update({ status, updatedAt: new Date() });
    const idx = demands.value.findIndex(d => d._id === id);
    if (idx !== -1) demands.value[idx].status = status;
  }

  async function softDelete(id, { skipApproval = false } = {}) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');
    const auth = useAuthStore();
    const isAdmin = skipApproval || auth.isAdmin;
    if (!isAdmin) {
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
