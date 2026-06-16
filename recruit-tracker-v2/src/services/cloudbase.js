/* 新励成招聘管理系统 V2.0 — CloudBase SDK 封装层 */

import cloudbase from '@cloudbase/js-sdk';
import env from '../config/env';

// 单例 CloudBase 实例
let app = null;

function getApp() {
  if (!app) {
    if (!env.ENV_ID) {
      console.warn(
        '⚠️ CloudBase ENV_ID 未配置。请创建 .env.local 并设置 VITE_CLOUDBASE_ENV_ID。\n' +
        '  当前处于离线模式，数据库/存储操作将不可用。'
      );
      return null;
    }
    app = cloudbase.init({
      env: env.ENV_ID,
    });
  }
  return app;
}

// 获取数据库实例
function db() {
  const app = getApp();
  if (!app) return null;
  return app.database();
}

// 获取认证实例
function auth(options) {
  const app = getApp();
  if (!app) return null;
  return app.auth(options);
}

// 获取存储实例
function storage() {
  const app = getApp();
  if (!app) return null;
  return app.storage();
}

// 调用云函数
async function callFunction(name, data) {
  const app = getApp();
  if (!app) throw new Error('CloudBase 未初始化，无法调用云函数');
  const res = await app.callFunction({ name, data });
  return res.result;
}

// 检查 CloudBase 是否可用
function isReady() {
  return !!getApp();
}

export default {
  getApp,
  db,
  auth,
  storage,
  callFunction,
  isReady,
};
