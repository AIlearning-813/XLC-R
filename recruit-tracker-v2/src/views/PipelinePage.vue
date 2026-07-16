<script setup>
/* 新励成招聘管理系统 V2.0 — 招聘看板（含结束流程+未分配候选人） */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useJobStore } from '../stores/useJobStore';
import { useApplicationStore } from '../stores/useApplicationStore';
import { useAuthStore } from '../stores/useAuthStore';
import cloudbase from '../services/cloudbase';
import { FUNNEL_STAGES } from '../config/constants';
import { ownerFilter } from '../services/data-filter';
import { safeErrorMsg } from '../services/error-messages';
import { isVersionConflict } from '../services/optimistic-lock';
import { getInterviewRounds, getStagesForJob } from '../services/pipeline-engine';
import { useBatchSelection } from '../composables/useBatchSelection';
import { useToast } from '../composables/useToast';
import KanbanBoard from '../components/pipeline/KanbanBoard.vue';
import StageTransitionDialog from '../components/pipeline/StageTransitionDialog.vue';
import BatchActionBar from '../components/pipeline/BatchActionBar.vue';

const router = useRouter();
const jobStore = useJobStore();
const appStore = useApplicationStore();
const auth = useAuthStore();
const db = cloudbase.db;
const toast = useToast();

// ===== 状态 =====
const selectedJobId = ref('');
const applications = ref([]);
const candidatesMap = ref({});
const loading = ref(false);
const error = ref('');

// 未分配岗位的候选人
const unassignedApps = ref([]);
const unassignedCandidatesMap = ref({});
const loadingUnassigned = ref(false);

// 流转确认弹窗
const dialogVisible = ref(false);
const pendingTransition = ref(null);
const selectedCandidate = ref(null);
const selectedApplication = ref(null);

// 结束流程：显示淘汰/放弃投放区（由 KanbanBoard 左侧紧凑投放区实现）
const showEndZones = ref(true);

// 批量选择
const batchSelection = useBatchSelection();

function onToggleSelect(id) {
  batchSelection.toggle(id);
}

function onBatchDone() {
  batchSelection.clear();
  refreshBoard();
}

function onBatchCancel() {
  batchSelection.clear();
}

// P3-33：移动端检测 — 屏幕宽度 < 768px 时看板降级为列表视图
const isMobile = ref(window.innerWidth < 768);
const mobileStageFilter = ref('all');

function onResize() {
  isMobile.value = window.innerWidth < 768;
}

onMounted(() => {
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
});

// ===== 计算属性 =====
const jobs = computed(() => jobStore.activeJobs);

const selectedJob = computed(() => {
  return jobs.value.find((j) => j._id === selectedJobId.value) || null;
});

// 结束区域（紧凑卡片式，与其他阶段统一风格）
const END_ZONE_STAGES = [
  { key: 'rejected', label: '淘汰', isEnd: true },
  { key: 'withdrawn', label: '放弃', isEnd: true },
];

// 全部可见阶段（漏斗+结束区，统一紧凑卡片式，使用流转引擎过滤）
const visibleStages = computed(() => {
  if (!selectedJob.value) {
    return [...END_ZONE_STAGES, ...FUNNEL_STAGES];
  }

  const jobType = selectedJob.value.type || selectedJob.value.jobType;
  const filtered = getStagesForJob(jobType);

  return [...END_ZONE_STAGES, ...filtered];
});

// P3-33：移动端辅助函数
const stageLabelMap = computed(() => {
  const map = {};
  for (const st of visibleStages.value) {
    map[st.key] = st.label;
  }
  return map;
});

function stageLabel(stageKey) {
  return stageLabelMap.value[stageKey] || stageKey;
}

function countAppsByStage(stageKey) {
  return applications.value.filter(a => a.stage === stageKey).length;
}

const filteredMobileApps = computed(() => {
  if (mobileStageFilter.value === 'all') return applications.value;
  return applications.value.filter(a => a.stage === mobileStageFilter.value);
});

function fmtMobileDate(d) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ===== 方法 =====

// 加载岗位列表
async function loadJobs() {
  try {
    await jobStore.fetchActive();
    if (!selectedJobId.value && jobs.value.length > 0) {
      selectedJobId.value = jobs.value[0]._id;
    }
  } catch (err) {
    error.value = '加载岗位失败：' + err.message;
  }
}

// 加载未分配岗位的候选人
async function loadUnassigned() {
  loadingUnassigned.value = true;
  try {
    const dbInstance = db();
    const of = ownerFilter();
    const unassignedFilter = {
      jobId: '',
      status: 'active',
      isArchived: dbInstance.command.neq(true),
      ...(of || {}),
    };
    const { data: apps } = await dbInstance
      .collection('Application')
      .where(unassignedFilter)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const appList = apps || [];

    // 批量获取候选人信息
    if (appList.length > 0) {
      const candidateIds = [...new Set(appList.map((a) => a.candidateId).filter(Boolean))];
      const newMap = {};

      const batchSize = 50;
      for (let i = 0; i < candidateIds.length; i += batchSize) {
        const batch = candidateIds.slice(i, i + batchSize);
        try {
          // 🔒 数据隔离：附加 ownerId 过滤
          const candidateConditions = { _id: dbInstance.command.in(batch) };
          if (of) candidateConditions.ownerId = of.ownerId;
          const { data: candidates } = await dbInstance
            .collection('Candidate')
            .where(candidateConditions)
            .get();

          for (const c of (candidates || [])) {
            newMap[c._id] = c;
          }
        } catch (err) {
          console.warn('[PipelinePage] 批量获取未分配候选人失败:', err.message);
          for (const id of batch) {
            if (newMap[id]) continue;
            try {
              const { data } = await dbInstance.collection('Candidate').doc(id).get();
              if (data?.[0]) newMap[id] = data[0];
            } catch { /* skip */ }
          }
        }
      }

      unassignedCandidatesMap.value = newMap;
    }

    unassignedApps.value = appList;
  } catch (err) {
    console.error('[PipelinePage] 加载未分配候选人失败:', err.message);
  } finally {
    loadingUnassigned.value = false;
  }
}

// 加载选中岗位的申请和候选人
async function loadApplications() {
  if (!selectedJobId.value) {
    applications.value = [];
    return;
  }

  loading.value = true;
  error.value = '';

  try {
    const dbInstance = db();

    // Phase 1 数据隔离
    const of = ownerFilter();

    // 查活跃申请
    const { data: activeApps } = await dbInstance
      .collection('Application')
      .where({
        jobId: selectedJobId.value,
        status: 'active',
        isArchived: dbInstance.command.neq(true),
        ...(of || {}),
      })
      .orderBy('createdAt', 'desc')
      .get();

    // 查已结束申请（淘汰+放弃），展示在结束列
    const { data: endedApps } = await dbInstance
      .collection('Application')
      .where({
        jobId: selectedJobId.value,
        status: dbInstance.command.in(['rejected', 'withdrawn']),
        isArchived: dbInstance.command.neq(true),
        ...(of || {}),
      })
      .orderBy('endedAt', 'desc')
      .limit(50)
      .get();

    const appList = [...(activeApps || []), ...(endedApps || [])];

    if (appList.length > 0) {
      const candidateIds = [...new Set(appList.map((a) => a.candidateId).filter(Boolean))];
      const newCandidatesMap = { ...candidatesMap.value };

      const batchSize = 50;
      for (let i = 0; i < candidateIds.length; i += batchSize) {
        const batch = candidateIds.slice(i, i + batchSize);
        try {
          // 🔒 数据隔离：附加 ownerId 过滤
          const candidateConditions = { _id: dbInstance.command.in(batch) };
          if (of) candidateConditions.ownerId = of.ownerId;
          const { data: candidates } = await dbInstance
            .collection('Candidate')
            .where(candidateConditions)
            .get();

          for (const c of (candidates || [])) {
            newCandidatesMap[c._id] = c;
          }
        } catch (err) {
          console.warn('[PipelinePage] 批量获取候选人失败:', err.message);
          for (const id of batch) {
            if (newCandidatesMap[id]) continue;
            try {
              const { data } = await dbInstance.collection('Candidate').doc(id).get();
              if (data?.[0]) newCandidatesMap[id] = data[0];
            } catch { /* skip */ }
          }
        }
      }

      candidatesMap.value = newCandidatesMap;
    }

    applications.value = appList;
  } catch (err) {
    console.error('[PipelinePage] 加载申请失败:', err.message);
    error.value = '加载申请失败：' + err.message;
  } finally {
    loading.value = false;
  }
}

// 快捷分配：将未分配候选人分配给当前岗位
async function quickAssignToJob(appId, candidateId) {
  try {
    await db().collection('Application').doc(appId).update({
      jobId: selectedJobId.value,
      updatedAt: new Date(),
    });

    // 从未分配列表移除
    unassignedApps.value = unassignedApps.value.filter((a) => a._id !== appId);

    // 刷新看板
    await refreshBoard();
  } catch (err) {
    toast.error('分配失败：' + safeErrorMsg(err));
  }
}

// 处理拖拽移动
function handleCardMove({ applicationId, fromStage, toStage }) {
  // 检查是否从未分配区域拖出（需要特殊处理）
  const isUnassigned = unassignedApps.value.some((a) => a._id === applicationId);
  const app = isUnassigned
    ? unassignedApps.value.find((a) => a._id === applicationId)
    : applications.value.find((a) => a._id === applicationId);

  if (!app) {
    console.warn('[PipelinePage] 未找到申请记录:', applicationId);
    refreshBoard();
    return;
  }

  const candidate = isUnassigned
    ? (unassignedCandidatesMap.value[app.candidateId] || {})
    : (candidatesMap.value[app.candidateId] || {});

  // 检查是否是结束操作（拖到 rejected/withdrawn 列）
  if (toStage === 'rejected' || toStage === 'withdrawn') {
    pendingTransition.value = { applicationId, fromStage, toStage, isUnassigned };
    selectedCandidate.value = candidate;
    selectedApplication.value = app;
    dialogVisible.value = true;
    return;
  }

  // 普通流转
  pendingTransition.value = { applicationId, fromStage, toStage, isUnassigned };
  selectedCandidate.value = candidate;
  selectedApplication.value = app;
  dialogVisible.value = true;
}

// 处理卡片快速流转按钮（不拖拽，直接弹窗确认）
function handleCardQuickMove({ applicationId, candidate, application, fromStage, toStage, endStage }) {
  pendingTransition.value = { applicationId, fromStage, toStage, isUnassigned: false, endStage };
  selectedCandidate.value = candidate;
  selectedApplication.value = application;
  dialogVisible.value = true;
}

// 确认流转
async function handleTransitionConfirm({ note, reason }) {
  if (!pendingTransition.value) return;

  const { applicationId, fromStage, toStage, isUnassigned } = pendingTransition.value;

  try {
    // 如果从未分配区域拖出，先分配岗位
    if (isUnassigned && selectedJobId.value) {
      await db().collection('Application').doc(applicationId).update({
        jobId: selectedJobId.value,
        updatedAt: new Date(),
      });
    }

    if (toStage === 'rejected' || toStage === 'withdrawn') {
      await appStore.endApplication(
        applicationId,
        toStage,
        reason || note || '未指定原因',
        { operatorId: auth.userName, endStage: pendingTransition.value?.endStage }
      );
    } else {
      await appStore.moveStage(applicationId, toStage, {
        note,
        operatorId: auth.userName,
        jobType: selectedJob.value?.type || selectedJob.value?.jobType,
      });
    }

    dialogVisible.value = false;
    pendingTransition.value = null;

    await refreshBoard();
  } catch (err) {
    console.error('[PipelinePage] 流转失败:', err.message);
    if (isVersionConflict(err)) {
      toast.error('操作冲突：数据已被其他用户修改，页面将自动刷新获取最新数据。');
    } else {
      toast.error('流转失败：' + safeErrorMsg(err));
    }
    refreshBoard();
  }
}

function handleTransitionCancel() {
  dialogVisible.value = false;
  pendingTransition.value = null;
  refreshBoard();
}

async function refreshBoard() {
  await Promise.all([
    loadApplications(),
    loadUnassigned(),
  ]);
}

function handleCardClick({ candidate, application }) {
  router.push(`/candidates/${candidate._id}`);
}

// 岗位切换
watch(selectedJobId, () => {
  applications.value = [];
  refreshBoard();
});

onMounted(() => {
  loadJobs();
  loadUnassigned();
});
</script>

<template>
  <div class="pipeline-page">
    <!-- 顶部工具栏 -->
    <div class="pipeline-toolbar">
      <div class="toolbar-left">
        <h2 class="page-title">招聘看板</h2>
        <div class="job-selector">
          <select
            v-model="selectedJobId"
            class="form-select job-select"
            :disabled="jobs.length === 0"
          >
            <option value="" disabled>选择岗位...</option>
            <option v-for="job in jobs" :key="job._id" :value="job._id">
              {{ job.title || job.name || job._id }}
            </option>
          </select>
          <span class="job-count" v-if="selectedJobId">
            {{ applications.length }} 人
          </span>
        </div>
      </div>

      <div class="toolbar-right">
        <button
          v-if="!batchSelection.selectionMode.value"
          class="btn btn-sm btn-secondary"
          @click="batchSelection.selectAll(applications.map(a => a._id))"
          :disabled="applications.length === 0"
          title="进入批量选择模式"
        >
          ☐ 批量选择
        </button>
        <button
          v-if="batchSelection.selectionMode.value"
          class="btn btn-sm btn-primary"
          @click="batchSelection.clear()"
        >
          取消选择 ({{ batchSelection.count.value }})
        </button>
        <button
          class="btn btn-sm btn-secondary"
          @click="refreshBoard"
          :disabled="loading"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
          </svg>
          刷新
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="pipeline-error">
      {{ error }}
      <button class="btn btn-sm btn-secondary" @click="refreshBoard">重试</button>
    </div>

    <!-- 未分配岗位候选人提示 -->
    <div v-if="unassignedApps.length > 0" class="unassigned-banner">
      <div class="unassigned-header">
        <div class="unassigned-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <strong>{{ unassignedApps.length }}</strong> 位候选人待分配岗位
          <span class="unassigned-hint">（来自邮箱导入，需分配岗位后进入看板）</span>
        </div>
      </div>
      <div class="unassigned-list">
        <div
          v-for="app in unassignedApps.slice(0, 5)"
          :key="app._id"
          class="unassigned-chip"
        >
          <span class="unassigned-name">{{ unassignedCandidatesMap[app.candidateId]?.name || '未命名' }}</span>
          <span class="unassigned-pos">{{ unassignedCandidatesMap[app.candidateId]?.expectedPosition || '未知岗位' }}</span>
          <button
            v-if="selectedJobId"
            class="btn btn-xs btn-primary"
            @click="quickAssignToJob(app._id, app.candidateId)"
          >
            分配到此岗位
          </button>
        </div>
        <div v-if="unassignedApps.length > 5" class="unassigned-more">
          还有 {{ unassignedApps.length - 5 }} 位，请前往
          <router-link to="/candidates">候选人库</router-link>
          查看
        </div>
      </div>
    </div>

    <!-- 看板区域 -->
    <div class="pipeline-board-container">
      <!-- 无岗位提示 -->
      <div v-if="jobs.length === 0" class="card card-solid empty-state" style="margin: var(--spacing-xl) 0;">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">暂无活跃岗位</div>
        <p class="text-muted">请先在设置中创建招聘岗位</p>
      </div>

      <!-- P3-33：移动端列表视图 — 屏幕宽度 < 768px 时降级 -->
      <div v-else-if="selectedJobId && isMobile" class="mobile-pipeline-list">
        <!-- 阶段筛选 -->
        <div class="mobile-stage-filter">
          <select v-model="mobileStageFilter" class="form-select">
            <option value="all">全部阶段 ({{ applications.length }})</option>
            <option v-for="st in visibleStages" :key="st.key" :value="st.key">
              {{ st.label }} ({{ countAppsByStage(st.key) }})
            </option>
          </select>
        </div>

        <!-- 候选人列表 -->
        <div v-if="filteredMobileApps.length === 0" class="mobile-empty">
          <p>此阶段暂无候选人</p>
        </div>
        <div v-else class="mobile-app-list">
          <div
            v-for="app in filteredMobileApps"
            :key="app._id"
            class="mobile-app-card"
            @click="handleCardClick(app)"
          >
            <div class="mobile-card-main">
              <span class="mobile-card-name">{{ candidatesMap[app.candidateId]?.name || '未命名' }}</span>
              <span class="mobile-card-stage">{{ stageLabel(app.stage) }}</span>
            </div>
            <div class="mobile-card-meta">
              <span v-if="candidatesMap[app.candidateId]?.phone">{{ candidatesMap[app.candidateId]?.phone }}</span>
              <span v-if="!candidatesMap[app.candidateId]?.phone" class="text-muted">无联系方式</span>
              <span class="mobile-card-date">{{ fmtMobileDate(app.stageEnteredAt) }}</span>
            </div>
            <!-- 快捷操作 -->
            <div class="mobile-card-actions" @click.stop>
              <select
                class="form-select form-select-xs"
                @change="(e) => { if (e.target.value) handleCardQuickMove(app, e.target.value); e.target.value = ''; }"
              >
                <option value="">移至…</option>
                <option v-for="st in visibleStages.filter(s => !s.isEnd && s.key !== app.stage)" :key="st.key" :value="st.key">
                  {{ st.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 桌面端看板 -->
      <KanbanBoard
        v-else-if="selectedJobId && !isMobile"
        :stages="visibleStages"
        :applications="applications"
        :candidates-map="candidatesMap"
        :job="selectedJob"
        :loading="loading"
        :selection-mode="batchSelection.selectionMode.value"
        :selected-ids="batchSelection.selectedIds.value"
        @card-move="handleCardMove"
        @card-click="handleCardClick"
        @card-quick-move="handleCardQuickMove"
        @toggle-select="onToggleSelect"
      />

      <!-- 批量操作栏 -->
      <BatchActionBar
        :selected-apps="batchSelection.getSelectedList(applications)"
        :candidates-map="candidatesMap"
        :job="selectedJob"
        :operator-id="auth.userName"
        @done="onBatchDone"
        @cancel="onBatchCancel"
      />
    </div>

    <!-- 流转确认弹窗 -->
    <StageTransitionDialog
      :visible="dialogVisible"
      :candidate="selectedCandidate"
      :application="selectedApplication"
      :job="selectedJob"
      :from-stage="pendingTransition?.fromStage || ''"
      :to-stage="pendingTransition?.toStage || ''"
      :end-stage="pendingTransition?.endStage || ''"
      @confirm="handleTransitionConfirm"
      @cancel="handleTransitionCancel"
    />
  </div>
</template>

<style scoped>
.pipeline-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 130px);
  max-width: 100%;
  overflow-y: auto;
}

/* === 工具栏 === */
.pipeline-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
  margin: 0;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.job-selector {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.job-select {
  width: 200px;
}

.job-count {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  white-space: nowrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* === 未分配候选人提示 === */
.unassigned-banner {
  background: var(--warning-bg);
  border: 1px solid var(--warning);
  border-radius: var(--radius);
  padding: var(--spacing-sm) var(--spacing-md);
  margin-bottom: var(--spacing-md);
  flex-shrink: 0;
}

.unassigned-header {
  margin-bottom: var(--spacing-xs);
}

.unassigned-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--gray-700);
}

.unassigned-hint {
  font-weight: 400;
  color: var(--gray-400);
  font-size: var(--font-size-xs);
}

.unassigned-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  align-items: center;
}

.unassigned-chip {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  padding: 4px 8px 4px 14px;
  font-size: var(--font-size-xs);
}

.unassigned-name {
  font-weight: 600;
  color: var(--gray-700);
}

.unassigned-pos {
  color: var(--gray-400);
}

.unassigned-more {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  padding: 4px 8px;
}

.unassigned-more a {
  color: var(--primary);
  text-decoration: underline;
}

.btn-xs {
  padding: 3px 10px;
  font-size: 11px;
  border-radius: var(--radius-full);
  white-space: nowrap;
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
  margin-bottom: var(--spacing-md);
  flex-shrink: 0;
}

/* === 看板容器 === */
.pipeline-board-container {
  flex: 1;
  min-height: 0;
}

/* P3-33：移动端列表视图 */
.mobile-pipeline-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-xl);
}

.mobile-stage-filter {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: var(--spacing-sm);
  background: var(--gray-25);
  border-bottom: 1px solid var(--gray-100);
}

.mobile-stage-filter .form-select {
  width: 100%;
  padding: 10px var(--spacing-md);
  font-size: var(--font-size-md);
  border-radius: var(--radius-sm);
}

.mobile-empty {
  text-align: center;
  padding: var(--spacing-2xl);
  color: var(--gray-400);
}

.mobile-app-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mobile-app-card {
  background: #fff;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.mobile-app-card:active {
  background: var(--gray-25);
}

.mobile-card-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mobile-card-name {
  font-weight: 600;
  font-size: var(--font-size-md);
  color: var(--gray-800);
}

.mobile-card-stage {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  background: var(--gray-100);
  border-radius: 10px;
  color: var(--gray-600);
  white-space: nowrap;
}

.mobile-card-meta {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--gray-500);
}

.mobile-card-date {
  color: var(--gray-400);
}

.mobile-card-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--gray-50);
}

.mobile-card-actions .form-select-xs {
  font-size: var(--font-size-xs);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
</style>
