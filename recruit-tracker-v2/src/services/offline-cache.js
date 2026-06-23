/**
 * offline-cache.js — 离线缓存兜底模块
 *
 * P0-4 修复：当 CloudBase 不可用时，从 localStorage 缓存读取数据保证基本可用。
 *
 * P1-9 修复：添加用户隔离机制——
 *   - 缓存 key 包含当前用户标识（username），确保不同用户的缓存互不可见
 *   - 用户切换/登出时自动清除旧用户的缓存
 *   - 防止浏览器共享导致的数据泄露（共享设备场景）
 *
 * 设计原则：
 *   - CloudBase = 唯一数据源，localStorage = 只读缓存 + 离线兜底
 *   - 读：CloudBase 优先 → 成功后写入 localStorage 缓存 → 失败时读缓存
 *   - 写：始终通过 CloudBase（离线时写入本地队列，待恢复后同步）
 *   - TTL 机制：缓存过期后仍可使用（stale-while-revalidate），但标记为过期
 *
 * 缓存粒度：按用户 + store + 数据类型分组存储
 */

const CACHE_PREFIX = 'xlc_cache_';
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 默认 30 分钟

/**
 * P1-9：获取当前用户标识（用于缓存隔离）
 * 优先从 auth store 获取，回退到 localStorage 中的登录态
 * @returns {string} 用户标识，未登录返回 '_anon'
 */
function getCurrentUserKey() {
  try {
    // 尝试从 auth store 获取（运行时）
    const sessionRaw = localStorage.getItem('xlc_auth_session');
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw);
      // P1-5 新格式
      if (session.u) return session.u;
      // 旧格式兼容
      if (session.username) return session.username;
    }
  } catch { /* ignore */ }
  return '_anon';
}

/**
 * P1-9：记录当前活跃用户（用于清除旧用户缓存时识别）
 */
let _activeUserKey = null;

/**
 * P1-9：设置当前活跃用户（登录/切换用户时调用）
 * 如果用户变化，自动清除旧用户的缓存
 * @param {string} username
 */
export function setActiveUser(username) {
  const newKey = username || '_anon';
  if (_activeUserKey && _activeUserKey !== newKey) {
    console.log(`[offline-cache] 用户切换: ${_activeUserKey} → ${newKey}，清除旧用户缓存`);
    clearAllCache();
  }
  _activeUserKey = newKey;
}

/**
 * 生成缓存 key（P1-9：含用户标识，隔离不同用户数据）
 * @param {string} namespace - 命名空间（如 'jobs', 'candidates', 'overview'）
 * @param {string} [id] - 可选的标识符
 * @returns {string}
 */
function cacheKey(namespace, id) {
  const userKey = _activeUserKey || getCurrentUserKey();
  return CACHE_PREFIX + userKey + '_' + namespace + (id ? '_' + id : '');
}

/**
 * 写入缓存
 * @param {string} namespace - 命名空间
 * @param {*} data - 要缓存的数据
 * @param {string} [id] - 可选的标识符
 * @param {number} [ttlMs] - TTL（毫秒），默认 30 分钟
 */
export function setCache(namespace, data, id, ttlMs = DEFAULT_TTL_MS) {
  try {
    const entry = {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    };
    localStorage.setItem(cacheKey(namespace, id), JSON.stringify(entry));
  } catch (err) {
    // localStorage 满或不可用，静默处理
    console.warn(`[offline-cache] 写入缓存失败 [${namespace}]:`, err.message);
  }
}

/**
 * 读取缓存
 * @param {string} namespace - 命名空间
 * @param {string} [id] - 可选的标识符
 * @param {number} [maxAgeMs] - 最大允许年龄（毫秒），超过则返回 null。默认不限。
 * @returns {*} 缓存数据，不存在或过期返回 null
 */
export function getCache(namespace, id, maxAgeMs) {
  try {
    const raw = localStorage.getItem(cacheKey(namespace, id));
    if (!raw) return null;

    const entry = JSON.parse(raw);

    // 检查是否过期
    if (maxAgeMs !== undefined) {
      const age = Date.now() - entry.timestamp;
      if (age > maxAgeMs) {
        console.log(`[offline-cache] 缓存过期 [${namespace}], 年龄: ${Math.round(age / 1000)}s`);
        return null;
      }
    }

    return entry.data;
  } catch (err) {
    console.warn(`[offline-cache] 读取缓存失败 [${namespace}]:`, err.message);
    return null;
  }
}

/**
 * 获取缓存元信息（用于判断新鲜度）
 * @param {string} namespace
 * @param {string} [id]
 * @returns {{ age: number, isStale: boolean } | null}
 */
export function getCacheMeta(namespace, id) {
  try {
    const raw = localStorage.getItem(cacheKey(namespace, id));
    if (!raw) return null;

    const entry = JSON.parse(raw);
    const age = Date.now() - entry.timestamp;
    return {
      age,
      isStale: age > (entry.ttl || DEFAULT_TTL_MS),
      timestamp: entry.timestamp,
    };
  } catch {
    return null;
  }
}

/**
 * 删除指定命名空间的缓存
 * @param {string} namespace
 * @param {string} [id]
 */
export function clearCache(namespace, id) {
  try {
    localStorage.removeItem(cacheKey(namespace, id));
  } catch { /* 静默处理 */ }
}

/**
 * 清除所有离线缓存（P1-9：仅清除当前用户的缓存）
 */
export function clearAllCache() {
  try {
    const userKey = _activeUserKey || getCurrentUserKey();
    const userPrefix = CACHE_PREFIX + userKey + '_';
    const keys = Object.keys(localStorage);
    let count = 0;
    for (const key of keys) {
      if (key.startsWith(userPrefix)) {
        localStorage.removeItem(key);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[offline-cache] 清除了 ${count} 条缓存 (用户: ${userKey})`);
    }
  } catch { /* 静默处理 */ }
}

/**
 * P1-9：清除所有用户的缓存（切换用户或登出时调用）
 */
export function clearAllUsersCache() {
  try {
    const keys = Object.keys(localStorage);
    let count = 0;
    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[offline-cache] 清除了全部 ${count} 条跨用户缓存`);
    }
  } catch { /* 静默处理 */ }
}

// ===== 离线写入队列 =====

const OFFLINE_QUEUE_KEY = CACHE_PREFIX + 'offline_queue';

/**
 * 将写操作加入离线队列（网络恢复后重放）
 * @param {object} operation - { action: string, collection: string, data: object }
 */
export function enqueueOfflineWrite(operation) {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    queue.push({
      ...operation,
      queuedAt: Date.now(),
      id: Math.random().toString(36).slice(2, 9),
    });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log(`[offline-cache] 离线写入已入队: ${operation.action} → ${operation.collection}`);
    return true;
  } catch (err) {
    console.warn('[offline-cache] 离线写入入队失败:', err.message);
    return false;
  }
}

/**
 * 获取并清空离线写入队列（用于网络恢复后重放）
 * @returns {Array}
 */
export function drainOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ===== CloudBase 读写包装器 =====

/**
 * 带离线兜底的数据获取
 *
 * @param {string} namespace - 缓存命名空间
 * @param {Function} fetcher - 获取数据的 async 函数（调 CloudBase）
 * @param {object} [options]
 * @param {number} [options.ttlMs] - 缓存 TTL
 * @param {number} [options.maxAgeMs] - 离线时缓存最大允许年龄（超过返回 null）
 * @param {Function} [options.onCacheHit] - 缓存命中时的回调
 * @returns {Promise<*>}
 */
export async function fetchWithFallback(namespace, fetcher, options = {}) {
  const { ttlMs = DEFAULT_TTL_MS, maxAgeMs, onCacheHit } = options;

  try {
    // 1. 尝试从 CloudBase 获取
    const data = await fetcher();

    // 2. 成功后写入缓存
    if (data !== null && data !== undefined) {
      setCache(namespace, data, undefined, ttlMs);
    }

    return data;
  } catch (err) {
    console.warn(`[offline-cache] CloudBase 获取失败 [${namespace}], 尝试离线缓存:`, err.message);

    // 3. CloudBase 失败 → 读 localStorage 缓存
    const cached = getCache(namespace, undefined, maxAgeMs);

    if (cached !== null && cached !== undefined) {
      if (onCacheHit) onCacheHit(cached);
      return cached;
    }

    // 4. 缓存也没有 → 抛出原始错误
    throw err;
  }
}

export default {
  setCache,
  getCache,
  getCacheMeta,
  clearCache,
  clearAllCache,
  clearAllUsersCache,
  setActiveUser,
  enqueueOfflineWrite,
  drainOfflineQueue,
  fetchWithFallback,
};
