<script setup>
/**
 * AssignDemandDialog.vue — 关联招聘需求弹窗
 *
 * 用于：候选人列表"待分配"入口 / 候选人详情"修改关联"入口
 * 流程：选择招聘需求 → 自动带出岗位 → 确认创建 Application
 */
import { ref, computed, onMounted } from 'vue';
import cloudbase from '../../services/cloudbase';
import { useRecruitmentDemandStore } from '../../stores/useRecruitmentDemandStore';
import { useJobStore } from '../../stores/useJobStore';
import { useAuthStore } from '../../stores/useAuthStore';

const db = cloudbase.db();

const props = defineProps({
  candidateId: { type: String, required: true },
  candidateName: { type: String, default: '' },
  /** 已有的 Application ID（如果是修改关联则传入，用于更新而非新建） */
  existingAppId: { type: String, default: '' },
});

const emit = defineEmits(['assigned', 'close']);

const demandStore = useRecruitmentDemandStore();
const jobStore = useJobStore();
const auth = useAuthStore();

// ===== 状态 =====
const demands = ref([]);
const demandsLoading = ref(false);
const selectedDemandId = ref('');
const submitting = ref(false);
const msg = ref('');
const msgType = ref('success');

// ===== 计算属性 =====
const selectedDemand = computed(() => {
  return demands.value.find(d => d._id === selectedDemandId.value) || null;
});

const linkedJob = computed(() => {
  const demand = selectedDemand.value;
  if (!demand?.linkedJobId) return null;
  return jobStore.getById(demand.linkedJobId);
});

const canSubmit = computed(() => {
  return selectedDemandId.value && !submitting.value;
});

// ===== 加载 =====
onMounted(async () => {
  demandsLoading.value = true;
  try {
    const result = await demandStore.fetchAll('recruiting');
    demands.value = result || [];
  } catch (err) {
    console.warn('[AssignDemandDialog] 加载需求失败:', err.message);
  } finally {
    demandsLoading.value = false;
  }
  // 确保岗位列表已加载（用于获取 linkedJob 详情）
  if (jobStore.jobs.length === 0) {
    await jobStore.fetchActive();
  }
});

// ===== 提交 =====
async function handleAssign() {
  if (!canSubmit.value) return;
  const demand = selectedDemand.value;
  if (!demand?.linkedJobId) {
    msg.value = `需求「${demand?.title || '未知'}」尚未关联岗位，请先在需求详情中创建岗位`;
    msgType.value = 'error';
    return;
  }

  submitting.value = true;
  msg.value = '';

  try {
    if (props.existingAppId) {
      // 已有 Application → 更新 jobId 和 demandId
      await db.collection('Application').doc(props.existingAppId).update({
        jobId: demand.linkedJobId,
        demandId: demand._id,
        demandTitle: demand.title || '',
        ownerId: auth.currentUsername || '',
        updatedAt: new Date(),
      });
    } else {
      // 新建 Application
      const appDoc = {
        candidateId: props.candidateId,
        jobId: demand.linkedJobId,
        demandId: demand._id,
        demandTitle: demand.title || '',
        stage: 'resume',
        stageEnteredAt: new Date(),
        status: 'active',
        funnel: { resumeAt: new Date() },
        funnelMeta: { entrySource: 'manual' },
        source: 'manual',
        ownerId: auth.currentUsername || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.collection('Application').add(appDoc);
    }

    emit('assigned', {
      demandId: demand._id,
      demandTitle: demand.title,
      jobId: demand.linkedJobId,
      isNew: !props.existingAppId,
    });
  } catch (err) {
    console.error('[AssignDemandDialog] 关联失败:', err.message);
    msg.value = `关联失败：${err.message}`;
    msgType.value = 'error';
  } finally {
    submitting.value = false;
  }
}

function getStatusLabel(status) {
  const labels = { pending: '待审批', active: '已生效', recruiting: '招聘中', completed: '已完成', closed: '已关闭' };
  return labels[status] || status;
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-card">
      <div class="dialog-header">
        <h3>关联招聘需求</h3>
        <button class="dialog-close" @click="emit('close')">&times;</button>
      </div>

      <div class="dialog-body">
        <p v-if="candidateName" class="candidate-info">
          候选人：<strong>{{ candidateName }}</strong>
          <template v-if="existingAppId">（已有 Application，将更新关联）</template>
          <template v-else>（将新建 Application）</template>
        </p>

        <!-- 需求列表 -->
        <div v-if="demandsLoading" class="text-muted">加载中…</div>
        <div v-else-if="demands.length === 0" class="text-muted">
          暂无招聘中的需求。请先在"招聘需求"中创建需求。
        </div>
        <div v-else class="demand-list">
          <label
            v-for="d in demands"
            :key="d._id"
            class="demand-option"
            :class="{ selected: selectedDemandId === d._id }"
          >
            <input
              type="radio"
              :value="d._id"
              v-model="selectedDemandId"
              class="demand-radio"
            />
            <div class="demand-info">
              <div class="demand-title">
                {{ d.title }}
                <span class="demand-status" :class="'sts-' + d.status">{{ getStatusLabel(d.status) }}</span>
              </div>
              <div class="demand-meta">
                <span>{{ d.department?.displayName || d.department || '未知部门' }}</span>
                <span>·</span>
                <span>需求 {{ d.headcount || 0 }}人</span>
                <span v-if="d.linkedJobId">· ✅ 已关联岗位</span>
                <span v-else class="no-job">· ⚠️ 未关联岗位</span>
                <span v-if="d.submittedAt">· {{ new Date(d.submittedAt).toLocaleDateString() }} 提交</span>
              </div>
              <!-- 已关联的岗位信息 -->
              <div v-if="d.linkedJobId" class="linked-job-info">
                → 岗位：{{ jobStore.getById(d.linkedJobId)?.title || d.linkedJobId }}
              </div>
            </div>
          </label>
        </div>

        <!-- 选中需求的详情 -->
        <div v-if="selectedDemand" class="selected-summary">
          <p>
            <strong>已选：</strong>{{ selectedDemand.title }}
            （{{ selectedDemand.department?.displayName || selectedDemand.department || '' }}）
          </p>
          <p v-if="!selectedDemand.linkedJobId" class="warn-text">
            ⚠️ 该需求尚未关联岗位，请先在需求详情中创建岗位后再关联候选人。
          </p>
        </div>

        <div v-if="msg" class="msg-bar" :class="msgType === 'error' ? 'msg-error' : 'msg-success'">
          {{ msg }}
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="emit('close')" :disabled="submitting">取消</button>
        <button class="btn btn-primary" :disabled="!canSubmit" @click="handleAssign">
          {{ submitting ? '关联中…' : '确认关联' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.dialog-card {
  background: #fff; border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  width: 560px; max-width: 90vw; max-height: 80vh;
  display: flex; flex-direction: column;
}
.dialog-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-sm);
}
.dialog-header h3 { margin: 0; font-size: var(--font-size-lg); }
.dialog-close {
  border: none; background: none; font-size: 22px;
  cursor: pointer; color: var(--gray-400); line-height: 1;
}
.dialog-close:hover { color: var(--gray-600); }
.dialog-body {
  padding: var(--spacing-sm) var(--spacing-lg);
  overflow-y: auto; flex: 1;
}
.dialog-footer {
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--gray-100);
  display: flex; justify-content: flex-end; gap: var(--spacing-sm);
}

.candidate-info {
  font-size: var(--font-size-sm); color: var(--gray-500); margin-bottom: var(--spacing-md);
}

/* 需求列表 */
.demand-list {
  display: flex; flex-direction: column; gap: 6px;
  margin-bottom: var(--spacing-md);
  max-height: 320px; overflow-y: auto;
}
.demand-option {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
}
.demand-option:hover { border-color: var(--gray-200); background: var(--gray-25); }
.demand-option.selected { border-color: var(--primary); background: var(--primary-bg); }
.demand-radio { margin-top: 3px; accent-color: var(--primary); flex-shrink: 0; }
.demand-info { flex: 1; min-width: 0; }
.demand-title { font-weight: 600; font-size: var(--font-size-sm); color: var(--gray-700); }
.demand-status { display: inline-block; padding: 1px 8px; border-radius: var(--radius-full); font-size: 11px; margin-left: 6px; }
.sts-recruiting { background: #cce5ff; color: #004085; }
.sts-pending { background: #fff3cd; color: #856404; }
.demand-meta {
  font-size: var(--font-size-xs); color: var(--gray-400); margin-top: 2px;
  display: flex; gap: 4px; flex-wrap: wrap;
}
.no-job { color: var(--warning); }
.linked-job-info {
  font-size: var(--font-size-xs); color: var(--success); margin-top: 2px;
}

/* 选中总结 */
.selected-summary {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--primary-bg); border-radius: var(--radius-sm);
  font-size: var(--font-size-sm); margin-bottom: var(--spacing-sm);
}
.selected-summary p { margin: 0 0 2px; }
.warn-text { color: var(--warning); font-size: var(--font-size-xs); }

.msg-bar {
  padding: 8px 12px; border-radius: var(--radius-sm); font-size: var(--font-size-sm);
}
.msg-success { background: #e8f5e9; color: #2e7d32; }
.msg-error { background: #fce4ec; color: #c62828; }
.text-muted {
  color: var(--gray-400); font-size: var(--font-size-sm);
  padding: var(--spacing-md); text-align: center;
}
</style>
