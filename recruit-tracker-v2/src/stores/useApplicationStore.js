/* 新励成招聘管理系统 V2.0 — 申请记录 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';

export const useApplicationStore = defineStore('application', () => {
  // ===== 状态 =====
  const applications = ref([]);
  const currentApplication = ref(null);
  const loading = ref(false);
  const error = ref('');

  // ===== 计算属性 =====
  const activeApplications = computed(() =>
    applications.value.filter(a => a.status === 'active')
  );

  const applicationsByStage = computed(() => {
    const map = {};
    for (const app of activeApplications.value) {
      const stage = app.stage || 'resume';
      if (!map[stage]) map[stage] = [];
      map[stage].push(app);
    }
    return map;
  });

  // ===== 操作 =====

  /**
   * 根据候选人 ID 获取所有申请
   */
  async function fetchByCandidate(candidateId) {
    const db = cloudbase.db();
    if (!db) {
      error.value = '数据库未初始化';
      return [];
    }

    loading.value = true;
    error.value = '';

    try {
      const result = await db.collection('Application')
        .where({ candidateId })
        .orderBy('createdAt', 'desc')
        .get();

      const data = result.data || [];
      // 合并缓存
      const existingIds = new Set(applications.value.map(a => a._id));
      for (const app of data) {
        if (!existingIds.has(app._id)) {
          applications.value.push(app);
        }
      }

      return data;
    } catch (err) {
      console.error('[useApplicationStore] 获取申请列表失败:', err.message);
      error.value = err.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 根据岗位 ID 获取所有申请
   */
  async function fetchByJob(jobId) {
    const db = cloudbase.db();
    if (!db) return [];

    try {
      const result = await db.collection('Application')
        .where({ jobId })
        .get();
      return result.data || [];
    } catch (err) {
      console.error('[useApplicationStore] 获取岗位申请失败:', err.message);
      return [];
    }
  }

  /**
   * 根据 ID 获取单个申请详情
   */
  async function fetchById(id) {
    const db = cloudbase.db();
    if (!db) return null;

    try {
      const result = await db.collection('Application').doc(id).get();
      const data = result.data?.[0] || null;
      if (data) currentApplication.value = data;
      return data;
    } catch (err) {
      console.error('[useApplicationStore] 获取申请详情失败:', err.message);
      return null;
    }
  }

  /**
   * 新增申请记录
   */
  async function add(applicationData) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const doc = {
      ...applicationData,
      stage: applicationData.stage || 'resume',
      stageEnteredAt: new Date(),
      status: applicationData.status || 'active',
      funnel: {
        resumeAt: new Date(),
        ...(applicationData.funnel || {}),
      },
      funnelMeta: {
        entrySource: 'manual',
        ...(applicationData.funnelMeta || {}),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('Application').add(doc);
    const newApp = { ...doc, _id: result.id };
    applications.value.unshift(newApp);
    currentApplication.value = newApp;

    return { id: result.id, doc: newApp };
  }

  /**
   * 管道流转：将候选人移动到新阶段
   *
   * @param {string} id - Application ID
   * @param {string} newStage - 新阶段 key
   * @param {Object} options - { note, operatorId }
   */
  async function moveStage(id, newStage, options = {}) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const { note = '', operatorId = '' } = options;

    // 获取当前状态
    const current = await fetchById(id);
    if (!current) throw new Error('申请记录不存在');

    const oldStage = current.stage;

    // 构建更新数据
    const updateData = {
      stage: newStage,
      stageEnteredAt: new Date(),
      updatedAt: new Date(),
    };

    // 追加流转历史
    updateData.history = db.command.push({
      fromStage: oldStage,
      toStage: newStage,
      at: new Date(),
      note,
      operatorId,
      operator: operatorId,
    });

    // 自动填写漏斗时间戳
    const funnelKey = stageToFunnelKey(newStage);
    if (funnelKey) {
      updateData[`funnel.${funnelKey}`] = new Date();
    }

    await db.collection('Application').doc(id).update(updateData);

    // 写入审计日志（异步，不阻塞主流程）
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'move_stage',
        entityType: 'Application',
        entityIds: [id],
        detail: {
          fromStage: oldStage,
          toStage: newStage,
          note,
          funnelKey,
        },
        operator: operatorId || 'system',
      });
    } catch (err) {
      console.warn('[useApplicationStore] 审计日志写入失败:', err.message);
    }

    // 更新本地缓存
    const idx = applications.value.findIndex(a => a._id === id);
    if (idx !== -1) {
      const oldHistory = applications.value[idx].history || [];
      applications.value[idx] = {
        ...applications.value[idx],
        ...updateData,
        history: [...oldHistory, {
          fromStage: oldStage,
          toStage: newStage,
          at: new Date(),
          note,
          operatorId,
        }],
      };
    }
    if (currentApplication.value?._id === id) {
      currentApplication.value = applications.value[idx] || currentApplication.value;
    }
  }

  /**
   * 结束申请流程（淘汰或放弃）
   */
  async function endApplication(id, status, reason, options = {}) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const current = applications.value.find(a => a._id === id)
      || await fetchById(id);
    if (!current) throw new Error('申请记录不存在');

    const updateData = {
      status, // 'rejected' | 'withdrawn'
      endStage: current.stage,
      endReason: reason,
      endedAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('Application').doc(id).update(updateData);

    // 写入审计日志（异步，不阻塞主流程）
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: status === 'rejected' ? 'reject_candidate' : 'withdraw_candidate',
        entityType: 'Application',
        entityIds: [id],
        detail: {
          endStage: current.stage,
          reason,
        },
        operator: options.operatorId || 'system',
      });
    } catch (err) {
      console.warn('[useApplicationStore] 审计日志写入失败:', err.message);
    }

    // 更新本地缓存
    const idx = applications.value.findIndex(a => a._id === id);
    if (idx !== -1) {
      applications.value[idx] = { ...applications.value[idx], ...updateData };
    }
  }

  return {
    // state
    applications,
    currentApplication,
    loading,
    error,
    // computed
    activeApplications,
    applicationsByStage,
    // actions
    fetchByCandidate,
    fetchByJob,
    fetchById,
    add,
    moveStage,
    endApplication,
  };
});

/**
 * 阶段 key → funnel 时间戳字段映射
 */
function stageToFunnelKey(stage) {
  const map = {
    resume: 'resumeAt',
    valid_resume: 'validAt',
    invite: 'inviteAt',
    invite_confirmed: 'inviteConfirmedAt',
    first_interview: 'interview1At',
    first_pass: 'interview1PassAt',
    second_interview: 'interview2At',
    second_pass: 'interview2PassAt',
    final_interview: 'interview3At',
    final_pass: 'interview3PassAt',
    offer: 'offerAt',
    onboard: 'onboardAt',
  };
  return map[stage] || null;
}
