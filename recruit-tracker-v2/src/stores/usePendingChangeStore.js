/* 新励成招聘管理系统 V2.0 — 变更审批 Store
 *
 * 轻量两层写入：专员提交 → PendingChanges 集合 → 管理员审批 → 自动写入目标集合。
 * 审批范围：仅 Job 和 Config 相关的增删改（不审批候选人操作）。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { useAuthStore } from './useAuthStore';

export const usePendingChangeStore = defineStore('pendingChange', () => {
  // ===== 状态 =====
  const pendingChanges = ref([]);
  const loading = ref(false);
  const error = ref('');

  // ===== 计算属性 =====
  const pendingCount = computed(() =>
    pendingChanges.value.filter(c => c.status === 'pending').length
  );

  const changesByStatus = computed(() => {
    const map = { pending: [], approved: [], rejected: [] };
    for (const c of pendingChanges.value) {
      if (map[c.status]) map[c.status].push(c);
    }
    return map;
  });

  // ===== 专员操作：提交变更 =====

  /**
   * @param {Object} params
   * @param {'job'|'config'} params.type
   * @param {'create'|'update'|'delete'} params.action
   * @param {string} params.entityType - 'job' | 'department' | 'city' | 'jobType' | 'alertThreshold'
   * @param {string} [params.entityId] - 被修改的实体 ID（create 时为空）
   * @param {Object} [params.before] - 变更前快照（update/delete 时）
   * @param {Object} [params.after] - 变更后数据（create/update 时）
   * @param {string} [params.entityLabel] - 实体可读标签（如岗位标题）
   */
  async function submitChange(params) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const auth = useAuthStore();
    const doc = {
      type: params.type,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || '',
      entityLabel: params.entityLabel || '',
      before: params.before || null,
      after: params.after || null,
      status: 'pending',
      submittedBy: auth.currentUsername || '',
      submittedByName: auth.userName || '',
      submittedAt: new Date(),
      reviewedBy: '',
      reviewedAt: null,
      reviewComment: '',
    };

    const result = await db.collection('PendingChanges').add(doc);
    const newChange = { ...doc, _id: result.id };
    pendingChanges.value.unshift(newChange);

    // 异步写审计日志
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'change_submitted',
        entityType: 'PendingChanges',
        entityIds: [result.id],
        detail: {
          type: params.type,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
        },
        operator: auth.currentUsername || 'system',
      });
    } catch (e) { console.warn('[usePendingChangeStore] 审计日志写入失败:', e.message); }

    return { id: result.id, doc: newChange };
  }

  // ===== 管理员操作：拉取列表 =====

  async function fetchAll(status = null) {
    const db = cloudbase.db();
    if (!db) return [];

    loading.value = true;
    error.value = '';

    try {
      let query = db.collection('PendingChanges').orderBy('submittedAt', 'desc');
      if (status) query = query.where({ status });

      // 游标分页拉全量
      const all = [];
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        let page = query.limit(100);
        if (cursor) page = page.where({ _id: db.command.gt(cursor) });
        const { data } = await page.get();
        if (data && data.length > 0) {
          all.push(...data);
          cursor = data[data.length - 1]._id;
          if (data.length < 100) hasMore = false;
        } else {
          hasMore = false;
        }
      }

      pendingChanges.value = all;
      return all;
    } catch (err) {
      console.error('[usePendingChangeStore] 获取审批列表失败:', err.message);
      error.value = err.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  // ===== 管理员操作：审批 =====

  /**
   * P1-3 修复：先执行变更，再更新审批状态——
   *   旧顺序：标记 approved → 执行变更（执行失败会导致"已通过但未生效"）
   *   新顺序：执行变更 → 标记 approved（执行失败则保持 pending，可重试）
   *
   * @param {string} id - PendingChanges 文档 ID
   * @param {'approved'|'rejected'} decision
   * @param {string} comment - 审批意见
   */
  async function review(id, decision, comment = '') {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const auth = useAuthStore();
    if (!auth.isAdmin) throw new Error('仅管理员可审批变更');

    const change = pendingChanges.value.find(c => c._id === id);
    if (!change) throw new Error('变更记录不存在');
    if (change.status !== 'pending') throw new Error('该变更已处理');

    const now = new Date();

    // P1-3：如果通过 → 先执行实际变更，成功后再更新审批状态
    if (decision === 'approved') {
      await executeChange(change);
    }

    // 更新 PendingChanges 状态（仅当 executeChange 成功后才会执行到这里）
    await db.collection('PendingChanges').doc(id).update({
      status: decision,
      reviewedBy: auth.currentUsername || '',
      reviewedByName: auth.userName || '',
      reviewedAt: now,
      reviewComment: comment,
    });

    // 更新本地缓存
    const idx = pendingChanges.value.findIndex(c => c._id === id);
    if (idx !== -1) {
      pendingChanges.value[idx] = {
        ...pendingChanges.value[idx],
        status: decision,
        reviewedBy: auth.currentUsername || '',
        reviewedByName: auth.userName || '',
        reviewedAt: now,
        reviewComment: comment,
      };
    }

    // 异步审计日志
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: decision === 'approved' ? 'change_approved' : 'change_rejected',
        entityType: 'PendingChanges',
        entityIds: [id],
        detail: {
          type: change.type,
          action: change.action,
          entityType: change.entityType,
          entityId: change.entityId,
          comment,
        },
        operator: auth.currentUsername || 'system',
      });
    } catch (e) { console.warn('[usePendingChangeStore] 审计日志写入失败:', e.message); }

    return { success: true };
  }

  // ===== 执行审批通过的变更 =====

  async function executeChange(change) {
    const db = cloudbase.db();

    try {
      switch (change.type) {
        case 'job': {
          if (change.action === 'create' && change.after) {
            const doc = { ...change.after, updatedAt: new Date() };
            if (change.entityId) {
              await db.collection('Job').doc(change.entityId).update(doc);
            } else {
              await db.collection('Job').add(doc);
            }
          } else if (change.action === 'update' && change.entityId && change.after) {
            await db.collection('Job').doc(change.entityId).update({
              ...change.after,
              updatedAt: new Date(),
            });
          } else if (change.action === 'delete' && change.entityId) {
            // 软删除（P0-3 修复：统一使用 'inactive'，与 useJobStore.remove() 一致）
            await db.collection('Job').doc(change.entityId).update({
              status: 'inactive',
              previousStatus: change.before?.status || 'active',
              deletedAt: new Date(),
            });
          }
          break;
        }

        case 'config': {
          // Config 变更：直接更新 Config 集合
          if (change.after && change.entityType) {
            const configDoc = await db.collection('Config').doc('system').get().catch(() => ({ data: [] }));
            const current = (Array.isArray(configDoc?.data) ? configDoc.data[0] : configDoc?.data) || {};
            const updated = { ...current, ...change.after, updatedAt: new Date() };

            if (configDoc?.data && configDoc.data.length > 0) {
              await db.collection('Config').doc('system').update(updated);
            } else {
              await db.collection('Config').add({ _id: 'system', ...updated, createdAt: new Date() });
            }
          }
          break;
        }

        case 'candidate': {
          if (change.action === 'delete' && change.entityId) {
            await db.collection('Candidate').doc(change.entityId).update({
              status: 'deleted', deletedBy: change.after?.deletedBy || 'system',
              deletedAt: new Date(), previousStatus: change.before?.status || 'active', updatedAt: new Date(),
            });
          }
          break;
        }

        case 'recruitmentDemand': {
          if (change.action === 'create' && change.after) {
            const doc = { ...change.after, status: 'recruiting', updatedAt: new Date() };
            if (change.entityId) {
              await db.collection('RecruitmentDemand').doc(change.entityId).update(doc);
            } else {
              const result = await db.collection('RecruitmentDemand').add(doc);
              change.entityId = result.id;
            }
            // Auto-create linked Job
            try {
              const jobStore = (await import('./useJobStore')).useJobStore();
              const jobResult = await jobStore().add({
                title: doc.title, department: doc.department?.displayName || '',
                headcount: doc.headcount || 1, requirements: doc.jobRequirements || '',
                ownerId: doc.ownerId, createdBy: doc.ownerId, status: 'active',
              });
              await db.collection('RecruitmentDemand').doc(change.entityId || result?.id).update({ linkedJobId: jobResult._id || jobResult.id });
            } catch (e) { console.warn('[executeChange] 自动创建Job失败:', e.message); }
          } else if (change.action === 'update' && change.entityId && change.after) {
            await db.collection('RecruitmentDemand').doc(change.entityId).update({ ...change.after, updatedAt: new Date() });
          } else if (change.action === 'delete' && change.entityId) {
            await db.collection('RecruitmentDemand').doc(change.entityId).update({
              status: 'deleted', deletedAt: new Date(),
              deletedBy: change.after?.deletedBy || 'system', updatedAt: new Date(),
            });
          }
          break;
        }

        default:
          console.warn(`[usePendingChangeStore] 未知变更类型: ${change.type}`);
      }
    } catch (err) {
      console.error(`[usePendingChangeStore] 执行变更失败:`, err);
      throw err;
    }
  }

  // ===== 专员操作：查看自己的提交 =====
  async function fetchMySubmissions() {
    const db = cloudbase.db();
    if (!db) return [];

    const auth = useAuthStore();
    const username = auth.currentUsername || '';

    try {
      const { data } = await db.collection('PendingChanges')
        .where({ submittedBy: username })
        .orderBy('submittedAt', 'desc')
        .limit(50)
        .get();
      return data || [];
    } catch (err) {
      console.error('[usePendingChangeStore] 获取我的提交失败:', err.message);
      return [];
    }
  }

  return {
    // state
    pendingChanges,
    loading,
    error,
    // computed
    pendingCount,
    changesByStatus,
    // actions
    submitChange,
    fetchAll,
    review,
    fetchMySubmissions,
  };
});
