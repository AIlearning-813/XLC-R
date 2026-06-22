<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useRecruitmentDemandStore } from '../stores/useRecruitmentDemandStore';
import { useAuthStore } from '../stores/useAuthStore';

const route = useRoute(); const router = useRouter();
const store = useRecruitmentDemandStore();
const auth = useAuthStore();
const demand = ref(null);

onMounted(async () => { demand.value = await store.fetchById(route.params.id); });

async function changeStatus(s) {
  await store.updateStatus(demand.value._id, s);
  demand.value = await store.fetchById(route.params.id);
}
</script>

<template>
  <div class="page" v-if="demand">
    <button class="btn btn-sm" @click="router.back()">← 返回</button>
    <div class="detail-card">
      <h2>{{ demand.title }}</h2>
      <span class="status-tag" :class="'status-' + demand.status">{{ store.STATUS_LABELS[demand.status] }}</span>
      <div class="detail-grid">
        <div class="detail-item"><label>部门</label><span>{{ demand.department?.displayName || '—' }}</span></div>
        <div class="detail-item"><label>招聘人数</label><span>{{ demand.headcount }}</span></div>
        <div class="detail-item"><label>到岗时间</label><span>{{ demand.expectedArrivalDate ? new Date(demand.expectedArrivalDate).toLocaleDateString() : '—' }}</span></div>
        <div class="detail-item"><label>招聘周期</label><span>{{ demand.recruitmentCycle || '—' }}</span></div>
        <div class="detail-item"><label>优先级</label><span>{{ demand.priority || '普通' }}</span></div>
        <div class="detail-item"><label>录入人</label><span>{{ demand.ownerId || '—' }}</span></div>
        <div class="detail-item"><label>录入日期</label><span>{{ demand.submittedAt ? new Date(demand.submittedAt).toLocaleDateString() : '—' }}</span></div>
        <div class="detail-item"><label>关联岗位</label><span>{{ demand.linkedJobId || '尚未创建' }}</span></div>
      </div>
      <div class="detail-section" v-if="demand.jobType">
        <h3>岗位类型</h3>
        <p>{{ demand.jobType }}</p>
      </div>
      <div class="detail-actions">
        <button v-if="auth.isAdmin && demand.status==='pending'" class="btn btn-success" @click="changeStatus('recruiting')">审批通过</button>
        <button v-if="auth.isAdmin && demand.status==='recruiting'" class="btn" @click="changeStatus('completed')">标记完成</button>
        <button v-if="auth.isAdmin && demand.status==='recruiting'" class="btn" @click="changeStatus('closed')">关闭需求</button>
      </div>
    </div>
  </div>
  <div v-else class="loading">加载中...</div>
</template>

<style scoped>
.page { padding: var(--spacing-lg); max-width: 800px; }
.detail-card { background: #fff; border: 1px solid var(--gray-100); border-radius: var(--radius-md); padding: var(--spacing-lg); margin-top: var(--spacing-md); }
.detail-card h2 { margin: 0 0 var(--spacing-sm); }
.status-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; margin-bottom: var(--spacing-md); }
.status-pending { background: #fff3cd; color: #856404; }
.status-recruiting { background: #cce5ff; color: #004085; }
.status-completed { background: #d4edda; color: #155724; }
.status-closed { background: #e2e3e5; color: #383d41; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-sm); margin-bottom: var(--spacing-lg); }
.detail-item label { display: block; font-size: var(--font-size-xs); color: var(--gray-400); }
.detail-item span { font-size: var(--font-size-sm); font-weight: 500; }
.detail-section { margin-bottom: var(--spacing-md); }
.detail-section h3 { font-size: var(--font-size-sm); color: var(--gray-500); margin-bottom: 4px; }
.detail-section p { font-size: var(--font-size-sm); color: var(--gray-700); margin: 0; white-space: pre-wrap; }
.detail-actions { display: flex; gap: var(--spacing-sm); margin-top: var(--spacing-lg); }
.btn-success { background: #28a745; color: #fff; border: none; }
.loading { text-align: center; padding: var(--spacing-3xl); color: var(--gray-400); }
</style>
