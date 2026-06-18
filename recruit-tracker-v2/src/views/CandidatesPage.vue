<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人列表（含批量操作+行内操作+岗位分配） */

import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useJobStore } from '../stores/useJobStore';
import { useApplicationStore } from '../stores/useApplicationStore';
import { useCandidateStore } from '../stores/useCandidateStore';
import { useAuthStore } from '../stores/useAuthStore';
import cloudbase from '../services/cloudbase';
import { END_REASONS } from '../config/constants';
import { safeErrorMsg } from '../services/error-messages';
import CandidateFilter from '../components/candidates/CandidateFilter.vue';
import CandidateTable from '../components/candidates/CandidateTable.vue';
import StageTransitionDialog from '../components/pipeline/StageTransitionDialog.vue';

const router = useRouter();
const jobStore = useJobStore();
const appStore = useApplicationStore();
const candidateStore = useCandidateStore();
const auth = useAuthStore();
const db = cloudbase.db;

// ===== 状态 =====
const loading = ref(false);
const error = ref('');
const rows = ref([]);
const selectedIds = ref(new Set());
const currentFilters = ref({});

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

    if (!filters.stage || !['rejected', 'withdrawn'].includes(filters.stage)) {
      conditions.status = 'active';
    }

    if (Object.keys(conditions).length > 0) {
      for (const [key, value] of Object.entries(conditions)) {
        query = query.where({ [key]: value });
      }
    }

    if (filters.dateFrom) {
      query = query.where({
        createdAt: dbInstance.command.gte(new Date(filters.dateFrom)),
      });
    }

    query = query.orderBy('updatedAt', 'desc');

    const { data: allApps } = await query.limit(200).get();
    let appList = allApps || [];

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
          jobTitle: job.title || job.name,
          jobName: job.title || job.name,
          jobId: app.jobId,
          stage: app.stage,
          source: app.funnelMeta?.entrySource || candidate.source,
          status: app.status,
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

// ===== 行内操作处理 =====

function handleAction({ action, row }) {
  switch (action) {
    case 'edit':
      openEditDialog(row);
      break;
    case 'assignJob':
      openAssignJobDialog(row);
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
  }
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
    } catch { /* ignore */ }

    editVisible.value = false;
    editTarget.value = null;
    loadData(currentFilters.value);
  } catch (err) {
    alert('保存失败：' + safeErrorMsg(err));
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
    } catch { /* ignore */ }

    assignJobVisible.value = false;
    assignTarget.value = null;
    loadData(currentFilters.value);
  } catch (err) {
    alert('分配岗位失败：' + safeErrorMsg(err));
  }
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
    alert('流转失败：' + safeErrorMsg(err));
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
      // 打开批量分配岗位弹窗
      batchActionOpen.value = false;
      const jobId = prompt('请输入要分配的岗位名称（将自动匹配）：');
      if (jobId) batchAssignJobs(ids, jobId);
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
  alert(`已完成：${success}/${ids.length} 位候选人`);
}

async function batchAssignJobs(ids, jobTitle) {
  // 查找匹配的岗位
  const job = jobStore.activeJobs.find(j =>
    (j.title || j.name || '').toLowerCase().includes(jobTitle.toLowerCase())
  );
  if (!job) {
    alert('未找到匹配的岗位，请确认岗位名称');
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
  alert(`已分配：${success}/${ids.length} 位候选人来"${job.title || job.name}"`);
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

    <!-- 分配岗位弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="assignJobVisible" class="dialog-overlay" @click.self="assignJobVisible = false">
          <div class="dialog-card dialog-sm">
            <div class="dialog-header">
              <h3 class="dialog-title">分配岗位</h3>
              <button class="dialog-close" @click="assignJobVisible = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="dialog-body">
              <p class="assign-info">
                为 <strong>{{ assignTarget?.name || '未命名' }}</strong> 分配岗位
              </p>
              <div class="form-group">
                <label class="form-label">选择岗位</label>
                <select v-model="assignJobId" class="form-select" style="width: 100%;">
                  <option value="" disabled>请选择岗位...</option>
                  <option v-for="job in jobStore.activeJobs" :key="job._id" :value="job._id">
                    {{ job.title || job.name }}
                  </option>
                </select>
              </div>
              <p v-if="assignTarget?.expectedPosition" class="assign-hint">
                💡 候选人期望岗位：{{ assignTarget.expectedPosition }}
              </p>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-secondary" @click="assignJobVisible = false">取消</button>
              <button class="btn btn-primary" :disabled="!assignJobId" @click="confirmAssignJob">确认分配</button>
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
