/* 新励成招聘管理系统 V2.0 — 候选人 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { attachHashes } from '../services/hash';
import { versionedUpdate, initialVersion, isVersionConflict, conflictMessage } from '../services/optimistic-lock';
import { syncToParsedData } from '../services/candidate-sync';
import { useAuthStore } from './useAuthStore';

export const useCandidateStore = defineStore('candidate', () => {
  // ===== 状态 =====
  const candidates = ref([]);
  const currentCandidate = ref(null);
  const loading = ref(false);
  const error = ref('');

  // ===== 计算属性 =====
  const candidateCount = computed(() => candidates.value.length);

  // ===== 操作 =====

  /**
   * 根据 ID 获取候选人详情
   */
  async function fetchById(id) {
    const db = cloudbase.db();
    if (!db) {
      error.value = '数据库未初始化';
      return null;
    }

    loading.value = true;
    error.value = '';

    try {
      const result = await db.collection('Candidate').doc(id).get();
      const data = result.data?.[0] || null;

      if (data) {
        currentCandidate.value = data;
        // 更新缓存
        const idx = candidates.value.findIndex(c => c._id === id);
        if (idx !== -1) {
          candidates.value[idx] = data;
        } else {
          candidates.value.push(data);
        }
      }

      return data;
    } catch (err) {
      console.error('[useCandidateStore] 获取候选人详情失败:', err.message);
      error.value = err.message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建候选人
   * @param {Object} candidateData - Candidate 文档数据
   * @returns {Promise<{ id: string, doc: Object }>}
   */
  async function add(candidateData) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const auth = useAuthStore();

    // P1-3：附加 phoneHash / emailHash 用于去重
    const dataWithHashes = await attachHashes({
      ...candidateData,
      // Phase 1 数据隔离：自动注入 ownerId（优先使用传入值）
      ownerId: candidateData.ownerId || auth.currentUsername || 'system',
      createdBy: candidateData.createdBy || auth.currentUsername || 'system',
    });

    const result = await db.collection('Candidate').add({ ...dataWithHashes, _version: initialVersion() });
    const doc = { ...dataWithHashes, _id: result.id };
    candidates.value.unshift(doc);
    currentCandidate.value = doc;

    return { id: result.id, doc };
  }

  /**
   * 更新候选人
   */
  async function update(id, data) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 获取当前版本号
    const current = candidates.value.find(c => c._id === id) || currentCandidate.value;
    if (!current && id) {
      // 本地缓存没有，从数据库读取
      const fetched = await fetchById(id);
      if (!fetched) throw new Error('候选人不存在');
    }

    const doc = candidates.value.find(c => c._id === id) || currentCandidate.value;
    const expectedVersion = typeof doc?._version === 'number' ? doc._version : 0;

    // P1-9：将顶层字段变更同步回 parsedData，防止双源数据不一致
    const syncedData = syncToParsedData(doc, data);

    // 带版本锁更新
    const newVersion = await versionedUpdate('Candidate', id, expectedVersion, syncedData);

    // 更新本地缓存
    const idx = candidates.value.findIndex(c => c._id === id);
    if (idx !== -1) {
      candidates.value[idx] = { ...candidates.value[idx], ...syncedData, _version: newVersion, updatedAt: new Date() };
    }
    if (currentCandidate.value?._id === id) {
      currentCandidate.value = { ...currentCandidate.value, ...syncedData, _version: newVersion, updatedAt: new Date() };
    }
  }

  /**
   * 事务性创建候选人（含 Application + AuditLog + ParseCorrectionBank）
   *
   * 将 ResumeImportPage 中散落的 5 步操作收敛为一个 Store 方法：
   *   1. 创建 Candidate
   *   2. 创建 Application
   *   3. 记录 ParseCorrectionBank
   *   4. 写入 AuditLog
   *
   * @param {Object} params
   * @param {Object} params.candidate - Candidate 文档数据
   * @param {Object} params.application - Application 文档数据（含 jobId）
   * @param {Array}  params.corrections - 修正记录列表
   * @param {Object} params.audit - 审计日志数据
   * @returns {Promise<{ candidateId: string }>}
   */
  async function createWithApplication({ candidate, application, corrections, audit }) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // P1-3：附加 phoneHash / emailHash 用于去重
    const candidateWithHashes = await attachHashes(candidate);

    // 1. 创建 Candidate（Phase 1：注入 ownerId）
    const auth = useAuthStore();
    const candidateResult = await db.collection('Candidate').add({
      ...candidateWithHashes,
      ownerId: candidate.ownerId || auth.currentUsername || 'system',
      createdBy: candidate.createdBy || auth.currentUsername || 'system',
      _version: initialVersion(),
    });
    const candidateId = candidateResult.id;

    // 2. 创建 Application（Phase 1：注入 ownerId）
    const applicationDoc = {
      ...application,
      candidateId,
      ownerId: application.ownerId || auth.currentUsername || 'system',
      stage: application.stage || 'resume',
      stageEnteredAt: new Date(),
      status: application.status || 'active',
      funnel: {
        resumeAt: new Date(),
        ...(application.funnel || {}),
      },
      funnelMeta: {
        entrySource: 'manual',
        ...(application.funnelMeta || {}),
      },
      _version: initialVersion(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('Application').add(applicationDoc);

    // 3. 记录 ParseCorrectionBank（如有修正）
    if (corrections && corrections.length > 0) {
      try {
        await recordCorrections(db, candidateId, corrections);
      } catch (err) {
        console.warn('[useCandidateStore] 修正案例库更新失败:', err.message);
        // 不阻塞主流程
      }
    }

    // 4. 写入 AuditLog
    if (audit) {
      try {
        await cloudbase.callFunction('write-audit-log', audit);
      } catch (err) {
        console.warn('[useCandidateStore] AuditLog 写入失败:', err.message);
        // 不阻塞主流程
      }
    }

    // 更新本地缓存
    const candidateDoc = { ...candidateWithHashes, _id: candidateId };
    candidates.value.unshift(candidateDoc);
    currentCandidate.value = candidateDoc;

    return { candidateId };
  }

  /**
   * 软删除候选人
   * Admin（skipApproval=true）：直接标记 status:'deleted'
   * Recruiter（skipApproval=false/未传）：提交 PendingChanges 审批
   */
  async function softDelete(id, { skipApproval = false } = {}) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 先从本地缓存查找，找不到再从数据库查
    let current = candidates.value.find(c => c._id === id)
      || (currentCandidate.value?._id === id ? currentCandidate.value : null);

    if (!current) {
      try {
        const { data } = await db.collection('Candidate').doc(id).get();
        current = data?.[0] || null;
      } catch { /* DB 查询失败也继续 */ }
    }

    const auth = useAuthStore();
    const isAdmin = skipApproval || auth.isAdmin;

    // Recruiter：走审批流程
    if (!isAdmin) {
      if (!current) throw new Error('候选人不存在');
      const { usePendingChangeStore } = await import('./usePendingChangeStore');
      const pendingStore = usePendingChangeStore();
      const result = await pendingStore.submitChange({
        type: 'candidate',
        action: 'delete',
        entityType: 'candidate',
        entityId: id,
        entityLabel: current.name || id,
        before: { status: current.status || 'active' },
        after: {
          status: 'deleted',
          deletedBy: auth.currentUsername || 'system',
          deletedAt: new Date(),
          previousStatus: current.status || 'active',
        },
      });
      return { pending: true, changeId: result.id };
    }

    // Admin：直接软删除（找不到本地缓存也直接删 DB，不需要 name/status）
    const updateData = {
      status: 'deleted',
      deletedBy: auth.currentUsername || 'admin',
      deletedAt: new Date(),
      previousStatus: current?.status || 'active',
      updatedAt: new Date(),
    };

    await db.collection('Candidate').doc(id).update(updateData);

    // 同时将关联的 Application 标记为 withdrawn，否则列表刷新后候选人会重新出现
    try {
      const { data: apps } = await db.collection('Application')
        .where({ candidateId: id, status: 'active' })
        .limit(100)
        .get();
      if (apps && apps.length > 0) {
        const batchUpdate = apps.map(app =>
          db.collection('Application').doc(app._id).update({
            status: 'withdrawn',
            updatedAt: new Date(),
          })
        );
        await Promise.allSettled(batchUpdate);
      }
    } catch (e) {
      console.warn('[useCandidateStore] 关联Application更新失败:', e.message);
    }

    // 更新本地缓存
    const idx = candidates.value.findIndex(c => c._id === id);
    if (idx !== -1) {
      candidates.value[idx] = { ...candidates.value[idx], ...updateData };
    }
    if (currentCandidate.value?._id === id) {
      currentCandidate.value = { ...currentCandidate.value, ...updateData };
    }
  }

  /**
   * 查询已删除候选人（回收站）
   */
  async function fetchDeleted() {
    const db = cloudbase.db();
    if (!db) return [];
    loading.value = true;
    error.value = '';
    try {
      const conditions = { status: 'deleted' };
      const of = ownerFilter();
      if (of) conditions.ownerId = of.ownerId;

      const { data } = await db.collection('Candidate')
        .where(conditions)
        .orderBy('deletedAt', 'desc')
        .limit(200)
        .get();
      candidates.value = data || [];
      return data || [];
    } catch (err) {
      error.value = err.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 恢复已删除候选人
   * - Candidate status → previousStatus（删除前的状态）
   * - 关联 Application status: 'withdrawn' → 'active'
   */
  async function restore(id) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 先从数据库获取完整 Candidate 记录
    let candidate;
    try {
      const { data } = await db.collection('Candidate').doc(id).get();
      candidate = data?.[0] || null;
    } catch { /* fallback */ }
    if (!candidate) throw new Error('候选人不存在');

    const previousStatus = candidate.previousStatus || 'active';

    // 恢复 Candidate
    const updateData = {
      status: previousStatus,
      deletedBy: db.command.remove(),
      deletedAt: db.command.remove(),
      previousStatus: db.command.remove(),
      updatedAt: new Date(),
    };
    await db.collection('Candidate').doc(id).update(updateData);

    // 恢复关联 Application
    try {
      const { data: apps } = await db.collection('Application')
        .where({ candidateId: id, status: 'withdrawn' })
        .limit(100)
        .get();
      if (apps && apps.length > 0) {
        await Promise.allSettled(
          apps.map(app =>
            db.collection('Application').doc(app._id).update({
              status: 'active',
              updatedAt: new Date(),
            })
          )
        );
      }
    } catch (e) {
      console.warn('[useCandidateStore] 恢复关联Application失败:', e.message);
    }

    // 从本地缓存移除
    candidates.value = candidates.value.filter(c => c._id !== id);
  }

  /**
   * 永久删除候选人（硬删除）
   * - 删除 Candidate 文档
   * - 删除关联 Application 文档
   */
  async function permanentDelete(id) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    // 删除 Candidate
    await db.collection('Candidate').doc(id).remove();

    // 删除关联 Application
    try {
      const { data: apps } = await db.collection('Application')
        .where({ candidateId: id })
        .limit(100)
        .get();
      if (apps && apps.length > 0) {
        await Promise.allSettled(
          apps.map(app => db.collection('Application').doc(app._id).remove())
        );
      }
    } catch (e) {
      console.warn('[useCandidateStore] 永久删除关联Application失败:', e.message);
    }

    // 从本地缓存移除
    candidates.value = candidates.value.filter(c => c._id !== id);
    if (currentCandidate.value?._id === id) {
      currentCandidate.value = null;
    }
  }

  return {
    // state
    candidates,
    currentCandidate,
    loading,
    error,
    // computed
    candidateCount,
    // actions
    fetchById,
    add,
    update,
    createWithApplication,
    softDelete,
    fetchDeleted,
    restore,
    permanentDelete,
    // 乐观锁工具
    isVersionConflict,
    conflictMessage,
  };
});

/**
 * 记录修正到 ParseCorrectionBank
 */
async function recordCorrections(db, candidateId, correctionList) {
  const bank = db.collection('ParseCorrectionBank');

  for (const { fieldPath, originalValue, correctedValue } of correctionList) {
    if (!originalValue || !correctedValue) continue;

    const field = fieldPath.split('.').pop();

    // 查找已有记录
    const existing = await bank
      .where({ field, originalValue, correctedValue })
      .get();

    if (existing.data && existing.data.length > 0) {
      await bank.doc(existing.data[0]._id).update({
        correctionCount: db.command.inc(1),
        updatedAt: new Date(),
      });
    } else {
      await bank.add({
        field,
        originalValue,
        correctedValue,
        correctionCount: 1,
        updatedAt: new Date(),
      });
    }
  }
}
