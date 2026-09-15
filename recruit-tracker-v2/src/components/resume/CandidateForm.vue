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

const hasDuplicates = computed(() => props.duplicates.length > 0);

/**
 * 强重复级：exact（文件哈希相同）与 high（手机号 / 邮箱完全相同）。
 *
 * 2026-09-15 变更（业务决定，方案乙）：
 *   这两级原本是**硬阻断**——不给放行入口，只提示「请到候选人模块查看已有记录」。
 *   实际使用中构成死结：候选人归属别的专员时，候选人列表按归属过滤，
 *   当前用户**搜不到**这条记录，却又被禁止重复录入，等于卡死；
 *   而那句指引要求用户去做一件 TA 做不到的事（卢思颖 × 徐哲湲 案例）。
 *   现改为：仍然强提示，并写明**这条记录现在归属谁**，但允许放行——
 *   两位专员各自保留一份自己的简历记录，岗位归属由各自的 Application 决定。
 *
 * medium（姓名相同 + ≥2 维交叉）：同名不同人真实存在，与上面两级一样只做提示。
 */
const blockingDuplicates = computed(() =>
  props.duplicates.filter((d) => d.matchLevel === 'exact' || d.matchLevel === 'high')
);

const hasBlockingDuplicates = computed(() => blockingDuplicates.value.length > 0);

/** 强重复原因说明 */
const blockingReason = computed(() => {
  const levels = new Set(blockingDuplicates.value.map((d) => d.matchLevel));
  if (levels.has('exact')) return '同一份简历文件已录入过';
  if (levels.has('high')) return '手机号或邮箱与已有候选人完全相同';
  return '已存在重复候选人';
});

/**
 * 这条重复记录当前归属谁。
 * detectDuplicates 全库查重（不限归属），所以命中别人的记录时 ownerId 就是对方账号，
 * 这正是上传者需要知道的信息：不是"你不能录"，而是"这条现在谁在跟"。
 */
function duplicateOwner(dup) {
  return dup?.candidate?.ownerId || dup?.candidate?.createdBy || '未知';
}

/** 命中的归属人去重汇总，用于顶部说明文案 */
const duplicateOwners = computed(() => {
  const owners = props.duplicates.map((d) => duplicateOwner(d)).filter((o) => o && o !== '未知');
  return [...new Set(owners)];
});

const canSubmit = computed(() => {
  if (!isFormValid.value || props.submitting) return false;
  // 所有重复级别一律「勾选已知晓即可放行」，不再有硬阻断入口
  if (hasDuplicates.value && !duplicateAcknowledged.value) return false;
  return true;
});

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
    <section
      v-if="hasDuplicates"
      class="duplicate-warning"
      :class="{ 'is-blocked': hasBlockingDuplicates }"
    >
      <div class="duplicate-header">
        <svg class="duplicate-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
        </svg>
        <div>
          <h4 class="duplicate-title">发现可能重复的候选人（{{ duplicates.length }} 条）</h4>
          <p class="duplicate-desc">
            <template v-if="hasBlockingDuplicates">
              {{ blockingReason }}。<template v-if="duplicateOwners.length">当前归属：{{ duplicateOwners.join('、') }}。</template>
              你可以继续录入，系统会为你另存一份记录；如要在这条已有记录上追加投递岗位，请与归属人对接。
            </template>
            <template v-else>
              同一候选人投不同岗位是正常行为，系统不会阻止录入，但请确认是否为同一个人
            </template>
          </p>
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
            · 归属：{{ duplicateOwner(dup) }}
          </span>
        </div>
      </div>

      <!-- 所有重复级别统一：人工确认后即可放行，不再有硬阻断 -->
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

/* === 强重复告警（exact / high）：只提示归属，不阻断录入 === */
.duplicate-warning.is-blocked {
  background: var(--danger-bg);
  border-color: rgba(220, 53, 69, 0.3);
}

.duplicate-warning.is-blocked .duplicate-icon {
  color: var(--danger);
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
