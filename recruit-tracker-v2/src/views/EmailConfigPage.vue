<script setup>
/**
 * EmailConfigPage.vue — 邮箱配置管理页
 *
 * 管理员在此配置专员的邮箱自动归集：
 *   - 选择邮箱类型（QQ/企业/163/其他）
 *   - 输入邮箱账号 + IMAP 授权码
 *   - 配置发件人过滤规则
 *   - 测试连接 + 启用/停用
 *   - 查看扫描状态和历史
 */
import { ref, reactive, onMounted, computed } from 'vue';
import { useEmailConfigStore } from '../stores/useEmailConfigStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useToast } from '../composables/useToast';
import { EMAIL_PROVIDERS } from '../config/constants';

const store = useEmailConfigStore();
const auth = useAuthStore();
const toast = useToast();

// 弹窗状态
const showForm = ref(false);
const editingId = ref(null);
const testResult = ref(null);
const formLoading = ref(false);

// 表单数据
const defaultForm = () => ({
  email: '',
  provider: 'qq',
  imapHost: 'imap.qq.com',
  imapPort: 993,
  imapUser: '',
  imapPassword: '',
  enabled: true,
  userId: auth.currentUser?.uid || '',
});

const form = reactive(defaultForm());

// 邮箱类型切换时自动填充 IMAP 配置
function onProviderChange(providerValue) {
  const provider = EMAIL_PROVIDERS.find((p) => p.value === providerValue);
  if (provider) {
    form.imapHost = provider.imapHost;
    form.imapPort = provider.imapPort;
  }
}

// 表单标题
const formTitle = computed(() => (editingId.value ? '编辑邮箱配置' : '添加邮箱配置'));

// 打开新增表单
function openAddForm() {
  if (!store.cryptoReady) {
    toast.warning('加密密钥未配置，无法添加邮箱。请联系管理员设置加密主密钥和加密盐值环境变量。');
    return;
  }
  editingId.value = null;
  Object.assign(form, defaultForm());
  testResult.value = null;
  showForm.value = true;
}

// 打开编辑表单
function openEditForm(config) {
  editingId.value = config._id;
  form.email = config.email;
  form.imapHost = config.imapHost || 'imap.qq.com';
  form.imapPort = config.imapPort || 993;
  form.imapUser = config.imapUser || config.email;
  form.imapPassword = ''; // 编辑时不回填密码
  form.enabled = config.enabled;
  form.userId = config.userId;
  form.provider = detectProvider(config.imapHost);
  testResult.value = null;
  showForm.value = true;
}

// 检测邮箱类型
function detectProvider(host) {
  const provider = EMAIL_PROVIDERS.find((p) => p.imapHost === host);
  return provider?.value || 'other';
}

// 关闭表单
function closeForm() {
  showForm.value = false;
  editingId.value = null;
  testResult.value = null;
}

// 测试连接
async function handleTestConnection() {
  if (!form.imapHost || !form.imapPassword) {
    testResult.value = { success: false, message: '请填写 IMAP 服务器地址和授权码' };
    return;
  }

  formLoading.value = true;
  testResult.value = null;

  try {
    testResult.value = await store.testConnection({
      email: form.email,
      imapHost: form.imapHost,
      imapPort: form.imapPort,
      imapUser: form.imapUser || form.email,
      imapPassword: form.imapPassword,
    });
  } finally {
    formLoading.value = false;
  }
}

// 保存配置
async function handleSave() {
  if (!form.email || !form.imapPassword) {
    toast.warning('请填写邮箱地址和授权码');
    return;
  }

  formLoading.value = true;
  try {
    const configData = {
      email: form.email,
      imapHost: form.imapHost,
      imapPort: form.imapPort,
      imapUser: form.imapUser || form.email,
      imapPassword: form.imapPassword,
      enabled: form.enabled,
      userId: form.userId,
    };

    if (editingId.value) {
      await store.update(editingId.value, configData);
    } else {
      await store.add(configData);
    }
    closeForm();
  } finally {
    formLoading.value = false;
  }
}

// 删除配置
async function handleDelete(config) {
  if (!confirm(`确定删除 ${config.email} 的邮箱配置吗？此操作不可撤销。`)) return;
  await store.remove(config._id);
}

// 切换启用状态
async function handleToggle(config) {
  await store.toggle(config._id, !config.enabled);
}

// 格式化时间
function formatTime(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

onMounted(() => {
  store.fetchConfigs();
});
</script>

<template>
  <div class="email-config-page">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">邮箱配置</h2>
        <p class="page-desc">配置 IMAP 邮箱自动归集，系统将定时扫描收件箱中的招聘平台简历邮件</p>
      </div>
      <div class="page-actions">
        <button
          class="btn btn-secondary"
          :disabled="store.scanning"
          @click="store.scanNow()"
        >
          {{ store.scanning ? '扫描中...' : '手动扫描' }}
        </button>
        <button class="btn btn-primary" @click="openAddForm">
          添加邮箱
        </button>
      </div>
    </div>

    <!-- 加密状态提示 -->
    <div v-if="!store.cryptoReady" class="crypto-warning">
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span>加密密钥未配置，无法添加新邮箱。请在 .env.local 中设置加密主密钥和加密盐值。</span>
    </div>

    <!-- 配置列表 -->
    <div v-if="store.loading && store.configs.length === 0" class="loading-state">
      <div class="spinner"></div>
      <span>加载中...</span>
    </div>

    <div v-else-if="!store.hasConfigs" class="empty-state">
      <div class="empty-state-icon">📧</div>
      <div class="empty-state-text">暂无邮箱配置</div>
      <p class="empty-state-hint">添加邮箱后，系统将自动扫描招聘平台的简历邮件</p>
    </div>

    <div v-else class="config-list">
      <div
        v-for="config in store.configs"
        :key="config._id"
        class="config-card"
        :class="{ disabled: !config.enabled }"
      >
        <div class="config-main">
          <div class="config-status">
            <span class="status-dot" :class="{ active: config.enabled }"></span>
          </div>
          <div class="config-info">
            <span class="config-email">{{ config.email }}</span>
            <span class="config-host">{{ config.imapHost }}:{{ config.imapPort }}</span>
          </div>
          <div class="config-meta">
            <span v-if="config.lastSuccessfulScanAt" class="meta-item" title="上次成功扫描">
              上次扫描：{{ formatTime(config.lastSuccessfulScanAt) }}
            </span>
            <span v-if="config.failureCount > 0" class="meta-item error" :title="config.lastError">
              ⚠️ 连续失败 {{ config.failureCount }} 次
            </span>
          </div>
        </div>
        <div class="config-actions">
          <label class="toggle-label">
            <input
              type="checkbox"
              :checked="config.enabled"
              @change="handleToggle(config)"
            />
            <span class="toggle-switch"></span>
          </label>
          <button class="btn btn-ghost btn-sm" @click="openEditForm(config)">编辑</button>
          <button class="btn btn-ghost btn-sm danger" @click="handleDelete(config)">删除</button>
        </div>
      </div>
    </div>

    <!-- 添加/编辑弹窗 -->
    <div v-if="showForm" class="modal-overlay" @mousedown.self="closeForm">
      <div class="modal-card" @mousedown.stop>
        <div class="modal-header">
          <h3>{{ formTitle }}</h3>
          <button class="modal-close" @click="closeForm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- 邮箱类型 -->
          <div class="form-group">
            <label class="form-label">邮箱类型</label>
            <select
              v-model="form.provider"
              class="form-select"
              @change="onProviderChange(form.provider)"
            >
              <option v-for="p in EMAIL_PROVIDERS" :key="p.value" :value="p.value">
                {{ p.label }}
              </option>
            </select>
          </div>

          <!-- 邮箱地址 -->
          <div class="form-group">
            <label class="form-label">邮箱地址</label>
            <input
              v-model="form.email"
              type="email"
              class="form-input"
              placeholder="例如：hr@xinlicheng.com"
            />
          </div>

          <!-- IMAP 服务器 -->
          <div class="form-row">
            <div class="form-group flex-3">
              <label class="form-label">邮件服务器</label>
              <input
                v-model="form.imapHost"
                type="text"
                class="form-input"
                placeholder="imap.qq.com"
              />
            </div>
            <div class="form-group flex-1">
              <label class="form-label">端口</label>
              <input
                v-model.number="form.imapPort"
                type="number"
                class="form-input"
              />
            </div>
          </div>

          <!-- 登录用户名 -->
          <div class="form-group">
            <label class="form-label">登录用户名</label>
            <input
              v-model="form.imapUser"
              type="text"
              class="form-input"
              :placeholder="form.email || '通常与邮箱地址相同'"
            />
          </div>

          <!-- 授权码 -->
          <div class="form-group">
            <label class="form-label">
              IMAP 授权码
              <span class="label-hint">（非邮箱登录密码，需在邮箱设置中开启邮件服务后获取）</span>
            </label>
            <input
              v-model="form.imapPassword"
              type="password"
              class="form-input"
              :placeholder="editingId ? '留空则不修改' : '请输入授权码'"
            />
          </div>

          <!-- 测试连接按钮 -->
          <div class="form-group">
            <button
              class="btn btn-secondary btn-sm"
              :disabled="formLoading"
              @click="handleTestConnection"
            >
              {{ formLoading ? '测试中...' : '🔍 测试连接' }}
            </button>
          </div>

          <!-- 测试结果 -->
          <div v-if="testResult" class="test-result" :class="{ success: testResult.success, fail: !testResult.success }">
            <span class="test-icon">{{ testResult.success ? '✅' : '❌' }}</span>
            <span>{{ testResult.message }}</span>
          </div>

          <!-- 启用开关 -->
          <div class="form-group">
            <label class="form-label">启用状态</label>
            <label class="toggle-label">
              <input type="checkbox" v-model="form.enabled" />
              <span class="toggle-switch"></span>
              <span class="toggle-text">{{ form.enabled ? '启用自动扫描' : '暂停扫描' }}</span>
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="closeForm">取消</button>
          <button class="btn btn-primary" :disabled="formLoading" @click="handleSave">
            {{ editingId ? '保存修改' : '添加配置' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.email-config-page {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-lg);
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-800);
  letter-spacing: -0.02em;
}

.page-desc {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin-top: 4px;
  max-width: 500px;
}

.page-actions {
  display: flex;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}

/* 加密警告 */
.crypto-warning {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  background: var(--warning-bg);
  border-radius: var(--radius-sm);
  color: var(--warning);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}

/* 配置列表 */
.config-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.config-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--card-bg);
  border: 1px solid var(--gray-100);
  border-radius: var(--radius);
  transition: box-shadow var(--transition);
}

.config-card:hover {
  box-shadow: var(--shadow);
}

.config-card.disabled {
  opacity: 0.6;
}

.config-main {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex: 1;
  min-width: 0;
}

.config-status {
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: block;
  background: var(--gray-200);
}

.status-dot.active {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-bg);
}

.config-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.config-email {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--gray-700);
}

.config-host {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.config-meta {
  display: flex;
  gap: var(--spacing-md);
  margin-left: auto;
}

.meta-item {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  white-space: nowrap;
}

.meta-item.error {
  color: var(--danger);
}

.config-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-left: var(--spacing-md);
  flex-shrink: 0;
}

/* 开关 */
.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  display: none;
}

.toggle-switch {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: var(--gray-200);
  position: relative;
  transition: background var(--transition);
}

.toggle-label input:checked + .toggle-switch {
  background: var(--primary);
}

.toggle-switch::after {
  content: '';
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform var(--transition);
}

.toggle-label input:checked + .toggle-switch::after {
  transform: translateX(18px);
}

.toggle-text {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
}

/* 弹窗 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: #fff;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 520px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--gray-100);
}

.modal-header h3 {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--gray-800);
}

.modal-close {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  color: var(--gray-400);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  background: var(--gray-50);
  color: var(--gray-600);
}

.modal-body {
  padding: var(--spacing-lg);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--gray-100);
}

/* 表单行 */
.form-row {
  display: flex;
  gap: var(--spacing-md);
}

.flex-3 { flex: 3; }
.flex-1 { flex: 1; }

.label-hint {
  font-weight: 400;
  color: var(--gray-400);
}

/* 测试结果 */
.test-result {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.test-result.success {
  background: var(--success-bg);
  color: var(--success);
}

.test-result.fail {
  background: var(--danger-bg);
  color: var(--danger);
}

.test-icon {
  flex-shrink: 0;
}

/* 空状态 */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-2xl);
  color: var(--gray-400);
}

.empty-state-hint {
  font-size: var(--font-size-sm);
  color: var(--gray-300);
  margin-top: var(--spacing-xs);
}

/* 危险按钮 */
.btn-ghost.danger {
  color: var(--danger);
}

.btn-ghost.danger:hover {
  background: var(--danger-bg);
}
</style>
