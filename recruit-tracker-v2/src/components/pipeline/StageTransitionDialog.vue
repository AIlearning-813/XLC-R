<script setup>
/* 新励成招聘管理系统 V2.0 — 阶段流转确认弹窗 */

import { ref, computed, watch } from 'vue';
import { FUNNEL_STAGES, END_REASONS } from '../../config/constants';
import { getIntermediateStages, stageToFunnelKey, STAGE_LABEL_MAP, checkPreconditions } from '../../services/pipeline-engine';

const props = defineProps({
  visible: { type: Boolean, default: false },
  candidate: { type: Object, default: null },
  application: { type: Object, default: null },
  fromStage: { type: String, default: '' },
  toStage: { type: String, default: '' },
  job: { type: Object, default: null },
  endStage: { type: String, default: '' },  // 淘汰细分阶段（resume/first_interview/second_interview/final_interview）
});

const emit = defineEmits(['confirm', 'cancel']);

const note = ref('');
const selectedReason = ref('');
const customReason = ref('');

const stageLabels = computed(() => {
  const map = {};
  for (const s of FUNNEL_STAGES) {
    map[s.key] = s.label;
  }
  return map;
});

const fromLabel = computed(() => stageLabels.value[props.fromStage] || props.fromStage);
const toLabel = computed(() => stageLabels.value[props.toStage] || props.toStage);
const candidateName = computed(() => props.candidate?.name || '未命名');
const positionName = computed(() => props.job?.title || props.job?.name || props.candidate?.expectedPosition || '未知');

// 是否结束流程
const isEnding = computed(() => {
  return props.toStage === 'rejected' || props.toStage === 'withdrawn';
});

const endType = computed(() => {
  if (props.toStage === 'rejected') return 'rejected';
  if (props.toStage === 'withdrawn') return 'withdrawn';
  return null;
});

// 淘汰细分阶段的中文标签
const rejectStageLabels = {
  resume: '简历筛选淘汰',
  first_interview: '初试淘汰',
  second_interview: '复试淘汰',
  final_interview: '终试淘汰',
};
const rejectStageLabel = computed(() => {
  if (props.toStage === 'rejected' && props.endStage) {
    return rejectStageLabels[props.endStage] || '淘汰';
  }
  return null;
});

const endReasons = computed(() => {
  if (!endType.value) return [];
  return END_REASONS[endType.value] || [];
});

const canConfirm = computed(() => {
  if (isEnding.value) {
    return !!selectedReason.value;
  }
  return true;
});

// 跳阶段回填预览
const backfillStages = computed(() => {
  if (isEnding.value) return [];
  const jobType = props.job?.type || props.job?.jobType || null;
  const intermediates = getIntermediateStages(props.fromStage, props.toStage, jobType);
  return intermediates.map((key) => ({
    key,
    label: STAGE_LABEL_MAP[key] || key,
    funnelKey: stageToFunnelKey(key),
  }));
});

const hasBackfill = computed(() => backfillStages.value.length > 0);

// 前置条件检查（P1-1：防止跳过必经过的阶段）
const preconditionResult = computed(() => {
  if (isEnding.value) return { valid: true, missing: [] };
  return checkPreconditions(props.toStage, props.application || {}, props.job);
});

const hasPreconditionWarnings = computed(() => !preconditionResult.value.valid);

function handleConfirm() {
  let reasonLabel;
  if (isEnding.value) {
    if (selectedReason.value === 'other_reject' || selectedReason.value === 'other_withdraw') {
      // 自定义原因直接用输入文本
      reasonLabel = customReason.value;
    } else {
      // 将英文 key 转成中文标签再存储
      const found = endReasons.value.find((r) => r.key === selectedReason.value);
      reasonLabel = found ? found.label : selectedReason.value;
    }
  }

  emit('confirm', {
    applicationId: props.application?._id,
    fromStage: props.fromStage,
    toStage: props.toStage,
    note: note.value.trim(),
    reason: isEnding.value ? reasonLabel : undefined,
  });
}

function handleCancel() {
  emit('cancel');
}

// 关闭时重置状态
watch(() => props.visible, (v) => {
  if (!v) {
    note.value = '';
    selectedReason.value = '';
    customReason.value = '';
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-overlay" @click.self="handleCancel">
        <div class="dialog-card">
          <!-- 头部 -->
          <div class="dialog-header">
            <h3 class="dialog-title" v-if="!isEnding">
              确认阶段流转
            </h3>
            <h3 class="dialog-title dialog-title-end" v-else>
              {{ endType === 'rejected' ? `确认淘汰 — ${rejectStageLabel || '淘汰'}` : '确认放弃' }}
            </h3>
            <button class="dialog-close" @click="handleCancel">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <!-- 内容 -->
          <div class="dialog-body">
            <!-- 候选人信息 -->
            <div class="transition-info">
              <div class="info-candidate">
                <span class="info-name">{{ candidateName }}</span>
                <span class="info-pos">{{ positionName }}</span>
              </div>
              <div class="info-arrow">
                <span class="info-stage-badge from">{{ fromLabel }}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
                <span
                  class="info-stage-badge to"
                  :class="{ end: isEnding }"
                >{{ isEnding ? (endType === 'rejected' ? (rejectStageLabel || '淘汰') : '放弃') : toLabel }}</span>
              </div>
            </div>

            <!-- 跳阶段回填预览 -->
            <div v-if="hasBackfill && !isEnding" class="backfill-preview">
              <div class="backfill-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>将自动回填 {{ backfillStages.length }} 个中间阶段</span>
              </div>
              <div class="backfill-list">
                <div
                  v-for="(s, i) in backfillStages"
                  :key="s.key"
                  class="backfill-item"
                >
                  <span class="backfill-dot auto"></span>
                  <span class="backfill-label">{{ s.label }}</span>
                  <span class="backfill-badge">自动</span>
                  <span
                    v-if="i < backfillStages.length - 1"
                    class="backfill-arrow"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </span>
                </div>
              </div>
              <p class="backfill-hint">回填时间戳均设为当前时间，不会覆盖已有漏斗数据</p>
            </div>

            <!-- 前置条件警告（P1-1：阻止跳过必须前置阶段） -->
            <div v-if="hasPreconditionWarnings && !isEnding" class="precondition-warning">
              <div class="precondition-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>缺少必要前置条件</span>
              </div>
              <ul class="precondition-list">
                <li v-for="item in preconditionResult.missing" :key="item">{{ item }}</li>
              </ul>
              <p class="precondition-hint">建议按顺序完成前置阶段后再流转，强行跳过可能影响数据准确性</p>
            </div>

            <!-- 结束原因选择 -->
            <div v-if="isEnding" class="end-reasons">
              <label class="form-label">
                {{ endType === 'rejected' ? '淘汰原因' : '放弃原因' }}
                <span class="required">*</span>
              </label>
              <div class="reasons-grid">
                <button
                  v-for="r in endReasons"
                  :key="r.key"
                  class="reason-chip"
                  :class="{ selected: selectedReason === r.key }"
                  @click="selectedReason = r.key"
                >
                  {{ r.label }}
                </button>
              </div>
              <!-- 自定义原因 -->
              <input
                v-if="selectedReason === 'other_reject' || selectedReason === 'other_withdraw'"
                v-model="customReason"
                type="text"
                class="form-input reason-input"
                placeholder="请输入具体原因"
              />
            </div>

            <!-- 备注 -->
            <div class="note-field">
              <label class="form-label">备注（选填）</label>
              <textarea
                v-model="note"
                class="form-textarea"
                rows="2"
                placeholder="可在此记录流转备注..."
              ></textarea>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="dialog-footer">
            <button class="btn btn-secondary" @click="handleCancel">取消</button>
            <button
              class="btn btn-primary"
              :class="{ 'btn-danger': isEnding }"
              :disabled="!canConfirm"
              @click="handleConfirm"
            >
              {{ isEnding ? '确认结束' : '确认流转' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* === 遮罩 === */
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

/* === 卡片 === */
.dialog-card {
  background: #fff;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 460px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* === 头部 === */
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

.dialog-title-end {
  color: var(--danger);
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

/* === 内容 === */
.dialog-body {
  padding: var(--spacing-lg);
  overflow-y: auto;
  flex: 1;
}

/* 流转信息 */
.transition-info {
  background: var(--gray-50);
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.info-candidate {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.info-name {
  font-weight: 600;
  color: var(--gray-700);
}

.info-pos {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.info-arrow {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--gray-400);
}

.info-stage-badge {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.info-stage-badge.from {
  background: var(--gray-100);
  color: var(--gray-500);
}

.info-stage-badge.to {
  background: var(--primary-bg);
  color: var(--primary);
}

.info-stage-badge.to.end {
  background: var(--danger-bg);
  color: var(--danger);
}

/* 结束原因 */
.end-reasons {
  margin-bottom: var(--spacing-md);
}

.required {
  color: var(--danger);
}

.reasons-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: var(--spacing-xs);
}

.reason-chip {
  padding: 6px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  background: #fff;
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  cursor: pointer;
  transition: all var(--transition);
  font-family: inherit;
}

.reason-chip:hover {
  border-color: var(--gray-300);
  color: var(--gray-600);
}

.reason-chip.selected {
  border-color: var(--danger);
  background: var(--danger-bg);
  color: var(--danger);
}

.reason-input {
  margin-top: var(--spacing-sm);
}

/* 备注 */
.note-field {
  margin-bottom: 0;
}

.form-textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--gray-700);
  font-size: var(--font-size-base);
  font-family: inherit;
  resize: vertical;
  transition: border-color var(--transition);
}

.form-textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-bg);
}

/* === 底部 === */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-lg) var(--spacing-lg);
}

/* === 回填预览 === */
.backfill-preview {
  background: #f0f7ff;
  border: 1px solid #b8d8f0;
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.backfill-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #3B4F8C;
  margin-bottom: 10px;
}

.backfill-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.backfill-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.backfill-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.backfill-dot.auto {
  background: #4A9C7C;
}

.backfill-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--gray-600);
  white-space: nowrap;
}

.backfill-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  background: #e0f0e8;
  color: #4A9C7C;
  font-weight: 600;
}

.backfill-arrow {
  color: var(--gray-300);
  display: flex;
  align-items: center;
  margin: 0 2px;
}

.backfill-hint {
  margin: 0;
  font-size: 10px;
  color: var(--gray-400);
  line-height: 1.4;
}

/* === 前置条件警告 === */
.precondition-warning {
  background: #fff8e6;
  border: 1px solid #f0c060;
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.precondition-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: #b08500;
  margin-bottom: 8px;
}

.precondition-list {
  margin: 0 0 8px 0;
  padding-left: 18px;
  font-size: var(--font-size-xs);
  color: var(--gray-600);
  line-height: 1.8;
}

.precondition-hint {
  margin: 0;
  font-size: 10px;
  color: var(--gray-400);
  line-height: 1.4;
}

/* === 过渡动画 === */
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
