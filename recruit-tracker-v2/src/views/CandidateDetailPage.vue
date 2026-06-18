<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人详情 */

import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCandidateStore } from '../stores/useCandidateStore';
import { useApplicationStore } from '../stores/useApplicationStore';
import { useJobStore } from '../stores/useJobStore';
import { useAuthStore } from '../stores/useAuthStore';
import cloudbase from '../services/cloudbase';
import { getCommunications } from '../services/communication';
import { FUNNEL_STAGES, JOB_TYPES } from '../config/constants';
import CommunicationLog from '../components/candidates/CommunicationLog.vue';
import mammoth from 'mammoth';

const route = useRoute();
const router = useRouter();
const candidateStore = useCandidateStore();
const appStore = useApplicationStore();
const jobStore = useJobStore();
const auth = useAuthStore();
const db = cloudbase.db;

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

// 原始简历文件预览
const fileUrl = ref('');       // blob: URL，用于 iframe 预览（PDF）或 img（图片）
const fileLoading = ref(false);
const fileError = ref('');
const filePreviewType = ref('');  // 'pdf' | 'docx' | 'image' | 'text' | 'unknown'
const docxHtml = ref('');         // DOCX→HTML 渲染结果

// ===== 计算属性 =====
const candidateId = computed(() => route.params.id);

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
    } catch { /* 审计日志失败不影响 */ }

    // 刷新
    candidate.value = await candidateStore.fetchById(candidateId.value);
    editing.value = false;
  } catch (err) {
    alert('保存失败：' + err.message);
  } finally {
    saving.value = false;
  }
}

// ===== 工具方法 =====
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

// ===== 文件类型检测 =====
// 三层判断：文件名后缀 → 云函数返回的 MIME → 文件内容魔数
// CloudBase 对无扩展名的邮件附件返回 octet-stream，需要魔数兜底

// 魔数签名映射（文件头前几个字节的特征）
const MAGIC_SIGNATURES = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf', type: 'pdf' },
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', type: 'docx', needsExtCheck: true },
  { bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png', type: 'image' },
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg', type: 'image' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif', type: 'image' },
  { bytes: [0x42, 0x4D], mime: 'image/bmp', type: 'image' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp', type: 'image', needsExtCheck: true },
];

function detectTypeByMagic(firstBytes) {
  for (const sig of MAGIC_SIGNATURES) {
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (firstBytes[i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      // ZIP 魔数 (PK\x03\x04) 用于 DOCX 但也匹配 ZIP/RAR 等。
      // 如果 fileName 有扩展名，已在之前被 extMimeMap 匹配；
      // 此处仅做兜底：无扩展名时且魔数为 ZIP → 假定为 DOCX（最常见）
      if (sig.needsExtCheck && sig.type === 'docx') {
        continue; // DOCX 需要由 fileName 后缀判断，魔数匹配 ZIP 不一定就是 DOCX
      }
      return sig;
    }
  }
  return null;
}

const extMimeMap = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  rtf: 'application/rtf',
};

function detectFileType(fileName, cloudContentType, firstBytes) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase();

  // Layer 1：文件名扩展名查表
  if (ext && extMimeMap[ext]) {
    const mime = extMimeMap[ext];
    return { mimeType: mime, ext, previewType: previewTypeFromMime(mime, ext) };
  }

  // Layer 2：云函数返回的非通用 MIME
  const isGenericCloud = !cloudContentType
    || cloudContentType === 'application/octet-stream'
    || cloudContentType === 'binary/octet-stream';
  if (!isGenericCloud) {
    return { mimeType: cloudContentType, ext, previewType: previewTypeFromMime(cloudContentType, ext) };
  }

  // Layer 3：文件内容魔数检测（兜底）
  if (firstBytes && firstBytes.length >= 4) {
    const magic = detectTypeByMagic(firstBytes);
    if (magic) {
      return { mimeType: magic.mime, ext, previewType: magic.type };
    }
  }

  return { mimeType: 'application/octet-stream', ext, previewType: 'unknown' };
}

function previewTypeFromMime(mimeType, ext) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mimeType.includes('officedocument.wordprocessingml')) return 'docx';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/')) return 'text';
  return 'unknown';
}

// 获取云存储文件并生成预览
// 云函数 get-file-url 用管理员身份下载文件 → 返回 base64
// PDF → iframe Blob URL  /  DOCX → mammoth 转 HTML  /  图片 → img  /  其他 → 下载按钮
async function loadFileUrl() {
  if (!candidate.value?.fileId) return;
  fileLoading.value = true;
  fileError.value = '';
  filePreviewType.value = '';
  docxHtml.value = '';

  try {
    // 1. 通过云函数下载文件内容（管理员权限，返回 base64）
    const result = await cloudbase.callFunction('get-file-url', {
      fileId: candidate.value.fileId,
    });
    if (!result?.success) {
      throw new Error(result?.error || '获取文件失败');
    }

    // 2. base64 → 二进制字符串（atob 返回每个字符代表一个字节的字符串）
    const binaryStr = atob(result.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // 3. 提取前几个字节做魔数检测（兜底无扩展名文件）
    const firstBytes = bytes.slice(0, 8);

    // 4. 检测文件真实类型（三层：扩展名 → 云 MIME → 魔数）
    const typeInfo = detectFileType(candidate.value.fileName, result.contentType, firstBytes);
    filePreviewType.value = typeInfo.previewType;

    // 4. 按文件类型生成预览
    if (typeInfo.previewType === 'docx') {
      // DOCX → mammoth 转 HTML（不经过 Blob URL，避免浏览器误判）
      const docxResult = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
      docxHtml.value = docxResult.value;
      // 同时生成 Blob URL 用于下载（下载按钮需要）
      if (fileUrl.value && fileUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(fileUrl.value);
      }
      const blob = new Blob([bytes], { type: typeInfo.mimeType });
      fileUrl.value = URL.createObjectURL(blob);
    } else if (typeInfo.previewType === 'pdf' || typeInfo.previewType === 'image' || typeInfo.previewType === 'text') {
      // PDF / 图片 / 文本 → Blob URL + iframe 或 img
      if (fileUrl.value && fileUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(fileUrl.value);
      }
      const blob = new Blob([bytes], { type: typeInfo.mimeType });
      fileUrl.value = URL.createObjectURL(blob);
    } else {
      // 未知格式 → 只生成下载用 Blob URL，不尝试预览
      if (fileUrl.value && fileUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(fileUrl.value);
      }
      const blob = new Blob([bytes], { type: typeInfo.mimeType });
      fileUrl.value = URL.createObjectURL(blob);
      filePreviewType.value = 'unknown';
    }
  } catch (err) {
    console.error('[CandidateDetail] 加载文件失败:', err);
    fileError.value = err.message;
  } finally {
    fileLoading.value = false;
  }
}

// 下载原始简历文件（用 Blob URL + download 属性确保文件名正确）
function downloadResume() {
  const doDownload = () => {
    if (!fileUrl.value) return;
    const a = document.createElement('a');
    a.href = fileUrl.value;
    a.download = candidate.value?.fileName || 'resume';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (fileUrl.value) {
    doDownload();
  } else {
    loadFileUrl().then(() => {
      if (fileUrl.value) doDownload();
    });
  }
}

// 切换到简历原文 Tab 时自动加载文件链接
watch(activeTab, (tab) => {
  if (tab === 'resume' && candidate.value?.fileId && !fileUrl.value) {
    loadFileUrl();
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
            <button
              v-if="!editing"
              class="btn btn-sm btn-secondary"
              @click="startEdit"
            >
              编辑
            </button>
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

      <!-- ===== Tab: 简历原文 ===== -->
      <div v-if="activeTab === 'resume'" class="tab-content">
        <div class="card">
          <div class="card-header">
            <span class="card-header-title">简历原文</span>
            <div class="card-header-actions">
              <button
                v-if="candidate.fileId"
                class="btn btn-sm btn-primary"
                @click="downloadResume"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                下载原始简历
              </button>
              <span class="card-header-meta" v-if="candidate.fileName">
                {{ candidate.fileName }}
              </span>
              <span class="card-header-meta" v-if="candidate.sourceEmailFrom">
                来自：{{ candidate.sourceEmailFrom }}
              </span>
            </div>
          </div>
          <div class="card-body">
            <!-- 原始文件预览 -->
            <div v-if="candidate.fileId" class="resume-preview">
              <!-- 加载中 -->
              <div v-if="fileLoading" class="resume-preview-placeholder">
                <span class="spinner"></span>
                <span>加载文件中...</span>
              </div>

              <!-- PDF 预览 → iframe（浏览器内置 PDF 查看器） -->
              <iframe
                v-else-if="filePreviewType === 'pdf' && fileUrl"
                :src="fileUrl"
                class="resume-iframe"
                frameborder="0"
              ></iframe>

              <!-- DOCX 预览 → mammoth 转 HTML -->
              <div
                v-else-if="filePreviewType === 'docx' && docxHtml"
                class="resume-docx-preview"
                v-html="docxHtml"
              ></div>

              <!-- 图片预览 -->
              <div v-else-if="filePreviewType === 'image' && fileUrl" class="resume-image-preview">
                <img :src="fileUrl" :alt="candidate.fileName || '简历图片'" class="resume-image" />
              </div>

              <!-- 文本预览 -->
              <iframe
                v-else-if="filePreviewType === 'text' && fileUrl"
                :src="fileUrl"
                class="resume-iframe resume-text-iframe"
                frameborder="0"
              ></iframe>

              <!-- 未知格式 → 显示提示，引导下载 -->
              <div v-else-if="filePreviewType === 'unknown' && fileUrl" class="resume-preview-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--gray-300);">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <p style="font-weight: 600; color: var(--gray-500); margin: 0;">
                  {{ candidate.fileName || '未知文件类型' }}
                </p>
                <p style="color: var(--gray-400); font-size: var(--font-size-sm); margin: 0;">
                  此文件格式不支持在线预览，请下载后查看
                </p>
              </div>

              <!-- 错误 -->
              <div v-else-if="fileError" class="resume-preview-placeholder">
                <p class="text-danger">{{ fileError }}</p>
                <button class="btn btn-sm btn-secondary" @click="loadFileUrl">重新加载</button>
              </div>

              <!-- 初始状态：未加载 -->
              <div v-else class="resume-preview-placeholder">
                <span style="color: var(--gray-400);">点击下方「下载原始简历」按钮或刷新页面加载预览</span>
              </div>
            </div>

            <!-- 提取文本（折叠，AI 解析用） -->
            <details v-if="display.resumeRawText" class="resume-text-details">
              <summary>📄 提取文本（AI 解析用）</summary>
              <pre class="resume-raw">{{ display.resumeRawText }}</pre>
            </details>

            <!-- 什么都没有 -->
            <div v-if="!candidate.fileId && !display.resumeRawText" class="empty-state" style="padding: var(--spacing-xl);">
              <div class="empty-state-text">简历原文不可用</div>
              <p class="text-muted" style="font-size: var(--font-size-xs);">
                该候选人创建时未保留原始简历文件
              </p>
            </div>
          </div>
        </div>
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
              创建于 {{ formatDate(app.createdAt) }}
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
                >{{ formatDate(app.funnel[getFunnelKey(stage.key)]) }}</span>
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
              {{ app.endReason }}
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

/* === 简历原文 === */
.resume-raw {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: var(--font-size-sm);
  color: var(--gray-600);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  margin: 0;
  max-height: 400px;
  overflow-y: auto;
}

/* 卡片头操作区 */
.card-header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* 简历文件预览 */
.resume-preview {
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: var(--spacing-md);
}

.resume-preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  min-height: 200px;
  background: var(--gray-50);
  color: var(--gray-400);
  font-size: var(--font-size-sm);
}

.resume-iframe {
  width: 100%;
  height: 700px;
  border: none;
  background: #fff;
}

.resume-text-iframe {
  height: 400px;
}

/* DOCX → HTML 预览 */
.resume-docx-preview {
  padding: var(--spacing-lg) var(--spacing-xl);
  max-height: 700px;
  overflow-y: auto;
  background: #fff;
  font-size: var(--font-size-sm);
  line-height: 1.8;
  color: var(--gray-700);
}

.resume-docx-preview :deep(h1),
.resume-docx-preview :deep(h2),
.resume-docx-preview :deep(h3) {
  color: var(--gray-800);
  margin-top: var(--spacing-md);
  margin-bottom: var(--spacing-sm);
}

.resume-docx-preview :deep(p) {
  margin: var(--spacing-sm) 0;
}

.resume-docx-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: var(--spacing-sm) 0;
}

.resume-docx-preview :deep(td),
.resume-docx-preview :deep(th) {
  border: 1px solid var(--gray-200);
  padding: 6px 12px;
  font-size: var(--font-size-xs);
}

/* 图片预览 */
.resume-image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: var(--gray-50);
  padding: var(--spacing-md);
}

.resume-image {
  max-width: 100%;
  max-height: 700px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 提取文本折叠区 */
.resume-text-details {
  margin-top: var(--spacing-md);
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.resume-text-details summary {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--gray-50);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  user-select: none;
}

.resume-text-details summary:hover {
  background: var(--gray-100);
}

.resume-text-details .resume-raw {
  padding: var(--spacing-md);
  max-height: 300px;
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
