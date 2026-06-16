<script setup>
/* 新励成招聘管理系统 V2.0 — 工作台 */

import { ref, onMounted, computed } from 'vue';
import { useAuthStore } from '../stores/useAuthStore';
import cloudbase from '../services/cloudbase';

const auth = useAuthStore();
const db = cloudbase.db();

// 解析统计（阶段 2 数据）
const parseStats = ref({ pending: 0, total: 0 });

const isAdmin = computed(() => auth.isAdmin);

onMounted(async () => {
  try {
    // 尝试获取 ParseQueue 待处理数量
    const pendingResult = await db.collection('ParseQueue')
      .where({ status: 'pending' })
      .count();
    parseStats.value.pending = pendingResult.total || 0;
  } catch {
    // 集合可能尚未创建，静默
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
    </div>

    <!-- 统计卡片 -->
    <div class="stat-grid">
      <div class="stat-card card">
        <div class="stat-label">活跃候选人</div>
        <div class="stat-value">—</div>
        <div class="stat-hint">阶段 5 实现</div>
      </div>
      <div class="stat-card card">
        <div class="stat-label">本月入职</div>
        <div class="stat-value">—</div>
        <div class="stat-hint">阶段 5 实现</div>
      </div>
      <div class="stat-card card">
        <div class="stat-label">待跟进</div>
        <div class="stat-value">—</div>
        <div class="stat-hint">阶段 5 实现</div>
      </div>
      <div class="stat-card card">
        <div class="stat-label">待解析简历</div>
        <div class="stat-value">{{ parseStats.pending }}</div>
        <div class="stat-hint">ParseQueue 队列</div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="section-header">
      <h3>快捷操作</h3>
    </div>
    <div class="quick-grid">
      <router-link to="/import/resume" class="quick-card card">
        <span class="quick-icon q-import">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </span>
        <span class="quick-title">录入简历</span>
        <span class="quick-desc">上传简历 · AI 解析</span>
      </router-link>
      <router-link to="/pipeline" class="quick-card card">
        <span class="quick-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="5" rx="1"/><rect x="3" y="10" width="18" height="5" rx="1"/><rect x="3" y="17" width="18" height="5" rx="1"/></svg>
        </span>
        <span class="quick-title">招聘看板</span>
        <span class="quick-desc">拖拽管理候选人流转</span>
      </router-link>
      <router-link to="/candidates" class="quick-card card">
        <span class="quick-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/></svg>
        </span>
        <span class="quick-title">候选人库</span>
        <span class="quick-desc">搜索和管理候选人</span>
      </router-link>
      <router-link to="/reports" class="quick-card card">
        <span class="quick-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </span>
        <span class="quick-title">数据分析</span>
        <span class="quick-desc">漏斗转化与趋势</span>
      </router-link>
      <router-link to="/settings" class="quick-card card">
        <span class="quick-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4"/></svg>
        </span>
        <span class="quick-title">系统设置</span>
        <span class="quick-desc">岗位与邮箱配置</span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  max-width: 1100px;
}

/* === 欢迎 === */
.welcome-bar {
  margin-bottom: var(--spacing-lg);
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--gray-700);
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
  margin-bottom: var(--spacing-xl);
}

.stat-card {
  padding: var(--spacing-lg);
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  font-weight: 500;
  margin-bottom: var(--spacing-sm);
}

.stat-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--gray-700);
  letter-spacing: -0.02em;
}

.stat-hint {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  margin-top: var(--spacing-xs);
}

/* === 快捷入口 === */
.section-header {
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

.quick-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--spacing-lg);
  text-decoration: none;
  transition: all var(--transition);
}

.quick-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.quick-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: var(--primary-bg);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--spacing-md);
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

@media (max-width: 900px) {
  .stat-grid,
  .quick-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .stat-grid,
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
</style>
