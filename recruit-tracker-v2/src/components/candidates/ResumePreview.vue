<script setup>
/**
 * ResumePreview.vue — 简历原文预览组件（从 CandidateDetailPage 提取）
 *
 * Props: candidate 对象（含 fileId, fileName, sourceEmailFrom）
 * 支持 PDF/DOCX/图片/文本的在线预览和下载
 */
import { ref, watch } from 'vue';
import cloudbase from '../../services/cloudbase';
import { useAuthStore } from '../../stores/useAuthStore';
import DOMPurify from 'dompurify';
import mammoth from 'mammoth';

const props = defineProps({
  candidate: { type: Object, default: () => ({}) },
});

const auth = useAuthStore();

// ===== 状态 =====
const fileUrl = ref('');
const fileLoading = ref(false);
const fileError = ref('');
const filePreviewType = ref('');
const docxHtml = ref('');

// ===== 魔数签名表 =====
const MAGIC_SIGNATURES = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf', type: 'pdf' },
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', type: 'docx', needsExtCheck: true },
  { bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png', type: 'image' },
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg', type: 'image' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif', type: 'image' },
  { bytes: [0x42, 0x4D], mime: 'image/bmp', type: 'image' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp', type: 'image', needsExtCheck: true },
];

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

// ===== 文件类型检测 =====
function detectTypeByMagic(firstBytes) {
  for (const sig of MAGIC_SIGNATURES) {
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (firstBytes[i] !== sig.bytes[i]) { match = false; break; }
    }
    if (match) {
      if (sig.needsExtCheck && sig.type === 'docx') continue;
      return sig;
    }
  }
  return null;
}

function previewTypeFromMime(mimeType, ext) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mimeType.includes('officedocument.wordprocessingml')) return 'docx';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/')) return 'text';
  return 'unknown';
}

function detectFileType(fileName, cloudContentType, firstBytes) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  if (ext && extMimeMap[ext]) {
    const mime = extMimeMap[ext];
    return { mimeType: mime, ext, previewType: previewTypeFromMime(mime, ext) };
  }
  const isGenericCloud = !cloudContentType || cloudContentType === 'application/octet-stream' || cloudContentType === 'binary/octet-stream';
  if (!isGenericCloud) {
    return { mimeType: cloudContentType, ext, previewType: previewTypeFromMime(cloudContentType, ext) };
  }
  if (firstBytes && firstBytes.length >= 4) {
    const magic = detectTypeByMagic(firstBytes);
    if (magic) return { mimeType: magic.mime, ext, previewType: magic.type };
  }
  return { mimeType: 'application/octet-stream', ext, previewType: 'unknown' };
}

// ===== 文件加载与预览 =====
async function loadFileUrl() {
  if (!props.candidate?.fileId) return;
  fileLoading.value = true;
  fileError.value = '';
  filePreviewType.value = '';
  docxHtml.value = '';

  try {
    const result = await cloudbase.callFunction('get-file-url', {
      fileId: props.candidate.fileId,
      callerUsername: auth.currentUsername,
    });
    if (!result?.success) throw new Error(result?.error || '获取文件失败');

    const binaryStr = atob(result.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const firstBytes = bytes.slice(0, 8);
    const typeInfo = detectFileType(props.candidate.fileName, result.contentType, firstBytes);
    filePreviewType.value = typeInfo.previewType;

    if (typeInfo.previewType === 'docx') {
      const docxResult = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
      docxHtml.value = DOMPurify.sanitize(docxResult.value, {
        ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','table','thead','tbody','tr','th','td','strong','em','b','i','u','s','span','div','img','a','blockquote','pre','code','sub','sup'],
        ALLOWED_ATTR: ['src','alt','width','height','href','title','style','class','id'],
      });
      if (fileUrl.value?.startsWith('blob:')) URL.revokeObjectURL(fileUrl.value);
      const blob = new Blob([bytes], { type: typeInfo.mimeType });
      fileUrl.value = URL.createObjectURL(blob);
    } else if (typeInfo.previewType === 'pdf' || typeInfo.previewType === 'image' || typeInfo.previewType === 'text') {
      if (fileUrl.value?.startsWith('blob:')) URL.revokeObjectURL(fileUrl.value);
      const blob = new Blob([bytes], { type: typeInfo.mimeType });
      fileUrl.value = URL.createObjectURL(blob);
    } else {
      if (fileUrl.value?.startsWith('blob:')) URL.revokeObjectURL(fileUrl.value);
      const blob = new Blob([bytes], { type: typeInfo.mimeType });
      fileUrl.value = URL.createObjectURL(blob);
      filePreviewType.value = 'unknown';
    }
  } catch (err) {
    console.error('[ResumePreview] 加载文件失败:', err);
    fileError.value = err.message;
  } finally {
    fileLoading.value = false;
  }
}

function downloadResume() {
  const doDownload = () => {
    if (!fileUrl.value) return;
    const a = document.createElement('a');
    a.href = fileUrl.value;
    a.download = props.candidate?.fileName || 'resume';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  if (fileUrl.value) {
    doDownload();
  } else {
    loadFileUrl().then(() => { if (fileUrl.value) doDownload(); });
  }
}

// 外部可调用：当切换到简历 Tab 时自动加载
defineExpose({ loadFileUrl });

// 清理 blob URL
import { onBeforeUnmount } from 'vue';
onBeforeUnmount(() => {
  if (fileUrl.value?.startsWith('blob:')) URL.revokeObjectURL(fileUrl.value);
});
</script>

<template>
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
        <span class="card-header-meta" v-if="candidate.fileName">{{ candidate.fileName }}</span>
        <span class="card-header-meta" v-if="candidate.sourceEmailFrom">来自：{{ candidate.sourceEmailFrom }}</span>
      </div>
    </div>
    <div class="card-body">
      <!-- 原始文件预览 -->
      <div v-if="candidate.fileId" class="resume-preview">
        <div v-if="fileLoading" class="resume-preview-placeholder">
          <span class="spinner"></span>
          <span>加载文件中...</span>
        </div>

        <iframe v-else-if="filePreviewType === 'pdf' && fileUrl" :src="fileUrl" class="resume-iframe" frameborder="0"></iframe>

        <div v-else-if="filePreviewType === 'docx' && docxHtml" class="resume-docx-preview" v-html="docxHtml"></div>

        <div v-else-if="filePreviewType === 'image' && fileUrl" class="resume-image-preview">
          <img :src="fileUrl" :alt="candidate.fileName || '简历图片'" class="resume-image" />
        </div>

        <iframe v-else-if="filePreviewType === 'text' && fileUrl" :src="fileUrl" class="resume-iframe resume-text-iframe" frameborder="0"></iframe>

        <div v-else-if="filePreviewType === 'unknown' && fileUrl" class="resume-preview-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--gray-300);">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p style="font-weight: 600; color: var(--gray-500); margin: 0;">{{ candidate.fileName || '未知文件类型' }}</p>
          <p style="color: var(--gray-400); font-size: var(--font-size-sm); margin: 0;">此文件格式不支持在线预览，请下载后查看</p>
        </div>

        <div v-else-if="fileError" class="resume-preview-placeholder">
          <p class="text-danger">{{ fileError }}</p>
          <button class="btn btn-sm btn-secondary" @click="loadFileUrl">重新加载</button>
        </div>

        <div v-else class="resume-preview-placeholder">
          <span style="color: var(--gray-400);">点击上方「下载原始简历」按钮或刷新页面加载预览</span>
        </div>
      </div>

      <!-- 提取文本（折叠） -->
      <details v-if="candidate.resumeRawText" class="resume-text-details">
        <summary>📄 提取文本（AI 解析用）</summary>
        <pre class="resume-raw">{{ candidate.resumeRawText }}</pre>
      </details>

      <div v-if="!candidate.fileId && !candidate.resumeRawText" class="empty-state" style="padding: var(--spacing-xl);">
        <div class="empty-state-text">简历原文不可用</div>
        <p class="text-muted" style="font-size: var(--font-size-xs);">该候选人创建时未保留原始简历文件</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 简历预览样式（从 CandidateDetailPage 提取） */
.resume-preview { position: relative; min-height: 200px; }
.resume-preview-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: var(--spacing-2xl); color: var(--gray-400);
  font-size: var(--font-size-sm);
}
.resume-iframe { width: 100%; height: 70vh; border: none; border-radius: var(--radius-sm); background: #fff; }
.resume-text-iframe { height: 400px; }
.resume-docx-preview {
  max-width: 800px; margin: 0 auto; padding: var(--spacing-lg);
  background: #fff; border: 1px solid var(--gray-100); border-radius: var(--radius-sm);
  font-size: var(--font-size-base); line-height: 1.8; color: var(--gray-800);
}
.resume-docx-preview :deep(img) { max-width: 100%; }
.resume-image-preview { text-align: center; }
.resume-image { max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: var(--radius-sm); }
.resume-text-details { margin-top: var(--spacing-md); }
.resume-text-details summary { cursor: pointer; font-size: var(--font-size-sm); color: var(--primary); font-weight: 500; }
.resume-raw {
  margin-top: var(--spacing-sm); padding: var(--spacing-md);
  background: var(--gray-25); border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm); font-size: var(--font-size-xs);
  white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto;
}
.card-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.card-header-title { font-weight: 600; font-size: var(--font-size-md); color: var(--gray-700); }
.card-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-header-meta { font-size: var(--font-size-xs); color: var(--gray-400); }
.card-body { padding: var(--spacing-md); }
.empty-state { text-align: center; }
.empty-state-text { font-size: var(--font-size-lg); font-weight: 600; color: var(--gray-400); }
.text-danger { color: var(--danger); }
.text-muted { color: var(--gray-400); }
.spinner {
  display: inline-block; width: 24px; height: 24px;
  border: 3px solid var(--gray-200); border-top-color: var(--primary);
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
