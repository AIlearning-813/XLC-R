<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人创建表单
 *
 * 增强版：支持按部门筛选岗位 + 关联招聘需求（选需求自动带岗位）
 */

import { ref, reactive, computed, onMounted, watch } from 'vue';
import cloudbase from '../../services/cloudbase';
import { useConfigStore } from '../../stores/useConfigStore';
import { useJobStore } from '../../stores/useJobStore';
import { useRecruitmentDemandStore } from '../../stores/useRecruitmentDemandStore';

const db = cloudbase.db();

const props = defineProps({
  parseResult: { type: Object, default: () => ({}) },
  duplicates: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false },
});

const emit = defineEmits([
  'create',  // (data: { candidate, application, corrections, fileInfo })
  'cancel',
]);

// ===== Store =====
const configStore = useConfigStore();
const jobStore = useJobStore();
const demandStore = useRecruitmentDemandStore();

// ===== 表单状态 =====
const selectedJobId = ref('');
const source = ref('manual');
const recruitmentSource = ref('');
const notes = ref('');
const duplicateAcknowledged = ref(false);

// 部门筛选
const selectedDept = ref('');
const availableDepts = ref([]);

// 招聘需求关联
const selectedDemandId = ref('');
const recruitingDemands = ref([]);
const demandsLoading = ref(false);

// 岗位列表
const jobs = ref([]);
const jobsLoading = ref(true);

// ===== 补充信息 =====
const basicInfo = reactive({
  name: '',
  phone: '',
  email: '',
});

// 从 parseResult 初始化
const initFromParseResult = () => {
  const data = props.parseResult;
  if (!data) return;
  const info = data.basic_info || {};
  if (info.name) basicInfo.name = info.name;
  if (info.phone) basicInfo.phone = info.phone;
  if (info.email) basicInfo.email = info.email;
};
initFromParseResult();

// ===== 加载数据 =====
onMounted(async () => {
  // 加载岗位列表（通过 store）
  try {
    jobsLoading.value = true;
    const fetchedJobs = await jobStore.fetchActive();
    jobs.value = fetchedJobs;
    // 提取部门列表
    const deptSet = new Set();
    for (const j of fetchedJobs) {
      const dept = j.department || '未分配';
      deptSet.add(dept);
    }
    availableDepts.value = [...deptSet].sort();
  } catch (err) {
    console.warn('[CandidateForm] 加载岗位列表失败:', err.message);
    jobs.value = [];
  } finally {
    jobsLoading.value = false;
  }

  // 加载招聘需求列表
  try {
    demandsLoading.value = true;
    const demands = await demandStore.fetchAll('recruiting');
    recruitingDemands.value = demands || [];
  } catch (err) {
    console.warn('[CandidateForm] 加载招聘需求失败:', err.message);
  } finally {
    demandsLoading.value = false;
  }
});

// ===== 计算属性 =====

/** 按部门筛选后的岗位 */
const filteredJobs = computed(() => {
  if (!selectedDept.value) return jobs.value;
  return jobs.value.filter(j => (j.department || '未分配') === selectedDept.value);
});

/** 当前选中需求对应的岗位 */
const demandLinkedJobId = computed(() => {
  if (!selectedDemandId.value) return null;
  const demand = recruitingDemands.value.find(d => d._id === selectedDemandId.value);
  return demand?.linkedJobId || null;
});

/** 当前选中需求的信息 */
const selectedDemand = computed(() => {
  return recruitingDemands.value.find(d => d._id === selectedDemandId.value) || null;
});

/** 表单是否有效 */
const isFormValid = computed(() => {
  return basicInfo.name.trim() && selectedJobId.value;
});

const canSubmit = computed(() => {
  if (!isFormValid.value || props.submitting) return false;
  if (props.duplicates.length > 0 && !duplicateAcknowledged.value) return false;
  return true;
});

const hasDuplicates = computed(() => props.duplicates.length > 0);

// ===== 监听：选需求 → 自动填岗位 =====
watch(selectedDemandId, (newDemandId) => {
  if (newDemandId) {
    const demand = recruitingDemands.value.find(d => d._id === newDemandId);
    if (demand?.linkedJobId) {
      selectedJobId.value = demand.linkedJobId;
      // 如果有部门信息，同步设置部门筛选
      const job = jobs.value.find(j => j._id === demand.linkedJobId);
      if (job?.department) {
        selectedDept.value = job.department;
      }
    }
  }
});

// ===== 方法 =====

/** 切换部门筛选时，如果当前选中的岗位不在该部门，清除选择 */
watch(selectedDept, () => {
  const job = jobs.value.find(j => j._id === selectedJobId.value);
  if (job && selectedDept.value && (job.department || '未分配') !== selectedDept.value) {
    selectedJobId.value = '';
  }
});

function handleSubmit() {
  if (!canSubmit.value) return;

  // 组装数据：合并 basicInfo 回到 parseResult
  const mergedData = JSON.parse(JSON.stringify(props.parseResult));
  if (!mergedData.basic_info) {
    mergedData.basic_info = {};
  }
  mergedData.basic_info.name = basicInfo.name.trim();
  if (basicInfo.phone.trim()) mergedData.basic_info.phone = basicInfo.phone.trim();
  if (basicInfo.email.trim()) mergedData.basic_info.email = basicInfo.email.trim();

  const selectedJob = jobs.value.find(j => j._id === selectedJobId.value);
  const demand = selectedDemand.value;

  emit('create', {
    candidate: {
      name: basicInfo.name.trim(),
      phone: basicInfo.phone.trim(),
      email: basicInfo.email.trim(),
      source: source.value,
      recruitmentSource: recruitmentSource.value,
      notes: notes.value.trim(),
      parsedData: mergedData,
    },
    application: {
      jobId: selectedJobId.value,
      demandId: demand?._id || '',  // 🆕 关联招聘需求
      demandTitle: demand?.title || '',
    },
    corrections: props.parseResult?._corrections || [],
  });
}
</script>

<template>
  <div class="candidate-form">
    <!-- 基本信息 -->
    <section class="form-section card">
      <h3 class="section-title">候选人基本信息</h3>

      <div class="form-group">
        <label class="form-label">姓名 <span class="required">*</span></label>
        <input
          v-model="basicInfo.name"
          type="text"
          class="form-input"
          placeholder="请输入候选人姓名"
          :disabled="submitting"
        />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">手机号</label>
          <input
            v-model="basicInfo.phone"
            type="tel"
            class="form-input"
            placeholder="请输入手机号"
            :disabled="submitting"
          />
        </div>
        <div class="form-group">
          <label class="form-label">邮箱</label>
          <input
            v-model="basicInfo.email"
            type="email"
            class="form-input"
            placeholder="请输入邮箱"
            :disabled="submitting"
          />
        </div>
      </div>
    </section>

    <!-- 关联招聘需求 -->
    <section class="form-section card">
      <h3 class="section-title">关联招聘需求</h3>
      <p class="section-hint">选择需求后自动关联对应岗位。如暂无需求直接选岗位即可。</p>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">招聘需求（可选）</label>
          <select
            v-model="selectedDemandId"
            class="form-select"
            :disabled="submitting || demandsLoading"
          >
            <option value="">不关联需求（直接选岗位）</option>
            <option
              v-for="d in recruitingDemands"
              :key="d._id"
              :value="d._id"
            >
              {{ d.title }} — {{ d.department?.displayName || d.department || '' }} ({{ d.headcount || 0 }}人)
              <template v-if="!d.linkedJobId">⚠未关联岗位</template>
            </option>
          </select>
          <span v-if="recruitingDemands.length === 0 && !demandsLoading" class="form-hint">
            暂无招聘中的需求，请直接选择岗位
          </span>
        </div>
      </div>
    </section>

    <!-- 岗位选择 -->
    <section class="form-section card">
      <h3 class="section-title">选择岗位 <span class="required">*</span></h3>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">部门筛选（可选）</label>
          <select
            v-model="selectedDept"
            class="form-select"
            :disabled="submitting"
          >
            <option value="">全部部门</option>
            <option v-for="dept in availableDepts" :key="dept" :value="dept">{{ dept }}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">
            岗位
            <span v-if="demandLinkedJobId && selectedJobId === demandLinkedJobId" class="tag-auto">已自动关联</span>
          </label>
          <select
            v-model="selectedJobId"
            class="form-select"
            :disabled="submitting || jobsLoading"
          >
            <option value="" disabled>{{ jobsLoading ? '加载中...' : '请选择招聘岗位' }}</option>
            <option
              v-for="job in filteredJobs"
              :key="job._id"
              :value="job._id"
            >
              {{ job.title }} — {{ job.department || '未分配部门' }}
              <template v-if="job.interviewRounds">
                ({{ job.interviewRounds }}轮面试)
              </template>
            </option>
          </select>
          <span v-if="filteredJobs.length === 0 && !jobsLoading" class="form-hint form-hint-warning">
            ⚠️ 系统中暂无活跃岗位，请联系管理员创建岗位或运行初始化脚本（scripts/seed-data.js）。
          </span>
          <span v-else class="form-hint">
            如果未显示目标岗位，请联系管理员在"系统设置"中添加。
          </span>
        </div>
      </div>
    </section>

    <!-- 补充信息 -->
    <section class="form-section card">
      <h3 class="section-title">补充信息</h3>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">简历来源</label>
          <select v-model="source" class="form-select" :disabled="submitting">
            <option value="manual">手动上传</option>
            <option value="email">邮箱收取</option>
            <option value="import">批量导入</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">招聘渠道</label>
          <select v-model="recruitmentSource" class="form-select" :disabled="submitting">
            <option value="">请选择</option>
            <option v-for="s in configStore.recruitmentSources" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea
          v-model="notes"
          class="form-input"
          rows="3"
          placeholder="选填：补充说明..."
          :disabled="submitting"
        ></textarea>
      </div>
    </section>

    <!-- 重复检测提示 -->
    <section v-if="hasDuplicates" class="duplicate-warning">
      <div class="duplicate-header">
        <svg class="duplicate-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
        </svg>
        <div>
          <h4 class="duplicate-title">发现可能重复的候选人（{{ duplicates.length }} 条）</h4>
          <p class="duplicate-desc">同一候选人投不同岗位是正常行为，系统不会阻止录入，但请确认是否为同一个人</p>
        </div>
      </div>

      <div class="duplicate-list">
        <div
          v-for="(dup, i) in duplicates"
          :key="i"
          class="duplicate-item"
          :class="{
            'is-exact': dup.matchLevel === 'exact',
            'is-high': dup.matchLevel === 'high',
            'is-medium': dup.matchLevel === 'medium',
          }"
        >
          <span class="duplicate-badge" :class="`badge-${dup.matchLevel}`">
            {{ dup.matchLevel === 'exact' ? '完全重复' : dup.matchLevel === 'high' ? '高置信度' : '可能重复' }}
          </span>
          <span class="duplicate-reason">{{ dup.matchReason }}</span>
          <span class="duplicate-name">
            — {{ dup.candidate?.name || '未知' }}
            <template v-if="dup.candidate?.phone"> · {{ dup.candidate.phone }}</template>
          </span>
        </div>
      </div>

      <div class="duplicate-ack">
        <label class="duplicate-ack-label">
          <input
            v-model="duplicateAcknowledged"
            type="checkbox"
            class="duplicate-checkbox"
            :disabled="submitting"
          />
          <span>已知晓，继续录入此候选人</span>
        </label>
      </div>
    </section>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <button class="btn btn-secondary" @click="$emit('cancel')" :disabled="submitting">
        返回修改
      </button>
      <button
        class="btn btn-primary btn-lg"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <span v-if="submitting" class="spinner"></span>
        {{ submitting ? '创建中...' : '确认创建候选人' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.candidate-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

/* === 分区 === */
.form-section {
  padding: var(--spacing-lg);
}

.section-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--gray-700);
  margin-bottom: var(--spacing-lg);
}

.section-hint {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin: -8px 0 var(--spacing-md);
}

.required { color: var(--danger); }

.tag-auto {
  display: inline-block;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--success);
  background: #e8f5e9;
  border-radius: var(--radius-full);
  vertical-align: middle;
}

/* === 表单 === */
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.form-hint {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  margin-top: 4px;
}

.form-hint-warning {
  color: var(--warning, #d4a24e);
  font-weight: 500;
}

/* === 重复检测 === */
.duplicate-warning {
  padding: var(--spacing-lg);
  background: var(--warning-bg);
  border: 1px solid rgba(212, 162, 78, 0.3);
  border-radius: var(--radius);
}

.duplicate-header {
  display: flex;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.duplicate-icon {
  width: 28px;
  height: 28px;
  color: var(--warning);
  flex-shrink: 0;
}

.duplicate-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--gray-700);
  margin-bottom: 2px;
}

.duplicate-desc {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  line-height: 1.5;
}

.duplicate-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.duplicate-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--card-bg, #fff);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--gray-300);
}

.duplicate-item.is-exact { border-left-color: var(--danger); }
.duplicate-item.is-high { border-left-color: var(--warning); }
.duplicate-item.is-medium { border-left-color: var(--accent); }

.duplicate-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 600;
  flex-shrink: 0;
}

.badge-exact { background: var(--danger-bg); color: var(--danger); }
.badge-high { background: var(--warning-bg); color: var(--warning); }
.badge-medium { background: var(--accent-bg); color: var(--accent); }

.duplicate-reason {
  font-size: var(--font-size-sm);
  color: var(--gray-600);
  flex: 1;
}

.duplicate-name {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  flex-shrink: 0;
}

.duplicate-ack {
  padding-top: var(--spacing-sm);
  border-top: 1px solid rgba(212, 162, 78, 0.2);
}

.duplicate-ack-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--gray-600);
  cursor: pointer;
}

.duplicate-checkbox {
  width: 18px; height: 18px;
  accent-color: var(--primary);
  cursor: pointer;
}

/* === 操作按钮 === */
.form-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  margin-top: var(--spacing-lg);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--gray-100);
}
</style>
