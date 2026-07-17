/* 新励成招聘管理系统 V2.0 — 申请记录 Store */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { captureError } from '../services/error-capture';
import { handleError } from '../services/error-handler';
import { useAuthStore } from './useAuthStore';
import { ownerFilter } from '../services/data-filter';
import { versionedUpdate, initialVersion, isVersionConflict, conflictMessage } from '../services/optimistic-lock';
import { canTransition, buildTransitionPayload, stageToFunnelKey } from '../services/pipeline-engine';
import { writeAuditLog } from '../services/audit-log';

export const useApplicationStore = defineStore('application', () => {
  // ===== 状态 =====
  const applications = ref([]);
  const currentApplication = ref(null);
  const loading = ref(false);
  const error = ref('');

  // P3-2：fetchByCandidate 去重缓存（避免同一候选人重复请求）
  const _fetchCache = new Map();
  const FETCH_CACHE_TTL = 30000; // 30 秒

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
    // P3-2：检查缓存（30 秒内重复请求直接返回）
    const cached = _fetchCache.get(candidateId);
    if (cached && Date.now() - cached.time < FETCH_CACHE_TTL) {
      return cached.data;
    }

    const db = cloudbase.db();
    if (!db) {
      error.value = '数据库未初始化';
      return [];
    }

    loading.value = true;
    error.value = '';

    try {
      const filter = ownerFilter();
      const conditions = filter ? { candidateId, ...filter } : { candidateId };
      const result = await db.collection('Application')
        .where(conditions)
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

      // P3-2：存入缓存
      _fetchCache.set(candidateId, { data, time: Date.now() });
      return data;
    } catch (err) {
      handleError(err, { context: '获取申请列表' });
      error.value = err.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 根据岗位 ID 获取所有申请
   * @param {string} jobId - 岗位 ID
   * @returns {Promise<Array>} 该岗位下所有申请记录
   */
  async function fetchByJob(jobId) {
    const db = cloudbase.db();
    if (!db) return [];

    try {
      const filter = ownerFilter();
      const conditions = filter ? { jobId, ...filter } : { jobId };
      const result = await db.collection('Application')
        .where(conditions)
        .get();
      return result.data || [];
    } catch (err) {
      handleError(err, { context: '获取岗位申请' });
      return [];
    }
  }

  /**
   * 根据 ID 获取单个申请详情（🔒 含归属校验）
   */
  async function fetchById(id) {
    const db = cloudbase.db();
    if (!db) return null;

    try {
      // 🔒 数据隔离：附加 ownerId 过滤
      const auth = useAuthStore();
      let data;
      if (!auth.isAdmin) {
        const result = await db.collection('Application')
          .where({ _id: id, ownerId: auth.currentUsername })
          .get();
        data = result.data?.[0] || null;
      } else {
        const result = await db.collection('Application').doc(id).get();
        data = result.data?.[0] || null;
      }
      if (data) currentApplication.value = data;
      return data;
    } catch (err) {
      handleError(err, { context: '获取申请详情' });
      return null;
    }
  }

  /**
   * 根据候选人ID查找关联的Application（供 useCandidateStore 权限校验用）
   * @param {string} candidateId
   * @returns {Promise<Array>}
   */
  async function findByCandidateId(candidateId) {
    const db = cloudbase.db();
    if (!db) return [];
    try {
      const result = await db.collection('Application')
        .where({ candidateId })
        .limit(100)
        .get();
      return result.data || [];
    } catch (err) {
      handleError(err, { context: '查询候选人关联申请' });
      return [];
    }
  }

  /**
   * 批量更新关联申请状态（供 useCandidateStore 软删除/恢复用）
   * @param {string} candidateId
   * @param {string} status - 'withdrawn' | 'active'
   */
  async function batchUpdateStatusByCandidate(candidateId, status) {
    const apps = await findByCandidateId(candidateId);
    if (apps.length === 0) return;
    const db = cloudbase.db();
    await Promise.allSettled(
      apps.map(app =>
        db.collection('Application').doc(app._id).update({
          status,
          updatedAt: new Date(),
        })
      )
    );
  }

  /**
   * 批量删除关联申请（供 useCandidateStore 永久删除用）
   * @param {string} candidateId
   */
  async function batchRemoveByCandidate(candidateId) {
    const apps = await findByCandidateId(candidateId);
    if (apps.length === 0) return;
    const db = cloudbase.db();
    await Promise.allSettled(
      apps.map(app => db.collection('Application').doc(app._id).remove())
    );
  }

  /**
   * 新增申请记录
   * @param {Object} applicationData - 申请数据（含 candidateId、jobId、stage、status 等）
   * @returns {Promise<{ id: string, doc: Object }>} 创建成功的申请 ID 和完整文档
   */
  async function add(applicationData) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const auth = useAuthStore();

    const doc = {
      ...applicationData,
      // Phase 1 数据隔离：自动注入 ownerId
      ownerId: applicationData.ownerId || auth.currentUsername || 'system',
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

    // 🔒 数据隔离：非管理员只能操作自己的申请
    const auth = useAuthStore();
    if (!auth.isAdmin && current.ownerId && current.ownerId !== auth.currentUsername) {
      throw new Error('无权操作此申请');
    }

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
    //
    // 【Date 编码】CloudBase 客户端 SDK 的 UpdateSerializer 只对顶层值调
    // encodeInternalDataType（Date → { $date: timestamp }），嵌套在
    // db.command.set() 内部的 Date 对象绕过编码，经 JSON.stringify 后变成
    // ISO 字符串，服务端无法识别为日期 → 整个 funnel 更新被丢弃。
    // 修复：手动将 Date 转为数字时间戳，确保服务端正确存储。
    const toTimestamp = (val) => {
      if (val instanceof Date) return val.getTime();
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const out = {};
        for (const [k, v] of Object.entries(val)) out[k] = toTimestamp(v);
        return out;
      }
      return val;
    };

    let mergedFunnel = null;
    if (payload.funnel) {
      mergedFunnel = {
        ...(current.funnel || {}),
        ...payload.funnel,
      };
      payload.funnel = db.command.set(toTimestamp(mergedFunnel));
    }

    // 将 history 数组项转为 db.command.push
    if (payload.history) {
      payload.history = db.command.push(payload.history);
    }

    // 带版本锁更新
    const newVersion = await versionedUpdate('Application', id, expectedVersion, payload);

    writeAuditLog('application_store', 'move_stage', 'Application', [id], { fromStage: oldStage, toStage: newStage, note }, operatorId || 'system');

    // 更新本地缓存（注意：payload 中的 funnel/history 已是 command 对象，需用纯数据覆盖）
    const idx = applications.value.findIndex(a => a._id === id);
    if (idx !== -1) {
      const oldHistory = applications.value[idx].history || [];
      applications.value[idx] = {
        ...applications.value[idx],
        stage: newStage,
        stageEnteredAt: new Date(),
        // 使用合并后的纯 funnel 数据而非 command 对象
        // 转换为时间戳格式与 DB 存储一致，避免下次读取后数据跳变
        ...(mergedFunnel ? { funnel: toTimestamp(mergedFunnel) } : {}),
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
   * @param {string} id - Application ID
   * @param {string} status - 结束状态（'rejected' | 'withdrawn'）
   * @param {string} reason - 淘汰/放弃原因
   * @param {Object} [options] - 可选参数
   * @param {string} [options.endStage] - 淘汰阶段（默认使用当前阶段）
   * @param {string} [options.operatorId] - 操作者 ID
   */
  async function endApplication(id, status, reason, options = {}) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const current = applications.value.find(a => a._id === id)
      || await fetchById(id);
    if (!current) throw new Error('申请记录不存在');

    // 🔒 数据隔离：非管理员只能操作自己的申请
    const auth = useAuthStore();
    if (!auth.isAdmin && current.ownerId && current.ownerId !== auth.currentUsername) {
      throw new Error('无权操作此申请');
    }

    const expectedVersion = typeof current._version === 'number' ? current._version : 0;

    // 支持显式指定淘汰阶段（如简历筛选淘汰/初试淘汰/复试淘汰/终试淘汰）
    // 未指定时默认使用当前阶段
    const endStage = options.endStage || current.stage;

    const updateData = {
      status, // 'rejected' | 'withdrawn'
      endStage,
      endReason: reason,
      endedAt: new Date(),
    };

    // 带版本锁更新
    const newVersion = await versionedUpdate('Application', id, expectedVersion, updateData);

    const action = status === 'rejected' ? 'reject_candidate' : 'withdraw_candidate';
    writeAuditLog('application_store', action, 'Application', [id], { fromStage: current.stage, toStage: status, reason }, options.operatorId || 'system');

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
    findByCandidateId,
    batchUpdateStatusByCandidate,
    batchRemoveByCandidate,
    add,
    moveStage,
    endApplication,
    // 乐观锁工具
    isVersionConflict,
    conflictMessage,
  };
});
