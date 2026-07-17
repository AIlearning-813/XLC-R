<script setup>
/**
 * StorageUsageTab.vue — 云存储用量展示 Tab
 *
 * 从 CloudBase 云函数 get-storage-usage 获取存储统计数据并展示。
 * 配额基于 19.9 元/月个人版（3GB），如升级套餐需更新 quotaBytes。
 */
import { ref, onMounted } from 'vue';
import cloudbase from '../../services/cloudbase';

const loading = ref(false);
const error = ref('');
const data = ref(null);

const QUOTA_BYTES = 3 * 1024 * 1024 * 1024; // 19.9元/月个人版：3GB

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function percentClass(pct) {
  const n = parseFloat(pct);
  if (n >= 80) return 'bar-danger';
  if (n >= 50) return 'bar-warning';
  return 'bar-safe';
}

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const result = await cloudbase.callFunction('get-storage-usage');
    if (result?.ok) {
      data.value = result;
    } else {
      error.value = result?.error || '云函数返回异常';
    }
  } catch (err) {
    error.value = err.message || '获取存储用量失败';
    console.error('[StorageUsageTab] 获取存储用量失败:', err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => { refresh(); });
</script>

<template>
  <div class="storage-usage-tab">
    <div class="tab-header">
      <h3 class="tab-title">📦 存储用量</h3>
      <button class="btn-refresh" :disabled="loading" @click="refresh">
        {{ loading ? '加载中...' : '🔄 刷新' }}
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-banner">
      <p>⚠️ {{ error }}</p>
      <p class="error-hint">
        如云函数尚未部署，请执行
        <code>tcb fn deploy get-storage-usage</code>
        或在 CloudBase 控制台上传云函数。
      </p>
    </div>

    <!-- 加载中占位 -->
    <div v-if="loading && !data" class="loading-placeholder">
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar short"></div>
      <div class="skeleton-row" v-for="i in 3" :key="i">
        <div class="skeleton-card"></div>
      </div>
    </div>

    <!-- 数据展示 -->
    <template v-if="data">
      <!-- 总览卡片 -->
      <div class="overview-card">
        <div class="overview-main">
          <div class="overview-stat">
            <span class="stat-label">已用空间</span>
            <span class="stat-value">{{ data.totalSizeFormatted || '0 B' }}</span>
          </div>
          <div class="overview-stat">
            <span class="stat-label">套餐配额</span>
            <span class="stat-value">{{ data.quotaFormatted || '3 GB' }}</span>
          </div>
          <div class="overview-stat">
            <span class="stat-label">文件数量</span>
            <span class="stat-value">{{ data.totalFiles || 0 }} 个</span>
          </div>
        </div>

        <!-- 进度条 -->
        <div class="progress-section">
          <div class="progress-header">
            <span>使用进度</span>
            <span :class="['progress-pct', percentClass(data.usagePercent)]">
              {{ data.usagePercent }}%
            </span>
          </div>
          <div class="progress-bar-track">
            <div
              class="progress-bar-fill"
              :class="percentClass(data.usagePercent)"
              :style="{ width: Math.min(parseFloat(data.usagePercent), 100) + '%' }"
            ></div>
          </div>
          <div class="progress-footer">
            <span>剩余 {{ formatSize(Math.max(0, QUOTA_BYTES - (data.totalSize || 0))) }}</span>
          </div>
        </div>
      </div>

      <!-- 分类明细 -->
      <div class="breakdown-section">
        <h4>分类明细</h4>
        <div class="breakdown-grid">
          <div
            v-for="item in data.breakdown"
            :key="item.prefix"
            class="breakdown-card"
          >
            <div class="breakdown-icon">
              {{ item.prefix.includes('email') ? '📧' : item.prefix.includes('backup') ? '💾' : '📄' }}
            </div>
            <div class="breakdown-info">
              <div class="breakdown-label">{{ item.label }}</div>
              <div class="breakdown-detail">
                {{ item.sizeFormatted || '0 B' }} · {{ item.count || 0 }} 个文件
              </div>
            </div>
          </div>

          <!-- 无分类文件提示 -->
          <div v-if="!data.breakdown || data.breakdown.length === 0" class="breakdown-empty">
            暂无分类数据
          </div>
        </div>
      </div>

      <!-- 扫描时间 -->
      <p class="scan-time">最近扫描：{{ new Date(data.scannedAt).toLocaleString() }}</p>
    </template>
  </div>
</template>

<style scoped>
.storage-usage-tab {
  max-width: 700px;
}

.tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
}

.tab-title {
  margin: 0;
  font-size: 1.1rem;
  color: var(--text-primary);
}

.btn-refresh {
  padding: 6px 16px;
  border: 1px solid var(--border-color, #d9d9d9);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-white, #fff);
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--text-secondary, #666);
  transition: all 0.2s;
}
.btn-refresh:hover:not(:disabled) {
  border-color: var(--primary-color, #4a90d9);
  color: var(--primary-color, #4a90d9);
}
.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 错误 */
.error-banner {
  padding: 16px;
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 8px;
  margin-bottom: 16px;
  color: #856404;
}
.error-banner p { margin: 0 0 8px; }
.error-banner p:last-child { margin: 0; }
.error-hint code {
  background: rgba(0,0,0,0.06);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.85rem;
}

/* 骨架屏 */
.loading-placeholder { padding: 16px 0; }
.skeleton-bar {
  height: 80px;
  background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
  margin-bottom: 16px;
}
.skeleton-bar.short { height: 40px; width: 60%; }
.skeleton-row { display: flex; gap: 12px; margin-bottom: 12px; }
.skeleton-card {
  flex: 1;
  height: 60px;
  background: linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

/* 总览卡片 */
.overview-card {
  background: var(--bg-white, #fff);
  border: 1px solid var(--border-color, #e8e8e8);
  border-radius: var(--radius-md, 8px);
  padding: 24px;
  margin-bottom: 20px;
}

.overview-main {
  display: flex;
  gap: 32px;
  margin-bottom: 20px;
}

.overview-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-label {
  font-size: 0.82rem;
  color: var(--text-tertiary, #999);
}
.stat-value {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--text-primary, #333);
}

/* 进度条 */
.progress-section { margin-top: 4px; }
.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.85rem;
  color: var(--text-secondary, #666);
}
.progress-pct { font-weight: 600; }
.progress-pct.bar-safe { color: #52c41a; }
.progress-pct.bar-warning { color: #fa8c16; }
.progress-pct.bar-danger { color: #ff4d4f; }

.progress-bar-track {
  height: 10px;
  background: #f0f0f0;
  border-radius: 5px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.6s ease;
}
.progress-bar-fill.bar-safe { background: linear-gradient(90deg, #52c41a, #73d13d); }
.progress-bar-fill.bar-warning { background: linear-gradient(90deg, #fa8c16, #ffc069); }
.progress-bar-fill.bar-danger { background: linear-gradient(90deg, #ff4d4f, #ff7875); }

.progress-footer {
  margin-top: 6px;
  font-size: 0.78rem;
  color: var(--text-tertiary, #999);
}

/* 分类明细 */
.breakdown-section { margin-bottom: 16px; }
.breakdown-section h4 {
  margin: 0 0 12px;
  font-size: 0.95rem;
  color: var(--text-primary, #333);
}

.breakdown-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.breakdown-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-page, #fafafa);
  border: 1px solid var(--border-color, #e8e8e8);
  border-radius: 8px;
  transition: background 0.2s;
}
.breakdown-card:hover { background: var(--bg-white, #fff); }

.breakdown-icon { font-size: 1.5rem; flex-shrink: 0; }
.breakdown-info { flex: 1; }
.breakdown-label {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary, #333);
  margin-bottom: 2px;
}
.breakdown-detail {
  font-size: 0.8rem;
  color: var(--text-tertiary, #999);
}

.breakdown-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-tertiary, #999);
  font-size: 0.9rem;
}

.scan-time {
  font-size: 0.75rem;
  color: var(--text-placeholder, #bbb);
  text-align: right;
  margin: 0;
}
</style>
