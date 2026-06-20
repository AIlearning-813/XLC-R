<script setup>
/**
 * ConfirmChangeDialog.vue — 专员修改 Job/Config 时的确认对话框
 *
 * 展示 before/after diff，要求专员确认"此修改需管理员审核"。
 */
import { ref, computed } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '提交变更申请' },
  typeLabel: { type: String, default: '' },   // "岗位" / "系统配置"
  actionLabel: { type: String, default: '' },  // "新建" / "修改" / "删除"
  entityLabel: { type: String, default: '' },
  before: { type: Object, default: null },
  after: { type: Object, default: null },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['confirm', 'cancel']);

const confirmed = ref(false);

const changedFields = computed(() => {
  if (!props.before || !props.after) return [];
  const fields = [];
  for (const key of Object.keys(props.after)) {
    const oldVal = props.before[key];
    const newVal = props.after[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      fields.push({ key, label: fieldLabel(key), oldVal: formatVal(oldVal), newVal: formatVal(newVal) });
    }
  }
  return fields;
});

function fieldLabel(key) {
  const labels = {
    title: '岗位标题', name: '岗位名称', type: '岗位类型', department: '部门',
    headcount: '招聘人数', salaryRange: '薪资范围', workCity: '工作城市',
    requirements: '岗位要求', status: '状态', priority: '优先级',
    expiryDate: '截止日期', cities: '城市列表', departments: '部门列表',
    jobTypes: '岗位类型', alertThresholds: '告警阈值',
  };
  return labels[key] || key;
}

function formatVal(val) {
  if (val === null || val === undefined) return '（无）';
  if (typeof val === 'object') return JSON.stringify(val, null, 1);
  return String(val);
}

function handleConfirm() {
  if (!confirmed.value) return;
  emit('confirm');
}

function handleCancel() {
  confirmed.value = false;
  emit('cancel');
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click.self="handleCancel">
    <div class="dialog">
      <div class="dialog-header">
        <h3>{{ title }}</h3>
        <p class="dialog-sub">
          {{ typeLabel }} · {{ actionLabel }}<template v-if="entityLabel">：{{ entityLabel }}</template>
        </p>
      </div>

      <!-- Diff 对比 -->
      <div class="diff-section" v-if="changedFields.length > 0">
        <div class="diff-title">变更内容</div>
        <div class="diff-table">
          <div class="diff-header">
            <span class="diff-col-label">字段</span>
            <span class="diff-col-before">原值</span>
            <span class="diff-col-after">新值</span>
          </div>
          <div v-for="field in changedFields" :key="field.key" class="diff-row">
            <span class="diff-col-label">{{ field.label }}</span>
            <span class="diff-col-before">{{ field.oldVal }}</span>
            <span class="diff-col-arrow">→</span>
            <span class="diff-col-after">{{ field.newVal }}</span>
          </div>
        </div>
      </div>

      <div v-else class="diff-empty">
        <p>无字段变更</p>
      </div>

      <!-- 确认勾选 -->
      <label class="confirm-check">
        <input type="checkbox" v-model="confirmed" />
        <span>我已确认以上修改内容，我知道此修改需<strong>管理员审核</strong>后方可生效</span>
      </label>

      <!-- 按钮 -->
      <div class="dialog-actions">
        <button class="btn" @click="handleCancel" :disabled="loading">取消</button>
        <button
          class="btn btn-primary"
          @click="handleConfirm"
          :disabled="!confirmed || loading"
        >
          {{ loading ? '提交中…' : '确认提交' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog {
  background: #fff;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xl);
  width: 520px;
  max-width: 95vw;
  max-height: 85vh;
  overflow-y: auto;
  padding: var(--spacing-lg);
}
.dialog-header h3 {
  margin: 0 0 2px;
  font-size: var(--font-size-lg);
  font-weight: 600;
}
.dialog-sub {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin: 0 0 var(--spacing-md);
}

/* Diff */
.diff-section {
  margin-bottom: var(--spacing-md);
}
.diff-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--gray-600);
  margin-bottom: var(--spacing-xs);
}
.diff-table {
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  overflow: hidden;
}
.diff-header, .diff-row {
  display: flex;
  align-items: baseline;
  padding: 6px 10px;
}
.diff-header {
  background: var(--gray-50);
  font-weight: 600;
  color: var(--gray-500);
}
.diff-row {
  border-top: 1px solid var(--gray-50);
}
.diff-col-label { width: 90px; flex-shrink: 0; color: var(--gray-500); }
.diff-col-before { flex: 1; color: var(--gray-400); text-decoration: line-through; white-space: pre-wrap; word-break: break-all; }
.diff-col-arrow { width: 24px; text-align: center; color: var(--primary); flex-shrink: 0; }
.diff-col-after { flex: 1; color: var(--gray-700); font-weight: 500; white-space: pre-wrap; word-break: break-all; }
.diff-empty {
  text-align: center;
  color: var(--gray-400);
  font-size: var(--font-size-sm);
  padding: var(--spacing-md);
}

/* 确认勾选 */
.confirm-check {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--gray-600);
  padding: var(--spacing-sm);
  background: var(--warning-bg);
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin-bottom: var(--spacing-md);
}
.confirm-check input { margin-top: 2px; }

/* 按钮 */
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
</style>
