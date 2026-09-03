<script setup>
/**
 * LoginAttendancePage.vue — 管理员登录考勤看板
 *
 * 行 = 招聘专员，列 = 当月 1..N 号。
 * 每格显示「当日手动登录次数」；整格淡蓝底 = 当日有会话活跃。
 * 数据源：report-aggregator 的 login_attendance（实时聚合，绕过缓存）。
 * 仅供管理员（路由 meta.requireAdmin 拦截）。
 */

import { ref, computed, onMounted } from 'vue';
import { getLoginAttendance } from '../services/login-attendance';

// ===== 北京时区"现在"（与后端 dateKey 同口径）=====
function beijingNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

const nowB = beijingNow();
const viewYear = ref(nowB.year);
const viewMonth = ref(nowB.month); // 1-12

// ===== 状态 =====
const data = ref(null);
const loading = ref(false);
const error = ref('');

// ===== 计算 =====
const daysInMonth = computed(() =>
  data.value ? data.value.daysInMonth : new Date(viewYear.value, viewMonth.value, 0).getDate()
);

// 北京"今天"是否落在当前查看月
function isToday(day) {
  return viewYear.value === nowB.year && viewMonth.value === nowB.month && day === nowB.day;
}
// 未来日期（本月尚未到的天）置灰
function isFuture(day) {
  const inCur = viewYear.value === nowB.year && viewMonth.value === nowB.month;
  return inCur && day > nowB.day;
}
// 周末列头标识（星期 0/6）
function isWeekend(day) {
  const wd = new Date(viewYear.value, viewMonth.value - 1, day).getDay();
  return wd === 0 || wd === 6;
}
function weekdayText(day) {
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  return names[new Date(viewYear.value, viewMonth.value - 1, day).getDay()];
}
function cellTitle(r, c) {
  const active = c.active ? '，有会话活跃' : '';
  return `${r.name || r.username} ${viewMonth.value}月${c.day}日：手动登录 ${c.logins} 次${active}`;
}

// ===== 数据加载 =====
async function load() {
  loading.value = true;
  error.value = '';
  const res = await getLoginAttendance(viewYear.value, viewMonth.value);
  if (!res) {
    error.value = '加载失败，请稍后重试';
  }
  data.value = res;
  loading.value = false;
}

function shiftMonth(delta) {
  const t = new Date(viewYear.value, viewMonth.value - 1 + delta, 1);
  viewYear.value = t.getFullYear();
  viewMonth.value = t.getMonth() + 1;
  load();
}

function goToday() {
  const b = beijingNow();
  viewYear.value = b.year;
  viewMonth.value = b.month;
  load();
}

onMounted(load);
</script>

<template>
  <div class="login-attendance-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">登录考勤</h2>
        <p class="page-desc">专员按日手动登录次数与活跃标记（北京时区 · 实时刷新）</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-sm btn-secondary" @click="shiftMonth(-1)">‹ 上月</button>
        <span class="month-label">{{ viewYear }} 年 {{ viewMonth }} 月</span>
        <button class="btn btn-sm btn-secondary" @click="shiftMonth(1)">下月 ›</button>
        <button class="btn btn-sm btn-ghost" @click="goToday">回到本月</button>
        <button class="btn btn-sm" :disabled="loading" @click="load">
          {{ loading ? '加载中…' : '刷新' }}
        </button>
      </div>
    </div>

    <!-- 加载 / 空态 / 错误 -->
    <div v-if="loading" class="card empty-state"><span class="empty-state-text">加载中…</span></div>
    <div v-else-if="error" class="card empty-state"><span class="empty-state-text">{{ error }}</span></div>
    <div v-else-if="!data" class="card empty-state"><span class="empty-state-text">暂无数据</span></div>

    <div v-else class="card table-card">
      <div class="table-scroll">
        <table class="att-table">
          <thead>
            <tr>
              <th class="fix-name head-name">专员</th>
              <th v-for="d in daysInMonth" :key="'h' + d" class="day-head">
                <span class="day-num">{{ d }}</span>
                <span class="day-week" :class="{ 'is-weekend': isWeekend(d), 'is-today-head': isToday(d) }">
                  {{ weekdayText(d) }}
                </span>
              </th>
              <th class="sum-col">登录<br />总数</th>
              <th class="sum-col">活跃<br />天数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data.recruiters" :key="r.username">
              <td class="fix-name name-cell">
                <span class="name-text">{{ r.name || r.username }}</span>
              </td>
              <td
                v-for="c in r.daily"
                :key="r.username + '-' + c.day"
                class="day-cell"
                :class="{
                  'is-active': c.active,
                  'is-today': isToday(c.day),
                  'is-future': isFuture(c.day),
                }"
                :title="cellTitle(r, c)"
              >
                <span v-if="c.logins > 0" class="login-num">{{ c.logins }}</span>
                <span v-if="c.active" class="active-dot"></span>
                <span v-else-if="c.logins === 0 && !isFuture(c.day)" class="zero-mark">·</span>
              </td>
              <td class="sum-cell"><strong class="sum-num">{{ r.totalLogins }}</strong></td>
              <td class="sum-cell">{{ r.activeDays }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 图例 -->
      <div class="legend">
        <span class="lg-item">
          <span class="lg-sample"><span class="login-num">3</span></span>
          数字 = 当日手动登录次数
        </span>
        <span class="lg-item">
          <span class="lg-sample is-active-bg"><span class="active-dot"></span></span>
          整格淡蓝底 = 当日有会话活跃
        </span>
        <span class="lg-item">
          <span class="lg-sample"><span class="zero-mark">·</span></span>
          无登录且无活跃
        </span>
        <span class="lg-item"><span class="today-tag"></span> 今日</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-attendance-page {
  max-width: 1280px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
  flex-wrap: wrap;
  gap: var(--spacing-sm);
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

.month-label {
  font-weight: 700;
  color: var(--gray-600);
  min-width: 110px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.table-card {
  padding: var(--spacing-md);
  overflow: hidden;
}

.table-scroll {
  overflow: auto;
  max-height: 72vh;
}

/* ==== 考勤表格 ==== */
.att-table {
  border-collapse: separate;
  border-spacing: 0;
  min-width: max-content;
  font-size: var(--font-size-sm);
}

.att-table th,
.att-table td {
  border: 1px solid var(--gray-100);
  border-top: none;
  border-left: none;
}

.att-table th:last-child,
.att-table td:last-child {
  border-right: none;
}

/* 表头 + 首列固定 */
.att-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}

.fix-name {
  position: sticky;
  left: 0;
  z-index: 3;
  background: #fff;
  min-width: 92px;
}

.att-table thead th.fix-name {
  z-index: 4;
}

.head-name {
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--gray-500);
  font-weight: 600;
}

.day-head {
  min-width: 36px;
  padding: 4px 2px;
  text-align: center;
  color: var(--gray-500);
}

.day-num {
  display: block;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.day-week {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
}

.day-week.is-weekend {
  color: var(--danger-light);
}

.day-week.is-today-head {
  color: var(--primary);
  font-weight: 700;
}

.name-cell {
  padding: var(--spacing-sm) var(--spacing-md);
}

.name-text {
  font-weight: 600;
  color: var(--gray-700);
  white-space: nowrap;
}

/* 日期格 */
.day-cell {
  position: relative;
  min-width: 36px;
  height: 40px;
  text-align: center;
  color: var(--gray-300);
  background: #fff;
  transition: background var(--transition);
}

.day-cell.is-active {
  background: var(--primary-bg);
}

.day-cell.is-today {
  box-shadow: inset 0 0 0 2px var(--primary-light);
}

.day-cell.is-future {
  background: var(--gray-50);
  color: var(--gray-200);
}

.day-cell.is-future.is-active {
  background: var(--gray-50);
}

.login-num {
  color: var(--primary-dark);
  font-weight: 700;
  font-size: var(--font-size-base);
  font-variant-numeric: tabular-nums;
}

.zero-mark {
  color: var(--gray-200);
}

.active-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
}

/* 汇总列 */
.sum-col {
  padding: var(--spacing-sm);
  text-align: center;
  color: var(--gray-500);
  font-weight: 600;
  min-width: 52px;
  background: var(--gray-50);
}

.sum-cell {
  padding: var(--spacing-sm);
  text-align: center;
  color: var(--gray-600);
  min-width: 52px;
  font-variant-numeric: tabular-nums;
  background: var(--gray-50);
}

.sum-num {
  color: var(--primary-dark);
}

/* 图例 */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-lg);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--gray-100);
  margin-top: var(--spacing-md);
  color: var(--gray-500);
  font-size: var(--font-size-sm);
}

.lg-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.lg-sample {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  border: 1px solid var(--gray-100);
  border-radius: 4px;
  background: #fff;
  position: relative;
}

.lg-sample.is-active-bg {
  background: var(--primary-bg);
}

.lg-sample .login-num {
  font-size: var(--font-size-sm);
}

.today-tag {
  display: inline-block;
  width: 22px;
  height: 20px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 2px var(--primary-light);
}
</style>
