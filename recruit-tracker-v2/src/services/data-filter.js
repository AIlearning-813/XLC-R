/**
 * data-filter.js — 数据隔离过滤器
 *
 * Phase 1 核心模块：实现专员之间的数据隔离。
 *
 * 规则：
 *   - Admin 返回 null（无过滤，看全部数据）
 *   - Recruiter 返回 { ownerId: currentUsername }（只看自己的）
 *   - 未登录返回 { ownerId: '__no_user__' }（看不到任何数据）
 *
 * 使用方式：
 *   import { ownerFilter, applyOwnerFilter } from '../services/data-filter';
 *   const filter = ownerFilter();
 *   const query = db.collection('Application').where(applyOwnerFilter({ candidateId }));
 */

import { useAuthStore } from '../stores/useAuthStore';

/** 返回当前用户的 ownerId 过滤条件 */
export function ownerFilter() {
  const auth = useAuthStore();
  if (auth.isAdmin) return null;
  if (!auth.currentUsername) return { ownerId: '__no_user__' };
  return { ownerId: auth.currentUsername };
}

/** 获取当前用户名（用于日志/显示） */
export function currentOwnerId() {
  const auth = useAuthStore();
  return auth.currentUsername || 'system';
}

/** 判断当前用户是否有权限访问指定 ownerId 的数据 */
export function canAccess(ownerId) {
  const auth = useAuthStore();
  if (auth.isAdmin) return true;
  return ownerId === auth.currentUsername;
}

/** 将 ownerFilter 合并到已有查询条件中 */
export function applyOwnerFilter(baseConditions = {}) {
  const filter = ownerFilter();
  if (filter) {
    return { ...baseConditions, ...filter };
  }
  return baseConditions;
}
