<script setup>
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useRecruitmentDemandStore } from '../stores/useRecruitmentDemandStore';
import { useConfigStore } from '../stores/useConfigStore';
import { useAuthStore } from '../stores/useAuthStore';
import { safeErrorMsg } from '../services/error-messages';
import TreeCascader from '../components/common/TreeCascader.vue';

const router = useRouter(); const route = useRoute();
const store = useRecruitmentDemandStore();
const config = useConfigStore();
const auth = useAuthStore();

const form = ref({
  title: '', department: {}, headcount: 1,
  expectedArrivalDate: '', jobResponsibilities: '', jobRequirements: '',
  priority: 'normal', jobType: 'CC',
});
const loading = ref(false); const error = ref('');

onMounted(() => { config.loadConfig(); });

async function submitForm() {
  if (!form.value.title.trim()) { error.value = '请输入需求标题'; return; }
  if (!form.value.department?.level1) { error.value = '请选择部门'; return; }
  loading.value = true; error.value = '';
  try {
    const result = await store.submit({
      ...form.value,
      expectedArrivalDate: form.value.expectedArrivalDate ? new Date(form.value.expectedArrivalDate) : null,
    });
    if (result?.pending) {
      alert('已提交审批，请等待管理员审核。');
      router.push('/demands');
    } else {
      router.push('/demands');
    }
  } catch (err) { error.value = safeErrorMsg(err); }
  finally { loading.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="page-header"><h2>新建招聘需求</h2></div>
    <form @submit.prevent="submitForm" class="form-card">
      <div class="form-group">
        <label>需求标题 <span class="req">*</span></label>
        <input v-model="form.title" class="form-input" placeholder="如：广州CC岗" />
      </div>
      <div class="form-group">
        <label>所属部门 <span class="req">*</span></label>
        <TreeCascader v-model="form.department" :tree="config.departmentTree" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>招聘人数</label>
          <input v-model.number="form.headcount" type="number" min="1" class="form-input" style="width:100px" />
        </div>
        <div class="form-group">
          <label>到岗时间</label>
          <input v-model="form.expectedArrivalDate" type="date" class="form-input" />
        </div>
        <div class="form-group">
          <label>优先级</label>
          <select v-model="form.priority" class="form-input">
            <option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option><option value="low">低</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>岗位职责</label>
        <textarea v-model="form.jobResponsibilities" class="form-textarea" rows="4" placeholder="描述该岗位的主要职责..."></textarea>
      </div>
      <div class="form-group">
        <label>任职要求</label>
        <textarea v-model="form.jobRequirements" class="form-textarea" rows="4" placeholder="描述任职要求..."></textarea>
      </div>
      <div v-if="error" class="form-error">{{ error }}</div>
      <div class="form-actions">
        <button type="button" class="btn" @click="router.back()">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="loading">
          {{ loading ? '提交中...' : (auth.isAdmin ? '直接创建' : '提交审批') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.page { padding: var(--spacing-lg); max-width: 700px; }
.page-header { margin-bottom: var(--spacing-lg); }
.page-header h2 { margin: 0; font-size: var(--font-size-xl); }
.form-card { background: #fff; border: 1px solid var(--gray-100); border-radius: var(--radius-md); padding: var(--spacing-lg); }
.form-group { margin-bottom: var(--spacing-md); }
.form-group label { display: block; font-size: var(--font-size-sm); font-weight: 500; color: var(--gray-600); margin-bottom: 4px; }
.req { color: var(--danger); }
.form-input, .form-textarea { width: 100%; padding: 8px 12px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; box-sizing: border-box; outline: none; }
.form-input:focus, .form-textarea:focus { border-color: var(--primary); }
.form-textarea { resize: vertical; }
.form-row { display: flex; gap: var(--spacing-md); }
.form-error { padding: 8px 16px; background: var(--danger-bg); color: var(--danger); border-radius: var(--radius-sm); margin-bottom: var(--spacing-md); font-size: var(--font-size-sm); }
.form-actions { display: flex; justify-content: flex-end; gap: var(--spacing-sm); }
</style>
