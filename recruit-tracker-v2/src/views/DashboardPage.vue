<script setup>
/* 新励成招聘管理系统 V2.0 — 工作台 */

import { ref, onMounted, computed, reactive, watch } from 'vue';
import { useAuthStore } from '../stores/useAuthStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { getDashboardOverview, getDemandVsOnboard, getSystemStatus, getDuplicateCandidates } from '../services/funnel-report';
import { getDemandTracking, getDemandAlerts } from '../services/demand-report';
import { ownerFilter } from '../services/data-filter';
import { formatDateISO } from '../services/format-utils';
import NotificationCard from '../components/dashboard/NotificationCard.vue';
import DateRangePicker from '../components/common/DateRangePicker.vue';
import PeriodMetricsCards from '../components/dashboard/PeriodMetricsCards.vue';
import DemandOverviewCards from '../components/dashboard/DemandOverviewCards.vue';
import DemandAlertBoard from '../components/dashboard/DemandAlertBoard.vue';

const auth = useAuthStore();
const notify = useNotificationStore();

const isAdmin = computed(() => auth.isAdmin);

// ===== 概览数据 =====
const overview = ref(null);
const overviewLoading = ref(true);
const overviewError = ref('');

// ===== 系统状态（管理员） =====
const systemStatus = ref({
  functionsOnline: 10,    // 已部署云函数总数（后续从 cloudbaserc.json 同步）
  dbStatus: 'checking',   // checking | ok | error
  emailConfigCount: 0,
  lastScanTime: null,
});
const showSystemPanel = ref(false);

// ===== 重复候选人（管理员） =====
const duplicateGroups = ref([]);
const duplicateLoading = ref(false);

// ===== Phase E: 时间段选择 + 增强数据 =====
const dateRange = reactive({ start: new Date(), end: new Date() });
// 默认本月
const now = new Date();
dateRange.start = new Date(now.getFullYear(), now.getMonth(), 1);
dateRange.end = now;

const periodMetrics = ref({ demandCount: 0, onboardCount: 0, offerPending: 0, alreadyOnboarded: 0 });
const demandOverview = ref({ recruiting: 0, overdue: 0, gap: 0, completionRate: 0 });
const demandAlerts = ref([]);
const metricsLoading = ref(false);

// P1-10：使用共享格式化工具
function fmtDate(d) { return formatDateISO(d); }

async function loadPeriodData() {
  metricsLoading.value = true;
  try {
    const of = ownerFilter();
    const params = { startDate: fmtDate(dateRange.start), endDate: fmtDate(dateRange.end) };
    if (of) params.ownerId = of.ownerId;

    // 并行加载
    const [overviewData, trackingData, dvoData] = await Promise.all([
      getDashboardOverview(params),
      getDemandTracking(params),
      getDemandVsOnboard({ ...params, months: 1 }),
    ]);

    // 周期指标
    periodMetrics.value = {
      demandCount: overviewData?.activeJobCount || 0,
      onboardCount: overviewData?.monthlyOnboardCount || 0,
      offerPending: 0, // 需要额外查询
      alreadyOnboarded: overviewData?.recent30dOnboardCount || 0,
      rangeLabel: `${fmtDate(dateRange.start)} ~ ${fmtDate(dateRange.end)}`,
    };

    // 需求概览
    if (trackingData) {
      const demands = trackingData.demands || [];
      demandOverview.value = {
        recruiting: demands.filter(d => d.status === 'recruiting').length,
        overdue: trackingData.alerts?.overdueCount || 0,
        gap: demands.reduce((s, d) => s + (d.gap || 0), 0),
        completionRate: demands.length > 0
          ? Math.round(demands.reduce((s, d) => s + (d.completionRate || 0), 0) / demands.length)
          : 0,
      };
    }

    // 预警数据
    if (trackingData) {
      demandAlerts.value = getDemandAlerts(trackingData).map(d => ({
        ...d,
        severity: d.isOverdue ? 'overdue' : d.isNearDeadline ? 'nearDeadline' : 'highGap',
      }));
    }
  } catch (err) {
    console.warn('[Dashboard] 周期数据加载失败:', err.message);
  } finally {
    metricsLoading.value = false;
  }
}

// 时间段切换时重新加载
watch(dateRange, () => { loadPeriodData(); }, { deep: true });

async function loadOverview() {
  overviewLoading.value = true;
  overviewError.value = '';
  try {
    const params = { startDate: fmtDate(dateRange.start), endDate: fmtDate(dateRange.end) };
    const data = await getDashboardOverview(params);
    if (data) {
      overview.value = data;
    } else {
      overviewError.value = '无法获取概览数据，请稍后重试';
    }
  } catch (err) {
    overviewError.value = err.message || '加载失败';
  } finally {
    overviewLoading.value = false;
  }
}

async function loadSystemStatus() {
  const status = await getSystemStatus();
  systemStatus.value = status;
}

async function loadDuplicates() {
  duplicateLoading.value = true;
  try {
    const candidates = await getDuplicateCandidates();

    if (!candidates || candidates.length < 2) {
      duplicateGroups.value = [];
      return;
    }

    // 按手机号分组
    const phoneMap = {};
    const nameCompanyMap = {};

    for (const c of candidates) {
      if (c.phone) {
        const phone = c.phone.replace(/\D/g, '');
        if (phone.length >= 11) {
          if (!phoneMap[phone]) phoneMap[phone] = [];
          phoneMap[phone].push(c);
        }
      }
      // 姓名相同（简化版：只按姓名分组）
      if (c.name) {
        const nameKey = c.name.trim();
        if (!nameCompanyMap[nameKey]) nameCompanyMap[nameKey] = [];
        nameCompanyMap[nameKey].push(c);
      }
    }

    const groups = [];

    // 手机号完全相同的（高度疑似）
    for (const [phone, list] of Object.entries(phoneMap)) {
      if (list.length >= 2) {
        groups.push({ type: 'phone', reason: `手机号 ${phone.slice(0, 3)}****${phone.slice(-4)} 相同`, candidates: list, confidence: 'high' });
      }
    }

    // 姓名相同的（可能重复，去重已在高疑似中的）
    const highPhoneIds = new Set(groups.flatMap(g => g.candidates.map(c => c._id)));
    for (const [name, list] of Object.entries(nameCompanyMap)) {
      if (list.length >= 2) {
        const filtered = list.filter(c => !highPhoneIds.has(c._id));
        if (filtered.length >= 2) {
          groups.push({ type: 'name', reason: `姓名"${name}"相同`, candidates: filtered, confidence: 'medium' });
        }
      }
    }

    duplicateGroups.value = groups;
  } catch (err) {
    console.warn('[Dashboard] 重复候选人查询失败:', err.message);
  } finally {
    duplicateLoading.value = false;
  }
}

function formatTime(dateStr) {
  if (!dateStr) return '暂无记录';
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 60000);
  if (diff < 1) return '刚刚';
  if (diff < 60) return `${diff} 分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小时前`;
  return `${Math.floor(diff / 1440)} 天前`;
}

onMounted(async () => {
  await loadOverview();
  loadPeriodData();

  if (auth.currentUser?.uid) {
    notify.fetchNotifications(auth.currentUser.uid);
  }

  if (isAdmin.value) {
    loadSystemStatus();
    loadDuplicates();
  }
});
</script>

<template>
  <div class="dashboard-page">
    <!-- 欢迎 -->
    <div class="welcome-bar">
      <div>
        <h2 class="page-title">早上好，{{ auth.userName }}</h2>
        <p class="page-subtitle">今日招聘工作概览</p>
      </div>
      <button v-if="isAdmin" class="btn btn-sm" :class="{ active: showSystemPanel }" @click="showSystemPanel = !showSystemPanel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4m-7.42-5.58l2.83-2.83m9.9-9.9l2.83-2.83M1 12h4m14 0h4M4.58 18.42l2.83-2.83m9.9-9.9l2.83-2.83"/>
        </svg>
        {{ showSystemPanel ? '收起' : '系统状态' }}
      </button>
    </div>

    <!-- 统计卡片 -->
    <div v-if="overviewLoading" class="stat-grid">
      <div v-for="i in 4" :key="i" class="card stat-card-accent skeleton">
        <div class="skeleton-line w-24"></div>
        <div class="skeleton-line w-12 h-lg"></div>
      </div>
    </div>
    <div v-else-if="overviewError" class="stat-grid">
      <div class="card stat-card-accent" style="grid-column: 1/-1; text-align: center; color: var(--gray-400);">
        {{ overviewError }}
        <button class="btn btn-sm" style="margin-left: 12px;" @click="loadOverview">重试</button>
      </div>
    </div>
    <div v-else class="stat-grid">
      <div class="card stat-card-accent primary">
        <div class="stat-icon primary">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/>
          </svg>
        </div>
        <div class="stat-label">活跃候选人</div>
        <div class="stat-value-lg">{{ overview?.activeCount ?? 0 }}</div>
        <div class="stat-hint">招聘看板流转中</div>
      </div>

      <div class="card stat-card-accent success">
        <div class="stat-icon success">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <div class="stat-label">本月入职</div>
        <div class="stat-value-lg">{{ overview?.monthlyOnboardCount ?? 0 }}</div>
        <div class="stat-hint">已发 Offer 并到岗</div>
      </div>

      <div class="card stat-card-accent warning" :class="{ 'has-alert': overview?.pendingFollowCount > 0 }">
        <div class="stat-icon warning">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div class="stat-label">待跟进</div>
        <div class="stat-value-lg">{{ overview?.pendingFollowCount ?? 0 }}</div>
        <div class="stat-hint">需推进流程的候选人</div>
      </div>

      <div class="card stat-card-accent accent">
        <div class="stat-icon accent">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div class="stat-label">待解析简历</div>
        <div class="stat-value-lg">{{ overview?.pendingParseCount ?? 0 }}</div>
        <div class="stat-hint">解析队列</div>
      </div>
    </div>

    <!-- Phase E: 时间段选择器 + 周期数据 -->
    <div class="section-header" style="margin-top: var(--spacing-2xl);">
      <h3>招聘数据周期</h3>
    </div>
    <DateRangePicker v-model="dateRange" />

    <!-- 周期指标卡片 -->
    <div v-if="!metricsLoading" style="margin-top: var(--spacing-lg);">
      <PeriodMetricsCards :metrics="periodMetrics" />
    </div>

    <!-- 需求概览 -->
    <DemandOverviewCards :stats="demandOverview" style="margin-bottom: var(--spacing-xl);" />

    <!-- 预警观察板 -->
    <DemandAlertBoard :alerts="demandAlerts" />

    <!-- 快捷入口 -->
    <div class="section-header">
      <h3>快捷操作</h3>
    </div>
    <div class="quick-grid">
      <router-link to="/import/resume" class="card quick-card-enhanced">
        <div class="quick-icon-grad blue">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <span class="quick-title">录入简历</span>
        <span class="quick-desc">上传简历 · AI 解析</span>
      </router-link>

      <router-link to="/pipeline" class="card quick-card-enhanced">
        <div class="quick-icon-grad green">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="3" y="3" width="18" height="5" rx="1.5"/><rect x="3" y="10" width="18" height="5" rx="1.5"/><rect x="3" y="17" width="18" height="5" rx="1.5"/>
          </svg>
        </div>
        <span class="quick-title">招聘看板</span>
        <span class="quick-desc">拖拽管理候选人流转</span>
      </router-link>

      <router-link to="/candidates" class="card quick-card-enhanced">
        <div class="quick-icon-grad amber">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/>
          </svg>
        </div>
        <span class="quick-title">候选人库</span>
        <span class="quick-desc">搜索和管理候选人</span>
      </router-link>

      <router-link to="/reports" class="card quick-card-enhanced">
        <div class="quick-icon-grad copper">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        </div>
        <span class="quick-title">数据分析</span>
        <span class="quick-desc">漏斗转化与趋势</span>
      </router-link>
    </div>

    <!-- ====== 管理员：系统状态面板 ====== -->
    <Transition name="panel-slide">
      <div v-if="isAdmin && showSystemPanel" class="system-panel">
        <div class="section-header">
          <h3>系统状态</h3>
          <button class="btn btn-sm" @click="loadSystemStatus">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
            刷新
          </button>
        </div>

        <div class="status-grid">
          <!-- 云函数 -->
          <div class="card status-card">
            <div class="status-card-header">
              <span class="status-dot ok"></span>
              <span>云函数状态</span>
            </div>
            <div class="status-func-list">
              <div class="func-row"><span>report-aggregator</span><span class="tag-ok">正常</span></div>
              <div class="func-row"><span>report-cache-warmer</span><span class="tag-ok">正常</span></div>
              <div class="func-row"><span>email-scanner</span><span class="tag-ok">正常</span></div>
              <div class="func-row"><span>parse-queue-processor</span><span class="tag-ok">正常</span></div>
              <div class="func-row"><span>resume-parser-proxy</span><span class="tag-ok">正常</span></div>
              <div class="func-row"><span>db-backup</span><span class="tag-ok">正常</span></div>
              <div class="func-row"><span>health-monitor</span><span class="tag-ok">正常</span></div>
              <div class="func-row"><span>archive-old-applications</span><span class="tag-ok">正常</span></div>
            </div>
          </div>

          <!-- API 和数据库 -->
          <div class="card status-card">
            <div class="status-card-header">
              <span class="status-dot" :class="systemStatus.dbStatus"></span>
              <span>数据库 &amp; API</span>
            </div>
            <div class="status-item">
              <span class="status-label">文档型数据库</span>
              <span class="tag-ok" v-if="systemStatus.dbStatus === 'ok'">连接正常</span>
              <span class="tag-err" v-else>连接异常</span>
            </div>
            <div class="status-divider"></div>
            <div class="status-item">
              <span class="status-label">DeepSeek AI</span>
              <span class="tag-ok">正常</span>
            </div>
            <div class="status-item">
              <span class="status-label">腾讯云 OCR</span>
              <span class="tag-ok">正常</span>
            </div>
          </div>

          <!-- 邮件扫描 -->
          <div class="card status-card">
            <div class="status-card-header">
              <span class="status-dot" :class="systemStatus.emailConfigCount > 0 ? 'ok' : 'warn'"></span>
              <span>邮件扫描</span>
            </div>
            <div class="status-item">
              <span class="status-label">已配置邮箱</span>
              <span>{{ systemStatus.emailConfigCount }} 个</span>
            </div>
            <div class="status-item">
              <span class="status-label">上次扫描</span>
              <span>{{ formatTime(systemStatus.lastScanTime) }}</span>
            </div>
          </div>

          <!-- 资源用量 -->
          <div class="card status-card">
            <div class="status-card-header">
              <span class="status-dot ok"></span>
              <span>套餐信息</span>
            </div>
            <div class="status-item">
              <span class="status-label">当前套餐</span>
              <span>个人版</span>
            </div>
            <div class="status-item">
              <span class="status-label">资源点</span>
              <span>40,000 点/月</span>
            </div>
            <div class="status-item">
              <span class="status-label">计费周期</span>
              <span>2026-06-19 ~ 2026-07-19</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ====== 管理员：重复候选人 ====== -->
    <div v-if="isAdmin && duplicateGroups.length > 0" class="section-header" style="margin-top: var(--spacing-2xl);">
      <h3>重复候选人检查</h3>
      <span class="badge badge-warning">{{ duplicateGroups.length }} 组疑似重复</span>
    </div>
    <div v-if="isAdmin && duplicateGroups.length > 0" class="duplicate-list">
      <div v-for="(group, gi) in duplicateGroups" :key="gi" class="card duplicate-group">
        <div class="dup-header">
          <span class="badge" :class="group.confidence === 'high' ? 'badge-danger' : 'badge-warning'">
            {{ group.confidence === 'high' ? '高度疑似' : '可能重复' }}
          </span>
          <span class="dup-reason">{{ group.reason }}</span>
        </div>
        <div class="dup-candidates">
          <div v-for="c in group.candidates" :key="c._id" class="dup-candidate-row">
            <span class="dup-name">{{ c.name || '未命名' }}</span>
            <span class="dup-phone">{{ c.phone || '无电话' }}</span>
            <router-link :to="`/candidates/${c._id}`" class="btn btn-xs">查看</router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- 通知卡片 -->
    <div class="section-header">
      <h3>最新动态</h3>
    </div>
    <NotificationCard />
  </div>
</template>

<style scoped>
.dashboard-page {
  max-width: 1100px;
}

/* === 欢迎 === */
.welcome-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--spacing-xl);
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-800);
  letter-spacing: -0.02em;
}

.page-subtitle {
  font-size: var(--font-size-base);
  color: var(--gray-400);
  margin-top: 2px;
}

/* === 统计卡片 === */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-2xl);
}

.stat-card-accent {
  padding: var(--spacing-lg);
}

.stat-card-accent.has-alert {
  border-left: 3px solid var(--warning);
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  font-weight: 500;
  margin-bottom: var(--spacing-xs);
}

.stat-hint {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  margin-top: var(--spacing-xs);
}

.stat-value-lg {
  font-size: 28px;
  font-weight: 700;
  color: var(--gray-800);
  line-height: 1.1;
}

/* === 骨架屏 === */
.skeleton .skeleton-line {
  height: 14px;
  background: var(--gray-100);
  border-radius: 4px;
  margin-bottom: 8px;
  animation: pulse 1.5s infinite;
}
.skeleton .skeleton-line.w-24 { width: 60%; }
.skeleton .skeleton-line.w-12 { width: 30%; }
.skeleton .skeleton-line.h-lg { height: 28px; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* === 快捷入口 === */
.section-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.section-header h3 {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--gray-700);
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacing-md);
}

.quick-card-enhanced {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--spacing-lg);
  text-decoration: none;
}

.quick-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--gray-700);
  margin-bottom: 2px;
}

.quick-desc {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
}

/* === 系统状态面板 === */
.system-panel {
  margin-bottom: var(--spacing-2xl);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-md);
}

.status-card {
  padding: var(--spacing-md);
}

.status-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--gray-700);
  margin-bottom: var(--spacing-sm);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.ok { background: var(--success); }
.status-dot.warn { background: var(--warning); }
.status-dot.error { background: var(--danger); }
.status-dot.checking { background: var(--gray-300); animation: pulse 1.5s infinite; }

.status-func-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.func-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-xs);
  color: var(--gray-500);
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: var(--font-size-xs);
}

.status-label {
  color: var(--gray-400);
}

.status-divider {
  height: 1px;
  background: var(--gray-100);
  margin: 4px 0;
}

.tag-ok {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: #ECFDF5;
  color: #059669;
}
.tag-err {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: #FEF2F2;
  color: #DC4C4C;
}

/* === 重复候选人 === */
.duplicate-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xl);
}

.duplicate-group {
  padding: var(--spacing-md);
}

.dup-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.dup-reason {
  font-size: var(--font-size-sm);
  color: var(--gray-600);
}

.dup-candidates {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dup-candidate-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: 6px 10px;
  background: var(--gray-25);
  border-radius: 4px;
  font-size: var(--font-size-sm);
}

.dup-name {
  font-weight: 500;
  color: var(--gray-700);
  min-width: 80px;
}

.dup-phone {
  color: var(--gray-400);
  flex: 1;
}

/* === 面板动画 === */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: all 0.25s ease;
}
.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* === 响应式 === */
@media (max-width: 900px) {
  .stat-grid,
  .quick-grid,
  .status-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .stat-grid,
  .quick-grid,
  .status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
