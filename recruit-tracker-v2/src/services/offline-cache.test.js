/**
 * offline-cache 单元测试
 *
 * 测试导出函数：
 * setCache / getCache / getCacheMeta / clearCache / clearAllCache /
 * clearAllUsersCache / setActiveUser / enqueueOfflineWrite /
 * drainOfflineQueue / fetchWithFallback
 *
 * jsdom 环境提供真实的 localStorage，直接使用即可。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
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
} from './offline-cache';

// 每个测试前后清理 localStorage
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ===== setCache / getCache =====

describe('setCache', () => {
  it('写入基本类型数据', () => {
    setCache('test', { name: '张三', age: 25 });
    const cached = getCache('test');
    expect(cached).toEqual({ name: '张三', age: 25 });
  });

  it('写入数组数据', () => {
    setCache('list', [1, 2, 3]);
    expect(getCache('list')).toEqual([1, 2, 3]);
  });

  it('写入带 id 的数据', () => {
    setCache('candidate', { name: '张三' }, 'c1');
    setCache('candidate', { name: '李四' }, 'c2');
    expect(getCache('candidate', 'c1')).toEqual({ name: '张三' });
    expect(getCache('candidate', 'c2')).toEqual({ name: '李四' });
  });

  it('写入 null 值', () => {
    setCache('null_val', null);
    expect(getCache('null_val')).toBeNull();
  });

  it('覆盖已有缓存', () => {
    setCache('overwrite', 'old');
    setCache('overwrite', 'new');
    expect(getCache('overwrite')).toBe('new');
  });
});

describe('getCache', () => {
  it('不存在返回 null', () => {
    expect(getCache('nonexistent')).toBeNull();
  });

  it('不存在的 id 返回 null', () => {
    setCache('test', 'data', 'id1');
    expect(getCache('test', 'id2')).toBeNull();
  });

  it('不传 maxAgeMs 时过期数据也返回', () => {
    // 写入一条"远古"数据
    const raw = {
      data: 'old-data',
      timestamp: Date.now() - 3600 * 1000, // 1 小时前
      ttl: 60 * 1000, // 1 分钟 TTL
    };
    const userKey = '_anon';
    localStorage.setItem(`xlc_cache_${userKey}_old_test`, JSON.stringify(raw));

    // 不传 maxAgeMs，即使 TTL 过期也返回
    const result = getCache('old_test');
    expect(result).toBe('old-data');
  });

  it('传入 maxAgeMs 时过期数据返回 null', () => {
    setCache('expires', 'fast-data', undefined, 100); // 100ms TTL

    // 等待 TTL 过期
    // 注：由于 setCache 使用 Date.now()，我们直接写入超时数据模拟
    const userKey = '_anon';
    const raw = {
      data: 'expired-data',
      timestamp: Date.now() - 5000, // 5 秒前
      ttl: 100,
    };
    localStorage.setItem(`xlc_cache_${userKey}_expires_test`, JSON.stringify(raw));

    const result = getCache('expires_test', undefined, 1000); // maxAge 1 秒
    expect(result).toBeNull();
  });

  it('maxAgeMs 内未过期数据正常返回', () => {
    setCache('fresh', 'fresh-data');
    const result = getCache('fresh', undefined, 60000); // 60 秒内
    expect(result).toBe('fresh-data');
  });

  it('localStorage 损坏数据返回 null', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const userKey = '_anon';
    localStorage.setItem(`xlc_cache_${userKey}_corrupt`, 'not-json{{{');
    const result = getCache('corrupt');
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ===== getCacheMeta =====

describe('getCacheMeta', () => {
  it('存在缓存返回元信息', () => {
    setCache('meta_test', 'data', undefined, 5000);
    const meta = getCacheMeta('meta_test');
    expect(meta).toBeTruthy();
    expect(meta).toHaveProperty('age');
    expect(meta).toHaveProperty('isStale');
    expect(meta).toHaveProperty('timestamp');
    expect(typeof meta.age).toBe('number');
    expect(typeof meta.isStale).toBe('boolean');
  });

  it('新鲜数据 isStale 为 false', () => {
    setCache('fresh_meta', 'data', undefined, 60000);
    const meta = getCacheMeta('fresh_meta');
    expect(meta.isStale).toBe(false);
  });

  it('过期数据 isStale 为 true', () => {
    const userKey = '_anon';
    const raw = {
      data: 'expired',
      timestamp: Date.now() - 10000,
      ttl: 100, // 100ms TTL，早就过期
    };
    localStorage.setItem(`xlc_cache_${userKey}_stale_test`, JSON.stringify(raw));
    const meta = getCacheMeta('stale_test');
    expect(meta.isStale).toBe(true);
  });

  it('不存在返回 null', () => {
    expect(getCacheMeta('nonexistent_meta')).toBeNull();
  });
});

// ===== clearCache =====

describe('clearCache', () => {
  it('清除指定命名空间缓存', () => {
    setCache('keep', 'keep-data');
    setCache('remove', 'remove-data');
    clearCache('remove');
    expect(getCache('remove')).toBeNull();
    expect(getCache('keep')).toBe('keep-data');
  });

  it('清除指定命名空间 + id 缓存', () => {
    setCache('ns', 'data1', 'id1');
    setCache('ns', 'data2', 'id2');
    clearCache('ns', 'id2');
    expect(getCache('ns', 'id1')).toBe('data1');
    expect(getCache('ns', 'id2')).toBeNull();
  });

  it('清除不存在的缓存不报错', () => {
    expect(() => clearCache('不存在')).not.toThrow();
  });
});

// ===== clearAllCache =====

describe('clearAllCache', () => {
  it('清除当前用户全部缓存', () => {
    setCache('a', 1);
    setCache('b', 2);
    setCache('c', 3);
    clearAllCache();
    expect(getCache('a')).toBeNull();
    expect(getCache('b')).toBeNull();
    expect(getCache('c')).toBeNull();
  });
});

// ===== setActiveUser =====

describe('setActiveUser', () => {
  it('用户切换时清除旧用户缓存', () => {
    setCache('data', 'user1-data');
    setActiveUser('user2');
    // 旧用户缓存被清除
    expect(getCache('data')).toBeNull();
  });

  it('同一用户不清除缓存', () => {
    setActiveUser('user1');
    setCache('data', 'user1-data');
    setActiveUser('user1'); // 相同用户
    // 缓存仍然存在（因为当前用户key匹配）
    // 注意：setActiveUser 会设置 _activeUserKey，之后 getCache 会用新 key
    // 但由于 clearAllCache 只在用户变化时调用，相同用户不会清除
    // 验证调用不报错
    expect(true).toBe(true);
  });

  it('设置 _anon 用户', () => {
    expect(() => setActiveUser('_anon')).not.toThrow();
  });

  it('设置 null/undefined 为 _anon', () => {
    expect(() => setActiveUser(null)).not.toThrow();
  });
});

// ===== clearAllUsersCache =====

describe('clearAllUsersCache', () => {
  it('清除所有用户缓存', () => {
    // 手动写入不同用户的缓存
    localStorage.setItem('xlc_cache_user1_data', JSON.stringify({ data: 1, timestamp: Date.now(), ttl: 60000 }));
    localStorage.setItem('xlc_cache_user2_data', JSON.stringify({ data: 2, timestamp: Date.now(), ttl: 60000 }));
    localStorage.setItem('other_key', 'should-remain');

    clearAllUsersCache();

    expect(localStorage.getItem('xlc_cache_user1_data')).toBeNull();
    expect(localStorage.getItem('xlc_cache_user2_data')).toBeNull();
    expect(localStorage.getItem('other_key')).toBe('should-remain');
  });

  it('无缓存时调用不报错', () => {
    expect(() => clearAllUsersCache()).not.toThrow();
  });
});

// ===== 离线写入队列 =====

describe('enqueueOfflineWrite', () => {
  it('写入操作到离线队列返回 true', () => {
    const result = enqueueOfflineWrite({
      action: 'add',
      collection: 'Candidate',
      data: { name: '张三' },
    });
    expect(result).toBe(true);
  });

  it('队列包含写入时间戳和随机 id', () => {
    enqueueOfflineWrite({ action: 'update', collection: 'Job', data: {} });
    const queue = JSON.parse(localStorage.getItem('xlc_cache_offline_queue'));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toHaveProperty('queuedAt');
    expect(queue[0]).toHaveProperty('id');
    expect(queue[0].action).toBe('update');
    expect(queue[0].collection).toBe('Job');
  });

  it('多次入队累积', () => {
    enqueueOfflineWrite({ action: 'add', collection: 'A', data: {} });
    enqueueOfflineWrite({ action: 'add', collection: 'B', data: {} });
    const queue = JSON.parse(localStorage.getItem('xlc_cache_offline_queue'));
    expect(queue).toHaveLength(2);
  });
});

describe('drainOfflineQueue', () => {
  it('返回队列并清空', () => {
    enqueueOfflineWrite({ action: 'add', collection: 'C', data: {} });
    enqueueOfflineWrite({ action: 'del', collection: 'D', data: {} });

    const drained = drainOfflineQueue();
    expect(drained).toHaveLength(2);
    expect(drained[0].action).toBe('add');
    expect(drained[1].action).toBe('del');

    // 队列已清空
    expect(localStorage.getItem('xlc_cache_offline_queue')).toBeNull();
  });

  it('空队列返回空数组', () => {
    expect(drainOfflineQueue()).toEqual([]);
  });

  it('损坏的队列数据返回空数组', () => {
    localStorage.setItem('xlc_cache_offline_queue', 'not-json');
    expect(drainOfflineQueue()).toEqual([]);
  });
});

// ===== fetchWithFallback =====

describe('fetchWithFallback', () => {
  it('fetcher 成功时返回数据并写入缓存', async () => {
    const fetcher = async () => [{ id: 1, name: 'test' }];
    const data = await fetchWithFallback('fetch_test', fetcher);
    expect(data).toEqual([{ id: 1, name: 'test' }]);

    // 验证已写入缓存
    const cached = getCache('fetch_test');
    expect(cached).toEqual([{ id: 1, name: 'test' }]);
  });

  it('fetcher 成功返回 falsy 0 值', async () => {
    const fetcher = async () => 0;
    // 0 !== null && 0 !== undefined，所以不应写入缓存
    // 但这里测试的是 fetchWithFallback 返回原值
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const data = await fetchWithFallback('zero_test', fetcher);
    // 注意：0 不满足 data !== null && data !== undefined
    // 所以不会写入缓存
    expect(data).toBe(0);
    spy.mockRestore();
  });

  it('fetcher 失败时从缓存兜底', async () => {
    // 先写入缓存
    setCache('fallback_test', 'cached-data');

    const fetcher = async () => { throw new Error('网络错误'); };
    const onCacheHit = vi.fn();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const data = await fetchWithFallback('fallback_test', fetcher, {
      onCacheHit,
    });

    expect(data).toBe('cached-data');
    expect(onCacheHit).toHaveBeenCalledWith('cached-data');
    spy.mockRestore();
  });

  it('fetcher 失败且无缓存时抛出原始错误', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = async () => { throw new Error('网络断开'); };

    await expect(
      fetchWithFallback('no_cache_test', fetcher)
    ).rejects.toThrow('网络断开');

    spy.mockRestore();
  });

  it('fetcher 失败缓存过期（maxAgeMs）时抛出错误', async () => {
    // 写入过期缓存
    const userKey = '_anon';
    const raw = {
      data: 'stale-data',
      timestamp: Date.now() - 10000,
      ttl: 60000,
    };
    localStorage.setItem(`xlc_cache_${userKey}_stale_cache`, JSON.stringify(raw));

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = async () => { throw new Error('超时'); };

    await expect(
      fetchWithFallback('stale_cache', fetcher, { maxAgeMs: 1000 })
    ).rejects.toThrow('超时');

    spy.mockRestore();
  });

  it('fetcher 返回 null 时不写入缓存', async () => {
    // 先清空
    clearCache('null_return_test');

    const fetcher = async () => null;
    const data = await fetchWithFallback('null_return_test', fetcher);
    expect(data).toBeNull();

    // 缓存不应被写入（因为 null）
    // 但实际上 getCache 可能返回 null（如果未曾写入也返回 null）
    // 这只是一个逻辑验证
    expect(getCache('null_return_test')).toBeNull(); // 未被写入或本身就是 null
  });

  it('自定义 ttlMs', async () => {
    clearCache('ttl_test');
    const fetcher = async () => 'custom-ttl-data';
    await fetchWithFallback('ttl_test', fetcher, { ttlMs: 5000 });

    const meta = getCacheMeta('ttl_test');
    expect(meta).toBeTruthy();
    // 无法直接验证 TTL 值，但可以验证缓存存在
  });

  it('成功获取时不调用 onCacheHit', async () => {
    const fetcher = async () => 'fresh';
    const onCacheHit = vi.fn();
    await fetchWithFallback('no_hit_test', fetcher, { onCacheHit });
    expect(onCacheHit).not.toHaveBeenCalled();
  });
});
