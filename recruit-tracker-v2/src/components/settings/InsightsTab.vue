<script setup>
/**
 * InsightsTab.vue — 历史洞察展示 Tab
 *
 * 按岗位类型展示 RecruitmentInsight 自动分析结果：
 * 平均招聘周期、Offer接受率、Top渠道、淘汰原因、录用画像等。
 * Admin 可触发重新生成。
 */
import { ref, onMounted } from 'vue';
import cloudbase from '../../services/cloudbase';
import { useAuthStore } from '../../stores/useAuthStore';

const auth = useAuthStore();
const db = cloudbase.db();

const insights = ref([]);
const loading = ref(false);
const generating = ref(false);
const error = ref('');

onMounted(async () => {
  await loadInsights();
});

async function loadInsights() {
  if (!db) return;
  loading.value = true;
  error.value = '';

  try {
    const { data } = await db.collection('RecruitmentInsight')
      .orderBy('totalApplications', 'desc')
      .limit(20)
      .get();
    insights.value = data || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function handleGenerate() {
  if (!confirm('将从历史数据中重新分析生成洞察，可能需要 1-2 分钟。确定继续？')) return;

  generating.value = true;
  try {
    const result = await cloudbase.callFunction('history-insight-generator', {
      forceRegenerate: true,
    });

    if (result?.success) {
      alert(`洞察生成完成！已为 ${result.data.jobTypes.length} 个岗位类型生成洞察`);
      await loadInsights();
    } else {
      alert('生成失败：' + (result?.error || '未知错误'));
    }
  } catch (err) {
    alert('生成失败：' + err.message);
  }
  generating.value = false;
}

function formatDays(days) {
  if (days === null || days === undefined) return '—';
  return `${days} 天`;
}

function formatRate(rate) {
  if (rate === null || rate === undefined) return '—';
  return `${rate}%`;
}
</script>

<template>
  <div class="insights-tab">
    <div class="toolbar">
      <h3 class="tab-title">招聘历史洞察</h3>
      <div class="toolbar-actions">
        <span class="text-muted" style="font-size: var(--font-size-sm);">
          基于历史招聘数据自动分析生成，缓存 30 天
        </span>
        <button
          v-if="auth.isAdmin"
          class="btn btn-sm btn-primary"
          @click="handleGenerate"
          :disabled="generating"
        >
          {{ generating ? '生成中…' : '🔄 重新生成洞察' }}
        </button>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="loading" class="card empty-state"><p>加载中…</p></div>

    <!-- 空状态 -->
    <div v-else-if="insights.length === 0" class="card empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">暂无历史洞察</div>
      <p class="text-muted">需要一定历史数据后，点击"生成洞察"自动分析</p>
    </div>

    <!-- 洞察卡片 -->
    <div v-else class="insights-grid">
      <div v-for="ins in insights" :key="ins.cacheKey" class="insight-card">
        <div class="insight-header">
          <h4 class="insight-job-type">{{ ins.jobType || ins.cacheKey?.replace('insight:', '') }}</h4>
          <span class="insight-meta">
            样本 {{ ins.totalApplications || 0 }} 份 | 录用 {{ ins.totalHired || 0 }} 人
          </span>
        </div>

        <div class="insight-metrics">
          <div class="metric">
            <span class="metric-value">{{ formatDays(ins.avgTimeToHire) }}</span>
            <span class="metric-label">平均招聘周期</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ formatRate(ins.offerAcceptRate) }}</span>
            <span class="metric-label">Offer 接受率</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ ins.avgCandidatesPerHire || '—' }}</span>
            <span class="metric-label">平均候选人/录用</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ ins.salaryRange?.min || 0 }}k-{{ ins.salaryRange?.max || 0 }}k</span>
            <span class="metric-label">薪资范围</span>
          </div>
        </div>

        <!-- 成功画像 -->
        <div v-if="ins.successfulProfile" class="insight-profile">
          <strong>🎯 成功候选人画像：</strong>
          <p>{{ ins.successfulProfile }}</p>
        </div>

        <!-- Top 渠道 -->
        <div v-if="ins.topSources?.length" class="insight-detail">
          <strong>📥 Top 来源：</strong>
          <span v-for="(s, i) in ins.topSources.slice(0, 3)" :key="s.source" class="detail-chip">
            {{ s.source }} ({{ s.count }})
          </span>
        </div>

        <!-- 常见淘汰原因 -->
        <div v-if="ins.commonRejectReasons?.length" class="insight-detail">
          <strong>⛔ 常见淘汰原因：</strong>
          <span v-for="(r, i) in ins.commonRejectReasons.slice(0, 3)" :key="r.reason" class="detail-chip danger">
            {{ r.reason }} ({{ r.count }})
          </span>
        </div>

        <!-- 过期警告 -->
        <div v-if="ins.computedAt" class="insight-footer">
          生成于 {{ new Date(ins.computedAt).toLocaleDateString('zh-CN') }}
          <span v-if="ins.expiresAt && new Date(ins.expiresAt) < new Date()" class="expired-warning">
            ⚠️ 已过期
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.insights-tab { max-width: 900px; }

.toolbar {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: var(--spacing-lg); flex-wrap: wrap; gap: var(--spacing-sm);
}
.tab-title {
  font-size: var(--font-size-lg); font-weight: 600; color: var(--gray-700); margin: 0;
}
.toolbar-actions { display: flex; align-items: center; gap: var(--spacing-md); }

.insights-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: var(--spacing-md);
}

.insight-card {
  border: 1px solid var(--gray-100); border-radius: var(--radius-md);
  padding: var(--spacing-md); background: #fff;
}

.insight-header {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: var(--spacing-md);
}
.insight-job-type { font-size: var(--font-size-md); font-weight: 700; color: var(--gray-700); margin: 0; }
.insight-meta { font-size: var(--font-size-xs); color: var(--gray-400); }

.insight-metrics {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md); padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--gray-50);
}
.metric { text-align: center; }
.metric-value { display: block; font-size: var(--font-size-lg); font-weight: 700; color: var(--primary); }
.metric-label { font-size: var(--font-size-xs); color: var(--gray-400); margin-top: 2px; }

.insight-profile {
  margin-bottom: var(--spacing-sm); padding: var(--spacing-sm);
  background: var(--gray-50); border-radius: var(--radius-sm);
  font-size: var(--font-size-sm); color: var(--gray-600); line-height: 1.6;
}
.insight-profile p { margin: var(--spacing-xs) 0 0; }

.insight-detail {
  margin-bottom: var(--spacing-xs); font-size: var(--font-size-sm);
  color: var(--gray-600); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.detail-chip {
  padding: 2px 8px; background: var(--primary-bg); color: var(--primary);
  border-radius: var(--radius-full); font-size: var(--font-size-xs);
}
.detail-chip.danger { background: #fce4ec; color: var(--danger); }

.insight-footer {
  margin-top: var(--spacing-sm); font-size: var(--font-size-xs); color: var(--gray-400);
}
.expired-warning { color: var(--warning); margin-left: var(--spacing-xs); }

@media (max-width: 768px) {
  .insights-grid { grid-template-columns: 1fr; }
  .insight-metrics { grid-template-columns: repeat(2, 1fr); }
}
</style>
