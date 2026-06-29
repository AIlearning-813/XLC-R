/* 新励成招聘管理系统 V2.0 — CloudBase SDK 封装层 */

import cloudbase from '@cloudbase/js-sdk';
import env from '../config/env';

// 单例 CloudBase 实例
let app = null;

function getApp() {
  if (!app) {
    if (!env.ENV_ID) {
      console.warn(
        '⚠️ 环境ID未配置，请检查 VITE_CLOUDBASE_ENV_ID 设置。\n' +
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
  // 兼容不同版本的 CloudBase JS SDK
  // v3.x 某些版本 storage 是 getter，不允许双重访问
  // 必须先缓存引用再判断，避免 getter 两次返回不同值
  const storageRef = app.storage;
  if (typeof storageRef === 'function') {
    return storageRef();
  }
  if (storageRef && typeof storageRef === 'object') {
    return storageRef;
  }
  console.warn('⚠️ CloudBase SDK 不支持 storage，文件上传功能不可用');
  return null;
}

// 调用云函数
async function callFunction(name, data, options = {}) {
  const app = getApp();
  if (!app) throw new Error('服务未初始化，无法调用云函数');
  const res = await app.callFunction({ name, data, ...options });
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
