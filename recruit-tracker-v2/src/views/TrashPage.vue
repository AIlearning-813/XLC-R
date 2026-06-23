<script setup>
/* 新励成招聘管理系统 V2.0 — 回收站（已删除候选人管理） */

import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useCandidateStore } from '../stores/useCandidateStore';
import { useAuthStore } from '../stores/useAuthStore';
import { safeErrorMsg } from '../services/error-messages';
import { useToast } from '../composables/useToast';
import { formatDateTime } from '../services/format-utils';

const router = useRouter();
const store = useCandidateStore();
const auth = useAuthStore();
const toast = useToast();

const loading = ref(false);

onMounted(() => { load(); });

async function load() {
  loading.value = true;
  try {
    await store.fetchDeleted();
  } catch (err) {
    toast.error('加载回收站失败：' + safeErrorMsg(err));
  } finally {
    loading.value = false;
  }
}

async function handleRestore(row) {
  if (!confirm(`确定恢复「${row.name || '未命名'}」的简历吗？\n\n恢复后候选人将回到原来的状态，关联的岗位申请也会恢复活跃。`)) return;
  try {
    await store.restore(row._id);
    toast.success(`已恢复「${row.name || '未命名'}」`);
  } catch (err) {
    toast.error('恢复失败：' + safeErrorMsg(err));
  }
}

async function handlePermanentDelete(row) {
  const name = row.name || '未命名';
  if (!confirm(`⚠️ 确定要永久删除「${name}」吗？\n\n此操作不可撤销！简历和所有关联的岗位申请将被彻底删除。`)) return;
  if (!confirm(`再次确认：永久删除「${name}」？\n\n数据一旦删除将无法找回。`)) return;
  try {
    await store.permanentDelete(row._id);
    toast.success(`已永久删除「${name}」`);
  } catch (err) {
    toast.error('永久删除失败：' + safeErrorMsg(err));
  }
}

// P1-10：使用共享格式化工具，消除重复实现
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2>🗑️ 回收站</h2>
      <span class="page-desc">已删除的候选人记录，可恢复或永久删除</span>
    </div>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="!store.candidates.length" class="empty">
      <div class="empty-icon">📭</div>
      <p>回收站为空</p>
      <p class="empty-hint">删除候选人后，他们会出现在这里，30天内可恢复</p>
    </div>

    <table v-else class="table">
      <thead>
        <tr>
          <th>姓名</th>
          <th>电话</th>
          <th>邮箱</th>
          <th>意向岗位</th>
          <th>删除时间</th>
          <th>删除人</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in store.candidates" :key="row._id">
          <td><strong>{{ row.name || '未命名' }}</strong></td>
          <td>{{ row.phone || '—' }}</td>
          <td>{{ row.email || '—' }}</td>
          <td>{{ row.expectedPosition || '—' }}</td>
          <td>{{ formatDateTime(row.deletedAt) }}</td>
          <td>{{ row.deletedBy || '—' }}</td>
          <td>
            <button class="btn btn-xs btn-success" @click="handleRestore(row)">恢复</button>
            <button class="btn btn-xs btn-danger" @click="handlePermanentDelete(row)">永久删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.page { padding: var(--spacing-lg); max-width: 1200px; }
.page-header { margin-bottom: var(--spacing-md); }
.page-header h2 { margin: 0 0 4px; font-size: var(--font-size-xl); }
.page-desc { color: var(--gray-400); font-size: var(--font-size-sm); }

.table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.table th { text-align: left; padding: 10px 8px; border-bottom: 2px solid var(--gray-100); color: var(--gray-500); font-weight: 600; }
.table td { padding: 10px 8px; border-bottom: 1px solid var(--gray-50); }

.btn-xs { padding: 4px 10px; font-size: 12px; margin-right: 6px; border-radius: var(--radius-sm); cursor: pointer; font-family: inherit; }
.btn-success { background: #28a745; color: #fff; border: none; }
.btn-danger { background: #dc3545; color: #fff; border: none; }

.loading, .empty { text-align: center; padding: var(--spacing-2xl); color: var(--gray-400); }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-hint { font-size: var(--font-size-xs); color: var(--gray-300); margin-top: 4px; }
</style>
