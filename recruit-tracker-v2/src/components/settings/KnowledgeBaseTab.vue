<script setup>
/**
 * KnowledgeBaseTab.vue — 知识库管理 Tab
 *
 * 管理招聘知识条目：列表/搜索/分类筛选/增删改/审核/归档。
 * 支持 9 种分类、关键字搜索、标签匹配。
 */
import { ref, onMounted, computed } from 'vue';
import { useKnowledgeStore, KNOWLEDGE_CATEGORIES } from '../../stores/useKnowledgeStore';
import { useAuthStore } from '../../stores/useAuthStore';
import cloudbase from '../../services/cloudbase';

const store = useKnowledgeStore();
const auth = useAuthStore();

// 筛选
const statusFilter = ref('published'); // 'all' | 'published' | 'draft' | 'archived'
const categoryFilter = ref('');
const searchQuery = ref('');

// 新增/编辑弹窗
const showForm = ref(false);
const editingId = ref(null);
const form = ref({
  title: '', category: 'recruitment', content: '', tags: [],
  relevance: 'common', source: 'manual',
});

// 标签输入
const tagInput = ref('');

onMounted(() => { loadEntries(); });

async function loadEntries() {
  const filters = {};
  if (statusFilter.value !== 'all') filters.status = statusFilter.value;
  if (categoryFilter.value) filters.category = categoryFilter.value;
  if (searchQuery.value) filters.search = searchQuery.value;
  await store.fetchEntries(filters);
}

function onFilterChange() { loadEntries(); }

// 按分类分组
const groupedEntries = computed(() => store.entriesByCategory);

// 获取分类名称
function catLabel(key) {
  return KNOWLEDGE_CATEGORIES.find(c => c.key === key)?.label || key;
}

// 新增
function openAddForm() {
  editingId.value = null;
  form.value = { title: '', category: categoryFilter.value || 'recruitment', content: '', tags: [], relevance: 'common', source: 'manual' };
  tagInput.value = '';
  showForm.value = true;
}

// 编辑
function openEditForm(entry) {
  editingId.value = entry._id;
  form.value = {
    title: entry.title || '',
    category: entry.category || 'recruitment',
    content: entry.content || '',
    tags: [...(entry.tags || [])],
    relevance: entry.relevance || 'common',
    source: entry.source || 'manual',
  };
  tagInput.value = '';
  showForm.value = true;
}

function addTag() {
  const t = tagInput.value.trim();
  if (t && !form.value.tags.includes(t)) {
    form.value.tags.push(t);
  }
  tagInput.value = '';
}

function removeTag(t) {
  form.value.tags = form.value.tags.filter(x => x !== t);
}

async function handleSave() {
  if (!form.value.title.trim()) return;
  if (editingId.value) {
    await store.updateEntry(editingId.value, { ...form.value, status: 'published' });
  } else {
    await store.addEntry({ ...form.value, status: 'published', sourceVerified: true });
  }
  showForm.value = false;
  loadEntries();
}

async function handleArchive(id) { await store.archiveEntry(id); loadEntries(); }
async function handleApprove(id) { await store.approveEntry(id); loadEntries(); }

// 触发 web-search-agent
async function triggerWebSearch() {
  try {
    await cloudbase.callFunction('web-search-agent', {
      searchQueries: ['新励成教育科技集团 公司简介', '新励成 企业文化 福利', '演讲口才培训 行业趋势'],
    });
    alert('信息采集已触发，结果将出现在"草稿"中，请审核后发布。');
  } catch (err) {
    alert('信息采集触发失败：' + err.message);
  }
}
</script>

<template>
  <div class="knowledge-base-tab">
    <!-- 操作栏 -->
    <div class="toolbar">
      <div class="filter-group">
        <select v-model="statusFilter" class="select-sm" @change="onFilterChange">
          <option value="all">全部状态</option>
          <option value="published">已发布</option>
          <option value="draft">草稿</option>
          <option value="archived">已归档</option>
        </select>
        <select v-model="categoryFilter" class="select-sm" @change="onFilterChange">
          <option value="">全部分类</option>
          <option v-for="c in KNOWLEDGE_CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <input
          v-model="searchQuery"
          class="input-sm"
          placeholder="搜索知识条目…"
          @keyup.enter="onFilterChange"
        />
        <button class="btn btn-sm" @click="onFilterChange">搜索</button>
      </div>
      <div class="action-group">
        <button v-if="auth.isAdmin" class="btn btn-sm" @click="triggerWebSearch">🌐 采集公司信息</button>
        <button class="btn btn-sm btn-primary" @click="openAddForm">+ 新增条目</button>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="store.loading" class="card empty-state"><p>加载中…</p></div>

    <!-- 空状态 -->
    <div v-else-if="store.entries.length === 0" class="card empty-state">
      <div class="empty-state-icon">📚</div>
      <div class="empty-state-text">知识库为空</div>
      <p class="text-muted">点击"新增条目"手动添加，或"采集公司信息"自动搜集</p>
    </div>

    <!-- 条目列表（按分类分组） -->
    <div v-else class="entries-container">
      <div v-for="(entries, cat) in groupedEntries" :key="cat" class="category-section">
        <h3 class="category-title">{{ catLabel(cat) }} <span class="cat-count">{{ entries.length }}</span></h3>
        <div class="entry-list">
          <div v-for="entry in entries" :key="entry._id" class="entry-card">
            <div class="entry-header">
              <span class="entry-title">{{ entry.title }}</span>
              <span class="entry-badges">
                <span v-if="entry.status === 'draft'" class="badge badge-draft">草稿</span>
                <span v-if="entry.status === 'archived'" class="badge badge-archived">已归档</span>
                <span class="badge badge-source">{{ entry.source === 'web_search' ? '🌐' : entry.source === 'ai_conversation' ? '💬' : '✍️' }}</span>
                <span class="entry-count" title="使用次数">{{ entry.useCount || 0 }}次</span>
              </span>
            </div>
            <p class="entry-preview">{{ (entry.content || '').substring(0, 150) }}{{ entry.content?.length > 150 ? '…' : '' }}</p>
            <div class="entry-tags" v-if="entry.tags?.length">
              <span v-for="t in entry.tags" :key="t" class="tag">{{ t }}</span>
            </div>
            <div class="entry-actions">
              <button v-if="entry.status === 'draft' && auth.isAdmin" class="btn-text success" @click="handleApprove(entry._id)">审核通过</button>
              <button class="btn-text" @click="openEditForm(entry)">编辑</button>
              <button v-if="entry.status !== 'archived'" class="btn-text mute" @click="handleArchive(entry._id)">归档</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showForm" class="dialog-overlay" @click.self="showForm = false">
      <div class="dialog">
        <h3>{{ editingId ? '编辑知识条目' : '新增知识条目' }}</h3>
        <div class="form-grid">
          <input v-model="form.title" class="input" placeholder="标题" />
          <div class="form-row">
            <select v-model="form.category" class="input">
              <option v-for="c in KNOWLEDGE_CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</option>
            </select>
            <select v-model="form.relevance" class="input">
              <option value="common">通用知识</option>
              <option value="specific">岗位专用</option>
            </select>
          </div>
          <textarea v-model="form.content" class="input textarea" rows="5" placeholder="内容…"></textarea>
          <div class="tag-input-row">
            <input v-model="tagInput" class="input-sm" placeholder="添加标签" @keyup.enter="addTag" />
            <button class="btn btn-sm" @click="addTag">+</button>
          </div>
          <div class="tag-list" v-if="form.tags.length">
            <span v-for="t in form.tags" :key="t" class="tag">
              {{ t }} <button class="tag-remove" @click="removeTag(t)">×</button>
            </span>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn" @click="showForm = false">取消</button>
          <button class="btn btn-primary" @click="handleSave">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.knowledge-base-tab { max-width: 900px; }

/* 工具栏 */
.toolbar {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: var(--spacing-md); margin-bottom: var(--spacing-lg); flex-wrap: wrap;
}
.filter-group { display: flex; gap: var(--spacing-xs); align-items: center; flex-wrap: wrap; }
.action-group { display: flex; gap: var(--spacing-xs); }

.select-sm, .input-sm {
  padding: 6px 10px; border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm); font-size: var(--font-size-sm);
  font-family: inherit;
}

/* 分类分组 */
.entries-container { display: flex; flex-direction: column; gap: var(--spacing-lg); }
.category-section { }
.category-title {
  font-size: var(--font-size-md); font-weight: 600; color: var(--gray-600);
  margin: 0 0 var(--spacing-sm); display: flex; align-items: center; gap: var(--spacing-xs);
}
.cat-count { font-size: var(--font-size-xs); color: var(--gray-400); font-weight: 400; }

.entry-list { display: flex; flex-direction: column; gap: var(--spacing-xs); }

.entry-card {
  padding: 10px 14px; border: 1px solid var(--gray-100);
  border-radius: var(--radius-sm); background: #fff;
}
.entry-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.entry-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--gray-700); }
.entry-badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.badge {
  font-size: var(--font-size-xs); padding: 1px 6px; border-radius: var(--radius-full);
  font-weight: 500;
}
.badge-draft { background: var(--warning-bg); color: var(--warning); }
.badge-archived { background: var(--gray-100); color: var(--gray-500); }
.badge-source { font-size: 12px; }
.entry-count { font-size: var(--font-size-xs); color: var(--gray-400); }

.entry-preview { font-size: var(--font-size-sm); color: var(--gray-500); margin: 4px 0; line-height: 1.5; }

.entry-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
.tag {
  display: inline-flex; align-items: center;
  padding: 1px 8px; background: var(--primary-bg); color: var(--primary);
  border-radius: var(--radius-full); font-size: var(--font-size-xs);
}

.entry-actions { display: flex; gap: var(--spacing-sm); }
.btn-text { border: none; background: none; cursor: pointer; font-size: var(--font-size-xs); color: var(--primary); padding: 0; }
.btn-text:hover { text-decoration: underline; }
.btn-text.success { color: var(--success); }
.btn-text.mute { color: var(--gray-400); }

/* 弹窗 */
.dialog-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.dialog {
  background: #fff; border-radius: var(--radius-md); box-shadow: var(--shadow-xl);
  width: 560px; max-width: 95vw; max-height: 85vh; overflow-y: auto;
  padding: var(--spacing-lg);
}
.dialog h3 { margin: 0 0 var(--spacing-md); font-size: var(--font-size-lg); }
.form-grid { display: flex; flex-direction: column; gap: var(--spacing-sm); margin-bottom: var(--spacing-md); }
.form-row { display: flex; gap: var(--spacing-sm); }
.form-row .input { flex: 1; }
.input {
  padding: 8px 12px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm);
  font-size: var(--font-size-sm); font-family: inherit; box-sizing: border-box; width: 100%;
}
.textarea { resize: vertical; }
.tag-input-row { display: flex; gap: var(--spacing-xs); }
.tag-list { display: flex; gap: 4px; flex-wrap: wrap; }
.tag-remove { border: none; background: none; cursor: pointer; font-size: 12px; padding: 0 2px; color: var(--primary); }

.dialog-actions { display: flex; justify-content: flex-end; gap: var(--spacing-sm); }
</style>
