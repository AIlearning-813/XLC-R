<script setup>
/* 新励成招聘管理系统 V2.0 — 候选人列表 */

import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useJobStore } from '../stores/useJobStore';
import cloudbase from '../services/cloudbase';
import CandidateFilter from '../components/candidates/CandidateFilter.vue';
import CandidateTable from '../components/candidates/CandidateTable.vue';

const router = useRouter();
const jobStore = useJobStore();
const db = cloudbase.db;

// ===== 状态 =====
const loading = ref(false);
const error = ref('');
const rows = ref([]);           // 合并后的行数据
const selectedIds = ref(new Set());
const currentFilters = ref({});

// 分页
const page = ref(1);
const pageSize = 20;
const totalCount = ref(0);

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize)));

const pages = computed(() => {
  const p = [];
  const total = totalPages.value;
  const current = page.value;

  let start = Math.max(1, current - 2);
  let end = Math.min(total, current + 2);

  if (end - start < 4) {
    if (start === 1) end = Math.min(total, start + 4);
    else start = Math.max(1, end - 4);
  }

  for (let i = start; i <= end; i++) p.push(i);
  return p;
});

// ===== 数据加载 =====

async function loadData(filters = {}) {
  loading.value = true;
  error.value = '';

  try {
    const dbInstance = db();

    // 构建 Application 查询
    let query = dbInstance.collection('Application');

    // 应用筛选
    const conditions = {};

    if (filters.stage) {
      conditions.stage = filters.stage;
    }
    if (filters.jobId) {
      conditions.jobId = filters.jobId;
    }
    if (filters.source) {
      conditions['funnelMeta.entrySource'] = filters.source;
    }

    // 只查活跃申请（除非明确筛选已结束的）
    if (!filters.stage || !['rejected', 'withdrawn'].includes(filters.stage)) {
      conditions.status = 'active';
    }

    if (Object.keys(conditions).length > 0) {
      // CloudBase 需要用 where 链式调用
      for (const [key, value] of Object.entries(conditions)) {
        query = query.where({ [key]: value });
      }
    }

    // 日期范围
    if (filters.dateFrom) {
      query = query.where({
        createdAt: dbInstance.command.gte(new Date(filters.dateFrom)),
      });
    }

    query = query.orderBy('updatedAt', 'desc');

    // 先获取总数（简化处理：取全部再前端分页）
    const { data: allApps } = await query.limit(200).get();
    let appList = allApps || [];

    // 日期 to 筛选（前端过滤，CloudBase 不支持 lte 和 gte 同时在不同字段）
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999);
      appList = appList.filter((a) => new Date(a.createdAt) <= toDate);
    }

    // 获取所有涉及的候选人
    if (appList.length > 0) {
      const candidateIds = [...new Set(appList.map((a) => a.candidateId).filter(Boolean))];
      const candidatesMap = {};

      // 批量获取
      const batchSize = 50;
      for (let i = 0; i < candidateIds.length; i += batchSize) {
        const batch = candidateIds.slice(i, i + batchSize);
        try {
          const { data: candidates } = await dbInstance
            .collection('Candidate')
            .where({ _id: dbInstance.command.in(batch) })
            .get();

          for (const c of (candidates || [])) {
            candidatesMap[c._id] = c;
          }
        } catch (err) {
          // 降级逐个获取
          for (const id of batch) {
            if (candidatesMap[id]) continue;
            try {
              const { data } = await dbInstance.collection('Candidate').doc(id).get();
              if (data?.[0]) candidatesMap[id] = data[0];
            } catch { /* skip */ }
          }
        }
      }

      // 获取涉及的岗位
      const jobIds = [...new Set(appList.map((a) => a.jobId).filter(Boolean))];
      const jobsMap = {};
      for (const jobId of jobIds) {
        const job = jobStore.getById(jobId);
        if (job) jobsMap[jobId] = job;
      }

      // 合并为行数据
      let merged = appList.map((app) => {
        const candidate = candidatesMap[app.candidateId] || {};
        const job = jobsMap[app.jobId] || {};

        return {
          _id: app._id,
          appId: app._id,
          candidateId: app.candidateId,
          name: candidate.name,
          phone: candidate.phone,
          email: candidate.email,
          expectedPosition: candidate.expectedPosition,
          jobTitle: job.title || job.name,
          jobName: job.title || job.name,
          stage: app.stage,
          source: app.funnelMeta?.entrySource || candidate.source,
          status: app.status,
          createdAt: app.createdAt,
          updatedAt: app.updatedAt,
          // 保留原始引用
          _candidate: candidate,
          _application: app,
          _job: job,
        };
      });

      // 文本搜索（前端过滤）
      if (filters.search) {
        const q = filters.search.toLowerCase();
        merged = merged.filter((row) => {
          return (row.name || '').toLowerCase().includes(q)
            || (row.phone || '').includes(q)
            || (row.email || '').toLowerCase().includes(q);
        });
      }

      totalCount.value = merged.length;

      // 前端分页
      const start = (page.value - 1) * pageSize;
      rows.value = merged.slice(start, start + pageSize);
    } else {
      rows.value = [];
      totalCount.value = 0;
    }
  } catch (err) {
    console.error('[CandidatesPage] 加载失败:', err.message);
    error.value = '加载候选人失败：' + err.message;
  } finally {
    loading.value = false;
  }
}

// ===== 事件处理 =====

function handleFilter(filters) {
  currentFilters.value = filters;
  page.value = 1;
  loadData(filters);
}

function handleReset() {
  currentFilters.value = {};
  page.value = 1;
  loadData({});
}

function handleRowClick(row) {
  router.push(`/candidates/${row.candidateId}`);
}

function handleToggleSelect(id) {
  const newSet = new Set(selectedIds.value);
  if (newSet.has(id)) {
    newSet.delete(id);
  } else {
    newSet.add(id);
  }
  selectedIds.value = newSet;
}

function handleSelectAll(select) {
  if (select) {
    selectedIds.value = new Set(rows.value.map((r) => r._id));
  } else {
    selectedIds.value = new Set();
  }
}

function goToPage(p) {
  if (p >= 1 && p <= totalPages.value) {
    page.value = p;
    loadData(currentFilters.value);
  }
}

onMounted(async () => {
  await jobStore.fetchActive();
  loadData({});
});
</script>

<template>
  <div class="candidates-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">候选人</h2>
        <p class="page-desc">
          共 {{ totalCount }} 位候选人
        </p>
      </div>
      <div class="header-actions">
        <button
          class="btn btn-primary btn-sm"
          @click="$router.push('/import/resume')"
        >
          + 录入简历
        </button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <CandidateFilter
      :jobs="jobStore.activeJobs"
      @filter="handleFilter"
      @reset="handleReset"
    />

    <!-- 错误 -->
    <div v-if="error" class="pipeline-error" style="margin-top: var(--spacing-md);">
      {{ error }}
      <button class="btn btn-sm btn-secondary" @click="loadData(currentFilters)">重试</button>
    </div>

    <!-- 表格 -->
    <div class="table-section">
      <CandidateTable
        :candidates="rows"
        :loading="loading"
        :selected-ids="selectedIds"
        @row-click="handleRowClick"
        @toggle-select="handleToggleSelect"
        @select-all="handleSelectAll"
      />
    </div>

    <!-- 分页 -->
    <div v-if="totalPages > 1" class="pagination">
      <button
        class="btn btn-sm btn-ghost page-btn"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        上一页
      </button>

      <button
        v-for="p in pages"
        :key="p"
        class="btn btn-sm page-num"
        :class="p === page ? 'btn-primary' : 'btn-ghost'"
        @click="goToPage(p)"
      >
        {{ p }}
      </button>

      <button
        class="btn btn-sm btn-ghost page-btn"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>

<style scoped>
.candidates-page {
  max-width: 1200px;
}

/* === 头部 === */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
  margin: 0 0 2px;
  letter-spacing: -0.02em;
}

.page-desc {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* === 表格区域 === */
.table-section {
  margin-top: var(--spacing-md);
  background: #fff;
  border-radius: var(--radius);
  border: var(--card-border);
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* === 分页 === */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: var(--spacing-lg);
}

.page-btn {
  font-size: var(--font-size-sm);
}

.page-num {
  min-width: 36px;
  height: 36px;
  padding: 0;
  font-size: var(--font-size-sm);
}
</style>
