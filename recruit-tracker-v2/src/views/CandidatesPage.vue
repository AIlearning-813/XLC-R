<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人列表（含批量操作+行内操作+岗位分配） */

import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useJobStore } from '../stores/useJobStore';
import { useApplicationStore } from '../stores/useApplicationStore';
import { useCandidateStore } from '../stores/useCandidateStore';
import { useAuthStore } from '../stores/useAuthStore';
import { ownerFilter } from '../services/data-filter';
import cloudbase from '../services/cloudbase';
import { END_REASONS, FUNNEL_STAGES } from '../config/constants';
import { handleError } from '../services/error-handler';
import { captureError } from '../services/error-capture';
import { isVersionConflict } from '../services/optimistic-lock';
import { getAvailableTargets } from '../services/pipeline-engine';
import { useToast } from '../composables/useToast';
import CandidateFilter from '../components/candidates/CandidateFilter.vue';
import CandidateTable from '../components/candidates/CandidateTable.vue';
import StageTransitionDialog from '../components/pipeline/StageTransitionDialog.vue';
import AssignDemandDialog from '../components/candidates/AssignDemandDialog.vue';

const router = useRouter();
const jobStore = useJobStore();
const appStore = useApplicationStore();
const candidateStore = useCandidateStore();
const auth = useAuthStore();
const db = cloudbase.db;
const toast = useToast();

// ===== 状态 =====
const loading = ref(false);
const error = ref('');
const rows = ref([]);
const selectedIds = ref(new Set());
const currentFilters = ref({});

// Tab 切换：活跃 vs 已结束 vs 待分配
const activeTab = ref('active'); // 'active' | 'ended' | 'unassigned'

// 分页
const page = ref(1);
const pageSize = 20;
const totalCount = ref(0);

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize)));

const pages = computed(() => {
  const p = [];
  const total = totalPages.value;
  const current = page.value;

  let start = Math.max(1, current - 2);
  let end = Math.min(total, current + 2);

  if (end - start < 4) {
    if (start === 1) end = Math.min(total, start + 4);
    else start = Math.max(1, end - 4);
  }

  for (let i = start; i <= end; i++) p.push(i);
  return p;
});

const selectedCount = computed(() => selectedIds.value.size);

// ===== 弹窗状态 =====
// 阶段流转确认弹窗（淘汰/放弃/阶段推进）
const transitionDialogVisible = ref(false);
const pendingTransition = ref(null);
const selectedCandidate = ref(null);
const selectedApplication = ref(null);

// 岗位分配弹窗
const assignJobVisible = ref(false);
const assignTarget = ref(null);
const assignJobId = ref('');

// 🆕 关联招聘需求弹窗
const assignDemandVisible = ref(false);
const assignDemandCandidateId = ref('');
const assignDemandCandidateName = ref('');
const assignDemandExistingAppId = ref('');  // 已有 Application ID，避免重复创建

// 编辑弹窗（简易内联编辑）
const editVisible = ref(false);
const editTarget = ref(null);
const editForm = ref({ name: '', phone: '', email: '', expectedPosition: '' });

// ===== 数据加载 =====

async function loadData(filters = {}) {
  loading.value = true;
  error.value = '';

  try {
    const dbInstance = db();

    // 🆕 待分配 Tab：查询没有 Application 的 Candidate
    if (activeTab.value === 'unassigned') {
      await loadUnassigned(dbInstance, filters);
      return;
    }

    let query = dbInstance.collection('Application');

    const conditions = {};

    if (filters.stage) {
      conditions.stage = filters.stage;
    }
    if (filters.jobId) {
      conditions.jobId = filters.jobId;
    }
    if (filters.source) {
      conditions['funnelMeta.entrySource'] = filters.source;
    }

    // 根据当前 Tab 决定查询状态
    if (activeTab.value === 'ended') {
      conditions.status = dbInstance.command.in(['rejected', 'withdrawn']);
    } else if (!filters.stage || !['rejected', 'withdrawn'].includes(filters.stage)) {
      conditions.status = 'active';
    }

    // Phase 1 数据隔离：专员只能看自己的候选人
    const of = ownerFilter();
    if (of) conditions.ownerId = of.ownerId;

    // 🆕 修复：CloudBase SDK 的 .where() 是替换语义，不能链式调用
    // 必须将所有条件合并到同一个对象，只调用一次 .where()
    if (filters.dateFrom) {
      conditions.createdAt = dbInstance.command.gte(new Date(filters.dateFrom));
    }

    if (Object.keys(conditions).length > 0) {
      query = query.where(conditions);
    }

    query = query.orderBy('updatedAt', 'desc');

    const { data: allApps } = await query.limit(200).get();
    let appList = allApps || [];

    // isArchived 在 JS 端过滤（避免与 status 条件一起放 CloudBase where 时被忽略）
    appList = appList.filter(a => a.isArchived !== true);

    // 🆕 活跃 Tab：排除未分配岗位的候选人（jobId 为空），它们应出现在"待分配"Tab
    if (activeTab.value === 'active') {
      appList = appList.filter(a => a.jobId && a.jobId !== '');
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999);
      appList = appList.filter((a) => new Date(a.createdAt) <= toDate);
    }

    if (appList.length > 0) {
      const candidateIds = [...new Set(appList.map((a) => a.candidateId).filter(Boolean))];
      const candidatesMap = {};

      const batchSize = 50;
      for (let i = 0; i < candidateIds.length; i += batchSize) {
        const batch = candidateIds.slice(i, i + batchSize);
        try {
          const { data: candidates } = await dbInstance
            .collection('Candidate')
            .where({ _id: dbInstance.command.in(batch) })
            .get();

          for (const c of (candidates || [])) {
            candidatesMap[c._id] = c;
          }
        } catch (err) {
          for (const id of batch) {
            if (candidatesMap[id]) continue;
            try {
              const { data } = await dbInstance.collection('Candidate').doc(id).get();
              if (data?.[0]) candidatesMap[id] = data[0];
            } catch { /* skip */ }
          }
        }
      }

      const jobIds = [...new Set(appList.map((a) => a.jobId).filter(Boolean))];
      const jobsMap = {};
      for (const jobId of jobIds) {
        const job = jobStore.getById(jobId);
        if (job) jobsMap[jobId] = job;
      }

      let merged = appList.map((app) => {
        const candidate = candidatesMap[app.candidateId] || {};
        const job = jobsMap[app.jobId] || {};

        return {
          _id: app._id,
          appId: app._id,
          candidateId: app.candidateId,
          name: candidate.name,
          phone: candidate.phone,
          email: candidate.email,
          expectedPosition: candidate.expectedPosition,
          sourceEmailSubject: candidate.sourceEmailSubject || '',
          jobTitle: job.title || job.name,
          jobName: job.title || job.name,
          jobId: app.jobId,
          stage: app.stage,
          source: app.funnelMeta?.entrySource || candidate.source,
          status: app.status,
          ownerId: candidate.ownerId || app.ownerId,
          createdBy: candidate.createdBy,
          createdAt: app.createdAt,
          updatedAt: app.updatedAt,
          _candidate: candidate,
          _application: app,
          _job: job,
        };
      });

      if (filters.search) {
        const q = filters.search.toLowerCase();
        merged = merged.filter((row) => {
          return (row.name || '').toLowerCase().includes(q)
            || (row.phone || '').includes(q)
            || (row.email || '').toLowerCase().includes(q);
        });
      }

      totalCount.value = merged.length;

      const start = (page.value - 1) * pageSize;
      rows.value = merged.slice(start, start + pageSize);
    } else {
      rows.value = [];
      totalCount.value = 0;
    }
  } catch (err) {
    console.error('[CandidatesPage] 加载失败:', err.message);
    error.value = '加载候选人失败：' + err.message;
  } finally {
    loading.value = false;
  }
}

// ===== 待分配候选人的加载 =====

async function loadUnassigned(dbInstance, filters = {}) {
  try {
    const of = ownerFilter();

    // 1. 以 Application 集合为数据隔离依据——只查当前用户的申请记录
    //    这样 email-imported 的候选人即使 Candidate.ownerId 缺失也能正确筛选
    let appQuery = dbInstance.collection('Application')
      .where({ isArchived: dbInstance.command.neq(true) });
    if (of) appQuery = appQuery.where({ ownerId: of.ownerId });

    const { data: myApps } = await appQuery.limit(500).get();

    const assignedIds = new Set();
    const endedIds = new Set();  // 🆕 已结束（淘汰/放弃）且未分配岗位的候选人
    const joblessAppMap = {};
    const myCandidateIds = new Set();

    for (const app of (myApps || [])) {
      if (!app.candidateId) continue;
      myCandidateIds.add(app.candidateId);

      if (app.jobId && app.jobId !== '') {
        // 已分配到实际岗位
        assignedIds.add(app.candidateId);
      } else if (app.status === 'active') {
        // jobId 为空 → 待分配，保留 Application 信息供后续使用
        if (!joblessAppMap[app.candidateId]) {
          joblessAppMap[app.candidateId] = app;
        }
      } else if (app.status === 'rejected' || app.status === 'withdrawn') {
        // 🐛 修复：已淘汰/放弃且未分配岗位的候选人，不应出现在待分配中
        // 但如果该候选人同时有另一个 active 的待分配申请（joblessAppMap），
        // 则以 joblessAppMap 为准——下面 filter 中会优先判断
        if (!joblessAppMap[app.candidateId]) {
          endedIds.add(app.candidateId);
        }
      }
    }

    // 2. 查询 Candidate——两个来源合并
    const candidates = [];
    const seenIds = new Set();

    // 2a. 通过 Application 关联的候选人（数据隔离通过 Application.ownerId 保证）
    if (myCandidateIds.size > 0) {
      const idsArray = [...myCandidateIds];
      for (let i = 0; i < idsArray.length; i += 100) {
        const batch = idsArray.slice(i, i + 100);
        const { data } = await dbInstance.collection('Candidate')
          .where({ _id: dbInstance.command.in(batch) })
          .orderBy('createdAt', 'desc')
          .get();
        for (const c of (data || [])) {
          if (!seenIds.has(c._id)) {
            seenIds.add(c._id);
            candidates.push(c);
          }
        }
      }
    }

    // 2b. 孤儿兜底：ownerId 匹配但无 Application 的候选人（手动录入未创建申请等异常情况）
    if (of) {
      const { data: orphanData } = await dbInstance.collection('Candidate')
        .where({ ownerId: of.ownerId })
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();
      for (const c of (orphanData || [])) {
        if (!seenIds.has(c._id)) {
          seenIds.add(c._id);
          candidates.push(c);
        }
      }
    }

    // 3. 筛选未分配：不在 assignedIds 中，且不在 endedIds 中（已淘汰/放弃的排除）
    //    joblessAppMap 优先——如果有 active 待分配申请，即使另一申请已结束也算待分配
    let unassigned = candidates.filter(c => {
      if (assignedIds.has(c._id)) return false;
      if (joblessAppMap[c._id]) return true;
      if (endedIds.has(c._id)) return false;
      return true;  // 孤儿候选人（无 Application）→ 待分配
    });

    // 搜索过滤
    if (filters.search) {
      const q = filters.search.toLowerCase();
      unassigned = unassigned.filter(c =>
        (c.name || '').toLowerCase().includes(q)
        || (c.phone || '').includes(q)
        || (c.email || '').toLowerCase().includes(q)
      );
    }

    // 4. 转换为行数据
    totalCount.value = unassigned.length;
    const start = (page.value - 1) * pageSize;
    rows.value = unassigned.slice(start, start + pageSize).map(c => {
      const joblessApp = joblessAppMap[c._id] || null;
      return {
        _id: joblessApp?._id || c._id,
        candidateId: c._id,
        appId: joblessApp?._id || '',
        name: c.name,
        phone: c.phone,
        email: c.email,
        sourceEmailSubject: c.sourceEmailSubject || '',
        expectedPosition: c.expectedPosition || '',
        jobTitle: '',
        jobName: '',
        jobId: '',
        stage: joblessApp?.stage || '',
        source: joblessApp?.funnelMeta?.entrySource || c.source || 'email',
        status: 'unassigned',
        ownerId: c.ownerId || of?.ownerId || '',
        createdBy: c.createdBy,
        createdAt: joblessApp?.createdAt || c.createdAt,
        updatedAt: c.updatedAt,
        _candidate: c,
        _application: joblessApp,
        _job: null,
      };
    });
  } catch (err) {
    handleError(err, { context: '加载待分配候选人' });
    error.value = '加载待分配候选人失败：' + err.message;
  } finally {
    loading.value = false;
  }
}

// ===== 行内操作处理 =====

function handleAction({ action, row }) {
  switch (action) {
    case 'edit':
      openEditDialog(row);
      break;
    case 'assignJob':
      openAssignJobDialog(row);
      break;
    case 'assignDemand':
      openAssignDemandDialog(row);
      break;
    case 'moveStage':
      openTransitionDialog(row, row.toStage);
      break;
    case 'reject':
      openTransitionDialog(row, 'rejected');
      break;
    case 'withdraw':
      openTransitionDialog(row, 'withdrawn');
      break;
    case 'reactivate':
      openReactivateDialog(row);
      break;
    case 'deleteResume':
      deleteCandidate(row);
      break;
  }
}

// ===== 删除简历 =====

async function deleteCandidate(row) {
  const name = row.name || '未命名';
  // 三重校验管理员身份：Pinia store + localStorage 新格式 + localStorage 旧格式
  const isAdmin = auth.isAdmin
    || (() => { try { const s = JSON.parse(localStorage.getItem('xlc_auth_session') || '{}'); return s.r === 'admin' || s.role === 'admin'; } catch { return false; } })();
  const confirmMsg = isAdmin
    ? `确定要删除「${name}」的简历吗？\n\n管理员删除将立即生效，简历将从列表中移除。`
    : `确定要删除「${name}」的简历吗？\n\n删除后将提交至管理员审批，审批通过后简历将不再出现在任何列表中。`;
  if (!confirm(confirmMsg)) return;

  try {
    // row._id 是 Application ID，row.candidateId 才是 Candidate ID
    const candidateId = row.candidateId || row._id;
    const result = await candidateStore.softDelete(candidateId, { skipApproval: isAdmin });
    if (result?.pending) {
      toast.success('已提交删除审批，请等待管理员审核');
    } else {
      // 先从本地列表移除（避免 DB 读写延迟导致刷新后仍出现）
      rows.value = rows.value.filter(r => r.candidateId !== candidateId);
      totalCount.value = Math.max(0, totalCount.value - 1);
      toast.success('简历已删除');
    }
  } catch (err) {
    handleError(err, { context: '删除简历', toast });
  }
}

// ===== 重新激活 =====

const reactivateDialogVisible = ref(false);
const reactivateTarget = ref(null);
const reactivateStage = ref('');

function openReactivateDialog(row) {
  reactivateTarget.value = row;
  // 获取可用的重新激活目标阶段
  const targets = getAvailableTargets(row.status, row.status, null);
  reactivateStage.value = targets.length > 0 ? targets[0].key : 'resume';
  reactivateDialogVisible.value = true;
}

async function confirmReactivate() {
  if (!reactivateTarget.value) return;
  const row = reactivateTarget.value;
  try {
    // 使用 moveStage 的 isReactivation 路径
    // 先更新 status 为 active，再设置 stage
    const dbInstance = db();
    await dbInstance.collection('Application').doc(row.appId).update({
      status: 'active',
      stage: reactivateStage.value,
      stageEnteredAt: new Date(),
      endedAt: null,
      endReason: '',
      endStage: '',
      reactivatedAt: new Date(),
      reactivatedFrom: row.status,
      updatedAt: new Date(),
      history: dbInstance.command.push({
        fromStage: row.status,
        toStage: reactivateStage.value,
        at: new Date(),
        note: '重新激活',
        operatorId: auth.userName,
        operator: auth.userName,
      }),
    });

    // 审计日志
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'reactivate_candidate',
        entityType: 'Application',
        entityIds: [row.appId],
        detail: {
          fromStatus: row.status,
          toStage: reactivateStage.value,
        },
        operator: auth.userName || 'system',
      });
    } catch (e) { captureError('candidates_page', '审计日志写入失败', { message: e.message, context: 'reactivate' }); }

    reactivateDialogVisible.value = false;
    reactivateTarget.value = null;
    await loadData(currentFilters.value);
  } catch (err) {
    if (isVersionConflict(err)) {
      toast.error('操作冲突：数据已被其他用户修改，请刷新后重试。');
    } else {
      handleError(err, { context: '重新激活', toast });
    }
    loadData(currentFilters.value);
  }
}

function cancelReactivate() {
  reactivateDialogVisible.value = false;
  reactivateTarget.value = null;
}

// ===== 编辑弹窗 =====

function openEditDialog(row) {
  editTarget.value = row;
  editForm.value = {
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    expectedPosition: row.expectedPosition || '',
  };
  editVisible.value = true;
}

async function saveEdit() {
  if (!editTarget.value) return;
  try {
    await candidateStore.update(editTarget.value.candidateId, {
      name: editForm.value.name,
      phone: editForm.value.phone,
      email: editForm.value.email,
      expectedPosition: editForm.value.expectedPosition,
      updatedAt: new Date(),
    });

    // 写审计日志
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'update_candidate',
        entityType: 'Candidate',
        entityIds: [editTarget.value.candidateId],
        detail: { updatedFields: Object.keys(editForm.value) },
        operator: auth.userName || 'system',
      });
    } catch (e) { captureError('candidates_page', '审计日志写入失败', { message: e.message, context: 'update_candidate' }); }

    editVisible.value = false;
    editTarget.value = null;
    loadData(currentFilters.value);
  } catch (err) {
    handleError(err, { context: '保存候选人', toast });
  }
}

// ===== 岗位分配弹窗 =====

function openAssignJobDialog(row) {
  assignTarget.value = row;
  assignJobId.value = row.jobId || '';
  assignJobVisible.value = true;
}

async function confirmAssignJob() {
  if (!assignTarget.value || !assignJobId.value) return;
  try {
    await db().collection('Application').doc(assignTarget.value.appId).update({
      jobId: assignJobId.value,
      updatedAt: new Date(),
    });

    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'assign_job',
        entityType: 'Application',
        entityIds: [assignTarget.value.appId],
        detail: { newJobId: assignJobId.value },
        operator: auth.userName || 'system',
      });
    } catch (e) { captureError('candidates_page', '审计日志写入失败', { message: e.message, context: 'assign_job' }); }

    assignJobVisible.value = false;
    assignTarget.value = null;
    loadData(currentFilters.value);
  } catch (err) {
    handleError(err, { context: '分配岗位', toast });
  }
}

// 🆕 关联招聘需求弹窗
function openAssignDemandDialog(row) {
  assignDemandCandidateId.value = row.candidateId || row._id;
  assignDemandCandidateName.value = row.name || '';
  // 如果已有 Application，传递其 ID → 更新而非新建，避免重复
  assignDemandExistingAppId.value = row.appId || '';
  assignDemandVisible.value = true;
}

function onDemandAssigned(result) {
  assignDemandVisible.value = false;
  if (result.isNew) {
    toast.success(`「${assignDemandCandidateName.value}」已关联至「${result.demandTitle}」`);
  } else {
    toast.success(`已更新关联`);
  }
  assignDemandCandidateId.value = '';
  assignDemandCandidateName.value = '';
  assignDemandExistingAppId.value = '';
  loadData(currentFilters.value);
}

// ===== 阶段流转弹窗（淘汰/放弃/阶段推进）=====

function openTransitionDialog(row, toStage) {
  selectedCandidate.value = row._candidate || {};
  selectedApplication.value = row._application || {};
  pendingTransition.value = {
    applicationId: row.appId,
    fromStage: row.stage,
    toStage,
  };
  transitionDialogVisible.value = true;
}

async function handleTransitionConfirm({ note, reason }) {
  if (!pendingTransition.value) return;

  const { applicationId, fromStage, toStage } = pendingTransition.value;

  try {
    if (toStage === 'rejected' || toStage === 'withdrawn') {
      await appStore.endApplication(
        applicationId,
        toStage,
        reason || note || '未指定原因',
        { operatorId: auth.userName }
      );
    } else {
      await appStore.moveStage(applicationId, toStage, {
        note,
        operatorId: auth.userName,
      });
    }

    transitionDialogVisible.value = false;
    pendingTransition.value = null;
    selectedCandidate.value = null;
    selectedApplication.value = null;

    await loadData(currentFilters.value);
  } catch (err) {
    handleError(err, { context: '流转候选人', toast });
    loadData(currentFilters.value);
  }
}

function handleTransitionCancel() {
  transitionDialogVisible.value = false;
  pendingTransition.value = null;
  selectedCandidate.value = null;
  selectedApplication.value = null;
}

// ===== 批量操作 =====

const batchActionOpen = ref(false);

// P2-24：岗位名称输入弹窗（替代 prompt()）
const jobSelectDialog = ref({ visible: false, ids: [] });
const selectedJobId = ref('');

function onJobSelectConfirm() {
  if (selectedJobId.value) batchAssignJobs(jobSelectDialog.value.ids, selectedJobId.value);
}

function batchAction(action) {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;

  switch (action) {
    case 'batchReject': {
      if (!confirm(`确认淘汰 ${ids.length} 位候选人？`)) return;
      batchEndApplications(ids, 'rejected');
      break;
    }
    case 'batchWithdraw': {
      if (!confirm(`确认放弃 ${ids.length} 位候选人？`)) return;
      batchEndApplications(ids, 'withdrawn');
      break;
    }
    case 'batchAssignJob': {
      batchActionOpen.value = false;
      selectedJobId.value = '';
      jobSelectDialog.value = { visible: true, ids };
      break;
    }
    case 'selectAll':
      handleSelectAll(true);
      break;
    case 'clearSelection':
      handleSelectAll(false);
      break;
  }
  batchActionOpen.value = false;
}

async function batchEndApplications(ids, status) {
  let success = 0;
  for (const appId of ids) {
    try {
      await appStore.endApplication(appId, status, '批量操作', { operatorId: auth.userName });
      success++;
    } catch (err) {
      console.error(`批量${status}失败 [${appId}]:`, err.message);
    }
  }
  selectedIds.value = new Set();
  loadData(currentFilters.value);
  toast.success(`已完成：${success}/${ids.length} 位候选人`);
}

async function batchAssignJobs(ids, jobId) {
  const job = jobStore.getById(jobId);
  if (!job) {
    toast.warning('未找到该岗位，请重新选择');
    return;
  }

  let success = 0;
  for (const appId of ids) {
    try {
      await db().collection('Application').doc(appId).update({
        jobId: job._id,
        updatedAt: new Date(),
      });
      success++;
    } catch (err) {
      console.error(`批量分配岗位失败 [${appId}]:`, err.message);
    }
  }
  selectedIds.value = new Set();
  loadData(currentFilters.value);
  toast.success(`已分配：${success}/${ids.length} 位候选人来"${job.title || job.name}"`);
}

// ===== 事件处理 =====

function handleFilter(filters) {
  currentFilters.value = filters;
  page.value = 1;
  loadData(filters);
}

function handleReset() {
  currentFilters.value = {};
  page.value = 1;
  loadData({});
}

function switchTab(tab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  page.value = 1;
  selectedIds.value = new Set();
  loadData(currentFilters.value);
}

function handleRowClick(row) {
  router.push(`/candidates/${row.candidateId}`);
}

function handleToggleSelect(id) {
  const newSet = new Set(selectedIds.value);
  if (newSet.has(id)) {
    newSet.delete(id);
  } else {
    newSet.add(id);
  }
  selectedIds.value = newSet;
}

function handleSelectAll(select) {
  if (select) {
    selectedIds.value = new Set(rows.value.map((r) => r._id));
  } else {
    selectedIds.value = new Set();
  }
}

function goToPage(p) {
  if (p >= 1 && p <= totalPages.value) {
    page.value = p;
    loadData(currentFilters.value);
  }
}

onMounted(async () => {
  await jobStore.fetchActive();
  loadData({});
});
</script>

<template>
  <div class="candidates-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">候选人</h2>
        <p class="page-desc">
          共 {{ totalCount }} 位候选人
          <span v-if="selectedCount > 0" class="selected-hint">
            · 已选 {{ selectedCount }} 位
          </span>
        </p>
      </div>
      <div class="header-actions">
        <button
          class="btn btn-primary btn-sm"
          @click="$router.push('/import/resume')"
        >
          + 录入简历
        </button>
      </div>
    </div>

    <!-- Tab 切换：活跃 / 已结束 / 待分配 -->
    <div class="tab-switcher">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'active' }"
        @click="switchTab('active')"
      >
        活跃候选人
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'unassigned' }"
        @click="switchTab('unassigned')"
      >
        待分配
        <span v-if="activeTab === 'unassigned'" class="tab-badge">{{ totalCount }}</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'ended' }"
        @click="switchTab('ended')"
      >
        已结束
      </button>
    </div>

    <!-- 批量操作工具栏 -->
    <Transition name="toolbar-slide">
      <div v-if="selectedCount > 0" class="batch-toolbar">
        <div class="batch-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <span>已选择 <strong>{{ selectedCount }}</strong> 位候选人</span>
        </div>
        <div class="batch-actions">
          <button class="btn btn-sm btn-secondary" @click="batchAction('batchAssignJob')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            批量分配岗位
          </button>
          <button class="btn btn-sm btn-danger-outline" @click="batchAction('batchReject')">
            批量淘汰
          </button>
          <button class="btn btn-sm btn-danger-outline" @click="batchAction('batchWithdraw')">
            批量放弃
          </button>
          <button class="btn btn-sm btn-ghost" @click="batchAction('clearSelection')">
            取消选择
          </button>
        </div>
      </div>
    </Transition>

    <!-- 筛选栏 -->
    <CandidateFilter
      :jobs="jobStore.activeJobs"
      @filter="handleFilter"
      @reset="handleReset"
    />

    <!-- 错误 -->
    <div v-if="error" class="pipeline-error" style="margin-top: var(--spacing-md);">
      {{ error }}
      <button class="btn btn-sm btn-secondary" @click="loadData(currentFilters)">重试</button>
    </div>

    <!-- 表格 -->
    <div class="table-section">
      <CandidateTable
        :candidates="rows"
        :loading="loading"
        :selected-ids="selectedIds"
        :active-tab="activeTab"
        @row-click="handleRowClick"
        @toggle-select="handleToggleSelect"
        @select-all="handleSelectAll"
        @action="handleAction"
      />
    </div>

    <!-- 分页 -->
    <div v-if="totalPages > 1" class="pagination">
      <button
        class="btn btn-sm btn-ghost page-btn"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        上一页
      </button>

      <button
        v-for="p in pages"
        :key="p"
        class="btn btn-sm page-num"
        :class="p === page ? 'btn-primary' : 'btn-ghost'"
        @click="goToPage(p)"
      >
        {{ p }}
      </button>

      <button
        class="btn btn-sm btn-ghost page-btn"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        下一页
      </button>
    </div>

    <!-- === 弹窗 === -->

    <!-- 编辑弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="editVisible" class="dialog-overlay" @click.self="editVisible = false">
          <div class="dialog-card dialog-sm">
            <div class="dialog-header">
              <h3 class="dialog-title">编辑候选人信息</h3>
              <button class="dialog-close" @click="editVisible = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label class="form-label">姓名</label>
                <input v-model="editForm.name" type="text" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">手机号</label>
                <input v-model="editForm.phone" type="text" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">邮箱</label>
                <input v-model="editForm.email" type="email" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">期望岗位</label>
                <input v-model="editForm.expectedPosition" type="text" class="form-input" />
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-secondary" @click="editVisible = false">取消</button>
              <button class="btn btn-primary" @click="saveEdit">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 🆕 关联招聘需求弹窗 -->
    <AssignDemandDialog
      v-if="assignDemandVisible"
      :candidate-id="assignDemandCandidateId"
      :candidate-name="assignDemandCandidateName"
      :existing-app-id="assignDemandExistingAppId"
      @assigned="onDemandAssigned"
      @close="assignDemandVisible = false"
    />

    <!-- 批量分配岗位 — 下拉选择弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="jobSelectDialog.visible" class="dialog-overlay" @click.self="jobSelectDialog.visible = false">
          <div class="dialog-card dialog-sm">
            <div class="dialog-header">
              <h3 class="dialog-title">批量分配岗位</h3>
              <button class="dialog-close" @click="jobSelectDialog.visible = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="dialog-body">
              <p class="dialog-desc">已选择 <strong>{{ jobSelectDialog.ids.length }}</strong> 位候选人，请选择目标岗位：</p>
              <div class="form-group">
                <select v-model="selectedJobId" class="form-select">
                  <option value="" disabled>— 请选择招聘需求 —</option>
                  <option
                    v-for="job in jobStore.activeJobs"
                    :key="job._id"
                    :value="job._id"
                  >{{ job.title || job.name }}{{ job.department ? ' — ' + job.department : '' }}</option>
                </select>
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-secondary" @click="jobSelectDialog.visible = false">取消</button>
              <button class="btn btn-primary" :disabled="!selectedJobId" @click="onJobSelectConfirm(); jobSelectDialog.visible = false;">
                确认分配
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 重新激活弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="reactivateDialogVisible" class="dialog-overlay" @click.self="cancelReactivate">
          <div class="dialog-card dialog-sm">
            <div class="dialog-header">
              <h3 class="dialog-title">重新激活候选人</h3>
              <button class="dialog-close" @click="cancelReactivate">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="dialog-body">
              <p class="reactivate-info">
                将 <strong>{{ reactivateTarget?.name || '未命名' }}</strong> 重新激活，恢复到以下阶段：
              </p>
              <div class="form-group">
                <label class="form-label">目标阶段</label>
                <select v-model="reactivateStage" class="form-select">
                  <option
                    v-for="s in FUNNEL_STAGES"
                    :key="s.key"
                    :value="s.key"
                  >{{ s.label }}</option>
                </select>
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-secondary" @click="cancelReactivate">取消</button>
              <button class="btn btn-primary" @click="confirmReactivate">确认激活</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 阶段流转确认弹窗 -->
    <StageTransitionDialog
      :visible="transitionDialogVisible"
      :candidate="selectedCandidate"
      :application="selectedApplication"
      :from-stage="pendingTransition?.fromStage || ''"
      :to-stage="pendingTransition?.toStage || ''"
      @confirm="handleTransitionConfirm"
      @cancel="handleTransitionCancel"
    />
  </div>
</template>

<style scoped>
.candidates-page {
  max-width: 1200px;
}

/* === 头部 === */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
  margin: 0 0 2px;
  letter-spacing: -0.02em;
}

.page-desc {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin: 0;
}

.selected-hint {
  color: var(--primary);
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* === Tab 切换 === */
.tab-switcher {
  display: flex;
  gap: 0;
  margin-bottom: var(--spacing-md);
  border-bottom: 2px solid var(--gray-100);
}

.tab-btn {
  padding: 8px 20px;
  border: none;
  background: transparent;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--gray-400);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all var(--transition);
  font-family: inherit;
}

.tab-btn:hover {
  color: var(--gray-600);
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.tab-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--primary); color: #fff;
  font-size: 11px; font-weight: 600;
  margin-left: 4px;
}

/* === 批量操作工具栏 === */
.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--primary-bg);
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  margin-bottom: var(--spacing-md);
  gap: var(--spacing-md);
  flex-wrap: wrap;
}

.batch-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--primary-dark);
  flex-shrink: 0;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.btn-danger-outline {
  border: 1px solid var(--danger);
  color: var(--danger);
  background: transparent;
}

.btn-danger-outline:hover {
  background: var(--danger-bg);
}

/* === 表格区域 === */
.table-section {
  margin-top: var(--spacing-md);
  background: #fff;
  border-radius: var(--radius);
  border: var(--card-border);
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* === 分页 === */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: var(--spacing-lg);
}

.page-btn {
  font-size: var(--font-size-sm);
}

.page-num {
  min-width: 36px;
  height: 36px;
  padding: 0;
  font-size: var(--font-size-sm);
}

/* === 错误 === */
.pipeline-error {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

/* === 弹窗 === */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-card {
  background: #fff;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 460px;
  max-width: 90vw;
  overflow: hidden;
}

.dialog-sm {
  width: 400px;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-lg) var(--spacing-lg) 0;
}

.dialog-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--gray-700);
  margin: 0;
}

.dialog-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--gray-400);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
}

.dialog-close:hover {
  background: var(--gray-50);
  color: var(--gray-600);
}

.dialog-body {
  padding: var(--spacing-lg);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-lg) var(--spacing-lg);
}

.form-group {
  margin-bottom: var(--spacing-md);
}

.form-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--gray-600);
  margin-bottom: var(--spacing-xs);
}

.form-input,
.form-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  color: var(--gray-700);
  background: #fff;
  transition: border-color var(--transition);
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-bg);
}

.assign-info {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  margin: 0 0 var(--spacing-md);
}

.assign-hint {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  margin: var(--spacing-sm) 0 0;
}

.reactivate-info {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  margin: 0 0 var(--spacing-md);
}

.reactivate-info strong {
  color: var(--gray-700);
}

/* === 工具栏动画 === */
.toolbar-slide-enter-active {
  transition: all 0.25s ease;
}

.toolbar-slide-leave-active {
  transition: all 0.2s ease;
}

.toolbar-slide-enter-from,
.toolbar-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* === 弹窗动画 === */
.dialog-enter-active {
  transition: all 0.25s ease;
}

.dialog-leave-active {
  transition: all 0.2s ease;
}

.dialog-enter-from {
  opacity: 0;
}

.dialog-enter-from .dialog-card {
  transform: scale(0.95) translateY(8px);
}

.dialog-leave-to {
  opacity: 0;
}
</style>
