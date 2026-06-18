<script setup>
/* 新励成招聘管理系统 V2.0 — 批量操作浮动栏 */

import { ref, computed } from 'vue';
import {
  batchMoveStage, batchEndApplications, batchExportExcel, batchExportCSV,
  batchReassignOwner, batchReactivate, batchAddTags, batchAddCommunication,
  batchMarkInviteConfirmed, MAX_BATCH_SIZE,
} from '../../services/batch-operations';
import { FUNNEL_STAGES, END_REASONS } from '../../config/constants';
import { getAvailableTargets } from '../../services/pipeline-engine';
import { safeErrorMsg } from '../../services/error-messages';

const props = defineProps({
  selectedApps: { type: Array, default: () => [] },
  candidatesMap: { type: Object, default: () => ({}) },
  jobsMap: { type: Object, default: () => ({}) },
  job: { type: Object, default: null },
  operatorId: { type: String, default: '' },
});

const emit = defineEmits(['done', 'cancel']);

// ===== 弹窗状态 =====
const activeAction = ref(null); // 'move' | 'end' | 'reassign' | 'reactivate' | 'tags' | 'comm' | 'invite'
const processing = ref(false);
const progress = ref({ done: 0, total: 0 });
const resultMessage = ref('');

// 结束操作
const endStatus = ref('rejected');
const endReason = ref('');
const endReasonObj = ref(null);
const note = ref('');

// 移动操作
const moveTarget = ref('');

// 分配操作
const newOwnerId = ref('');

// 标签操作
const tagInput = ref('');
const tagList = ref([]);

// 沟通记录
const commMethod = ref('电话');
const commContent = ref('');

const count = computed(() => props.selectedApps.length);
const overLimit = computed(() => count.value > MAX_BATCH_SIZE);

// 可用目标阶段
const availableTargets = computed(() => {
  if (props.selectedApps.length === 0) return [];
  const firstApp = props.selectedApps[0];
  const jobType = props.job?.type || props.job?.jobType || firstApp?.jobType || null;
  return getAvailableTargets(firstApp.stage, firstApp.status, jobType)
    .filter((t) => !t.isEnd);
});

// 结束原因列表
const endReasons = computed(() => END_REASONS[endStatus.value] || []);

function closeAction() {
  activeAction.value = null;
  note.value = '';
  endReason.value = '';
  endReasonObj.value = null;
  moveTarget.value = '';
  newOwnerId.value = '';
  tagInput.value = '';
  tagList.value = [];
  commContent.value = '';
  resultMessage.value = '';
}

async function executeAction(fn) {
  processing.value = true;
  resultMessage.value = '';
  progress.value = { done: 0, total: count.value };

  try {
    const { results, errors } = await fn((done, total) => {
      progress.value = { done, total };
    });

    if (errors.length > 0) {
      resultMessage.value = `完成 ${results.length} 项，${errors.length} 项失败`;
    } else {
      resultMessage.value = `成功处理 ${results.length} 位候选人`;
    }

    emit('done');
  } catch (err) {
    resultMessage.value = '操作失败：' + safeErrorMsg(err);
  } finally {
    processing.value = false;
  }
}

// 各操作执行函数
function doMoveStage() {
  if (!moveTarget.value) return;
  executeAction((onProgress) =>
    batchMoveStage(props.selectedApps, moveTarget.value, {
      note: note.value,
      operatorId: props.operatorId,
      jobType: props.job?.type || props.job?.jobType,
    }, onProgress)
  );
}

function doEnd() {
  const reasonLabel = endReasonObj.value?.label || endReason.value;
  if (!reasonLabel) return;
  executeAction((onProgress) =>
    batchEndApplications(props.selectedApps, endStatus.value, reasonLabel, {
      operatorId: props.operatorId,
    }, onProgress)
  );
}

function doExportExcel() {
  const result = batchExportExcel(props.selectedApps, props.candidatesMap, props.jobsMap);
  resultMessage.value = `已导出 ${result.count} 条记录`;
}

function doExportCSV() {
  const result = batchExportCSV(props.selectedApps, props.candidatesMap, props.jobsMap);
  resultMessage.value = `已导出 ${result.count} 条记录`;
}

function doReassign() {
  if (!newOwnerId.value) return;
  executeAction((onProgress) =>
    batchReassignOwner(props.selectedApps, newOwnerId.value, {
      operatorId: props.operatorId,
    }, onProgress)
  );
}

function doReactivate() {
  executeAction((onProgress) =>
    batchReactivate(props.selectedApps, null, {
      note: note.value,
      operatorId: props.operatorId,
    }, onProgress)
  );
}

function doAddTags() {
  if (tagList.value.length === 0) return;
  executeAction((onProgress) =>
    batchAddTags(props.selectedApps, [...tagList.value], {}, onProgress)
  );
}

function doAddComm() {
  if (!commContent.value.trim()) return;
  executeAction((onProgress) =>
    batchAddCommunication(props.selectedApps, {
      method: commMethod.value,
      content: commContent.value.trim(),
    }, { operator: props.operatorId }, onProgress)
  );
}

function doMarkInvite() {
  executeAction((onProgress) =>
    batchMarkInviteConfirmed(props.selectedApps, {
      operatorId: props.operatorId,
    }, onProgress)
  );
}

function addTag() {
  const t = tagInput.value.trim();
  if (t && !tagList.value.includes(t)) {
    tagList.value.push(t);
  }
  tagInput.value = '';
}
function removeTag(tag) {
  tagList.value = tagList.value.filter((t) => t !== tag);
}

// 停止事件冒泡，防止触发行点击
function stopProp(e) {
  e.stopPropagation();
}
</script>

<template>
  <Teleport to="body">
    <!-- 浮动操作栏 -->
    <Transition name="bar-slide">
      <div v-if="count > 0" class="batch-bar">
        <div class="batch-bar-inner">
          <!-- 选中计数 -->
          <div class="batch-info">
            <span class="batch-count">{{ count }}</span>
            <span class="batch-label">位已选择</span>
            <span v-if="overLimit" class="batch-warn">（单次上限 {{ MAX_BATCH_SIZE }} 项，将分批执行）</span>
          </div>

          <!-- 操作按钮 -->
          <div class="batch-actions">
            <button class="batch-btn" @click="activeAction = 'move'">📦 移动阶段</button>
            <button class="batch-btn batch-btn-danger" @click="activeAction = 'end'">⛔ 结束流程</button>
            <button class="batch-btn" @click="activeAction = 'reassign'">👤 分配负责人</button>
            <button class="batch-btn" @click="doExportExcel">📥 导出 Excel</button>
            <button class="batch-btn" @click="activeAction = 'tags'">🏷 打标签</button>
            <button class="batch-btn" @click="activeAction = 'comm'">💬 加沟通</button>
            <button class="batch-btn" @click="activeAction = 'invite'">✅ 标记邀约</button>
            <button
              v-if="props.selectedApps.some(a => a.status !== 'active')"
              class="batch-btn"
              @click="doReactivate"
            >🔄 重新激活</button>
          </div>

          <!-- 取消 -->
          <button class="batch-btn batch-btn-cancel" @click="$emit('cancel')">✕ 取消选择</button>
        </div>
      </div>
    </Transition>

    <!-- 操作弹窗遮罩 -->
    <div v-if="activeAction" class="batch-dialog-overlay" @click="closeAction">
      <div class="batch-dialog" @click="stopProp">
        <!-- 移动阶段 -->
        <template v-if="activeAction === 'move'">
          <h3>批量移动阶段</h3>
          <p class="batch-dialog-sub">{{ count }} 位候选人将被移动到新阶段</p>
          <div class="batch-target-grid">
            <button
              v-for="t in availableTargets"
              :key="t.key"
              class="batch-target-chip"
              :class="{ selected: moveTarget === t.key }"
              @click="moveTarget = t.key"
            >{{ t.label }}</button>
          </div>
          <input v-model="note" class="form-input" placeholder="备注（选填）" />
          <div class="batch-dialog-actions">
            <button class="btn btn-ghost" @click="closeAction">取消</button>
            <button class="btn btn-primary" :disabled="!moveTarget || processing" @click="doMoveStage">
              {{ processing ? `处理中 ${progress.done}/${progress.total}...` : '确认移动' }}
            </button>
          </div>
        </template>

        <!-- 结束流程 -->
        <template v-if="activeAction === 'end'">
          <h3>批量结束流程</h3>
          <div class="form-row">
            <select v-model="endStatus" class="form-select">
              <option value="rejected">淘汰</option>
              <option value="withdrawn">放弃</option>
            </select>
          </div>
          <div class="reasons-grid">
            <button
              v-for="r in endReasons"
              :key="r.key"
              class="reason-chip"
              :class="{ selected: endReason === r.key }"
              @click="endReason = r.key; endReasonObj = r"
            >{{ r.label }}</button>
          </div>
          <div class="batch-dialog-actions">
            <button class="btn btn-ghost" @click="closeAction">取消</button>
            <button class="btn btn-danger" :disabled="!endReason || processing" @click="doEnd">
              {{ processing ? '处理中...' : `确认${endStatus === 'rejected' ? '淘汰' : '放弃'} ${count} 人` }}
            </button>
          </div>
        </template>

        <!-- 分配负责人 -->
        <template v-if="activeAction === 'reassign'">
          <h3>批量分配负责人</h3>
          <input v-model="newOwnerId" class="form-input" placeholder="输入新负责人 ID 或姓名" />
          <div class="batch-dialog-actions">
            <button class="btn btn-ghost" @click="closeAction">取消</button>
            <button class="btn btn-primary" :disabled="!newOwnerId || processing" @click="doReassign">
              {{ processing ? '处理中...' : '确认分配' }}
            </button>
          </div>
        </template>

        <!-- 打标签 -->
        <template v-if="activeAction === 'tags'">
          <h3>批量打标签</h3>
          <div class="tag-input-row">
            <input v-model="tagInput" class="form-input" placeholder="输入标签后回车" @keyup.enter="addTag" />
            <button class="btn btn-sm btn-primary" @click="addTag">添加</button>
          </div>
          <div class="tag-preview" v-if="tagList.length > 0">
            <span v-for="t in tagList" :key="t" class="tag-chip">
              {{ t }} <button class="tag-remove" @click="removeTag(t)">×</button>
            </span>
          </div>
          <div class="batch-dialog-actions">
            <button class="btn btn-ghost" @click="closeAction">取消</button>
            <button class="btn btn-primary" :disabled="tagList.length === 0 || processing" @click="doAddTags">
              确认打标
            </button>
          </div>
        </template>

        <!-- 加沟通 -->
        <template v-if="activeAction === 'comm'">
          <h3>批量添加沟通记录</h3>
          <div class="form-row">
            <select v-model="commMethod" class="form-select">
              <option>电话</option><option>微信</option><option>短信</option><option>邮件</option><option>当面</option>
            </select>
          </div>
          <textarea v-model="commContent" class="form-textarea" rows="3" placeholder="沟通内容将统一追加到所有选中候选人"></textarea>
          <div class="batch-dialog-actions">
            <button class="btn btn-ghost" @click="closeAction">取消</button>
            <button class="btn btn-primary" :disabled="!commContent.trim() || processing" @click="doAddComm">
              确认添加
            </button>
          </div>
        </template>

        <!-- 标记邀约 -->
        <template v-if="activeAction === 'invite'">
          <h3>批量标记邀约已确认</h3>
          <p class="batch-dialog-sub">将为 {{ count }} 位候选人的漏斗记录标记 inviteConfirmedAt 时间戳</p>
          <div class="batch-dialog-actions">
            <button class="btn btn-ghost" @click="closeAction">取消</button>
            <button class="btn btn-primary" :disabled="processing" @click="doMarkInvite">
              {{ processing ? '处理中...' : '确认标记' }}
            </button>
          </div>
        </template>

        <!-- 结果消息 -->
        <div v-if="resultMessage" class="batch-result" :class="{ error: resultMessage.includes('失败') }">
          {{ resultMessage }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* === 浮动栏 === */
.batch-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 900;
  background: #fff;
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  border: 1px solid var(--gray-200);
  max-width: 95vw;
}

.batch-bar-inner {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 10px 16px;
  flex-wrap: wrap;
}

.batch-info {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding-right: var(--spacing-md);
  border-right: 1px solid var(--gray-200);
  white-space: nowrap;
}

.batch-count {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--primary);
}

.batch-label {
  font-size: var(--font-size-sm);
  color: var(--gray-500);
}

.batch-warn {
  font-size: 11px;
  color: var(--gray-400);
  margin-left: 4px;
}

.batch-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.batch-btn {
  padding: 6px 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  background: #fff;
  font-size: 13px;
  color: var(--gray-600);
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: all var(--transition);
}

.batch-btn:hover {
  background: var(--primary-bg);
  border-color: var(--primary);
  color: var(--primary);
}

.batch-btn-danger:hover {
  background: var(--danger-bg);
  border-color: var(--danger);
  color: var(--danger);
}

.batch-btn-cancel {
  border: none;
  background: transparent;
  color: var(--gray-400);
}

.batch-btn-cancel:hover {
  color: var(--gray-600);
  background: var(--gray-50);
}

/* === 弹窗 === */
.batch-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 950;
}

.batch-dialog {
  background: #fff;
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  width: 440px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.batch-dialog h3 {
  margin: 0 0 4px;
  font-size: var(--font-size-md);
}

.batch-dialog-sub {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin: 0 0 var(--spacing-md);
}

.batch-target-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--spacing-sm);
}

.batch-target-chip {
  padding: 5px 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition);
  color: var(--gray-600);
}

.batch-target-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.batch-target-chip.selected {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.batch-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.tag-input-row {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.tag-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--spacing-sm);
}

.tag-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--primary-bg);
  color: var(--primary);
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
}

.tag-remove {
  border: none;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  line-height: 1;
}

.batch-result {
  margin-top: var(--spacing-sm);
  padding: 8px 12px;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.batch-result.error {
  background: #fbe9e7;
  color: #c62828;
}

/* === 过渡动画 === */
.bar-slide-enter-active,
.bar-slide-leave-active {
  transition: all 0.25s ease;
}

.bar-slide-enter-from,
.bar-slide-leave-to {
  transform: translateX(-50%) translateY(20px);
  opacity: 0;
}

/* === 复用弹窗组件样式 === */
.form-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  margin-bottom: var(--spacing-sm);
  box-sizing: border-box;
}

.form-select {
  padding: 10px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  margin-bottom: var(--spacing-sm);
}

.form-textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  resize: vertical;
  margin-bottom: var(--spacing-sm);
  box-sizing: border-box;
}

.reasons-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--spacing-sm);
}

.reason-chip {
  padding: 6px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  background: #fff;
  font-size: var(--font-size-sm);
  color: var(--gray-500);
  cursor: pointer;
  transition: all var(--transition);
  font-family: inherit;
}

.reason-chip:hover {
  border-color: var(--gray-300);
}

.reason-chip.selected {
  border-color: var(--danger);
  background: var(--danger-bg);
  color: var(--danger);
}
</style>
