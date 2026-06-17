<script setup>
/* 新励成招聘管理系统 V2.0 — 简历上传组件 */

import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, UPLOAD_MAX_SIZE } from '../../config/constants';

const props = defineProps({
  maxSize: { type: Number, default: UPLOAD_MAX_SIZE },
  acceptFormats: { type: Array, default: () => ALLOWED_EXTENSIONS },
  multiple: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits([
  'files-ready',      // 文件校验通过
  'extract-progress',  // 提取进度
  'extract-done',      // 提取完成
  'extract-error',     // 提取失败
]);

// 状态
const dragOver = ref(false);
const files = ref([]);
const errors = ref([]);
const extracting = ref(false);
const progress = ref(0);

// 隐藏的 file input
const fileInputRef = ref(null);

// 格式校验白名单（MIME + 扩展名）
const acceptAttr = computedAcceptAttr();

function computedAcceptAttr() {
  // 生成 input[accept] 属性值
  const mimes = ALLOWED_MIME_TYPES.filter(m => !m.includes('rar') && !m.includes('zip'));
  const exts = ALLOWED_EXTENSIONS.map(e => e);
  return [...mimes, ...exts].join(',');
}

// ===== 文件校验 =====

function validateFile(file) {
  const errs = [];

  // 大小校验
  if (file.size > props.maxSize) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    const maxMB = (props.maxSize / 1024 / 1024).toFixed(0);
    errs.push(`"${file.name}" 大小为 ${sizeMB}MB，超过 ${maxMB}MB 限制`);
  }

  // 空文件
  if (file.size === 0) {
    errs.push(`"${file.name}" 是空文件`);
  }

  // 格式校验：先按 MIME，再按扩展名
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  const mimeOk = ALLOWED_MIME_TYPES.includes(file.type);
  const extOk = ALLOWED_EXTENSIONS.includes(ext);

  if (!mimeOk && !extOk) {
    errs.push(`不支持 "${file.name}" 的文件格式（${file.type || ext}）`);
  }

  return errs;
}

// ===== 事件处理 =====

function onDragEnter(e) {
  if (props.disabled) return;
  e.preventDefault();
  dragOver.value = true;
}

function onDragOver(e) {
  if (props.disabled) return;
  e.preventDefault();
  dragOver.value = true;
}

function onDragLeave(e) {
  dragOver.value = false;
}

function onDrop(e) {
  if (props.disabled) return;
  e.preventDefault();
  dragOver.value = false;

  const droppedFiles = Array.from(e.dataTransfer.files);
  if (droppedFiles.length === 0) return;
  addFiles(droppedFiles);
}

function onClickUpload() {
  if (props.disabled) return;
  fileInputRef.value?.click();
}

function onFileInputChange(e) {
  const selected = Array.from(e.target.files);
  if (selected.length === 0) return;
  addFiles(selected);
  // 重置 input 以允许重复选择同名文件
  e.target.value = '';
}

function onPaste(e) {
  if (props.disabled) return;
  const items = e.clipboardData?.items;
  if (!items) return;

  const pastedFiles = [];
  for (const item of items) {
    if (item.kind === 'file') {
      pastedFiles.push(item.getAsFile());
    }
  }
  if (pastedFiles.length > 0) {
    addFiles(pastedFiles);
  }
}

function addFiles(newFiles) {
  errors.value = [];
  const validFiles = [];

  for (const file of newFiles) {
    const fileErrs = validateFile(file);
    if (fileErrs.length > 0) {
      errors.value.push(...fileErrs);
    } else {
      validFiles.push(file);
    }
  }

  // 单文件模式：只保留最后一个有效文件
  if (!props.multiple && validFiles.length > 0) {
    files.value = [validFiles[validFiles.length - 1]];
  } else if (props.multiple) {
    files.value.push(...validFiles);
  }

  if (files.value.length > 0) {
    emit('files-ready', [...files.value]);
  }
}

function removeFile(index) {
  files.value.splice(index, 1);
  errors.value = [];
}

// 外部调用：设置提取状态
function setExtracting(val, prog = 0) {
  extracting.value = val;
  progress.value = prog;
}

// ===== 生命周期 =====

onMounted(() => {
  document.addEventListener('paste', onPaste);
});

onUnmounted(() => {
  document.removeEventListener('paste', onPaste);
});

defineExpose({ setExtracting, addFiles });
</script>

<template>
  <div class="uploader">
    <!-- 拖拽上传区 -->
    <div
      class="uploader-dropzone"
      :class="{ 'is-dragover': dragOver, 'is-disabled': disabled }"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="onClickUpload"
    >
      <!-- 上传图标 -->
      <div class="uploader-icon">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M24 8v24M16 18l8-10 8 10M8 34v4a4 4 0 004 4h24a4 4 0 004-4v-4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="uploader-text">
        <p class="uploader-title">拖拽简历文件到此处</p>
        <p class="uploader-hint">或 <span class="uploader-link">点击选择</span> / Ctrl+V 粘贴</p>
        <p class="uploader-formats">
          支持 PDF、DOCX、DOC、TXT、PNG、JPG 格式，单文件最大 {{ (maxSize / 1024 / 1024).toFixed(0) }}MB
        </p>
      </div>

      <!-- 隐藏的 file input -->
      <input
        ref="fileInputRef"
        type="file"
        class="uploader-input-hidden"
        :accept="acceptAttr"
        :multiple="multiple"
        @change="onFileInputChange"
      />
    </div>

    <!-- 文件列表 -->
    <div v-if="files.length > 0" class="uploader-file-list">
      <div
        v-for="(file, index) in files"
        :key="index"
        class="uploader-file-card"
      >
        <div class="uploader-file-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div class="uploader-file-info">
          <span class="uploader-file-name">{{ file.name }}</span>
          <span class="uploader-file-size">{{ (file.size / 1024).toFixed(1) }} KB</span>
        </div>
        <span class="uploader-file-badge">{{ file.name.split('.').pop().toUpperCase() }}</span>
        <button
          v-if="!extracting"
          class="uploader-file-remove"
          @click.stop="removeFile(index)"
          title="移除文件"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 提取进度 -->
    <div v-if="extracting" class="uploader-progress">
      <div class="uploader-progress-bar">
        <div class="uploader-progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <span class="uploader-progress-text">{{ progress < 100 ? '正在提取文本...' : '提取完成' }}</span>
    </div>

    <!-- 错误提示 -->
    <div v-if="errors.length > 0" class="uploader-errors">
      <div v-for="(msg, i) in errors" :key="i" class="uploader-error-item">
        <svg viewBox="0 0 24 24" fill="currentColor" class="uploader-error-icon">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
        {{ msg }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.uploader {
  width: 100%;
}

/* === 拖拽区 === */
.uploader-dropzone {
  border: 2px dashed var(--gray-200);
  border-radius: var(--radius);
  padding: var(--spacing-lg) var(--spacing-lg);
  text-align: center;
  cursor: pointer;
  transition: all var(--transition);
  background: var(--card-bg, #fff);
}

.uploader-dropzone:hover {
  border-color: var(--primary);
  background: var(--primary-bg);
}

.uploader-dropzone.is-dragover {
  border-color: var(--primary);
  background: var(--primary-bg);
  box-shadow: 0 0 0 4px rgba(76, 95, 122, 0.08);
}

.uploader-dropzone.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* === 上传图标 === */
.uploader-icon {
  width: 36px;
  height: 36px;
  margin: 0 auto var(--spacing-xs);
  color: var(--gray-300);
  transition: color var(--transition);
}

.uploader-dropzone:hover .uploader-icon,
.uploader-dropzone.is-dragover .uploader-icon {
  color: var(--primary);
}

.uploader-icon svg {
  width: 100%;
  height: 100%;
}

/* === 文案 === */
.uploader-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--gray-600);
  margin-bottom: var(--spacing-xs);
}

.uploader-hint {
  font-size: var(--font-size-base);
  color: var(--gray-400);
  margin-bottom: var(--spacing-sm);
}

.uploader-link {
  color: var(--primary);
  font-weight: 500;
}

.uploader-formats {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
}

/* === 隐藏 input === */
.uploader-input-hidden {
  display: none;
}

/* === 文件列表 === */
.uploader-file-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.uploader-file-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--card-bg, #fff);
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  transition: box-shadow var(--transition);
}

.uploader-file-card:hover {
  box-shadow: var(--shadow);
}

.uploader-file-icon {
  width: 32px;
  height: 32px;
  color: var(--primary);
  flex-shrink: 0;
}

.uploader-file-icon svg {
  width: 100%;
  height: 100%;
}

.uploader-file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.uploader-file-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--gray-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uploader-file-size {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.uploader-file-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--primary-bg);
  color: var(--primary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.uploader-file-remove {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--gray-300);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
  flex-shrink: 0;
}

.uploader-file-remove:hover {
  color: var(--danger);
  background: var(--danger-bg);
}

.uploader-file-remove svg {
  width: 16px;
  height: 16px;
}

/* === 进度条 === */
.uploader-progress {
  margin-top: var(--spacing-md);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.uploader-progress-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--gray-100);
  overflow: hidden;
}

.uploader-progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.uploader-progress-text {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  flex-shrink: 0;
}

/* === 错误提示 === */
.uploader-errors {
  margin-top: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.uploader-error-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.uploader-error-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
