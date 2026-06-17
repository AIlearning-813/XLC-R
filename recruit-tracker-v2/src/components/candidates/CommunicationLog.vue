<script setup>
/* 新励成招聘管理系统 V2.0 — 沟通记录时间线 */

import { ref, computed } from 'vue';
import { COMMUNICATION_METHODS } from '../../config/constants';
import { addCommunication, deleteCommunication } from '../../services/communication';

const props = defineProps({
  communications: { type: Array, default: () => [] },
  candidateId: { type: String, required: true },
  applicationId: { type: String, default: null },
  operator: { type: String, default: '' },
});

const emit = defineEmits(['updated']);

const showForm = ref(false);
const newMethod = ref('电话');
const newContent = ref('');
const submitting = ref(false);
const error = ref('');

const sortedList = computed(() => {
  return [...props.communications].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
});

const methodIcon = {
  '电话': '📞',
  '微信': '💬',
  '短信': '✉️',
  '邮件': '📧',
  '当面': '🤝',
};

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${min}`;
}

async function handleSubmit() {
  if (!newContent.value.trim()) return;

  submitting.value = true;
  error.value = '';

  try {
    await addCommunication({
      candidateId: props.candidateId,
      applicationId: props.applicationId,
      method: newMethod.value,
      content: newContent.value.trim(),
      operator: props.operator,
    });

    newContent.value = '';
    showForm.value = false;
    emit('updated');
  } catch (err) {
    error.value = '添加失败：' + err.message;
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id) {
  if (!confirm('确认删除这条沟通记录？')) return;

  try {
    await deleteCommunication(id);
    emit('updated');
  } catch (err) {
    error.value = '删除失败：' + err.message;
  }
}
</script>

<template>
  <div class="comm-log">
    <!-- 添加按钮 -->
    <div class="comm-header">
      <button
        v-if="!showForm"
        class="btn btn-sm btn-primary"
        @click="showForm = true"
      >
        + 添加沟通记录
      </button>
    </div>

    <!-- 表单 -->
    <div v-if="showForm" class="comm-form card">
      <div class="form-row">
        <select v-model="newMethod" class="form-select" style="width: 120px;">
          <option v-for="m in COMMUNICATION_METHODS" :key="m" :value="m">{{ m }}</option>
        </select>
        <textarea
          v-model="newContent"
          class="form-textarea"
          rows="2"
          placeholder="记录沟通内容..."
          @keyup.ctrl.enter="handleSubmit"
        ></textarea>
      </div>
      <div class="form-actions">
        <span class="form-error" v-if="error">{{ error }}</span>
        <button class="btn btn-sm btn-ghost" @click="showForm = false">取消</button>
        <button
          class="btn btn-sm btn-primary"
          :disabled="!newContent.trim() || submitting"
          @click="handleSubmit"
        >
          {{ submitting ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <!-- 时间线 -->
    <div v-if="sortedList.length > 0" class="timeline">
      <div
        v-for="(item, i) in sortedList"
        :key="item._id"
        class="timeline-item"
        :class="{ first: i === 0 }"
      >
        <div class="timeline-dot">
          <span class="dot-icon">{{ methodIcon[item.method] || '📝' }}</span>
        </div>
        <div class="timeline-card">
          <div class="timeline-meta">
            <span class="timeline-method">{{ item.method }}</span>
            <span class="timeline-operator">{{ item.operator }}</span>
            <span class="timeline-time">{{ formatTime(item.createdAt) }}</span>
          </div>
          <div class="timeline-content">{{ item.content }}</div>
          <button
            class="timeline-delete"
            @click="handleDelete(item._id)"
            title="删除"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!showForm" class="empty-state" style="padding: var(--spacing-xl);">
      <div class="empty-state-text">暂无沟通记录</div>
    </div>
  </div>
</template>

<style scoped>
.comm-header {
  margin-bottom: var(--spacing-md);
}

/* === 表单 === */
.comm-form {
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.form-row {
  display: flex;
  gap: var(--spacing-sm);
  align-items: flex-start;
}

.form-textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  resize: vertical;
  color: var(--gray-700);
}

.form-textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-bg);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

.form-error {
  font-size: var(--font-size-xs);
  color: var(--danger);
  flex: 1;
}

/* === 时间线 === */
.timeline {
  position: relative;
}

.timeline-item {
  display: flex;
  gap: var(--spacing-md);
  padding-bottom: var(--spacing-lg);
  position: relative;
}

.timeline-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 14px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: var(--gray-100);
}

.timeline-dot {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--gray-50);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.first .timeline-dot {
  background: var(--primary-bg);
}

.dot-icon {
  font-size: 14px;
}

.timeline-card {
  flex: 1;
  background: #fff;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  position: relative;
}

.timeline-card:hover .timeline-delete {
  opacity: 1;
}

.timeline-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: 4px;
}

.timeline-method {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--primary);
}

.timeline-operator {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.timeline-time {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  margin-left: auto;
}

.timeline-content {
  font-size: var(--font-size-base);
  color: var(--gray-600);
  line-height: 1.5;
}

.timeline-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: var(--danger-bg);
  color: var(--danger);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--transition);
}
</style>
