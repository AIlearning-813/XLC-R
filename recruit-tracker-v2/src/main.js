/* 新励成招聘管理系统 V2.0 — 入口文件 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { setupErrorCapture } from './services/error-capture';
import { calibrate as calibrateServerTime } from './services/server-time';

// 样式
import './assets/styles/base.css';
import './assets/styles/components.css';

// P0-5：启动时异步校准服务器时间（不阻塞应用渲染）
calibrateServerTime().catch(() => {
  console.warn('[main] 服务器时间校准失败，将使用客户端时间');
});

const app = createApp(App);

// 状态管理
const pinia = createPinia();
app.use(pinia);

// 路由
app.use(router);

// 全局错误捕获（main.js 级兜底）
setupErrorCapture(app);

app.mount('#app');
