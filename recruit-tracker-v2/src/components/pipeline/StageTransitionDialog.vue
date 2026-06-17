<script setup>
/* 新励成招聘管理系统 V2.0 — 阶段流转确认弹窗 */

import { ref, computed, watch } from 'vue';
import { FUNNEL_STAGES, END_REASONS } from '../../config/constants';

const props = defineProps({
  visible: { type: Boolean, default: false },
  candidate: { type: Object, default: null },
  application: { type: Object, default: null },
  fromStage: { type: String, default: '' },
  toStage: { type: String, default: '' },
  job: { type: Object, default: null },
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

function handleConfirm() {
  emit('confirm', {
    applicationId: props.application?._id,
    fromStage: props.fromStage,
    toStage: props.toStage,
    note: note.value.trim(),
    reason: isEnding.value ? (selectedReason.value === 'other_reject' || selectedReason.value === 'other_withdraw' ? customReason.value : selectedReason.value) : undefined,
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
              {{ endType === 'rejected' ? '确认淘汰' : '确认放弃' }}
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
                >{{ isEnding ? (endType === 'rejected' ? '淘汰' : '放弃') : toLabel }}</span>
              </div>
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
