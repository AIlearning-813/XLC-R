<script setup>
/* 新励成招聘管理系统 V2.0 — 工作台 */

import { ref, onMounted, computed } from 'vue';
import { useAuthStore } from '../stores/useAuthStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import cloudbase from '../services/cloudbase';
import NotificationCard from '../components/dashboard/NotificationCard.vue';

const auth = useAuthStore();
const notify = useNotificationStore();
const db = cloudbase.db();

// 解析统计
const parseStats = ref({ pending: 0, total: 0 });

const isAdmin = computed(() => auth.isAdmin);

onMounted(async () => {
  // 查询 ParseQueue 数量
  try {
    const pendingResult = await db.collection('ParseQueue')
      .where({ status: 'pending' })
      .count();
    parseStats.value.pending = pendingResult.total || 0;
  } catch {
    // 集合可能尚未创建，静默
  }

  // 加载通知
  if (auth.currentUser?.uid) {
    notify.fetchNotifications(auth.currentUser.uid);
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
      <!-- 活跃候选人 -->
      <div class="card stat-card-accent primary">
        <div class="stat-icon primary">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/>
          </svg>
        </div>
        <div class="stat-label">活跃候选人</div>
        <div class="stat-value-lg">—</div>
        <div class="stat-hint">招聘看板流转中</div>
      </div>

      <!-- 本月入职 -->
      <div class="card stat-card-accent success">
        <div class="stat-icon success">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <div class="stat-label">本月入职</div>
        <div class="stat-value-lg">—</div>
        <div class="stat-hint">已发 Offer 并到岗</div>
      </div>

      <!-- 待跟进 -->
      <div class="card stat-card-accent warning">
        <div class="stat-icon warning">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div class="stat-label">待跟进</div>
        <div class="stat-value-lg">—</div>
        <div class="stat-hint">需推进流程的候选人</div>
      </div>

      <!-- 待解析 -->
      <div class="card stat-card-accent accent">
        <div class="stat-icon accent">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div class="stat-label">待解析简历</div>
        <div class="stat-value-lg">{{ parseStats.pending }}</div>
        <div class="stat-hint">ParseQueue 队列</div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="section-header">
      <h3>快捷操作</h3>
    </div>
    <div class="quick-grid">
      <router-link to="/import/resume" class="card quick-card-enhanced">
        <div class="quick-icon-grad blue">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
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
