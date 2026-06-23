<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人详情 */

import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCandidateStore } from '../stores/useCandidateStore';
import { useApplicationStore } from '../stores/useApplicationStore';
import { useJobStore } from '../stores/useJobStore';
import { useAuthStore } from '../stores/useAuthStore';
import cloudbase from '../services/cloudbase';
import { captureError } from '../services/error-capture';
import { getCommunications } from '../services/communication';
import { safeErrorMsg } from '../services/error-messages';
import { formatDateISO } from '../services/format-utils';
import { isVersionConflict } from '../services/optimistic-lock';
import { useToast } from '../composables/useToast';
import { FUNNEL_STAGES, JOB_TYPES, END_REASONS } from '../config/constants';
import CommunicationLog from '../components/candidates/CommunicationLog.vue';
import AssignDemandDialog from '../components/candidates/AssignDemandDialog.vue';
import ResumePreview from '../components/candidates/ResumePreview.vue';

const route = useRoute();
const router = useRouter();
const candidateStore = useCandidateStore();
const appStore = useApplicationStore();
const jobStore = useJobStore();
const auth = useAuthStore();
const db = cloudbase.db;
const toast = useToast();

// ===== 状态 =====
const loading = ref(false);
const error = ref('');
const candidate = ref(null);
const applications = ref([]);
const communications = ref([]);
const auditLogs = ref([]);
const jobsMap = ref({});

const activeTab = ref('basic');
const editing = ref(false);
const editForm = ref({});
const saving = ref(false);

// P2-17：简历预览组件引用
const resumePreviewRef = ref(null);

// 🆕 关联招聘需求弹窗
const assignDemandVisible = ref(false);
const assignDemandAppId = ref('');

// ===== 计算属性 =====
const candidateId = computed(() => route.params.id);

/** 当前关联的招聘需求（取第一个 Application 的 demandId） */
const currentDemand = computed(() => {
  const app = applications.value[0];
  if (!app?.demandId) return null;
  return {
    demandId: app.demandId,
    demandTitle: app.demandTitle || '',
  };
});

/** 当前 Application ID（用于修改关联） */
const currentAppId = computed(() => {
  return applications.value[0]?._id || '';
});

const tabs = [
  { key: 'basic', label: '基本信息' },
  { key: 'resume', label: '简历原文' },
  { key: 'applications', label: '申请记录' },
  { key: 'communications', label: '沟通记录' },
  { key: 'logs', label: '操作日志' },
];

const stageLabelMap = computed(() => {
  const map = {};
  for (const s of FUNNEL_STAGES) {
    map[s.key] = s.label;
  }
  return map;
});

// 将结束原因 key 转为中文标签（兼容旧数据的英文 key）
function translateEndReason(reason) {
  if (!reason) return '';
  // 如果已经是中文（含汉字），直接返回
  if (/[一-鿿]/.test(reason)) return reason;
  // 在 END_REASONS 中查找对应的中文标签
  for (const type of ['rejected', 'withdrawn']) {
    const reasons = END_REASONS[type] || [];
    const found = reasons.find((r) => r.key === reason);
    if (found) return found.label;
  }
  return reason;
}

const jobTypeOptions = Object.keys(JOB_TYPES);

// 合并顶层字段和 parsedData 降级（兼容旧数据：DeepSeek 结果存在 parsedData 中但未扁平化到顶层）
const display = computed(() => {
  const c = candidate.value;
  if (!c) return {};
  const p = c.parsedData || {};
  const b = p.basic_info || {};

  return {
    // 优先取顶层，没有则从 parsedData 降级
    name: c.name || b.name || '',
    gender: c.gender || b.gender || '',
    phone: c.phone || b.phone || '',
    email: c.email || b.email || '',
    age: c.age || b.age || null,
    city: c.city || b.city || '',
    yearsOfExperience: c.yearsOfExperience || b.years_of_experience || null,
    expectedPosition: c.expectedPosition || p.expected_position || '',
    expectedSalary: c.expectedSalary || p.expected_salary || '',
    selfEvaluation: c.selfEvaluation || p.self_evaluation || '',
    education: c.education?.length ? c.education : (p.education || []),
    workExperience: c.workExperience?.length ? c.workExperience : (p.work_experience || []),
    skills: c.skills?.length ? c.skills : (p.skills || []),
    certificates: c.certificates?.length ? c.certificates : (p.certificates || []),
    resumeRawText: c.resumeRawText || '',
  };
});

// ===== 数据加载 =====
async function loadCandidate() {
  loading.value = true;
  error.value = '';

  try {
    const data = await candidateStore.fetchById(candidateId.value);
    if (!data) {
      error.value = '候选人不存在';
      loading.value = false;
      return;
    }
    candidate.value = data;
  } catch (err) {
    error.value = '加载候选人失败：' + err.message;
    loading.value = false;
    return;
  }

  // 并行加载关联数据
  try {
    await Promise.all([
      loadApplications(),
      loadCommunications(),
      loadAuditLogs(),
    ]);
  } catch { /* 关联数据加载失败不影响主流程 */ }

  loading.value = false;
}

async function loadApplications() {
  try {
    const apps = await appStore.fetchByCandidate(candidateId.value);
    applications.value = apps || [];

    // 加载岗位信息
    for (const app of applications.value) {
      if (app.jobId && !jobsMap.value[app.jobId]) {
        const job = jobStore.getById(app.jobId);
        if (job) jobsMap.value[app.jobId] = job;
      }
    }
  } catch (err) {
    console.warn('[CandidateDetail] 加载申请记录失败:', err.message);
  }
}

async function loadCommunications() {
  try {
    communications.value = await getCommunications(candidateId.value);
  } catch (err) {
    console.warn('[CandidateDetail] 加载沟通记录失败:', err.message);
  }
}

async function loadAuditLogs() {
  try {
    const { data } = await db()
      .collection('AuditLog')
      .where({ entityType: 'Candidate', 'entityIds': candidateId.value })
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    auditLogs.value = data || [];
  } catch (err) {
    console.warn('[CandidateDetail] 加载操作日志失败:', err.message);
    auditLogs.value = [];
  }
}

// ===== 编辑 =====
function startEdit() {
  if (!candidate.value) return;
  editForm.value = {
    name: candidate.value.name || '',
    phone: candidate.value.phone || '',
    email: candidate.value.email || '',
    gender: candidate.value.gender || '',
    age: candidate.value.age || '',
    city: candidate.value.city || '',
    yearsOfExperience: candidate.value.yearsOfExperience || '',
    expectedPosition: candidate.value.expectedPosition || '',
    expectedSalary: candidate.value.expectedSalary || '',
    selfEvaluation: candidate.value.selfEvaluation || '',
  };
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
  editForm.value = {};
}

async function saveEdit() {
  saving.value = true;
  try {
    await candidateStore.update(candidateId.value, {
      ...editForm.value,
      age: editForm.value.age ? Number(editForm.value.age) : undefined,
      yearsOfExperience: editForm.value.yearsOfExperience
        ? Number(editForm.value.yearsOfExperience) : undefined,
    });

    // 写审计日志
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'update_candidate',
        entityType: 'Candidate',
        entityIds: [candidateId.value],
        detail: { updatedFields: Object.keys(editForm.value) },
        operator: auth.userName,
      });
    } catch (e) { captureError('candidate_detail', '候选人更新审计日志写入失败', { message: e.message, context: 'update_candidate' }); }

    // 刷新
    candidate.value = await candidateStore.fetchById(candidateId.value);
    editing.value = false;
  } catch (err) {
    if (isVersionConflict(err)) {
      toast.error('保存失败：数据已被其他用户修改，页面将刷新获取最新数据。');
      // 重新加载数据
      candidate.value = await candidateStore.fetchById(candidateId.value);
      editing.value = false;
    } else {
      toast.error('保存失败：' + safeErrorMsg(err));
    }
  } finally {
    saving.value = false;
  }
}

// ===== 工具方法 =====
// P1-10：formatDate 已替换为共享工具 formatDateISO

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function getStageLabel(stage) {
  return stageLabelMap.value[stage] || stage || '未知';
}

function getStatusLabel(status) {
  const map = {
    active: '进行中',
    rejected: '已淘汰',
    withdrawn: '已放弃',
    duplicate: '重复',
  };
  return map[status] || status;
}

function getStatusClass(status) {
  const map = {
    active: 'badge-info',
    rejected: 'badge-danger',
    withdrawn: 'badge-warning',
    duplicate: 'badge-warning',
  };
  return map[status] || '';
}

function getJobTitle(app) {
  if (app.jobId && jobsMap.value[app.jobId]) {
    return jobsMap.value[app.jobId].title || jobsMap.value[app.jobId].name;
  }
  return '未知岗位';
}

function goBack() {
  router.back();
}

// 🆕 关联需求
function openAssignDemand() {
  assignDemandAppId.value = currentAppId.value;
  assignDemandVisible.value = true;
}

function onDemandAssigned() {
  assignDemandVisible.value = false;
  loadApplications();  // 刷新申请记录以显示新关联
}

// ===== 文件类型检测 =====
// 三层判断：文件名后缀 → 云函数返回的 MIME → 文件内容魔数
// CloudBase 对无扩展名的邮件附件返回 octet-stream，需要魔数兜底

// 魔数签名映射（文件头前几个字节的特征）
// P2-17：切换到简历原文 Tab 时自动触发预览加载
watch(activeTab, (tab) => {
  if (tab === 'resume' && candidate.value?.fileId) {
    resumePreviewRef.value?.loadFileUrl();
  }
});

// ===== 生命周期 =====
onMounted(async () => {
  await jobStore.fetchActive();
  if (candidateId.value) {
    loadCandidate();
  }
});

watch(candidateId, (newId) => {
  if (newId) loadCandidate();
});
</script>

<template>
  <div class="detail-page">
    <!-- 顶部导航 -->
    <div class="detail-header">
      <button class="btn btn-sm btn-ghost back-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        返回
      </button>
      <h2 class="detail-title" v-if="candidate">
        {{ candidate.name || '未命名' }}
      </h2>
      <span class="detail-id" v-if="candidate">ID: {{ candidate._id?.slice(-8) }}</span>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="detail-loading">
      <span class="spinner"></span>
      加载中...
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="detail-error">
      <p>{{ error }}</p>
      <button class="btn btn-sm btn-secondary" @click="loadCandidate">重试</button>
    </div>

    <!-- 内容 -->
    <template v-else-if="candidate">
      <!-- Tab 导航 -->
      <div class="detail-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ===== Tab: 基本信息 ===== -->
      <div v-if="activeTab === 'basic'" class="tab-content">
        <div class="card">
          <div class="card-header">
            <span class="card-header-title">基本信息</span>
            <div class="card-header-actions">
              <!-- 关联需求 -->
              <span v-if="currentDemand" class="demand-tag" title="关联的招聘需求">
                📋 {{ currentDemand.demandTitle }}
              </span>
              <button
                v-if="!editing"
                class="btn btn-sm btn-ghost"
                @click="openAssignDemand"
                title="关联/修改招聘需求"
              >
                {{ currentDemand ? '修改关联' : '关联需求' }}
              </button>
              <button
                v-if="!editing"
                class="btn btn-sm btn-secondary"
                @click="startEdit"
              >
                编辑
              </button>
            </div>
          </div>

          <div class="card-body">
            <!-- 查看模式 -->
            <div v-if="!editing" class="info-grid">
              <div class="info-item">
                <label>姓名</label>
                <span>{{ display.name || '—' }}</span>
              </div>
              <div class="info-item">
                <label>性别</label>
                <span>{{ display.gender || '—' }}</span>
              </div>
              <div class="info-item">
                <label>手机</label>
                <span>{{ display.phone || '—' }}</span>
              </div>
              <div class="info-item">
                <label>邮箱</label>
                <span>{{ display.email || '—' }}</span>
              </div>
              <div class="info-item">
                <label>年龄</label>
                <span>{{ display.age || '—' }}</span>
              </div>
              <div class="info-item">
                <label>城市</label>
                <span>{{ display.city || '—' }}</span>
              </div>
              <div class="info-item">
                <label>工作年限</label>
                <span>{{ display.yearsOfExperience ? display.yearsOfExperience + ' 年' : '—' }}</span>
              </div>
              <div class="info-item">
                <label>来源</label>
                <span>{{ candidate.source || '—' }}</span>
              </div>
              <div class="info-item">
                <label>录入人</label>
                <span>{{ candidate.ownerId || candidate.createdBy || '—' }}</span>
              </div>
              <div class="info-item full-width">
                <label>期望岗位</label>
                <span>{{ display.expectedPosition || '—' }}</span>
              </div>
              <div class="info-item">
                <label>期望薪资</label>
                <span>{{ display.expectedSalary || '—' }}</span>
              </div>
              <div class="info-item full-width">
                <label>自我评价</label>
                <p class="info-textarea">{{ display.selfEvaluation || '—' }}</p>
              </div>
            </div>

            <!-- 编辑模式 -->
            <div v-else class="edit-grid">
              <div class="form-group">
                <label class="form-label">姓名</label>
                <input v-model="editForm.name" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">性别</label>
                <select v-model="editForm.gender" class="form-select">
                  <option value="">未设置</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">手机</label>
                <input v-model="editForm.phone" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">邮箱</label>
                <input v-model="editForm.email" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">年龄</label>
                <input v-model.number="editForm.age" type="number" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">城市</label>
                <input v-model="editForm.city" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">工作年限</label>
                <input v-model.number="editForm.yearsOfExperience" type="number" class="form-input" />
              </div>
              <div class="form-group full-width">
                <label class="form-label">期望岗位</label>
                <input v-model="editForm.expectedPosition" class="form-input" />
              </div>
              <div class="form-group">
                <label class="form-label">期望薪资</label>
                <input v-model="editForm.expectedSalary" class="form-input" />
              </div>
              <div class="form-group full-width">
                <label class="form-label">自我评价</label>
                <textarea v-model="editForm.selfEvaluation" class="form-textarea" rows="3"></textarea>
              </div>

              <div class="edit-actions full-width">
                <button class="btn btn-secondary" @click="cancelEdit" :disabled="saving">取消</button>
                <button class="btn btn-primary" @click="saveEdit" :disabled="saving">
                  {{ saving ? '保存中...' : '保存' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 教育经历 -->
        <div class="card" style="margin-top: var(--spacing-md);" v-if="display.education?.length">
          <div class="card-header">
            <span class="card-header-title">教育经历</span>
          </div>
          <div class="card-body">
            <div
              v-for="(edu, i) in display.education"
              :key="i"
              class="list-item"
            >
              <div class="list-item-main">
                <span class="list-item-title">{{ edu.school }}</span>
                <span class="list-item-sub">{{ edu.major }} · {{ edu.degree }}</span>
              </div>
              <span class="list-item-meta" v-if="edu.start_date || edu.end_date">
                {{ edu.start_date || '?' }} — {{ edu.end_date || '?' }}
              </span>
            </div>
          </div>
        </div>

        <!-- 工作经历 -->
        <div class="card" style="margin-top: var(--spacing-md);" v-if="display.workExperience?.length">
          <div class="card-header">
            <span class="card-header-title">工作经历</span>
          </div>
          <div class="card-body">
            <div
              v-for="(exp, i) in display.workExperience"
              :key="i"
              class="list-item"
            >
              <div class="list-item-main">
                <span class="list-item-title">{{ exp.company }}</span>
                <span class="list-item-sub">{{ exp.position }}</span>
                <p class="list-item-desc" v-if="exp.description">{{ exp.description }}</p>
              </div>
              <span class="list-item-meta" v-if="exp.start_date || exp.end_date">
                {{ exp.start_date || '?' }} — {{ exp.end_date || '至今' }}
              </span>
            </div>
          </div>
        </div>

        <!-- 技能 / 证书 -->
        <div class="info-side-cards" style="margin-top: var(--spacing-md);">
          <div class="card" v-if="display.skills?.length">
            <div class="card-header">
              <span class="card-header-title">技能</span>
            </div>
            <div class="card-body">
              <div class="tag-list">
                <span v-for="(skill, i) in display.skills" :key="i" class="tag-chip">{{ skill }}</span>
              </div>
            </div>
          </div>

          <div class="card" v-if="display.certificates?.length">
            <div class="card-header">
              <span class="card-header-title">证书</span>
            </div>
            <div class="card-body">
              <div class="tag-list">
                <span v-for="(cert, i) in display.certificates" :key="i" class="tag-chip cert">{{ cert }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== P2-17：简历原文 Tab（提取为独立组件） ===== -->
      <div v-if="activeTab === 'resume'" class="tab-content">
        <ResumePreview :candidate="candidate" ref="resumePreviewRef" />
      </div>

      <!-- ===== Tab: 申请记录 ===== -->
      <div v-if="activeTab === 'applications'" class="tab-content">
        <div v-if="applications.length === 0" class="card">
          <div class="empty-state" style="padding: var(--spacing-xl);">
            <div class="empty-state-text">暂无申请记录</div>
          </div>
        </div>

        <div v-for="app in applications" :key="app._id" class="card app-card">
          <div class="card-header">
            <div class="app-header-left">
              <span class="app-job-title">{{ getJobTitle(app) }}</span>
              <span class="badge" :class="getStatusClass(app.status)">
                {{ getStatusLabel(app.status) }}
              </span>
              <span class="badge badge-info">{{ getStageLabel(app.stage) }}</span>
            </div>
            <span class="card-header-meta">
              创建于 {{ formatDateISO(app.createdAt) }}
            </span>
          </div>
          <div class="card-body">
            <!-- 漏斗时间线 -->
            <div class="funnel-mini" v-if="app.funnel">
              <div
                v-for="stage in FUNNEL_STAGES"
                :key="stage.key"
                class="funnel-step"
              >
                <div
                  class="funnel-dot"
                  :class="{
                    filled: app.funnel[getFunnelKey(stage.key)],
                    current: app.stage === stage.key,
                  }"
                ></div>
                <span
                  class="funnel-label"
                  :class="{ current: app.stage === stage.key }"
                >{{ stage.label }}</span>
                <span
                  class="funnel-date"
                  v-if="app.funnel[getFunnelKey(stage.key)]"
                >{{ formatDateISO(app.funnel[getFunnelKey(stage.key)]) }}</span>
              </div>
            </div>

            <!-- 流转历史 -->
            <div v-if="app.history?.length" class="history-section">
              <span class="history-title">流转历史</span>
              <div
                v-for="(h, i) in app.history"
                :key="i"
                class="history-item"
              >
                <span class="history-arrow">{{ getStageLabel(h.fromStage) }} → {{ getStageLabel(h.toStage) }}</span>
                <span class="history-time">{{ formatDateTime(h.at) }}</span>
                <span class="history-note" v-if="h.note">{{ h.note }}</span>
              </div>
            </div>

            <!-- 结束原因 -->
            <div v-if="app.endReason" class="end-reason">
              <span class="end-label">{{ app.status === 'rejected' ? '淘汰原因：' : '放弃原因：' }}</span>
              {{ translateEndReason(app.endReason) }}
            </div>
          </div>
        </div>
      </div>

      <!-- ===== Tab: 沟通记录 ===== -->
      <div v-if="activeTab === 'communications'" class="tab-content">
        <CommunicationLog
          :communications="communications"
          :candidate-id="candidateId"
          :operator="auth.userName"
          @updated="loadCommunications"
        />
      </div>

      <!-- ===== Tab: 操作日志 ===== -->
      <div v-if="activeTab === 'logs'" class="tab-content">
        <div class="card">
          <div class="card-body">
            <div v-if="auditLogs.length === 0" class="empty-state" style="padding: var(--spacing-xl);">
              <div class="empty-state-text">暂无操作日志</div>
            </div>
            <div v-else class="audit-list">
              <div v-for="log in auditLogs" :key="log._id" class="audit-item">
                <span class="audit-action">{{ log.action }}</span>
                <span class="audit-operator">{{ log.operator }}</span>
                <span class="audit-time">{{ formatDateTime(log.timestamp) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 🆕 关联招聘需求弹窗 -->
    <AssignDemandDialog
      v-if="assignDemandVisible"
      :candidate-id="candidateId"
      :candidate-name="candidate?.name || ''"
      :existing-app-id="assignDemandAppId"
      @assigned="onDemandAssigned"
      @close="assignDemandVisible = false"
    />
  </div>
</template>

<script>
/* 辅助函数：stage key → funnel 时间戳字段 */
function getFunnelKey(stage) {
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
</script>

<style scoped>
.detail-page {
  max-width: 960px;
}

/* === 顶部 === */
.detail-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.back-btn {
  flex-shrink: 0;
}

.detail-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
  margin: 0;
}

.detail-id {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  font-family: monospace;
}

.detail-loading {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-2xl);
  color: var(--gray-400);
}

.detail-error {
  padding: var(--spacing-lg);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-error p {
  margin: 0;
}

/* === Tab === */
.detail-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--gray-100);
  margin-bottom: var(--spacing-lg);
}

.tab-btn {
  padding: 10px 20px;
  border: none;
  background: transparent;
  color: var(--gray-400);
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  font-family: inherit;
}

.tab-btn:hover {
  color: var(--gray-600);
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}

.tab-content {
  min-height: 300px;
}

/* === 基本信息网格 === */
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--gray-400);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.info-item span {
  font-size: var(--font-size-base);
  color: var(--gray-700);
}

.info-item.full-width {
  grid-column: 1 / -1;
}

.info-textarea {
  font-size: var(--font-size-base);
  color: var(--gray-600);
  line-height: 1.6;
  margin: 0;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

.form-group.full-width {
  grid-column: 1 / -1;
}

/* === 列表项（教育/工作）=== */
.list-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--gray-50);
}

.list-item:last-child {
  border-bottom: none;
}

.list-item-main {
  flex: 1;
}

.list-item-title {
  font-weight: 600;
  color: var(--gray-700);
  display: block;
}

.list-item-sub {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  display: block;
  margin-top: 2px;
}

.list-item-desc {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  margin: 4px 0 0;
  line-height: 1.4;
}

.list-item-meta {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  white-space: nowrap;
  margin-left: var(--spacing-md);
}

/* === 标签云 === */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-chip {
  padding: 4px 12px;
  background: var(--primary-bg);
  color: var(--primary);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.tag-chip.cert {
  background: var(--success-bg);
  color: var(--success);
}

/* 卡片头操作区 */
.card-header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* === 卡片头复用 === */
.card-header-title {
  font-weight: 600;
  font-size: var(--font-size-base);
  color: var(--gray-700);
}

.card-header-meta {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

/* 需求关联标签 */
.demand-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px;
  background: var(--primary-bg); color: var(--primary);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs); font-weight: 500;
}

/* === 申请卡片 === */
.app-card {
  margin-bottom: var(--spacing-md);
}

.app-header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.app-job-title {
  font-weight: 600;
  color: var(--gray-700);
}

/* === 漏斗迷你图 === */
.funnel-mini {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  align-items: flex-start;
  margin-bottom: var(--spacing-md);
}

.funnel-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 60px;
}

.funnel-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--gray-100);
  border: 2px solid var(--gray-200);
  margin-bottom: 4px;
}

.funnel-dot.filled {
  background: var(--success);
  border-color: var(--success);
}

.funnel-dot.current {
  background: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 0 0 4px var(--primary-bg);
}

.funnel-label {
  font-size: 10px;
  color: var(--gray-300);
  text-align: center;
  line-height: 1.2;
}

.funnel-label.current {
  color: var(--primary);
  font-weight: 600;
}

.funnel-date {
  font-size: 9px;
  color: var(--gray-300);
  margin-top: 2px;
}

/* === 流转历史 === */
.history-section {
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--gray-50);
}

.history-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--gray-400);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.history-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 6px 0;
  font-size: var(--font-size-sm);
}

.history-arrow {
  color: var(--gray-500);
  font-weight: 500;
}

.history-time {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
}

.history-note {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

/* === 结束原因 === */
.end-reason {
  margin-top: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.end-label {
  font-weight: 600;
}

/* === 操作日志 === */
.audit-list {
  display: flex;
  flex-direction: column;
}

.audit-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 8px 0;
  border-bottom: 1px solid var(--gray-50);
  font-size: var(--font-size-sm);
}

.audit-item:last-child {
  border-bottom: none;
}

.audit-action {
  font-weight: 500;
  color: var(--gray-600);
}

.audit-operator {
  color: var(--gray-400);
}

.audit-time {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--gray-300);
}

/* === 边栏卡片 === */
.info-side-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

@media (max-width: 600px) {
  .info-side-cards {
    grid-template-columns: 1fr;
  }
}
</style>
