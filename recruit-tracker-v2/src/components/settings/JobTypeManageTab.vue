<script setup>
/**
 * JobTypeManageTab.vue — 岗位类型配置 Tab
 *
 * 管理岗位类型（key、名称、面试轮次、职责、资格要求），
 * 新建招聘需求时自动关联。
 */
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../../stores/useConfigStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { usePendingChangeStore } from '../../stores/usePendingChangeStore';

const config = useConfigStore();
const auth = useAuthStore();
const pendingStore = usePendingChangeStore();

// 挂载时加载配置（确保 CloudBase 数据同步到本地）
onMounted(() => { config.loadConfig(); });

// ===== Toast =====
const submitMsg = ref('');
const submitMsgType = ref('success');
function showMsg(msg, type = 'success') {
  submitMsg.value = msg;
  submitMsgType.value = type;
  setTimeout(() => { submitMsg.value = ''; }, 3000);
}

// ===== 岗位类型管理 =====
const newJobType = ref({ key: '', label: '', interviewRounds: 3, responsibilities: '', requirements: '' });
const showJobTypeForm = ref(false);
const editingJobTypeKey = ref(null);
const editJobTypeForm = ref({ label: '', interviewRounds: 3, responsibilities: '', requirements: '' });

async function submitAddJobType() {
  const { key, label, interviewRounds, responsibilities, requirements } = newJobType.value;
  if (!key || !label) return;
  const config_ = {
    label, interviewRounds: Number(interviewRounds) || 3,
    responsibilities: responsibilities || '', requirements: requirements || '',
  };
  if (auth.isAdmin) {
    config.addJobType(key, config_);
    showMsg(`已添加岗位类型：${label}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'jobType',
        entityId: 'system', entityLabel: `添加岗位类型: ${label}`,
        before: { jobTypes: config.jobTypes },
        after: { jobTypes: { ...config.jobTypes, [key]: config_ } },
      });
      showMsg(`已提交"添加岗位类型：${label}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  newJobType.value = { key: '', label: '', interviewRounds: 3, responsibilities: '', requirements: '' };
  showJobTypeForm.value = false;
}

function startEditJobType(key) {
  editingJobTypeKey.value = key;
  const jt = config.jobTypes[key] || {};
  editJobTypeForm.value = {
    label: jt.label || key,
    interviewRounds: jt.interviewRounds || 3,
    responsibilities: jt.responsibilities || '',
    requirements: jt.requirements || '',
  };
}

async function submitEditJobType(key) {
  const { label, interviewRounds, responsibilities, requirements } = editJobTypeForm.value;
  const config_ = {
    label, interviewRounds: Number(interviewRounds) || 3,
    responsibilities: responsibilities || '', requirements: requirements || '',
  };
  if (auth.isAdmin) {
    config.updateJobType(key, config_);
    showMsg(`已更新岗位类型：${label}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'jobType',
        entityId: 'system', entityLabel: `修改岗位类型: ${label}`,
        before: { jobTypes: config.jobTypes },
        after: { jobTypes: { ...config.jobTypes, [key]: { ...config.jobTypes[key], ...config_ } } },
      });
      showMsg(`已提交"修改岗位类型：${label}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  editingJobTypeKey.value = null;
}

function cancelEditJobType() { editingJobTypeKey.value = null; }

async function removeJobType(key) {
  const label = config.jobTypes[key]?.label || key;
  if (!confirm(`确定删除岗位类型「${label}」？\n\n注意：已关联此类型的岗位不受影响。`)) return;
  if (auth.isAdmin) {
    config.removeJobType(key);
    showMsg(`已删除岗位类型：${label}`);
  } else {
    try {
      const updated = { ...config.jobTypes };
      delete updated[key];
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'jobType',
        entityId: 'system', entityLabel: `删除岗位类型: ${label}`,
        before: { jobTypes: config.jobTypes },
        after: { jobTypes: updated },
      });
      showMsg(`已提交"删除岗位类型：${label}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
}
</script>

<template>
  <div class="job-type-manage">
    <!-- Toast -->
    <transition name="fade">
      <div v-if="submitMsg" class="submit-toast" :class="submitMsgType === 'error' ? 'toast-error' : 'toast-success'">
        {{ submitMsg }}
      </div>
    </transition>

    <section class="config-section">
      <h3 class="section-title">岗位类型</h3>
      <p class="section-desc">每个岗位类型的职责和资格要求，新建招聘需求时自动关联</p>

      <div class="job-type-cards">
        <div v-for="(val, key) in config.jobTypes" :key="key" class="jt-card" :class="{ 'jt-editing': editingJobTypeKey === key }">
          <!-- 展示模式 -->
          <template v-if="editingJobTypeKey !== key">
            <div class="jt-header">
              <span class="jt-key">{{ key }}</span>
              <span class="jt-label">{{ val.label }}</span>
              <span class="jt-rounds">{{ val.interviewRounds }}轮面试</span>
              <div class="jt-actions">
                <button class="btn-icon-sm" title="编辑" @click="startEditJobType(key)">&#9998;</button>
                <button class="btn-icon-sm btn-del" title="删除" @click="removeJobType(key)">&#10005;</button>
              </div>
            </div>
            <div class="jt-body">
              <div class="jt-field">
                <span class="jt-field-label">岗位职责</span>
                <span class="jt-field-value">{{ val.responsibilities || '未设置' }}</span>
              </div>
              <div class="jt-field">
                <span class="jt-field-label">任职资格</span>
                <span class="jt-field-value">{{ val.requirements || '未设置' }}</span>
              </div>
            </div>
          </template>

          <!-- 编辑模式 -->
          <template v-else>
            <div class="jt-edit-form">
              <div class="jt-edit-row">
                <label>名称</label>
                <input v-model="editJobTypeForm.label" class="input-sm" />
                <label>面试轮次</label>
                <select v-model.number="editJobTypeForm.interviewRounds" class="input-sm">
                  <option :value="2">2 轮</option>
                  <option :value="3">3 轮</option>
                </select>
              </div>
              <div class="jt-edit-row">
                <label>岗位职责</label>
                <textarea v-model="editJobTypeForm.responsibilities" class="input-sm jt-textarea" rows="3" placeholder="描述该岗位的主要职责..."></textarea>
              </div>
              <div class="jt-edit-row">
                <label>任职资格</label>
                <textarea v-model="editJobTypeForm.requirements" class="input-sm jt-textarea" rows="3" placeholder="描述任职资格要求..."></textarea>
              </div>
              <div class="jt-edit-actions">
                <button class="btn btn-sm btn-primary" @click="submitEditJobType(key)">保存</button>
                <button class="btn btn-sm" @click="cancelEditJobType">取消</button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 新增岗位类型 -->
      <div v-if="showJobTypeForm" class="jt-card jt-new">
        <div class="jt-edit-form">
          <div class="jt-edit-row">
            <label>Key <span class="req">*</span></label>
            <input v-model="newJobType.key" placeholder="如 CC" class="input-sm" />
            <label>名称 <span class="req">*</span></label>
            <input v-model="newJobType.label" placeholder="如 课程顾问" class="input-sm" />
            <label>面试轮次</label>
            <select v-model.number="newJobType.interviewRounds" class="input-sm">
              <option :value="2">2 轮</option>
              <option :value="3">3 轮</option>
            </select>
          </div>
          <div class="jt-edit-row">
            <label>岗位职责</label>
            <textarea v-model="newJobType.responsibilities" class="input-sm jt-textarea" rows="3" placeholder="描述该岗位的主要职责..."></textarea>
          </div>
          <div class="jt-edit-row">
            <label>任职资格</label>
            <textarea v-model="newJobType.requirements" class="input-sm jt-textarea" rows="3" placeholder="描述任职资格要求..."></textarea>
          </div>
          <div class="jt-edit-actions">
            <button class="btn btn-sm btn-primary" @click="submitAddJobType">添加</button>
            <button class="btn btn-sm" @click="showJobTypeForm = false">取消</button>
          </div>
        </div>
      </div>
      <button v-else class="btn-link" @click="showJobTypeForm = true">+ 添加岗位类型</button>
    </section>

    <p v-if="!auth.isAdmin" class="hint-recruiter">⚠ 你的修改将提交给管理员审核后生效</p>
  </div>
</template>

<style scoped>
.job-type-manage { max-width: 800px; }

.config-section { margin-bottom: var(--spacing-xl); padding-bottom: var(--spacing-lg); border-bottom: 1px solid var(--gray-100); }
.config-section:last-child { border-bottom: none; }

.section-title { font-size: var(--font-size-md); font-weight: 600; color: var(--gray-700); margin: 0 0 var(--spacing-xs); }
.section-desc { font-size: var(--font-size-sm); color: var(--gray-400); margin: 0 0 var(--spacing-md); }

/* Toast */
.submit-toast { position: fixed; top: 16px; right: 16px; z-index: 9999; padding: 12px 20px; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; box-shadow: var(--shadow-lg); max-width: 400px; }
.toast-success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
.toast-error { background: #fce4ec; color: #c62828; border: 1px solid #ef9a9a; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 岗位类型卡片 */
.job-type-cards { display: flex; flex-direction: column; gap: 10px; margin-bottom: var(--spacing-sm); }
.jt-card { border: 1px solid var(--gray-100); border-radius: var(--radius-md); background: #fff; overflow: hidden; transition: border-color 0.2s; }
.jt-card:hover { border-color: var(--gray-200); }
.jt-card.jt-editing { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(74,108,247,0.08); }
.jt-card.jt-new { border-style: dashed; border-color: var(--gray-200); background: var(--gray-25); }

.jt-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; }
.jt-key { font-weight: 700; font-size: var(--font-size-sm); color: var(--primary); background: rgba(74,108,247,0.08); padding: 2px 10px; border-radius: var(--radius-sm); min-width: 50px; text-align: center; }
.jt-label { font-weight: 600; color: var(--gray-700); flex: 1; }
.jt-rounds { font-size: var(--font-size-xs); color: var(--gray-400); background: var(--gray-50); padding: 2px 8px; border-radius: var(--radius-full); }
.jt-actions { display: flex; gap: 2px; }
.btn-icon-sm { width: 28px; height: 28px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; color: var(--gray-400); font-family: inherit; transition: all 0.15s; }
.btn-icon-sm:hover { background: var(--gray-50); color: var(--gray-600); border-color: var(--gray-200); }
.btn-icon-sm.btn-del:hover { color: var(--danger); background: rgba(229,62,62,0.06); border-color: rgba(229,62,62,0.2); }

.jt-body { padding: 0 14px 12px; display: flex; flex-direction: column; gap: 6px; }
.jt-field { display: flex; gap: 8px; align-items: baseline; }
.jt-field-label { font-size: var(--font-size-xs); font-weight: 600; color: var(--gray-400); min-width: 56px; flex-shrink: 0; }
.jt-field-value { font-size: var(--font-size-sm); color: var(--gray-600); white-space: pre-wrap; }

.jt-edit-form { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.jt-edit-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.jt-edit-row label { font-size: var(--font-size-xs); font-weight: 600; color: var(--gray-500); min-width: 56px; }
.jt-edit-row .input-sm { flex: 1; min-width: 100px; }
.jt-textarea { resize: vertical; flex: 1; min-width: 100px; font-family: inherit; }
.jt-edit-actions { display: flex; gap: var(--spacing-xs); justify-content: flex-end; padding-top: 4px; }
.req { color: var(--danger); }

.input-sm { padding: 4px 8px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; }
.btn-link { border: none; background: none; cursor: pointer; color: var(--primary); font-size: var(--font-size-sm); padding: 0; }
.btn-link:hover { text-decoration: underline; }

.hint-recruiter { margin-top: var(--spacing-md); padding: var(--spacing-sm); background: var(--warning-bg); color: var(--warning); border-radius: var(--radius-sm); font-size: var(--font-size-sm); }
</style>
