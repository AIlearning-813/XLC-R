<script setup>
/**
 * CompanyInfoTab.vue — 公司信息编辑 Tab
 *
 * 编辑 CompanyProfile 单例文档（CloudBase 中 _id="singleton"）。
 * 每次保存自动追加 changeLog 历史记录。
 */
import { ref, reactive, onMounted } from 'vue';
import cloudbase from '../../services/cloudbase';
import { useAuthStore } from '../../stores/useAuthStore';
import { captureError } from '../../services/error-capture';

const auth = useAuthStore();
const db = cloudbase.db();

const loading = ref(false);
const saved = ref(false);
const error = ref('');

// CompanyProfile 表单数据
const form = reactive({
  shortIntro: '',
  fullDescription: '',
  foundedYear: '',
  headquarter: '',
  locations: ['广州'],
  businessLines: [''],
  culture: [''],
  benefits: [''],
  recruitmentPhilosophy: '',
  employerBrand: '',
});

const changeLog = ref([]);

onMounted(async () => {
  await loadProfile();
});

async function loadProfile() {
  if (!db) return;
  loading.value = true;
  try {
    const result = await db.collection('CompanyProfile').doc('singleton').get().catch(() => ({ data: null }));
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    if (data) {
      Object.assign(form, {
        shortIntro: data.shortIntro || '',
        fullDescription: data.fullDescription || '',
        foundedYear: data.foundedYear || '',
        headquarter: data.headquarter || '',
        locations: data.locations?.length ? data.locations : ['广州'],
        businessLines: data.businessLines?.length ? data.businessLines : [''],
        culture: data.culture?.length ? data.culture : [''],
        benefits: data.benefits?.length ? data.benefits : [''],
        recruitmentPhilosophy: data.recruitmentPhilosophy || '',
        employerBrand: data.employerBrand || '',
      });
      changeLog.value = data.changeLog || [];
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

// 动态列表辅助
function addItem(arr) { arr.push(''); }
function removeItem(arr, idx) { if (arr.length > 1) arr.splice(idx, 1); }

async function handleSave() {
  if (!db) { error.value = '数据库未初始化'; return; }
  loading.value = true;
  saved.value = false;
  error.value = '';

  try {
    const now = new Date();
    const logEntry = {
      changedAt: now.toISOString(),
      changedBy: auth.userName || auth.currentUser?.uid || 'system',
      summary: '更新公司信息',
    };

    const profileData = {
      ...form,
      locations: form.locations.filter(l => l.trim()),
      businessLines: form.businessLines.filter(l => l.trim()),
      culture: form.culture.filter(l => l.trim()),
      benefits: form.benefits.filter(l => l.trim()),
      changeLog: [logEntry, ...changeLog.value].slice(0, 50), // 保留最近 50 条
      updatedAt: now,
    };

    // upsert
    const existing = await db.collection('CompanyProfile').doc('singleton').get().catch(() => ({ data: [] }));
    if (existing?.data && existing.data.length > 0) {
      await db.collection('CompanyProfile').doc('singleton').update(profileData);
    } else {
      await db.collection('CompanyProfile').add({
        _id: 'singleton',
        ...profileData,
        createdAt: now,
      });
    }

    // 更新本地 changeLog
    changeLog.value = profileData.changeLog;

    // 审计
    try {
      await cloudbase.callFunction('write-audit-log', {
        action: 'company_profile_updated',
        entityType: 'CompanyProfile',
        entityIds: ['singleton'],
        detail: { summary: '更新公司信息' },
        operator: auth.currentUser?.uid || 'system',
      });
    } catch (e) { captureError('settings', '公司信息审计日志写入失败', { message: e.message, context: 'CompanyInfoTab.save' }); }

    saved.value = true;
    setTimeout(() => saved.value = false, 3000);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="company-info-tab">
    <div v-if="!db" class="card empty-state">
      <p>数据库未连接</p>
    </div>

    <div v-else-if="loading && !form.shortIntro" class="card empty-state">
      <p>加载中…</p>
    </div>

    <div v-else class="form-layout">
      <!-- 保存状态 -->
      <p v-if="saved" class="save-toast">✅ 公司信息已保存</p>
      <p v-if="error" class="error-toast">❌ {{ error }}</p>

      <div class="form-grid">
        <!-- 基本信息 -->
        <div class="form-group">
          <label class="form-label">一句话介绍</label>
          <input v-model="form.shortIntro" class="input" placeholder="如：新励成教育科技集团，专注演讲口才培训20年" />
        </div>

        <div class="form-group">
          <label class="form-label">公司全称/品牌描述</label>
          <textarea v-model="form.fullDescription" class="input textarea" rows="3" placeholder="详细介绍公司的业务领域、规模、行业地位等"></textarea>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">成立年份</label>
            <input v-model="form.foundedYear" class="input" placeholder="如：2005" />
          </div>
          <div class="form-group">
            <label class="form-label">总部</label>
            <input v-model="form.headquarter" class="input" placeholder="如：广州" />
          </div>
        </div>

        <!-- 动态列表 -->
        <div class="form-group">
          <label class="form-label">办公城市</label>
          <div v-for="(item, i) in form.locations" :key="'loc-'+i" class="list-row">
            <input v-model="form.locations[i]" class="input" placeholder="如：广州" />
            <button class="btn-icon" @click="removeItem(form.locations, i)" title="删除">×</button>
          </div>
          <button class="btn-link" @click="addItem(form.locations)">+ 添加城市</button>
        </div>

        <div class="form-group">
          <label class="form-label">业务板块</label>
          <div v-for="(item, i) in form.businessLines" :key="'bl-'+i" class="list-row">
            <input v-model="form.businessLines[i]" class="input" placeholder="如：演讲口才培训" />
            <button class="btn-icon" @click="removeItem(form.businessLines, i)" title="删除">×</button>
          </div>
          <button class="btn-link" @click="addItem(form.businessLines)">+ 添加业务</button>
        </div>

        <!-- 企业文化标签 -->
        <div class="form-group">
          <label class="form-label">企业文化标签</label>
          <div v-for="(item, i) in form.culture" :key="'cul-'+i" class="list-row">
            <input v-model="form.culture[i]" class="input" placeholder="如：奋斗、创新、利他" />
            <button class="btn-icon" @click="removeItem(form.culture, i)" title="删除">×</button>
          </div>
          <button class="btn-link" @click="addItem(form.culture)">+ 添加标签</button>
        </div>

        <div class="form-group">
          <label class="form-label">员工福利标签</label>
          <div v-for="(item, i) in form.benefits" :key="'ben-'+i" class="list-row">
            <input v-model="form.benefits[i]" class="input" placeholder="如：五险一金、带薪年假、年度旅游" />
            <button class="btn-icon" @click="removeItem(form.benefits, i)" title="删除">×</button>
          </div>
          <button class="btn-link" @click="addItem(form.benefits)">+ 添加福利</button>
        </div>

        <!-- 招聘相关 -->
        <div class="form-group">
          <label class="form-label">招聘理念</label>
          <textarea v-model="form.recruitmentPhilosophy" class="input textarea" rows="2" placeholder="如：我们寻找那些愿意为学员的成长而全力以赴的伙伴"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">雇主品牌描述</label>
          <textarea v-model="form.employerBrand" class="input textarea" rows="2" placeholder="吸引候选人的品牌故事和卖点"></textarea>
        </div>
      </div>

      <button class="btn btn-primary" @click="handleSave" :disabled="loading">
        {{ loading ? '保存中…' : '保存公司信息' }}
      </button>

      <!-- 变更历史 -->
      <div v-if="changeLog.length > 0" class="changelog-section">
        <h4 class="section-title">变更历史</h4>
        <div class="changelog-list">
          <div v-for="(entry, i) in changeLog.slice(0, 20)" :key="i" class="changelog-item">
            <span class="changelog-date">{{ entry.changedAt?.slice(0, 10) }}</span>
            <span class="changelog-operator">{{ entry.changedBy }}</span>
            <span class="changelog-summary">{{ entry.summary }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.company-info-tab { max-width: 720px; }

.save-toast {
  padding: 8px 14px;
  background: var(--success-bg);
  color: var(--success);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}
.error-toast {
  padding: 8px 14px;
  background: #fce4ec;
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}

.form-grid { display: flex; flex-direction: column; gap: var(--spacing-md); margin-bottom: var(--spacing-lg); }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-row { display: flex; gap: var(--spacing-md); }
.form-row .form-group { flex: 1; }

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--gray-600);
}

.input {
  padding: 8px 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-family: inherit;
  box-sizing: border-box;
  width: 100%;
}
.input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 2px var(--primary-bg); }
.textarea { resize: vertical; }

.list-row { display: flex; gap: var(--spacing-xs); align-items: center; margin-bottom: 4px; }
.list-row .input { flex: 1; }
.btn-icon {
  width: 28px; height: 28px; border: none; background: none;
  font-size: 16px; color: var(--gray-400); cursor: pointer; border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
}
.btn-icon:hover { color: var(--danger); background: rgba(194,84,80,0.1); }
.btn-link { border: none; background: none; cursor: pointer; color: var(--primary); font-size: var(--font-size-sm); padding: 0; }
.btn-link:hover { text-decoration: underline; }

/* 变更历史 */
.changelog-section { margin-top: var(--spacing-xl); padding-top: var(--spacing-lg); border-top: 1px solid var(--gray-100); }
.section-title { font-size: var(--font-size-md); font-weight: 600; color: var(--gray-600); margin: 0 0 var(--spacing-sm); }
.changelog-list { font-size: var(--font-size-sm); }
.changelog-item {
  display: flex; gap: var(--spacing-sm); padding: 4px 0;
  border-bottom: 1px solid var(--gray-25);
  color: var(--gray-500);
}
.changelog-date { color: var(--gray-400); flex-shrink: 0; width: 90px; }
.changelog-operator { color: var(--gray-500); flex-shrink: 0; width: 60px; }
.changelog-summary { flex: 1; }
</style>
