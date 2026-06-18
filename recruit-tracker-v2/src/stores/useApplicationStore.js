/* 新励成招聘管理系统 V2.0 — 申请记录 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { versionedUpdate, initialVersion, isVersionConflict, conflictMessage } from '../services/optimistic-lock';
import { canTransition, buildTransitionPayload, stageToFunnelKey } from '../services/pipeline-engine';

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
      _version: initialVersion(),
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

    const { note = '', operatorId = '', jobType = null } = options;

    // 获取当前状态（确保有最新版本号）
    const current = await fetchById(id);
    if (!current) throw new Error('申请记录不存在');

    const oldStage = current.stage;
    const currentStatus = current.status || 'active';
    const expectedVersion = typeof current._version === 'number' ? current._version : 0;

    // === 流转引擎校验 ===
    const validation = canTransition(oldStage, newStage, {
      jobType: jobType || current.jobType,
      currentStatus,
    });

    if (!validation.valid) {
      throw new Error(validation.reason || '流转校验未通过');
    }

    // === 构建流转载荷 ===
    const payload = buildTransitionPayload(oldStage, newStage, {
      note,
      operatorId,
      jobType: jobType || current.jobType,
      isReactivation: validation.isReactivation || false,
    });

    // 合并 funnel：保留已有漏斗时间戳 + 叠加回填 + 新阶段
    // 【关键】必须用单个 db.command.set() 设整个 funnel 对象，生成一条 $set
    // 而非多条 funnel.* 点分隔 $set——CloudBase 服务端对多条同父路径的点分隔
    // $set 有 bug，只保留最后一个，导致跳阶段回填字段丢失。
    let mergedFunnel = null;
    if (payload.funnel) {
      mergedFunnel = {
        ...(current.funnel || {}),
        ...payload.funnel,
      };
      // 单个 set 命令：整个 funnel 对象作为一个 $set 操作
      payload.funnel = db.command.set(mergedFunnel);
    }

    // 将 history 数组项转为 db.command.push
    if (payload.history) {
      payload.history = db.command.push(payload.history);
    }

    // 带版本锁更新
    const newVersion = await versionedUpdate('Application', id, expectedVersion, payload);

    // 写入审计日志（异步，不阻塞主流程）
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: validation.isReactivation ? 'reactivate_candidate' : 'move_stage',
        entityType: 'Application',
        entityIds: [id],
        detail: {
          fromStage: oldStage,
          toStage: newStage,
          note,
          isReactivation: validation.isReactivation || false,
        },
        operator: operatorId || 'system',
      });
    } catch (err) {
      console.warn('[useApplicationStore] 审计日志写入失败:', err.message);
    }

    // 更新本地缓存（注意：payload 中的 funnel/history 已是 command 对象，需用纯数据覆盖）
    const idx = applications.value.findIndex(a => a._id === id);
    if (idx !== -1) {
      const oldHistory = applications.value[idx].history || [];
      applications.value[idx] = {
        ...applications.value[idx],
        stage: newStage,
        stageEnteredAt: new Date(),
        // 使用合并后的纯 funnel 数据而非 command 对象
        ...(mergedFunnel ? { funnel: mergedFunnel } : {}),
        _version: newVersion,
        updatedAt: new Date(),
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

    const expectedVersion = typeof current._version === 'number' ? current._version : 0;

    const updateData = {
      status, // 'rejected' | 'withdrawn'
      endStage: current.stage,
      endReason: reason,
      endedAt: new Date(),
    };

    // 带版本锁更新
    const newVersion = await versionedUpdate('Application', id, expectedVersion, updateData);

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
      applications.value[idx] = { ...applications.value[idx], ...updateData, _version: newVersion, updatedAt: new Date() };
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
    // 乐观锁工具
    isVersionConflict,
    conflictMessage,
  };
});
