/* 新励成招聘管理系统 V2.0 — 候选人 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { attachHashes } from '../services/hash';
import { versionedUpdate, initialVersion, isVersionConflict, conflictMessage } from '../services/optimistic-lock';
import { syncToParsedData } from '../services/candidate-sync';

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
