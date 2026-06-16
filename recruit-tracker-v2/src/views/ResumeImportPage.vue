<script setup>
/* 新励成招聘管理系统 V2.0 — 简历录入页（三步流程编排） */

import { reactive, ref, computed, provide } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/useAuthStore';
import cloudbase from '../services/cloudbase';
import { extractText, parseWithDeepSeek, computeFileHash } from '../services/resume-parser';
import { detectDuplicates } from '../services/duplicate-detector';
import ResumeUploader from '../components/resume/ResumeUploader.vue';
import ParseResultView from '../components/resume/ParseResultView.vue';
import CandidateForm from '../components/resume/CandidateForm.vue';

const router = useRouter();
const auth = useAuthStore();
const db = cloudbase.db();
const storage = cloudbase.storage();

// ===== 流程步骤 =====
const STEPS = {
  UPLOAD: 1,
  EXTRACTING: 2,
  PARSING: 3,
  REVIEW: 4,
  FORM: 5,
};

const currentStep = ref(STEPS.UPLOAD);
const stepLabel = computed(() => {
  const labels = {
    [STEPS.UPLOAD]: '上传简历',
    [STEPS.EXTRACTING]: '提取文本',
    [STEPS.PARSING]: 'AI 解析',
    [STEPS.REVIEW]: '核对修正',
    [STEPS.FORM]: '确认创建',
  };
  return labels[currentStep.value] || '';
});

// ===== 流程数据 =====
const files = ref([]);
const extractedTexts = ref([]);
const parseResult = ref(null);
const parseError = ref('');
const parseLoading = ref(false);
const corrections = ref([]); // 专员修正记录
const duplicates = ref([]);
const submitting = ref(false);

// 文件哈希（用于重复检测第一级）
const fileHash = ref('');

// Uploader 引用
const uploaderRef = ref(null);

// ===== 步骤指示器 =====
const steps = [
  { num: 1, label: '上传文件', key: 'upload' },
  { num: 2, label: '核对解析', key: 'review' },
  { num: 3, label: '确认创建', key: 'form' },
];

const activeStepIndex = computed(() => {
  if (currentStep.value <= STEPS.EXTRACTING) return 0;
  if (currentStep.value <= STEPS.REVIEW) return 1;
  return 2;
});

// ===== 事件处理 =====

// 步骤 1：文件就绪 → 自动提取文本
async function onFilesReady(newFiles) {
  files.value = newFiles;
  currentStep.value = STEPS.EXTRACTING;
  parseError.value = '';
  parseResult.value = null;
  corrections.value = [];

  try {
    // 计算文件哈希
    fileHash.value = await computeFileHash(newFiles[0]);

    // 提取文本
    uploaderRef.value?.setExtracting(true, 10);
    const text = await extractText(newFiles[0]);
    uploaderRef.value?.setExtracting(true, 100);
    extractedTexts.value = [text];

    // 自动进入解析
    await onTextExtracted();
  } catch (err) {
    console.error('[ResumeImport] 文本提取失败:', err);
    parseError.value = err.message || '文本提取失败';
    currentStep.value = STEPS.REVIEW; // 进入审核步骤显示错误
  }
}

// 文本提取完成 → 调用云函数解析
async function onTextExtracted() {
  if (extractedTexts.value.length === 0) return;

  currentStep.value = STEPS.PARSING;
  parseLoading.value = true;
  parseError.value = '';

  try {
    const result = await parseWithDeepSeek(extractedTexts.value[0]);

    if (result.success) {
      parseResult.value = result.data;
      currentStep.value = STEPS.REVIEW;
    } else {
      parseError.value = result.error || '解析失败，请重试';
      currentStep.value = STEPS.REVIEW;
    }
  } catch (err) {
    console.error('[ResumeImport] 解析调用失败:', err);
    parseError.value = err.message || '解析服务调用失败';
    currentStep.value = STEPS.REVIEW;
  } finally {
    parseLoading.value = false;
  }
}

// 步骤 2：字段修正
function onFieldCorrect(fieldPath, originalValue, correctedValue) {
  corrections.value.push({ fieldPath, originalValue, correctedValue });
}

// 步骤 2：确认解析结果 → 进入重复检测 + 候选表单
async function onParseConfirm(correctedResult) {
  const data = correctedResult || parseResult.value;

  // 如果返回 null 表示用户选择手动录入，跳转到表单
  if (!data && correctedResult === null) {
    parseResult.value = { basic_info: {} };
    currentStep.value = STEPS.FORM;
    return;
  }

  // 使用修正后的数据
  if (correctedResult) {
    parseResult.value = correctedResult;
  }

  // 重复检测
  try {
    duplicates.value = await detectDuplicates(parseResult.value, {
      fileHash: fileHash.value,
      db,
    });
  } catch (err) {
    console.warn('[ResumeImport] 重复检测失败，跳过:', err.message);
    duplicates.value = [];
  }

  currentStep.value = STEPS.FORM;
}

// 手动录入（跳过解析）
function onManualEntry() {
  parseResult.value = { basic_info: {} };
  currentStep.value = STEPS.FORM;
}

// 步骤 3：创建 Candidate + Application
async function onCreateCandidate(data) {
  submitting.value = true;

  try {
    const { candidate: candidateData, application: appData, corrections: correctionData, fileInfo } = data;

    // 1. 上传文件到云存储
    let fileId = null;
    if (files.value.length > 0 && storage) {
      try {
        const file = files.value[0];
        const cloudPath = `resumes/${Date.now()}_${file.name}`;
        const uploadResult = await storage.uploadFile({
          cloudPath,
          filePath: file, // CloudBase JS SDK 浏览器端接受 File 对象
        });
        fileId = uploadResult.fileID;
      } catch (uploadErr) {
        console.error('[ResumeImport] 文件上传失败:', uploadErr);
        // 文件上传失败不阻塞候选创建，继续（文件已在内存中）
      }
    }

    // 2. 创建 Candidate
    const candidateDoc = {
      name: candidateData.name || '',
      phone: candidateData.phone || '',
      email: candidateData.email || '',
      parsedData: parseResult.value,
      parseCorrections: correctionData || [],
      fileHash: fileHash.value,
      fileId: fileId || '',
      fileName: files.value[0]?.name || '',
      createdBy: auth.currentUser?.uid || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const candidateResult = await db.collection('Candidate').add(candidateDoc);
    const candidateId = candidateResult.id;

    // 3. 创建 Application
    const applicationDoc = {
      candidateId,
      jobId: appData.jobId,
      stage: 'resume',
      stageEnteredAt: new Date(),
      status: 'active',
      funnel: {
        resumeAt: new Date(),
      },
      funnelMeta: {
        entrySource: 'manual',
      },
      source: candidateData.source || 'manual',
      ownerId: auth.currentUser?.uid || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('Application').add(applicationDoc);

    // 4. 更新 ParseCorrectionBank（如有修正）
    if (correctionData && correctionData.length > 0) {
      try {
        await recordCorrections(candidateId, correctionData);
      } catch (err) {
        console.warn('[ResumeImport] 修正案例库更新失败:', err.message);
      }
    }

    // 5. 写入 AuditLog（通过云函数，避免前端安全规则限制）
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'candidate_created',
        entityType: 'Candidate',
        entityIds: [candidateId],
        detail: {
          source: 'manual',
          fileName: files.value[0]?.name,
          parsedFields: Object.keys(parseResult.value?.basic_info || {}),
        },
        operator: auth.currentUser?.uid || '',
      });
    } catch (err) {
      console.warn('[ResumeImport] AuditLog 写入失败:', err.message);
    }

    // 成功 → Toast + 跳转
    alert(`候选人 "${candidateData.name || '未知'}" 创建成功！`);
    router.push(`/candidates/${candidateId}`);
  } catch (err) {
    console.error('[ResumeImport] 创建候选人失败:', err);
    // 错误已由 error-capture.js 全局捕获，这里额外提示
    alert(`创建失败: ${err.message || '未知错误'}`);
  } finally {
    submitting.value = false;
  }
}

/**
 * 记录修正到 ParseCorrectionBank
 */
async function recordCorrections(candidateId, correctionList) {
  const bank = db.collection('ParseCorrectionBank');

  for (const { fieldPath, originalValue, correctedValue } of correctionList) {
    if (!originalValue || !correctedValue) continue;

    const field = fieldPath.split('.').pop();

    // 查找已有记录
    const existing = await bank
      .where({ field, originalValue, correctedValue })
      .get();

    if (existing.data && existing.data.length > 0) {
      await bank.doc(existing.data[0]._id).update({
        correctionCount: db.command.inc(1),
        updatedAt: new Date(),
      });
    } else {
      await bank.add({
        field,
        originalValue,
        correctedValue,
        correctionCount: 1,
        updatedAt: new Date(),
      });
    }
  }
}

// 返回上一步
function onCancel() {
  if (currentStep.value === STEPS.FORM) {
    currentStep.value = STEPS.REVIEW;
  } else if (currentStep.value === STEPS.REVIEW) {
    currentStep.value = STEPS.UPLOAD;
    files.value = [];
    parseResult.value = null;
    parseError.value = '';
    duplicates.value = [];
  }
}
</script>

<template>
  <div class="resume-import-page">
    <div class="page-header">
      <h1 class="page-title">录入简历</h1>
      <p class="page-subtitle">上传简历文件 → AI 自动解析 → 核对修正 → 创建候选人</p>
    </div>

    <!-- 步骤指示器 -->
    <div class="steps-indicator">
      <div
        v-for="(step, i) in steps"
        :key="step.key"
        class="step-item"
        :class="{
          'is-active': i === activeStepIndex,
          'is-done': i < activeStepIndex,
        }"
      >
        <div class="step-dot">
          <svg v-if="i < activeStepIndex" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
          <span v-else>{{ step.num }}</span>
        </div>
        <span class="step-label">{{ step.label }}</span>
      </div>
    </div>

    <!-- 步骤 1：上传 -->
    <div v-if="currentStep <= STEPS.EXTRACTING" class="step-content">
      <ResumeUploader
        ref="uploaderRef"
        @files-ready="onFilesReady"
      />
    </div>

    <!-- 步骤 2：解析预览 + 修正 -->
    <div v-else-if="currentStep <= STEPS.REVIEW" class="step-content">
      <ParseResultView
        :parse-result="parseResult"
        :loading="parseLoading"
        :error="parseError"
        @field-correct="onFieldCorrect"
        @confirm="onParseConfirm"
        @retry="onTextExtracted"
      />

      <!-- 手动录入入口 -->
      <div v-if="parseError && !parseLoading" class="manual-entry-hint">
        <p class="text-muted">如果解析持续失败，可以跳过解析直接手动录入：</p>
        <button class="btn btn-ghost" @click="onManualEntry">手动录入候选人信息</button>
      </div>
    </div>

    <!-- 步骤 3：候选表单 -->
    <div v-else-if="currentStep === STEPS.FORM" class="step-content">
      <CandidateForm
        :parse-result="parseResult"
        :duplicates="duplicates"
        :submitting="submitting"
        @create="onCreateCandidate"
        @cancel="onCancel"
      />
    </div>
  </div>
</template>

<style scoped>
.resume-import-page {
  max-width: 800px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: var(--spacing-xl);
}

.page-title {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--gray-700);
  letter-spacing: -0.02em;
}

.page-subtitle {
  font-size: var(--font-size-base);
  color: var(--gray-400);
  margin-top: var(--spacing-xs);
}

/* === 步骤指示器 === */
.steps-indicator {
  display: flex;
  align-items: center;
  margin-bottom: var(--spacing-2xl);
  padding: var(--spacing-lg);
  background: var(--card-bg, #fff);
  border-radius: var(--radius);
  border: 1px solid var(--gray-100);
}

.step-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 1;
  position: relative;
}

.step-item + .step-item::before {
  content: '';
  flex: 1;
  height: 2px;
  background: var(--gray-200);
  margin-right: var(--spacing-md);
}

.step-item.is-done + .step-item::before {
  background: var(--primary);
}

.step-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
  flex-shrink: 0;
  background: var(--gray-100);
  color: var(--gray-400);
  border: 2px solid var(--gray-200);
}

.step-item.is-active .step-dot {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.step-item.is-done .step-dot {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.step-dot svg {
  width: 18px;
  height: 18px;
}

.step-label {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  font-weight: 500;
}

.step-item.is-active .step-label {
  color: var(--gray-700);
  font-weight: 600;
}

.step-item.is-done .step-label {
  color: var(--primary);
}

/* === 步骤内容 === */
.step-content {
  min-height: 300px;
}

.manual-entry-hint {
  margin-top: var(--spacing-xl);
  padding: var(--spacing-md);
  background: var(--gray-50);
  border-radius: var(--radius-sm);
  text-align: center;
}
</style>
