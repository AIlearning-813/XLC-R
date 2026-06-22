<script setup>
/**
 * SystemConfigTab.vue — 系统配置管理 Tab
 *
 * 管理：部门、城市、岗位类型、告警阈值。
 * Admin 直接修改，Recruiter 通过 PendingChanges 提交审批。
 */
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../../stores/useConfigStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { usePendingChangeStore } from '../../stores/usePendingChangeStore';
import { FUNNEL_STAGES } from '../../config/constants';

const config = useConfigStore();
const auth = useAuthStore();
const pendingStore = usePendingChangeStore();

onMounted(() => {
  config.loadConfig();
});

// ===== Toast 反馈 =====
const submitMsg = ref('');
const submitMsgType = ref('success'); // 'success' | 'error'
function showMsg(msg, type = 'success') {
  submitMsg.value = msg;
  submitMsgType.value = type;
  setTimeout(() => { submitMsg.value = ''; }, 3000);
}

// ===== 部门管理 =====
const newDept = ref('');
const editingDept = ref(null);
const editingDeptName = ref('');

async function submitAddDept() {
  const name = newDept.value.trim();
  if (!name) return;
  if (auth.isAdmin) {
    config.addDepartment(name);
    showMsg(`已添加部门：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'department',
        entityId: 'system', entityLabel: `添加部门: ${name}`,
        before: { departments: config.departments },
        after: { departments: [...config.departments, name] },
      });
      showMsg(`已提交"添加部门：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  newDept.value = '';
}

function startEditDept(name) {
  editingDept.value = name;
  editingDeptName.value = name;
}

async function submitEditDept() {
  const newName = editingDeptName.value.trim();
  if (!newName || newName === editingDept.value) { editingDept.value = null; return; }
  if (auth.isAdmin) {
    config.updateDepartment(editingDept.value, newName);
    showMsg(`已修改部门：${editingDept.value} → ${newName}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'department',
        entityId: 'system', entityLabel: `修改部门: ${editingDept.value} → ${newName}`,
        before: { departments: config.departments },
        after: { departments: config.departments.map(d => d === editingDept.value ? newName : d) },
      });
      showMsg(`已提交"修改部门"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  editingDept.value = null;
}

async function removeDept(name) {
  if (!confirm(`确定删除部门「${name}」？`)) return;
  if (auth.isAdmin) {
    config.removeDepartment(name);
    showMsg(`已删除部门：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'department',
        entityId: 'system', entityLabel: `删除部门: ${name}`,
        before: { departments: config.departments },
        after: { departments: config.departments.filter(d => d !== name) },
      });
      showMsg(`已提交"删除部门：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
}

// ===== 城市管理 =====
const newCity = ref('');

async function submitAddCity() {
  const name = newCity.value.trim();
  if (!name) return;
  if (auth.isAdmin) {
    config.addCity(name);
    showMsg(`已添加城市：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'city',
        entityId: 'system', entityLabel: `添加城市: ${name}`,
        before: { cities: config.cities },
        after: { cities: [...config.cities, name] },
      });
      showMsg(`已提交"添加城市：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  newCity.value = '';
}

async function removeCity(name) {
  if (!confirm(`确定删除城市「${name}」？`)) return;
  if (auth.isAdmin) {
    config.removeCity(name);
    showMsg(`已删除城市：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'city',
        entityId: 'system', entityLabel: `删除城市: ${name}`,
        before: { cities: config.cities },
        after: { cities: config.cities.filter(c => c !== name) },
      });
      showMsg(`已提交"删除城市：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
}

// ===== 岗位类型管理 =====
const newJobType = ref({ key: '', label: '', interviewRounds: 3 });
const showJobTypeForm = ref(false);

async function submitAddJobType() {
  const { key, label, interviewRounds } = newJobType.value;
  if (!key || !label) return;
  const config_ = { label, interviewRounds: Number(interviewRounds) || 3 };
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
  newJobType.value = { key: '', label: '', interviewRounds: 3 };
  showJobTypeForm.value = false;
}

async function removeJobType(key) {
  const label = config.jobTypes[key]?.label || key;
  if (!confirm(`确定删除岗位类型「${label}」？`)) return;
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

// ===== 告警阈值 =====
async function onChangeThreshold(stageKey, days) {
  const val = Number(days);
  if (isNaN(val) || val < 1) return;
  if (auth.isAdmin) {
    config.updateAlertThreshold(stageKey, val);
    showMsg(`已更新告警阈值`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'alertThreshold',
        entityId: 'system', entityLabel: `修改告警阈值: ${stageKey} → ${val}天`,
        before: { alertThresholds: config.alertThresholds },
        after: { alertThresholds: { ...config.alertThresholds, [stageKey]: val } },
      });
      showMsg(`已提交"修改告警阈值"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
}
</script>

<template>
  <div class="system-config">
    <!-- Toast 反馈 -->
    <transition name="fade">
      <div v-if="submitMsg" class="submit-toast" :class="submitMsgType === 'error' ? 'toast-error' : 'toast-success'">
        {{ submitMsg }}
      </div>
    </transition>

    <!-- 部门管理 -->
    <section class="config-section">
      <h3 class="section-title">部门管理</h3>
      <div class="chip-group">
        <span v-for="dept in config.departments" :key="dept" class="chip">
          <template v-if="editingDept === dept">
            <input v-model="editingDeptName" class="chip-input" @keyup.enter="submitEditDept" @blur="submitEditDept" size="8" />
          </template>
          <template v-else>
            {{ dept }}
            <button class="chip-edit" @click="startEditDept(dept)" title="编辑">✎</button>
            <button class="chip-remove" @click="removeDept(dept)" title="删除">×</button>
          </template>
        </span>
        <span class="chip chip-add">
          <input v-model="newDept" class="chip-input" placeholder="新部门" @keyup.enter="submitAddDept" size="10" />
          <button class="chip-confirm" @click="submitAddDept">+</button>
        </span>
      </div>
    </section>

    <!-- 城市管理 -->
    <section class="config-section">
      <h3 class="section-title">工作城市</h3>
      <div class="chip-group">
        <span v-for="city in config.cities" :key="city" class="chip">
          {{ city }}
          <button class="chip-remove" @click="removeCity(city)" title="删除">×</button>
        </span>
        <span class="chip chip-add">
          <input v-model="newCity" class="chip-input" placeholder="新城市" @keyup.enter="submitAddCity" size="8" />
          <button class="chip-confirm" @click="submitAddCity">+</button>
        </span>
      </div>
    </section>

    <!-- 岗位类型管理 -->
    <section class="config-section">
      <h3 class="section-title">岗位类型</h3>
      <div class="table-mini">
        <div class="table-row table-header">
          <span class="col-key">类型</span>
          <span class="col-label">名称</span>
          <span class="col-rounds">面试轮次</span>
          <span class="col-action"></span>
        </div>
        <div v-for="(val, key) in config.jobTypes" :key="key" class="table-row">
          <span class="col-key">{{ key }}</span>
          <span class="col-label">{{ val.label }}</span>
          <span class="col-rounds">{{ val.interviewRounds }} 轮</span>
          <span class="col-action">
            <button class="btn-text danger" @click="removeJobType(key)">删除</button>
          </span>
        </div>
      </div>

      <div v-if="showJobTypeForm" class="inline-form">
        <input v-model="newJobType.key" placeholder="Key (如 CC)" class="input-sm" size="10" />
        <input v-model="newJobType.label" placeholder="名称 (如 CC)" class="input-sm" size="10" />
        <select v-model.number="newJobType.interviewRounds" class="input-sm">
          <option :value="2">2 轮</option>
          <option :value="3">3 轮</option>
        </select>
        <button class="btn btn-sm btn-primary" @click="submitAddJobType">添加</button>
        <button class="btn btn-sm" @click="showJobTypeForm = false">取消</button>
      </div>
      <button v-else class="btn-link" @click="showJobTypeForm = true">+ 添加岗位类型</button>
    </section>

    <!-- 告警阈值 -->
    <section class="config-section">
      <h3 class="section-title">阶段停留告警阈值（天）</h3>
      <p class="section-desc">候选人超过阈值未推进时触发"待跟进"提醒</p>
      <div class="threshold-grid">
        <div v-for="stage in FUNNEL_STAGES" :key="stage.key" class="threshold-item">
          <label class="threshold-label" :title="stage.key">{{ stage.label }}</label>
          <input
            type="number"
            class="input-sm threshold-input"
            :value="config.getAlertThreshold(stage.key)"
            @change="onChangeThreshold(stage.key, ($event.target).value)"
            min="1"
            max="60"
          />
          <span class="threshold-unit">天</span>
        </div>
      </div>
    </section>

    <!-- 底部提示 -->
    <p v-if="!auth.isAdmin" class="hint-recruiter">⚠ 你的修改将提交给管理员审核后生效</p>
  </div>
</template>

<style scoped>
.system-config { max-width: 800px; }

.config-section {
  margin-bottom: var(--spacing-xl);
  padding-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--gray-100);
}
.config-section:last-child { border-bottom: none; }

.section-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--gray-700);
  margin: 0 0 var(--spacing-xs);
}
.section-desc {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin: 0 0 var(--spacing-md);
}

/* Toast */
.submit-toast {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  padding: 12px 20px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  max-width: 400px;
}
.toast-success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
.toast-error { background: #fce4ec; color: #c62828; border: 1px solid #ef9a9a; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Chip 组 */
.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--gray-50);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--gray-600);
}
.chip-add {
  background: var(--primary-bg);
  border-color: var(--primary-border);
}
.chip-input {
  border: none;
  background: transparent;
  font-size: var(--font-size-sm);
  color: var(--gray-700);
  outline: none;
  min-width: 40px;
}
.chip-input:focus { background: rgba(255,255,255,0.5); }
.chip-edit, .chip-remove, .chip-confirm {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  padding: 0 2px;
  color: var(--gray-400);
  line-height: 1;
}
.chip-edit:hover, .chip-confirm:hover { color: var(--primary); }
.chip-remove:hover { color: var(--danger); }

/* 迷你表格 */
.table-mini {
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  margin-bottom: var(--spacing-sm);
}
.table-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  font-size: var(--font-size-sm);
  border-bottom: 1px solid var(--gray-50);
}
.table-row:last-child { border-bottom: none; }
.table-header {
  background: var(--gray-50);
  font-weight: 600;
  color: var(--gray-500);
}
.col-key { width: 120px; }
.col-label { flex: 1; }
.col-rounds { width: 80px; text-align: center; }
.col-action { width: 60px; text-align: right; }

/* 内联表单 */
.inline-form {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}

/* 阈值网格 */
.threshold-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--spacing-sm);
}
.threshold-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--gray-50);
  border-radius: var(--radius-sm);
}
.threshold-label {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--gray-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.threshold-input { width: 52px; }
.threshold-unit { font-size: var(--font-size-xs); color: var(--gray-400); }

/* 通用 */
.input-sm {
  padding: 4px 8px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-family: inherit;
}
.btn-text { border: none; background: none; cursor: pointer; font-size: var(--font-size-sm); }
.btn-text.danger { color: var(--danger); }
.btn-text.danger:hover { text-decoration: underline; }
.btn-link {
  border: none; background: none; cursor: pointer;
  color: var(--primary); font-size: var(--font-size-sm);
  padding: 0;
}
.btn-link:hover { text-decoration: underline; }

.hint-recruiter {
  margin-top: var(--spacing-md);
  padding: var(--spacing-sm);
  background: var(--warning-bg);
  color: var(--warning);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}
</style>
