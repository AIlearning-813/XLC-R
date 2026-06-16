/* 新励成招聘管理系统 V2.0 — 环境配置 */

// CloudBase 环境 ID（部署时替换为实际值）
const ENV_ID = import.meta.env.VITE_CLOUDBASE_ENV_ID || '';

// 环境检测
const isProduction = import.meta.env.PROD;
const isDevelopment = import.meta.env.DEV;

// 当前域名
const hostname = window.location.hostname;

// 自动检测环境
function detectEnv() {
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'local';
  }
  // dev 环境域名（根据实际 CloudBase 静态托管域名配置）
  if (hostname.includes('-dev') || hostname.includes('localhost')) {
    return 'dev';
  }
  return 'prod';
}

export const env = {
  ENV_ID,
  envName: detectEnv(),
  isProduction,
  isDevelopment,
  isLocal: detectEnv() === 'local',
};

export default env;
