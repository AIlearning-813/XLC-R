/* 新励成招聘管理系统 V2.0 — 路由配置 */

import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from '../stores/useAuthStore';

const routes = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../views/DashboardPage.vue'),
    meta: { title: '工作台', icon: 'dashboard' },
  },
  {
    path: '/pipeline',
    name: 'Pipeline',
    component: () => import('../views/PipelinePage.vue'),
    meta: { title: '招聘看板', icon: 'pipeline' },
  },
  {
    path: '/candidates',
    name: 'Candidates',
    component: () => import('../views/CandidatesPage.vue'),
    meta: { title: '候选人', icon: 'candidates' },
  },
  {
    path: '/candidates/:id',
    name: 'CandidateDetail',
    component: () => import('../views/CandidateDetailPage.vue'),
    meta: { title: '候选人详情' },
  },
  {
    path: '/reports',
    name: 'Reports',
    component: () => import('../views/ReportsPage.vue'),
    meta: { title: '数据分析', icon: 'reports' },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsPage.vue'),
    meta: { title: '系统设置', icon: 'settings', requireAdmin: true },
  },
  {
    path: '/import/resume',
    name: 'ResumeImport',
    component: () => import('../views/ResumeImportPage.vue'),
    meta: { title: '录入简历', icon: 'import' },
  },
  {
    path: '/import',
    name: 'Import',
    component: () => import('../views/ImportPage.vue'),
    meta: { title: '历史数据导入', icon: 'import', requireAdmin: true },
  },
  {
    path: '/admin-review',
    name: 'AdminReview',
    component: () => import('../views/AdminReviewPage.vue'),
    meta: { title: '变更审核', icon: 'review', requireAdmin: true },
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 路由守卫
router.beforeEach((to, from, next) => {
  const auth = useAuthStore();

  // 未登录 → 直接放行（App.vue 层面拦截到 LoginPage）
  if (!auth.isLoggedIn) {
    return next();
  }

  // 需要管理员权限
  if (to.meta.requireAdmin && auth.userRole !== 'admin') {
    console.warn(`权限不足：${to.path} 需要管理员权限`);
    return next('/dashboard');
  }

  // 设置页面标题
  document.title = `${to.meta.title || '新励成招聘'} — 新励成招聘管理系统 V2.0`;
  next();
});

export default router;
