<script setup>
/* 新励成招聘管理系统 V2.0 — 解析结果预览 + 手动修正 */

import { ref, reactive, computed, watch } from 'vue';

const props = defineProps({
  parseResult: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits([
  'field-correct',  // (fieldPath, originalValue, correctedValue)
  'confirm',         // (correctedResult)
  'retry',           // 重新解析
]);

// 可编辑的深拷贝
const editable = reactive({});
const editingField = ref(null);       // 当前编辑的字段路径
const editValue = ref('');             // 当前编辑的值
const corrections = ref([]);           // 已修正列表

// 监听 parseResult 变化，重置编辑状态
watch(() => props.parseResult, (val) => {
  if (val) {
    // 深拷贝到 editable
    Object.keys(editable).forEach(k => delete editable[k]);
    Object.assign(editable, JSON.parse(JSON.stringify(val)));
    corrections.value = [];
    editingField.value = null;
  }
}, { immediate: true });

// 分组配置
const sections = computed(() => {
  if (!props.parseResult) return [];
  return [
    {
      key: 'basic_info',
      title: '基本信息',
      fields: [
        { key: 'name', label: '姓名' },
        { key: 'gender', label: '性别' },
        { key: 'phone', label: '手机号' },
        { key: 'email', label: '邮箱' },
        { key: 'age', label: '年龄' },
        { key: 'city', label: '所在城市' },
        { key: 'years_of_experience', label: '工作年限' },
      ],
    },
    {
      key: 'education',
      title: '教育经历',
      type: 'array',
      itemFields: [
        { key: 'school', label: '学校' },
        { key: 'major', label: '专业' },
        { key: 'degree', label: '学历' },
        { key: 'start_date', label: '入学时间' },
        { key: 'end_date', label: '毕业时间' },
      ],
    },
    {
      key: 'work_experience',
      title: '工作经历',
      type: 'array',
      itemFields: [
        { key: 'company', label: '公司' },
        { key: 'position', label: '职位' },
        { key: 'start_date', label: '入职时间' },
        { key: 'end_date', label: '离职时间' },
        { key: 'description', label: '工作描述' },
      ],
    },
    {
      key: 'skills',
      title: '技能',
      type: 'tags',
    },
    {
      key: 'certificates',
      title: '证书',
      type: 'tags',
    },
    {
      key: null,
      title: '求职意向',
      fields: [
        { key: 'expected_position', label: '期望岗位', parent: null },
        { key: 'expected_salary', label: '期望薪资', parent: null },
      ],
    },
    {
      key: 'self_evaluation',
      title: '自我评价',
      type: 'text',
    },
  ];
});

// 获取字段值
function getFieldValue(fieldKey, parentKey = null) {
  const source = parentKey ? editable[parentKey] : editable;
  if (!source) return '';
  // 特殊处理：basic_info 是嵌套对象
  if (parentKey === null && editable.basic_info && fieldKey in editable.basic_info) {
    return editable.basic_info[fieldKey];
  }
  return source[fieldKey] || '';
}

// 检查字段是否已被修正
function isFieldCorrected(fieldPath) {
  return corrections.value.some(c => c.fieldPath === fieldPath);
}

// 开始编辑字段
function startEdit(fieldPath, parentKey = null) {
  editingField.value = fieldPath;
  editValue.value = String(getFieldValue(fieldPath, parentKey) || '');
}

// 提交编辑
function commitEdit(fieldPath, parentKey = null) {
  const originalValue = getFieldValue(fieldPath, parentKey);
  const correctedValue = editValue.value.trim();

  if (correctedValue !== String(originalValue || '')) {
    // 更新 editable 中的值
    if (parentKey === null && editable.basic_info) {
      editable.basic_info[fieldPath] = correctedValue;
    } else if (parentKey) {
      editable[parentKey][fieldPath] = correctedValue;
    } else {
      editable[fieldPath] = correctedValue;
    }

    // 记录修正
    corrections.value.push({
      fieldPath,
      originalValue,
      correctedValue,
    });

    emit('field-correct', fieldPath, originalValue, correctedValue);
  }

  editingField.value = null;
}

// 取消编辑
function cancelEdit() {
  editingField.value = null;
}

// 编辑数组项字段
function startEditArrayItem(arrayKey, index, fieldKey) {
  const fieldPath = `${arrayKey}.${index}.${fieldKey}`;
  editingField.value = fieldPath;
  const item = editable[arrayKey]?.[index];
  editValue.value = String(item?.[fieldKey] || '');
}

function commitEditArrayItem(arrayKey, index, fieldKey) {
  const item = editable[arrayKey]?.[index];
  const originalValue = item?.[fieldKey] || '';
  const correctedValue = editValue.value.trim();

  if (correctedValue !== String(originalValue)) {
    if (editable[arrayKey]?.[index]) {
      editable[arrayKey][index][fieldKey] = correctedValue;
    }
    const fieldPath = `${arrayKey}.${index}.${fieldKey}`;
    corrections.value.push({ fieldPath, originalValue, correctedValue });
    emit('field-correct', fieldPath, originalValue, correctedValue);
  }
  editingField.value = null;
}

// 确认数据
function handleConfirm() {
  emit('confirm', {
    ...JSON.parse(JSON.stringify(editable)),
    _corrections: [...corrections.value],
  });
}

// 是否显示"确认"按钮（至少要有解析结果）
const canConfirm = computed(() => props.parseResult && !props.loading);
</script>

<template>
  <div class="parse-result">
    <!-- 加载态 -->
    <div v-if="loading" class="parse-loading">
      <div class="spinner"></div>
      <p class="parse-loading-text">AI 正在解析简历，请稍候...</p>
      <div class="parse-skeleton">
        <div v-for="i in 4" :key="i" class="skeleton-card">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line" style="width: 60%"></div>
          <div class="skeleton-line" style="width: 80%"></div>
          <div class="skeleton-line" style="width: 40%"></div>
        </div>
      </div>
    </div>

    <!-- 错误态 -->
    <div v-else-if="error" class="parse-error">
      <div class="parse-error-card">
        <div class="parse-error-icon">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="24" cy="24" r="20"/>
            <line x1="24" y1="14" x2="24" y2="28"/>
            <circle cx="24" cy="34" r="1.5" fill="currentColor"/>
          </svg>
        </div>
        <h3 class="parse-error-title">解析未能完成</h3>
        <p class="parse-error-desc">{{ error }}</p>
        <div class="parse-error-actions">
          <button class="btn btn-secondary" @click="$emit('retry')">重新解析</button>
          <button class="btn btn-primary" @click="$emit('confirm', null)">手动录入</button>
        </div>
      </div>
    </div>

    <!-- 成功态 -->
    <div v-else-if="parseResult" class="parse-sections">
      <template v-for="section in sections" :key="section.title">
        <section class="parse-section card">
          <div class="parse-section-header">
            <h3 class="parse-section-title">{{ section.title }}</h3>
            <span
              v-if="section.key && corrections.some(c => c.fieldPath.startsWith(section.key))"
              class="badge badge-warning"
            >已修改</span>
          </div>

          <!-- 简单字段 -->
          <div v-if="section.fields" class="parse-fields">
            <div
              v-for="field in section.fields"
              :key="field.key"
              class="parse-field-row"
              :class="{ 'is-corrected': isFieldCorrected(field.key) }"
            >
              <span class="parse-field-label">{{ field.label }}</span>
              <div class="parse-field-value-wrap">
                <!-- 编辑态 -->
                <template v-if="editingField === field.key">
                  <input
                    v-model="editValue"
                    class="form-input parse-edit-input"
                    @keyup.enter="commitEdit(field.key, field.parent)"
                    @keyup.escape="cancelEdit"
                    @blur="commitEdit(field.key, field.parent)"
                    autofocus
                  />
                </template>
                <!-- 展示态 -->
                <template v-else>
                  <span
                    class="parse-field-value"
                    :class="{ 'text-muted': !getFieldValue(field.key, field.parent) }"
                  >
                    {{ getFieldValue(field.key, field.parent) || '未识别' }}
                  </span>
                  <button
                    class="parse-edit-btn"
                    @click="startEdit(field.key, field.parent)"
                    title="修正此字段"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                </template>
              </div>
            </div>
          </div>

          <!-- 数组字段（教育/工作经历） -->
          <div v-if="section.type === 'array' && section.key" class="parse-array">
            <div
              v-if="editable[section.key] && editable[section.key].length > 0"
              class="parse-array-list"
            >
              <div
                v-for="(item, index) in editable[section.key]"
                :key="index"
                class="parse-array-item"
              >
                <span class="parse-array-index">#{{ index + 1 }}</span>
                <div class="parse-array-fields">
                  <div
                    v-for="f in section.itemFields"
                    :key="f.key"
                    class="parse-array-field"
                  >
                    <span class="parse-field-label">{{ f.label }}</span>
                    <template v-if="editingField === `${section.key}.${index}.${f.key}`">
                      <input
                        v-model="editValue"
                        class="form-input parse-edit-input"
                        @keyup.enter="commitEditArrayItem(section.key, index, f.key)"
                        @keyup.escape="cancelEdit"
                        @blur="commitEditArrayItem(section.key, index, f.key)"
                        autofocus
                      />
                    </template>
                    <template v-else>
                      <span
                        class="parse-field-value"
                        :class="{ 'text-muted': !item[f.key] }"
                      >
                        {{ item[f.key] || '未识别' }}
                      </span>
                      <button
                        class="parse-edit-btn"
                        @click="startEditArrayItem(section.key, index, f.key)"
                        title="修正"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="parse-edit-icon">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    </template>
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="text-muted">未识别到{{ section.title }}信息</p>
          </div>

          <!-- 标签（技能/证书） -->
          <div v-if="section.type === 'tags' && section.key" class="parse-tags">
            <template v-if="editable[section.key] && editable[section.key].length > 0">
              <span
                v-for="(tag, i) in editable[section.key]"
                :key="i"
                class="parse-tag"
              >{{ tag }}</span>
            </template>
            <p v-else class="text-muted">未识别到{{ section.title }}</p>
          </div>

          <!-- 纯文本（自我评价） -->
          <div v-if="section.type === 'text' && section.key" class="parse-text">
            <p v-if="editable[section.key]" class="parse-text-content">{{ editable[section.key] }}</p>
            <p v-else class="text-muted">未识别到{{ section.title }}</p>
          </div>
        </section>
      </template>

      <!-- 底部操作 -->
      <div v-if="canConfirm" class="parse-actions">
        <button class="btn btn-secondary" @click="$emit('retry')">重新解析</button>
        <button class="btn btn-primary" @click="handleConfirm">确认无误，继续</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.parse-result {
  width: 100%;
}

/* === 加载态 === */
.parse-loading {
  text-align: center;
  padding: var(--spacing-2xl) 0;
}

.parse-loading-text {
  margin-top: var(--spacing-md);
  font-size: var(--font-size-base);
  color: var(--gray-500);
}

/* 骨架屏 */
.parse-skeleton {
  margin-top: var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.skeleton-card {
  padding: var(--spacing-md);
  background: var(--card-bg, #fff);
  border-radius: var(--radius-sm);
  border: 1px solid var(--gray-100);
}

.skeleton-line {
  height: 14px;
  background: linear-gradient(90deg, var(--gray-100) 0%, var(--gray-50) 50%, var(--gray-100) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 8px;
}

.skeleton-title {
  width: 30%;
  height: 18px;
  margin-bottom: 12px;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* === 错误态 === */
.parse-error {
  display: flex;
  justify-content: center;
  padding: var(--spacing-3xl) 0;
}

.parse-error-card {
  text-align: center;
  max-width: 420px;
}

.parse-error-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto var(--spacing-md);
  color: var(--danger);
}

.parse-error-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
  margin-bottom: var(--spacing-sm);
}

.parse-error-desc {
  font-size: var(--font-size-base);
  color: var(--gray-400);
  margin-bottom: var(--spacing-lg);
  line-height: 1.6;
}

.parse-error-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: center;
}

/* === 解析结果分区 === */
.parse-sections {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.parse-section {
  padding: var(--spacing-lg);
}

.parse-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--gray-100);
}

.parse-section-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--gray-700);
}

/* === 字段行 === */
.parse-fields {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--gray-50);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.parse-field-row {
  display: flex;
  align-items: center;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--card-bg, #fff);
  transition: background var(--transition);
}

.parse-field-row.is-corrected {
  border-left: 3px solid var(--accent);
  background: var(--accent-bg);
}

.parse-field-label {
  width: 100px;
  flex-shrink: 0;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--gray-500);
}

.parse-field-value-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.parse-field-value {
  font-size: var(--font-size-base);
  color: var(--gray-800);
  word-break: break-all;
}

.parse-edit-input {
  flex: 1;
  padding: 4px 8px;
  font-size: var(--font-size-base);
}

.parse-edit-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--gray-300);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
  flex-shrink: 0;
  opacity: 0;
}

.parse-field-row:hover .parse-edit-btn {
  opacity: 1;
}

.parse-edit-btn:hover {
  color: var(--primary);
  background: var(--primary-bg);
}

.parse-edit-btn svg,
.parse-edit-icon {
  width: 14px;
  height: 14px;
}

/* === 数组项 === */
.parse-array-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.parse-array-item {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--gray-50);
  border-radius: var(--radius-sm);
  position: relative;
}

.parse-array-index {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-bg);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  height: fit-content;
  flex-shrink: 0;
}

.parse-array-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.parse-array-field {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.parse-array-field .parse-field-label {
  width: 80px;
}

.parse-array-field .parse-field-value-wrap {
  display: contents;
}

.parse-array-field:hover .parse-edit-btn {
  opacity: 1;
}

/* === 标签 === */
.parse-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.parse-tag {
  display: inline-block;
  padding: 4px 12px;
  background: var(--primary-bg);
  color: var(--primary);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
}

/* === 文本 === */
.parse-text-content {
  font-size: var(--font-size-base);
  color: var(--gray-600);
  line-height: 1.8;
  white-space: pre-wrap;
}

/* === 底部操作 === */
.parse-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  margin-top: var(--spacing-lg);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--gray-100);
}
</style>
