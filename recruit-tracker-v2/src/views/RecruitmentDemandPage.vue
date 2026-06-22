<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRecruitmentDemandStore } from '../stores/useRecruitmentDemandStore';
import { useAuthStore } from '../stores/useAuthStore';
import { safeErrorMsg } from '../services/error-messages';

const router = useRouter();
const store = useRecruitmentDemandStore();
const auth = useAuthStore();

const filterStatus = ref('');
const msg = ref('');

onMounted(() => { load(); });
async function load() { await store.fetchAll(filterStatus.value || null); }

async function changeStatus(demand, newStatus) {
  try { await store.updateStatus(demand._id, newStatus); msg.value = '已更新'; setTimeout(() => msg.value = '', 2000); }
  catch (e) { msg.value = safeErrorMsg(e); }
}
async function handleDelete(demand) {
  if (!confirm(`确定删除「${demand.title}」？`)) return;
  try {
    const r = await store.softDelete(demand._id);
    msg.value = r?.pending ? '已提交删除审批' : '已删除';
    load(); setTimeout(() => msg.value = '', 2000);
  } catch (e) { msg.value = safeErrorMsg(e); }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2>招聘需求</h2>
      <button class="btn btn-primary" @click="router.push('/demands/new')">+ 新建需求</button>
    </div>
    <div v-if="msg" class="toast-bar">{{ msg }}</div>
    <div class="filter-bar">
      <select v-model="filterStatus" @change="load" class="filter-select">
        <option value="">全部状态</option>
        <option value="pending">待审批</option>
        <option value="active">已生效</option>
        <option value="recruiting">招聘中</option>
        <option value="completed">已完成</option>
        <option value="closed">已关闭</option>
      </select>
    </div>

    <div v-if="store.loading" class="loading">加载中...</div>
    <div v-else-if="!store.demands.length" class="empty">暂无招聘需求</div>
    <table v-else class="table">
      <thead><tr>
        <th>需求标题</th><th>部门</th><th>人数</th><th>状态</th><th>录入日期</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="d in store.demands" :key="d._id" @click="router.push('/demands/' + d._id)" class="clickable">
          <td><strong>{{ d.title }}</strong></td>
          <td>{{ d.department?.displayName || d.department || '—' }}</td>
          <td>{{ d.headcount || 1 }}</td>
          <td><span class="status-tag" :class="'status-' + d.status">{{ store.STATUS_LABELS[d.status] || d.status }}</span></td>
          <td>{{ d.submittedAt ? new Date(d.submittedAt).toLocaleDateString() : '—' }}</td>
          <td @click.stop>
            <button v-if="auth.isAdmin && d.status==='pending'" class="btn btn-xs btn-success" @click="changeStatus(d,'recruiting')">通过</button>
            <button v-if="auth.isAdmin && d.status==='recruiting'" class="btn btn-xs" @click="changeStatus(d,'completed')">完成</button>
            <button v-if="auth.isAdmin && d.status==='recruiting'" class="btn btn-xs" @click="changeStatus(d,'closed')">关闭</button>
            <button class="btn btn-xs btn-danger" @click="handleDelete(d)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.page { padding: var(--spacing-lg); max-width: 1200px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-md); }
.page-header h2 { margin: 0; font-size: var(--font-size-xl); }
.filter-bar { margin-bottom: var(--spacing-md); }
.filter-select { padding: 6px 12px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-family: inherit; font-size: var(--font-size-sm); }
.table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.table th { text-align: left; padding: 10px 8px; border-bottom: 2px solid var(--gray-100); color: var(--gray-500); font-weight: 600; }
.table td { padding: 10px 8px; border-bottom: 1px solid var(--gray-50); }
.clickable { cursor: pointer; }
.clickable:hover { background: var(--gray-25); }
.status-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
.status-pending { background: #fff3cd; color: #856404; }
.status-recruiting { background: #cce5ff; color: #004085; }
.status-active { background: #d4edda; color: #155724; }
.status-completed { background: #d4edda; color: #155724; }
.status-closed { background: #e2e3e5; color: #383d41; }
.btn-xs { padding: 3px 8px; font-size: 11px; }
.btn-success { background: #28a745; color: #fff; border: none; }
.btn-danger { background: #dc3545; color: #fff; border: none; }
.toast-bar { padding: 8px 16px; background: var(--success-bg); color: var(--success); border-radius: var(--radius-sm); margin-bottom: var(--spacing-sm); font-size: var(--font-size-sm); }
.loading, .empty { text-align: center; padding: var(--spacing-2xl); color: var(--gray-400); }
</style>
