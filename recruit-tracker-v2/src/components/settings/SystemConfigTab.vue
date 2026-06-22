<script setup>
/**
 * SystemConfigTab.vue — 系统配置管理 Tab
 *
 * 管理：渠道来源、告警阈值、招聘专员账号。
 * 部门管理 → DepartmentManageTab / 岗位配置 → JobTypeManageTab（已拆分独立Tab）
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
  if (auth.isAdmin) loadUsers();
});

// ===== Toast 反馈 =====
const submitMsg = ref('');
const submitMsgType = ref('success');
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

    <!-- 渠道来源管理 -->
    <section class="config-section">
      <h3 class="section-title">渠道来源</h3>
      <p class="section-desc">招聘简历的来源渠道，新建简历录入时供专员选择。部门管理、岗位配置请到对应 Tab 设置。</p>
      <div class="chip-group">
        <span v-for="source in config.recruitmentSources" :key="source" class="chip">
          <template v-if="editingSource === source">
            <input v-model="editingSourceName" class="chip-input" @keyup.enter="submitEditSource" @blur="submitEditSource" size="10" />
          </template>
          <template v-else>
            {{ source }}
            <button class="chip-edit" @click="startEditSource(source)" title="编辑">&#9998;</button>
            <button class="chip-remove" @click="removeSource(source)" title="删除">&times;</button>
          </template>
        </span>
        <span class="chip chip-add">
          <input v-model="newSource" class="chip-input" placeholder="新渠道" @keyup.enter="submitAddSource" size="10" />
          <button class="chip-confirm" @click="submitAddSource">+</button>
        </span>
      </div>
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
              >&#128273;</button>
              <button
                v-if="user.role !== 'admin'"
                class="btn-text danger"
                @click="handleDeleteUser(user.username)"
                :disabled="actingUserId === user.username"
                title="删除用户"
              >&#128465;</button>
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
.col-user { width: 120px; font-weight: 500; }
.col-name { flex: 1; }
.col-role { width: 100px; text-align: center; }
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

.role-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}
.role-admin { background: var(--primary-bg); color: var(--primary); }
.role-recruiter { background: var(--gray-50); color: var(--gray-600); }
</style>
