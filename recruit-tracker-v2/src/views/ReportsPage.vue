<script setup>
/* 新励成招聘管理系统 V2.0 — 数据分析 */

import { ref, onMounted, computed, watch, nextTick, reactive } from 'vue';
import { Chart, BarController, LineController, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { getJobFunnel, getDeptMonthly, getDemandMetrics, getRecruiterEfficiency, getConversionRates, getDeptOnboardOverview, getSourceOnboardStats, getDemandVsOnboard } from '../services/funnel-report';
import { batchExportCSV } from '../services/batch-operations';
import { useAuthStore } from '../stores/useAuthStore';
import { useJobStore } from '../stores/useJobStore';
import { formatDateISO } from '../services/format-utils';
import DateRangePicker from '../components/common/DateRangePicker.vue';
import ConversionRatePanel from '../components/reports/ConversionRatePanel.vue';
import DeptOnboardOverview from '../components/reports/DeptOnboardOverview.vue';
import SourceOnboardBoard from '../components/reports/SourceOnboardBoard.vue';
import DemandVsOnboardChart from '../components/reports/DemandVsOnboardChart.vue';

// 注册 Chart.js 组件
Chart.register(BarController, LineController, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

const auth = useAuthStore();
const jobStore = useJobStore();

// ===== 状态 =====
const activeJobs = ref([]);
const selectedJobId = ref('');
const selectedJobType = ref('');
const filterOwnerId = ref('');

const funnelData = ref(null);
const deptData = ref(null);
const demandData = ref(null);
const efficiencyData = ref(null);
const conversionRates = ref(null);
const deptOnboardData = ref(null);
const sourceStats = ref(null);
const demandVsOnboardData = ref(null);
const selectedDept = ref('');
const loading = ref(false);
const error = ref('');
const recruiters = ref([]);

// 时间段
const dateRange = reactive({ start: new Date(), end: new Date() });
const now2 = new Date();
dateRange.start = new Date(now2.getFullYear(), now2.getMonth(), 1);
dateRange.end = now2;
// P1-10：使用共享格式化工具
function fmtDate(d) { return formatDateISO(d); }

// Chart 实例引用
const funnelCanvas = ref(null);
let funnelChart = null;

// ===== 计算属性 =====
const selectedJobLabel = computed(() => {
  if (!selectedJobId.value) return '全部岗位';
  const job = activeJobs.value.find(j => j._id === selectedJobId.value);
  return job ? (job.title || job.name || '未知岗位') : '全部岗位';
});

// ===== 数据加载 =====
async function loadJobs() {
  try {
    activeJobs.value = await jobStore.fetchActive();
  } catch (err) {
    console.warn('[Reports] 岗位列表加载失败:', err.message);
  }
  // 加载专员列表
  try {
    recruiters.value = await auth.fetchUsers();
  } catch (_) {}
}

async function loadAllData() {
  loading.value = true;
  error.value = '';

  try {
    const filters = filterOwnerId.value ? { ownerId: filterOwnerId.value } : {};
    const timeParams = { startDate: fmtDate(dateRange.start), endDate: fmtDate(dateRange.end), ...filters };

    const [funnel, dept, demand, efficiency, conv, deptOnboard, srcStats, dvo] = await Promise.all([
      getJobFunnel(selectedJobId.value || undefined, selectedJobType.value || undefined),
      getDeptMonthly(new Date().getFullYear(), new Date().getMonth() + 1),
      getDemandMetrics(filters),
      getRecruiterEfficiency(filters),
      getConversionRates(selectedJobId.value || undefined, timeParams),
      getDeptOnboardOverview({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, ...(selectedDept.value ? { department: selectedDept.value } : {}) }),
      getSourceOnboardStats(timeParams),
      getDemandVsOnboard(timeParams),
    ]);

    funnelData.value = funnel;
    demandData.value = demand;
    efficiencyData.value = efficiency;
    deptData.value = dept;
    conversionRates.value = conv;
    deptOnboardData.value = deptOnboard;
    sourceStats.value = srcStats;
    demandVsOnboardData.value = dvo;
    loading.value = false;

    await nextTick();
    await nextTick();
    renderFunnelChart();
  } catch (err) {
    error.value = err.message || '数据加载失败';
    loading.value = false;
  }
}

// ===== 漏斗图渲染 =====
function renderFunnelChart() {
  if (!funnelCanvas.value || !funnelData.value) return;

  if (funnelChart) funnelChart.destroy();

  const stages = funnelData.value.stages || [];
  // 只显示 count > 0 的阶段，避免全空图表
  const displayStages = stages.length > 0 ? stages : [];

  const stageLabels = {
    resume: '简历筛选', valid_resume: '有效简历', invite: '邀约',
    invite_confirmed: '确认面试', first_interview: '初试', first_pass: '初试通过',
    second_interview: '复试', second_pass: '复试通过',
    final_interview: '终试', final_pass: '终试通过',
    offer: 'Offer', onboard: '入职',
  };

  funnelChart = new Chart(funnelCanvas.value, {
    type: 'bar',
    data: {
      labels: displayStages.map(s => stageLabels[s.key] || s.key),
      datasets: [{
        label: '候选人数量',
        data: displayStages.map(s => s.count),
        backgroundColor: displayStages.map((_, i) => {
          const colors = [
            '#E8E0F0', '#C4B5D8', '#A8D8EA', '#7EC8E3',
            '#AAE0C8', '#6ECB99', '#FFE5A3', '#FFD06B',
            '#FFB5B5', '#FF8989', '#B8D0F0', '#7BA8E0',
          ];
          return colors[i % colors.length];
        }),
        borderColor: displayStages.map((_, i) => {
          const borders = [
            '#C4B5D8', '#A085B8', '#7EC8E3', '#5BA8CC',
            '#6ECB99', '#3DAF6E', '#FFD06B', '#F0B828',
            '#FF8989', '#EE5A5A', '#7BA8E0', '#5A8ACC',
          ];
          return borders[i % borders.length];
        }),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `${selectedJobLabel.value} — 漏斗转化`,
          font: { size: 14, weight: '600' },
          color: '#4A4A4A',
        },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const count = ctx.raw;
              const stages = funnelData.value?.stages || [];
              const rates = funnelData.value?.rates || {};
              const stageKey = stages[ctx.dataIndex]?.key;
              let label = `人数: ${count}`;
              if (ctx.dataIndex > 0) {
                const rateKey = `${stageKey}Rate`;
                if (rates[rateKey] !== undefined) {
                  label += ` | 转化率: ${rates[rateKey]}%`;
                }
              }
              return label;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: '候选人数量', color: '#999' },
          ticks: { stepSize: 1 },
        },
      },
    },
  });
}

// ===== 导出 =====
async function handleExportCSV() {
  if (!funnelData.value) return;

  const stageLabels = {
    resume: '简历筛选', valid_resume: '有效简历', invite: '邀约',
    invite_confirmed: '确认面试', first_interview: '初试', first_pass: '初试通过',
    second_interview: '复试', second_pass: '复试通过',
    final_interview: '终试', final_pass: '终试通过',
    offer: 'Offer', onboard: '入职',
  };

  const rows = [
    ['阶段', '人数', '转化率(%)'],
    ...(funnelData.value.stages || []).map((s, i) => {
      const rateKey = `${s.key}Rate`;
      const rate = i > 0 ? (funnelData.value.rates?.[rateKey] ?? '') : '';
      return [stageLabels[s.key] || s.key, s.count, rate];
    }),
    ['', '', ''],
    ['淘汰', funnelData.value.rejectedCount, ''],
    ['放弃', funnelData.value.withdrawnCount, ''],
    ['总计', funnelData.value.totalCount, `整体转化率: ${funnelData.value.rates?.overallRate ?? 0}%`],
  ];

  const csv = '﻿' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `漏斗报表_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== 监听筛选变化 =====
watch([selectedJobId, dateRange], () => {
  loadAllData();
}, { deep: true });

watch(selectedDept, () => {
  loadAllData();
});

onMounted(async () => {
  await loadJobs();
  await loadAllData();
});
</script>

<template>
  <div class="reports-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">数据分析</h2>
        <p class="page-desc">漏斗转化率、趋势图、报表导出</p>
      </div>
      <div class="header-actions">
        <!-- 时间段 -->
        <DateRangePicker v-model="dateRange" />
        <!-- 岗位筛选 -->
        <select v-model="selectedJobId" class="select-sm">
          <option value="">全部岗位</option>
          <option v-for="job in activeJobs" :key="job._id" :value="job._id">
            {{ job.title || job.name }}
          </option>
        </select>
        <!-- 专员筛选 -->
        <select v-if="auth.isAdmin" v-model="filterOwnerId" class="select-sm" @change="loadAllData">
          <option value="">全部专员</option>
          <option v-for="r in recruiters" :key="r.username" :value="r.username">{{ r.name || r.username }}</option>
        </select>
        <button class="btn btn-sm" @click="loadAllData">刷新</button>
        <button class="btn btn-sm" @click="handleExportCSV" :disabled="!funnelData">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导出 CSV
        </button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <div v-for="i in 2" :key="i" class="card skeleton-chart">
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-full" style="height: 200px; margin-top: 16px;"></div>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="card empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">数据加载失败</div>
      <p class="text-muted">{{ error }}</p>
      <button class="btn btn-sm" style="margin-top: 12px;" @click="loadAllData">重试</button>
    </div>

    <!-- 空数据状态 -->
    <div v-else-if="!funnelData || (funnelData.totalCount === 0 && (!trendData || trendData.data?.every(m => m.total === 0)))" class="card empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">还没有足够的数据</div>
      <p class="text-muted">
        至少需要 5 个候选人进入流程后，漏斗图和趋势图才会生成<br/>
        当前进度：{{ funnelData?.totalCount || 0 }}/5 候选人
      </p>
    </div>

    <!-- 图表区 -->
    <template v-else>
      <div class="charts-grid">
        <!-- 漏斗图 -->
        <div class="card chart-card">
          <canvas ref="funnelCanvas" height="300"></canvas>
        </div>

      </div>

      <!-- Phase E: 转化率面板 -->
      <ConversionRatePanel
        v-if="conversionRates"
        :rates="conversionRates.rates"
        :overall-rate="conversionRates.overallRate"
        style="margin-top: var(--spacing-lg);"
      />

      <!-- Phase E: 渠道入职看板 -->
      <SourceOnboardBoard
        v-if="sourceStats?.sources?.length"
        :source-data="sourceStats.sources"
      />

      <!-- Phase E: 部门入职概览 -->
      <DeptOnboardOverview
        v-if="deptOnboardData"
        v-model="selectedDept"
        :dept-data="deptOnboardData"
        :departments="deptOnboardData.departments"
      />

      <!-- Phase E: 月度需求vs入职 -->
      <DemandVsOnboardChart
        v-if="demandVsOnboardData?.months?.length"
        :data="demandVsOnboardData"
      />

      <!-- 月度部门报表 -->
      <div v-if="deptData?.jobs?.length > 0" class="section-header" style="margin-top: var(--spacing-2xl);">
        <h3>部门月度概况（{{ deptData.year }}-{{ String(deptData.month).padStart(2, '0') }}）</h3>
      </div>
      <div v-if="deptData?.jobs?.length > 0" class="card dept-table-card">
        <table class="dept-table">
          <thead>
            <tr>
              <th>岗位</th>
              <th class="num">进入面试</th>
              <th class="num">发出 Offer</th>
              <th class="num">入职</th>
              <th class="num">Offer 转化率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in deptData.jobs" :key="job.jobId">
              <td>{{ job.jobTitle }}</td>
              <td class="num">{{ job.interviewCount }}</td>
              <td class="num">{{ job.offerCount }}</td>
              <td class="num">{{ job.onboardCount }}</td>
              <td class="num">
                {{ job.offerCount > 0 ? Math.round(job.onboardCount / job.offerCount * 100) + '%' : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 漏斗数据表 -->
      <div class="section-header" style="margin-top: var(--spacing-2xl);">
        <h3>漏斗明细</h3>
      </div>
      <div class="card funnel-table-card">
        <div class="funnel-mini-bar">
          <div
            v-for="(stage, i) in funnelData.stages"
            :key="stage.key"
            class="funnel-mini-segment"
            :style="{ flex: Math.max(stage.count, 0.5), opacity: 0.4 + (i / funnelData.stages.length) * 0.6 }"
            :title="`${stage.key}: ${stage.count}`"
          ></div>
        </div>
        <div class="funnel-stats-row">
          <div class="funnel-stat">
            <span class="funnel-stat-label">简历 → 入职</span>
            <span class="funnel-stat-value">{{ funnelData.rates?.overallRate ?? 0 }}%</span>
          </div>
          <div class="funnel-stat">
            <span class="funnel-stat-label">淘汰</span>
            <span class="funnel-stat-value danger">{{ funnelData.rejectedCount }}</span>
          </div>
          <div class="funnel-stat">
            <span class="funnel-stat-label">放弃</span>
            <span class="funnel-stat-value muted">{{ funnelData.withdrawnCount }}</span>
          </div>
          <div class="funnel-stat">
            <span class="funnel-stat-label">总候选人</span>
            <span class="funnel-stat-value">{{ funnelData.totalCount }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 招聘需求指标（Phase 6） -->
    <div v-if="demandData" class="report-card">
      <h3 class="card-title">📋 招聘需求概况</h3>
      <div class="stat-cards">
        <div class="stat-card"><span class="stat-num">{{ demandData.totalDemands }}</span><span class="stat-label">需求总数</span></div>
        <div class="stat-card"><span class="stat-num">{{ demandData.pendingDemands }}</span><span class="stat-label">待审批</span></div>
        <div class="stat-card"><span class="stat-num">{{ demandData.recruitingDemands }}</span><span class="stat-label">招聘中</span></div>
        <div class="stat-card"><span class="stat-num">{{ demandData.completedDemands }}</span><span class="stat-label">已完成</span></div>
        <div class="stat-card"><span class="stat-num">{{ demandData.avgApprovalHours }}h</span><span class="stat-label">平均审批周期</span></div>
      </div>
    </div>

    <!-- 招聘专员效能（Phase 6） -->
    <div v-if="efficiencyData?.recruiters?.length" class="report-card">
      <h3 class="card-title">👥 招聘专员效能</h3>
      <table class="eff-table">
        <thead><tr>
          <th>专员</th><th>简历处理</th><th>面试中</th><th>Offer</th><th>已入职</th><th>在招岗位</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in efficiencyData.recruiters" :key="r.ownerId">
            <td><strong>{{ r.name }}</strong></td>
            <td>{{ r.resumeProcessed }}</td>
            <td>{{ r.interviews }}</td>
            <td>{{ r.offers }}</td>
            <td>{{ r.onboarded }}</td>
            <td>{{ r.activeJobs }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.reports-page {
  max-width: 1200px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--spacing-xl);
}

.page-title {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--gray-700);
  margin-bottom: var(--spacing-xs);
}

.page-desc {
  color: var(--gray-400);
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}

.select-sm {
  padding: 6px 12px;
  font-size: var(--font-size-sm);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  background: #fff;
  color: var(--gray-600);
  font-family: inherit;
  cursor: pointer;
}

/* === 图表 === */
.charts-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--spacing-lg);
}

.chart-card {
  padding: var(--spacing-lg);
  position: relative;
  min-height: 360px;
}

.chart-card canvas {
  width: 100% !important;
}

/* === 加载 === */
.loading-state {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-lg);
}

.skeleton-chart {
  padding: var(--spacing-lg);
}

.skeleton-line {
  height: 14px;
  background: var(--gray-100);
  border-radius: 4px;
  animation: pulse 1.5s infinite;
}
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-full { width: 100%; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* === 空状态 === */
.empty-state {
  text-align: center;
  padding: var(--spacing-3xl);
}
.empty-state-icon { font-size: 48px; margin-bottom: var(--spacing-md); }
.empty-state-text { font-size: var(--font-size-lg); font-weight: 600; color: var(--gray-500); margin-bottom: var(--spacing-sm); }
.text-muted { color: var(--gray-400); font-size: var(--font-size-sm); line-height: 1.6; }

/* === 部门表 === */
.section-header h3 {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--gray-700);
  margin-bottom: var(--spacing-md);
}

.dept-table-card {
  padding: 0;
  overflow: hidden;
}

.dept-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.dept-table th {
  text-align: left;
  padding: 10px 16px;
  background: var(--gray-25);
  color: var(--gray-500);
  font-weight: 500;
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dept-table td {
  padding: 10px 16px;
  color: var(--gray-600);
  border-top: 1px solid var(--gray-100);
}

.dept-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* === 漏斗明细 === */
.funnel-table-card {
  padding: var(--spacing-lg);
}

.funnel-mini-bar {
  display: flex;
  gap: 2px;
  height: 24px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: var(--spacing-md);
}

.funnel-mini-segment {
  background: var(--primary);
  min-width: 2px;
  border-radius: 2px;
  transition: opacity 0.2s;
}

.funnel-stats-row {
  display: flex;
  gap: var(--spacing-xl);
}

.funnel-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.funnel-stat-label {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

.funnel-stat-value {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--gray-700);
}

.funnel-stat-value.danger { color: var(--danger); }
.funnel-stat-value.muted { color: var(--gray-400); }

@media (max-width: 768px) {
  .charts-grid,
  .loading-state {
    grid-template-columns: 1fr;
  }
}
/* Phase 6: 需求指标 + 专员效能 */
.report-card { background: #fff; border: 1px solid var(--gray-100); border-radius: var(--radius-md); padding: var(--spacing-lg); margin-bottom: var(--spacing-lg); }
.card-title { margin: 0 0 var(--spacing-md); font-size: var(--font-size-lg); }
.stat-cards { display: flex; gap: var(--spacing-md); flex-wrap: wrap; }
.stat-card { flex: 1; min-width: 120px; text-align: center; padding: var(--spacing-md); background: var(--gray-25); border-radius: var(--radius-sm); }
.stat-num { display: block; font-size: 28px; font-weight: 700; color: var(--primary); }
.stat-label { display: block; font-size: var(--font-size-xs); color: var(--gray-500); margin-top: 4px; }
.eff-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.eff-table th { text-align: left; padding: 8px; border-bottom: 2px solid var(--gray-100); color: var(--gray-500); }
.eff-table td { padding: 8px; border-bottom: 1px solid var(--gray-50); }
</style>
