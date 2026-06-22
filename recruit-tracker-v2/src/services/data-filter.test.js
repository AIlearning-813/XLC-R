/**
 * data-filter 单元测试
 *
 * 测试：ownerFilter / currentOwnerId / canAccess / applyOwnerFilter
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Mock useAuthStore
const mockAuth = { isAdmin: false, currentUsername: '' };
vi.mock('../stores/useAuthStore', () => ({
  useAuthStore: () => mockAuth,
}));

import { ownerFilter, currentOwnerId, canAccess, applyOwnerFilter } from './data-filter.js';

describe('ownerFilter', () => {
  beforeEach(() => { mockAuth.isAdmin = false; mockAuth.currentUsername = ''; });

  it('Admin 返回 null（无过滤）', () => {
    mockAuth.isAdmin = true;
    mockAuth.currentUsername = 'admin';
    expect(ownerFilter()).toBeNull();
  });

  it('Recruiter 返回自己的 ownerId 过滤', () => {
    mockAuth.isAdmin = false;
    mockAuth.currentUsername = '王莉';
    expect(ownerFilter()).toEqual({ ownerId: '王莉' });
  });

  it('未登录返回安全兜底', () => {
    mockAuth.isAdmin = false;
    mockAuth.currentUsername = '';
    expect(ownerFilter()).toEqual({ ownerId: '__no_user__' });
  });
});

describe('currentOwnerId', () => {
  it('返回当前用户名', () => {
    mockAuth.currentUsername = '刘滢滢';
    expect(currentOwnerId()).toBe('刘滢滢');
  });

  it('空用户名返回 system', () => {
    mockAuth.currentUsername = '';
    expect(currentOwnerId()).toBe('system');
  });
});

describe('canAccess', () => {
  beforeEach(() => { mockAuth.isAdmin = false; mockAuth.currentUsername = '高艺'; });

  it('Admin 可访问任何数据', () => {
    mockAuth.isAdmin = true;
    expect(canAccess('王莉')).toBe(true);
    expect(canAccess('任何人')).toBe(true);
  });

  it('Recruiter 可访问自己的数据', () => {
    expect(canAccess('高艺')).toBe(true);
  });

  it('Recruiter 不可访问别人的数据', () => {
    expect(canAccess('王莉')).toBe(false);
    expect(canAccess('admin')).toBe(false);
  });

  it('未登录不可访问任何数据', () => {
    mockAuth.currentUsername = '';
    expect(canAccess('高艺')).toBe(false);
  });
});

describe('applyOwnerFilter', () => {
  it('Admin 不修改查询条件', () => {
    mockAuth.isAdmin = true;
    expect(applyOwnerFilter({ jobId: '123' })).toEqual({ jobId: '123' });
  });

  it('Recruiter 附加 ownerId', () => {
    mockAuth.isAdmin = false;
    mockAuth.currentUsername = '杨紫莹';
    expect(applyOwnerFilter({ jobId: '123' })).toEqual({
      jobId: '123',
      ownerId: '杨紫莹',
    });
  });

  it('空条件也能附加 ownerFilter', () => {
    mockAuth.isAdmin = false;
    mockAuth.currentUsername = '麦欣瑜';
    expect(applyOwnerFilter({})).toEqual({ ownerId: '麦欣瑜' });
  });
});
