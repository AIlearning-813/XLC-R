<script setup>
/**
 * AdminReviewPage.vue — 管理员变更审核页
 *
 * 管理员查看所有 PendingChanges，对比 before/after，通过或驳回变更。
 * 审批范围：仅 Job 和 Config 的增删改变更。
 */
import { ref, onMounted, computed } from 'vue';
import { usePendingChangeStore } from '../stores/usePendingChangeStore';
import { useAuthStore } from '../stores/useAuthStore';

const store = usePendingChangeStore();
const auth = useAuthStore();

// 筛选状态
const statusFilter = ref('pending'); // 'all' | 'pending' | 'approved' | 'rejected'

// 详情展开
const expandedId = ref(null);

// 驳回弹窗
const rejectDialog = ref({ visible: false, changeId: null, comment: '' });

// 操作中
const actingId = ref(null);

onMounted(() => {
  loadChanges();
});

async function loadChanges() {
  await store.fetchAll(statusFilter.value === 'all' ? null : statusFilter.value);
}

function onFilterChange(status) {
  statusFilter.value = status;
  loadChanges();
}

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id;
}

async function handleApprove(id) {
  actingId.value = id;
  try {
    await store.review(id, 'approved', '');
  } catch (err) {
    console.error('[AdminReview] 审批失败:', err.message);
  }
  actingId.value = null;
}

function openRejectDialog(id) {
  rejectDialog.value = { visible: true, changeId: id, comment: '' };
}

async function handleReject() {
  const id = rejectDialog.value.changeId;
  actingId.value = id;
  try {
    await store.review(id, 'rejected', rejectDialog.value.comment);
    rejectDialog.value = { visible: false, changeId: null, comment: '' };
  } catch (err) {
    console.error('[AdminReview] 驳回失败:', err.message);
  }
  actingId.value = null;
}

// 筛选后的变更列表
const filteredChanges = computed(() => store.pendingChanges);

// 格式化
function typeIcon(type) { return type === 'job' ? '📋' : '⚙️'; }
function typeLabel(type) { return type === 'job' ? '岗位' : '系统配置'; }
function actionLabel(action) { return { create: '新建', update: '修改', delete: '删除' }[action] || action; }
function statusLabel(status) { return { pending: '待审批', approved: '已通过', rejected: '已驳回' }[status] || status; }
function statusClass(status) { return `badge-${status}`; }
function fmtDate(d) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 获取展示的变化字段
function getChangedFields(change) {
  if (!change.before || !change.after) return [];
  const fields = [];
  for (const key of Object.keys(change.after)) {
    const oldVal = change.before[key];
    const newVal = change.after[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      fields.push({ key, oldVal, newVal });
    }
  }
  return fields;
}

function fieldLabel(key) {
  const labels = {
    title: '标题', name: '名称', type: '类型', department: '部门',
    headcount: '人数', salaryRange: '薪资', workCity: '城市',
    requirements: '要求', status: '状态', priority: '优先级',
  };
  return labels[key] || key;
}

function fmtVal(v) {
  if (v === null || v === undefined) return '（无）';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
</script>

<template>
  <div class="admin-review-page">
    <div class="page-header">
      <h2 class="page-title">变更审核</h2>
      <p class="page-desc">审核专员提交的岗位和系统配置变更申请</p>
    </div>

    <!-- 状态筛选 -->
    <div class="filter-bar">
      <button
        v-for="s in [{ k: 'all', l: '全部' }, { k: 'pending', l: '待审批' }, { k: 'approved', l: '已通过' }, { k: 'rejected', l: '已驳回' }]"
        :key="s.k"
        class="filter-btn"
        :class="{ active: statusFilter === s.k }"
        @click="onFilterChange(s.k)"
      >
        {{ s.l }}
        <span v-if="s.k === 'pending' && store.pendingCount > 0" class="count-badge">{{ store.pendingCount }}</span>
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="store.loading" class="card empty-state">
      <p>加载中…</p>
    </div>

    <!-- 空状态 -->
    <div v-else-if="filteredChanges.length === 0" class="card empty-state">
      <div class="empty-state-icon">✅</div>
      <div class="empty-state-text">没有待审批的变更</div>
      <p class="text-muted">当专员提交岗位或配置变更时，在这里审核</p>
    </div>

    <!-- 变更列表 -->
    <div v-else class="change-list">
      <div
        v-for="change in filteredChanges"
        :key="change._id"
        class="change-card"
        :class="{ expanded: expandedId === change._id }"
      >
        <div class="change-summary" @click="toggleExpand(change._id)">
          <span class="change-type-icon">{{ typeIcon(change.type) }}</span>
          <div class="change-meta">
            <span class="change-entity">
              {{ typeLabel(change.type) }} · {{ actionLabel(change.action) }}
              <template v-if="change.entityLabel">：<strong>{{ change.entityLabel }}</strong></template>
            </span>
            <span class="change-submitter">
              {{ change.submittedByName || change.submittedBy }} · {{ fmtDate(change.submittedAt) }}
            </span>
          </div>
          <span class="change-status" :class="statusClass(change.status)">{{ statusLabel(change.status) }}</span>
          <span class="expand-arrow">{{ expandedId === change._id ? '▾' : '▸' }}</span>
        </div>

        <!-- 展开详情 -->
        <div v-if="expandedId === change._id" class="change-detail">
          <!-- Diff 对比 -->
          <div v-if="getChangedFields(change).length > 0" class="diff-panel">
            <div class="diff-header-row">
              <span class="diff-label-h">字段</span>
              <span class="diff-before-h">原值</span>
              <span class="diff-after-h">新值</span>
            </div>
            <div v-for="f in getChangedFields(change)" :key="f.key" class="diff-row">
              <span class="diff-label">{{ fieldLabel(f.key) }}</span>
              <span class="diff-before">{{ fmtVal(f.oldVal) }}</span>
              <span class="diff-arrow">→</span>
              <span class="diff-after">{{ fmtVal(f.newVal) }}</span>
            </div>
          </div>
          <div v-else class="text-muted" style="padding: 12px;">无字段变更详情</div>

          <!-- 审批信息 -->
          <div v-if="change.reviewedBy" class="review-info">
            <span>
              {{ change.status === 'approved' ? '✅ 已通过' : '❌ 已驳回' }}
              — {{ change.reviewedByName || change.reviewedBy }}
              · {{ fmtDate(change.reviewedAt) }}
            </span>
            <span v-if="change.reviewComment" class="review-comment">理由：{{ change.reviewComment }}</span>
          </div>

          <!-- 审批按钮（仅 pending 状态显示） -->
          <div v-if="change.status === 'pending'" class="action-row">
            <button
              class="btn btn-sm btn-primary"
              @click.stop="handleApprove(change._id)"
              :disabled="actingId === change._id"
            >
              {{ actingId === change._id ? '处理中…' : '✅ 通过' }}
            </button>
            <button
              class="btn btn-sm btn-danger"
              @click.stop="openRejectDialog(change._id)"
              :disabled="actingId === change._id"
            >
              ❌ 驳回
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 驳回弹窗 -->
    <div v-if="rejectDialog.visible" class="dialog-overlay" @click.self="rejectDialog.visible = false">
      <div class="dialog">
        <h3>驳回变更申请</h3>
        <p class="text-muted">请输入驳回原因（可选）：</p>
        <textarea
          v-model="rejectDialog.comment"
          class="input-textarea"
          rows="3"
          placeholder="如：岗位名称重复、信息不完整等"
        ></textarea>
        <div class="dialog-actions">
          <button class="btn" @click="rejectDialog.visible = false">取消</button>
          <button class="btn btn-danger" @click="handleReject" :disabled="actingId">确认驳回</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-review-page { max-width: 900px; }

.page-header { margin-bottom: var(--spacing-lg); }
.page-title { font-size: var(--font-size-2xl); font-weight: 700; color: var(--gray-800); }
.page-desc { font-size: var(--font-size-base); color: var(--gray-400); margin-top: 2px; }

/* 筛选 */
.filter-bar {
  display: flex;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-lg);
}
.filter-btn {
  padding: 6px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  background: #fff;
  font-size: var(--font-size-sm);
  cursor: pointer;
  color: var(--gray-600);
  transition: all var(--transition);
  font-family: inherit;
}
.filter-btn:hover { border-color: var(--primary); color: var(--primary); }
.filter-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  margin-left: 4px;
}
.filter-btn.active .count-badge { background: rgba(255,255,255,0.3); }

/* 列表 */
.change-list { display: flex; flex-direction: column; gap: var(--spacing-sm); }

.change-card {
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm);
  background: #fff;
  overflow: hidden;
}
.change-card.expanded { border-color: var(--primary-border); }

.change-summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 12px var(--spacing-md);
  cursor: pointer;
  transition: background var(--transition);
}
.change-summary:hover { background: var(--gray-50); }

.change-type-icon { font-size: 20px; flex-shrink: 0; }
.change-meta { flex: 1; min-width: 0; }
.change-entity { display: block; font-size: var(--font-size-sm); color: var(--gray-700); }
.change-submitter { display: block; font-size: var(--font-size-xs); color: var(--gray-400); margin-top: 2px; }

.change-status { flex-shrink: 0; padding: 2px 10px; border-radius: var(--radius-full); font-size: var(--font-size-xs); font-weight: 500; }
.badge-pending { background: var(--warning-bg); color: var(--warning); }
.badge-approved { background: var(--success-bg); color: var(--success); }
.badge-rejected { background: #fce4ec; color: var(--danger); }

.expand-arrow { flex-shrink: 0; color: var(--gray-400); font-size: 14px; width: 20px; text-align: center; }

/* 展开详情 */
.change-detail {
  border-top: 1px solid var(--gray-50);
  padding: 0;
}

.diff-panel {
  font-size: var(--font-size-sm);
}
.diff-header-row, .diff-row {
  display: flex;
  align-items: baseline;
  padding: 6px 14px;
}
.diff-header-row {
  background: var(--gray-50);
  font-weight: 600;
  color: var(--gray-500);
}
.diff-row { border-top: 1px solid var(--gray-25); }
.diff-label { width: 72px; flex-shrink: 0; color: var(--gray-500); }
.diff-label-h { width: 72px; flex-shrink: 0; }
.diff-before, .diff-before-h { flex: 1; color: var(--gray-400); word-break: break-all; }
.diff-after, .diff-after-h { flex: 1; color: var(--gray-700); word-break: break-all; }
.diff-before { text-decoration: line-through; }
.diff-after { font-weight: 500; }
.diff-arrow { width: 24px; text-align: center; color: var(--primary); flex-shrink: 0; }

.review-info {
  padding: 10px 14px;
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.review-comment { color: var(--gray-400); font-style: italic; }

.action-row {
  display: flex;
  gap: var(--spacing-sm);
  padding: 10px 14px;
  border-top: 1px solid var(--gray-50);
}
.btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }
.btn-danger:hover { background: var(--danger-dark, #c62828); }

/* 驳回弹窗 */
.dialog-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.dialog {
  background: #fff; border-radius: var(--radius-md);
  box-shadow: var(--shadow-xl);
  width: 400px; max-width: 95vw;
  padding: var(--spacing-lg);
}
.dialog h3 { margin: 0 0 var(--spacing-xs); font-size: var(--font-size-lg); }
.input-textarea {
  width: 100%; padding: 8px; border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm); font-size: var(--font-size-sm);
  font-family: inherit; resize: vertical; margin: var(--spacing-sm) 0;
  box-sizing: border-box;
}
.dialog-actions { display: flex; justify-content: flex-end; gap: var(--spacing-sm); margin-top: var(--spacing-md); }
</style>
