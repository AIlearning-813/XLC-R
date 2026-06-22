<script setup>
/**
 * SystemConfigTab.vue — 系统配置管理 Tab
 *
 * 管理：部门、城市、岗位类型、告警阈值、招聘专员账号。
 * Admin 直接修改，Recruiter 通过 PendingChanges 提交审批。
 */
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../../stores/useConfigStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { usePendingChangeStore } from '../../stores/usePendingChangeStore';
import { FUNNEL_STAGES } from '../../config/constants';
import DepartmentTreeEditor from './DepartmentTreeEditor.vue';

const config = useConfigStore();
const auth = useAuthStore();
const pendingStore = usePendingChangeStore();

onMounted(() => {
  config.loadConfig();
  if (auth.isAdmin) loadUsers();
});

// ===== Toast 反馈 =====
const submitMsg = ref('');
const submitMsgType = ref('success'); // 'success' | 'error'
function showMsg(msg, type = 'success') {
  submitMsg.value = msg;
  submitMsgType.value = type;
  setTimeout(() => { submitMsg.value = ''; }, 3000);
}

// ===== 账号管理（仅管理员可见） =====
const users = ref([]);
const usersLoading = ref(false);
const showAddUserForm = ref(false);
const newUser = ref({ username: '', password: 'xlc2026', role: 'recruiter', name: '' });
const actingUserId = ref(null);

async function loadUsers() {
  usersLoading.value = true;
  try {
    users.value = await auth.fetchUsers();
  } catch (err) {
    console.error('加载用户列表失败:', err);
    showMsg(`加载用户列表失败：${err.message}`, 'error');
  } finally {
    usersLoading.value = false;
  }
}

async function submitAddUser() {
  const { username, password, role, name } = newUser.value;
  if (!username.trim() || !password.trim()) {
    showMsg('账号和密码不能为空', 'error');
    return;
  }
  actingUserId.value = '__add__';
  try {
    await auth.addUserAccount(username.trim(), password, role, name || username.trim());
    showMsg(`已添加用户「${username.trim()}」`);
    newUser.value = { username: '', password: 'xlc2026', role: 'recruiter', name: '' };
    showAddUserForm.value = false;
    await loadUsers();
  } catch (err) {
    showMsg(`添加失败：${err.message}`, 'error');
  } finally {
    actingUserId.value = null;
  }
}

async function handleDeleteUser(username) {
  if (!confirm(`确定删除账号「${username}」？\n\n删除后该用户无法登录，但其创建的数据仍保留在系统中。`)) return;
  actingUserId.value = username;
  try {
    await auth.deleteUserAccount(username);
    showMsg(`已删除用户「${username}」`);
    await loadUsers();
  } catch (err) {
    showMsg(`删除失败：${err.message}`, 'error');
  } finally {
    actingUserId.value = null;
  }
}

async function handleResetPassword(username) {
  const newPwd = prompt(`请输入「${username}」的新密码：`, 'xlc2026');
  if (!newPwd) return;
  actingUserId.value = username;
  try {
    await auth.resetUserPassword(username, newPwd);
    showMsg(`已重置「${username}」的密码`);
  } catch (err) {
    showMsg(`重置失败：${err.message}`, 'error');
  } finally {
    actingUserId.value = null;
  }
}

async function handleSeedDefaults() {
  if (!confirm('将创建默认管理员账号（admin）和 8 个招聘专员账号，密码均为 xlc2026。\n\n仅当系统中没有用户时才会创建。确定继续？')) return;
  try {
    const result = await auth.seedDefaultUsers();
    if (result.skipped) {
      showMsg('账号已存在，跳过初始化');
    } else {
      showMsg(result.message);
      await loadUsers();
    }
  } catch (err) {
    showMsg(`初始化失败：${err.message}`, 'error');
  }
}

function roleLabel(role) {
  return role === 'admin' ? '管理员' : '招聘专员';
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

// ===== 渠道来源管理 =====
const newSource = ref('');
const editingSource = ref(null);
const editingSourceName = ref('');

async function submitAddSource() {
  const name = newSource.value.trim();
  if (!name) return;
  if (auth.isAdmin) {
    config.addSource(name);
    showMsg(`已添加渠道来源：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'recruitmentSource',
        entityId: 'system', entityLabel: `添加渠道来源: ${name}`,
        before: { recruitmentSources: config.recruitmentSources },
        after: { recruitmentSources: [...config.recruitmentSources, name] },
      });
      showMsg(`已提交"添加渠道来源：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  newSource.value = '';
}

function startEditSource(name) {
  editingSource.value = name;
  editingSourceName.value = name;
}

async function submitEditSource() {
  const newName = editingSourceName.value.trim();
  if (!newName || newName === editingSource.value) { editingSource.value = null; return; }
  if (auth.isAdmin) {
    config.updateSource(editingSource.value, newName);
    showMsg(`已修改渠道来源：${editingSource.value} → ${newName}`);
  } else {
    try {
      const updated = config.recruitmentSources.map(s => s === editingSource.value ? newName : s);
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'recruitmentSource',
        entityId: 'system', entityLabel: `修改渠道来源: ${editingSource.value} → ${newName}`,
        before: { recruitmentSources: config.recruitmentSources },
        after: { recruitmentSources: updated },
      });
      showMsg(`已提交"修改渠道来源"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  editingSource.value = null;
}

async function removeSource(name) {
  if (!confirm(`确定删除渠道来源「${name}」？\n\n注意：已有候选人填写的该渠道来源不受影响。`)) return;
  if (auth.isAdmin) {
    config.removeSource(name);
    showMsg(`已删除渠道来源：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'recruitmentSource',
        entityId: 'system', entityLabel: `删除渠道来源: ${name}`,
        before: { recruitmentSources: config.recruitmentSources },
        after: { recruitmentSources: config.recruitmentSources.filter(s => s !== name) },
      });
      showMsg(`已提交"删除渠道来源：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
}

// ===== 岗位类型管理 =====
const newJobType = ref({ key: '', label: '', interviewRounds: 3, responsibilities: '', requirements: '' });
const showJobTypeForm = ref(false);
const editingJobTypeKey = ref(null);  // 当前编辑中的岗位类型 key
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

    <!-- 部门管理（四级树形） -->
    <section class="config-section">
      <h3 class="section-title">部门管理（四级架构）</h3>
      <DepartmentTreeEditor />
      <p class="section-hint">来源于员工名册：12个一级部门 / 30个二级部门 / 25个三级部门 / 54个校区</p>
    </section>
    <!-- 扁平部门（兼容旧版，隐藏保留） -->
    <section class="config-section" style="display:none">
      <h3 class="section-title">部门管理（旧）</h3>
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

    <!-- 渠道来源管理 -->
    <section class="config-section">
      <h3 class="section-title">渠道来源</h3>
      <p class="section-desc">招聘简历的来源渠道，新建简历录入时供专员选择</p>
      <div class="chip-group">
        <span v-for="source in config.recruitmentSources" :key="source" class="chip">
          <template v-if="editingSource === source">
            <input v-model="editingSourceName" class="chip-input" @keyup.enter="submitEditSource" @blur="submitEditSource" size="10" />
          </template>
          <template v-else>
            {{ source }}
            <button class="chip-edit" @click="startEditSource(source)" title="编辑">✎</button>
            <button class="chip-remove" @click="removeSource(source)" title="删除">×</button>
          </template>
        </span>
        <span class="chip chip-add">
          <input v-model="newSource" class="chip-input" placeholder="新渠道" @keyup.enter="submitAddSource" size="10" />
          <button class="chip-confirm" @click="submitAddSource">+</button>
        </span>
      </div>
    </section>

    <!-- 岗位类型管理 -->
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
                <button class="btn-icon-sm" title="编辑" @click="startEditJobType(key)">✎</button>
                <button class="btn-icon-sm btn-del" title="删除" @click="removeJobType(key)">✕</button>
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
            <input v-model="newJobType.label" placeholder="如 CC" class="input-sm" />
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

    <!-- 账号管理（仅管理员可见） -->
    <section v-if="auth.isAdmin" class="config-section">
      <h3 class="section-title">账号管理</h3>
      <p class="section-desc">管理系统登录账号。管理员可添加/删除招聘专员账号、重置密码</p>

      <div class="user-list">
        <div v-if="usersLoading" class="text-muted">加载中…</div>
        <div v-else-if="users.length === 0" class="text-muted">暂无用户，点击下方按钮初始化默认账号</div>
        <div v-else class="table-mini">
          <div class="table-row table-header">
            <span class="col-user">账号</span>
            <span class="col-name">显示名称</span>
            <span class="col-role">角色</span>
            <span class="col-action">操作</span>
          </div>
          <div v-for="user in users" :key="user.username" class="table-row">
            <span class="col-user">{{ user.username }}</span>
            <span class="col-name">{{ user.name }}</span>
            <span class="col-role">
              <span class="role-tag" :class="user.role === 'admin' ? 'role-admin' : 'role-recruiter'">
                {{ roleLabel(user.role) }}
              </span>
            </span>
            <span class="col-action">
              <button
                class="btn-text"
                @click="handleResetPassword(user.username)"
                :disabled="actingUserId === user.username"
                title="重置密码"
              >🔑</button>
              <button
                v-if="user.role !== 'admin'"
                class="btn-text danger"
                @click="handleDeleteUser(user.username)"
                :disabled="actingUserId === user.username"
                title="删除用户"
              >🗑</button>
            </span>
          </div>
        </div>
      </div>

      <!-- 添加用户表单 -->
      <div v-if="showAddUserForm" class="inline-form" style="margin-top: var(--spacing-sm);">
        <input v-model="newUser.username" placeholder="账号名" class="input-sm" size="10" />
        <input v-model="newUser.name" placeholder="显示名称（可选）" class="input-sm" size="10" />
        <select v-model="newUser.role" class="input-sm">
          <option value="recruiter">招聘专员</option>
          <option value="admin">管理员</option>
        </select>
        <input v-model="newUser.password" type="text" placeholder="密码" class="input-sm" size="10" />
        <button class="btn btn-sm btn-primary" @click="submitAddUser" :disabled="actingUserId === '__add__'">添加</button>
        <button class="btn btn-sm" @click="showAddUserForm = false">取消</button>
      </div>

      <div class="user-actions" style="margin-top: var(--spacing-sm); display: flex; gap: var(--spacing-xs);">
        <button v-if="!showAddUserForm" class="btn-link" @click="showAddUserForm = true">+ 添加用户</button>
        <button v-if="users.length === 0" class="btn-link" @click="handleSeedDefaults" style="color: var(--warning);">⚡ 初始化默认账号</button>
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

/* 账号管理 */
.col-user { width: 120px; font-weight: 500; }
.col-name { flex: 1; }
.col-role { width: 100px; text-align: center; }

.role-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}
.role-admin { background: var(--primary-bg); color: var(--primary); }
.role-recruiter { background: var(--gray-50); color: var(--gray-600); }

/* 岗位类型卡片 */
.job-type-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: var(--spacing-sm);
}
.jt-card {
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-md);
  background: #fff;
  overflow: hidden;
  transition: border-color 0.2s;
}
.jt-card:hover { border-color: var(--gray-200); }
.jt-card.jt-editing { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(74,108,247,0.08); }
.jt-card.jt-new { border-style: dashed; border-color: var(--gray-200); background: var(--gray-25); }

.jt-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
.jt-key {
  font-weight: 700;
  font-size: var(--font-size-sm);
  color: var(--primary);
  background: rgba(74,108,247,0.08);
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  min-width: 50px;
  text-align: center;
}
.jt-label {
  font-weight: 600;
  color: var(--gray-700);
  flex: 1;
}
.jt-rounds {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  background: var(--gray-50);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}
.jt-actions {
  display: flex;
  gap: 2px;
}
.btn-icon-sm {
  width: 28px; height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  color: var(--gray-400);
  font-family: inherit;
  transition: all 0.15s;
}
.btn-icon-sm:hover { background: var(--gray-50); color: var(--gray-600); border-color: var(--gray-200); }
.btn-icon-sm.btn-del:hover { color: var(--danger); background: rgba(229,62,62,0.06); border-color: rgba(229,62,62,0.2); }

.jt-body {
  padding: 0 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.jt-field {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.jt-field-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--gray-400);
  min-width: 56px;
  flex-shrink: 0;
}
.jt-field-value {
  font-size: var(--font-size-sm);
  color: var(--gray-600);
  white-space: pre-wrap;
}

/* 岗位类型编辑表单 */
.jt-edit-form {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.jt-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.jt-edit-row label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--gray-500);
  min-width: 56px;
}
.jt-edit-row .input-sm { flex: 1; min-width: 100px; }
.jt-textarea {
  resize: vertical;
  flex: 1;
  min-width: 100px;
  font-family: inherit;
}
.jt-edit-actions {
  display: flex;
  gap: var(--spacing-xs);
  justify-content: flex-end;
  padding-top: 4px;
}
.req { color: var(--danger); }
</style>
