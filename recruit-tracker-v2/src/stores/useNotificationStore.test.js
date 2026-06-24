/**
 * useNotificationStore.test.js — 通知 Store 测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - 初始状态 + 计算属性
 *   - fetchNotifications（获取通知列表）
 *   - markAsRead（单条已读）
 *   - markAllAsRead（全部已读）
 *   - loading 状态转换
 *   - 错误处理 + 边界情况
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ===== Mock CloudBase SDK（自动使用 services/__mocks__/cloudbase.js）=====
vi.mock('../services/cloudbase');
import cloudbase from '../services/cloudbase';

import { useNotificationStore } from './useNotificationStore';

let store;

beforeEach(() => {
  setActivePinia(createPinia());
  cloudbase.__resetAll();
  store = useNotificationStore();
});

// ===== 测试辅助 =====

/** 在 ParseNotification 集合中 seeding 通知数据 */
function seedNotifications(notifications) {
  cloudbase.__setCollectionData('ParseNotification', notifications);
}

/** 创建一条标准通知对象 */
function makeNotif(overrides = {}) {
  return {
    _id: 'notif_001',
    userId: 'user1',
    type: 'new_candidate',
    title: '新候选人张三投递了课程顾问',
    status: 'unread',
    createdAt: new Date('2025-06-01'),
    ...overrides,
  };
}

// ==========================================
// 测试套件
// ==========================================

describe('useNotificationStore', () => {
  // ==========================================
  // 初始状态
  // ==========================================
  describe('初始状态', () => {
    it('notifications 初始为空数组', () => {
      expect(store.notifications).toEqual([]);
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('error 初始为空字符串', () => {
      expect(store.error).toBe('');
    });
  });

  // ==========================================
  // 计算属性
  // ==========================================
  describe('计算属性', () => {
    describe('unreadCount', () => {
      it('全部为 unread 时返回总数', () => {
        store.notifications = [
          makeNotif({ _id: 'n1', status: 'unread' }),
          makeNotif({ _id: 'n2', status: 'unread' }),
          makeNotif({ _id: 'n3', status: 'unread' }),
        ];
        expect(store.unreadCount).toBe(3);
      });

      it('全部为 read 时返回 0', () => {
        store.notifications = [
          makeNotif({ _id: 'n1', status: 'read' }),
          makeNotif({ _id: 'n2', status: 'read' }),
        ];
        expect(store.unreadCount).toBe(0);
      });

      it('混合状态时只统计 unread', () => {
        store.notifications = [
          makeNotif({ _id: 'n1', status: 'unread' }),
          makeNotif({ _id: 'n2', status: 'read' }),
          makeNotif({ _id: 'n3', status: 'unread' }),
          makeNotif({ _id: 'n4', status: 'read' }),
        ];
        expect(store.unreadCount).toBe(2);
      });

      it('空数组返回 0', () => {
        store.notifications = [];
        expect(store.unreadCount).toBe(0);
      });

      it('包含非标准状态的文档不被计入', () => {
        store.notifications = [
          makeNotif({ _id: 'n1', status: 'unread' }),
          makeNotif({ _id: 'n2', status: 'archived' }),
        ];
        expect(store.unreadCount).toBe(1);
      });
    });

    describe('recentNotifications', () => {
      it('返回前 5 条通知', () => {
        store.notifications = Array.from({ length: 10 }, (_, i) =>
          makeNotif({ _id: `n${i + 1}`, title: `通知${i + 1}` })
        );
        const recent = store.recentNotifications;
        expect(recent).toHaveLength(5);
        expect(recent[0].title).toBe('通知1');
        expect(recent[4].title).toBe('通知5');
      });

      it('少于 5 条时返回全部', () => {
        store.notifications = [
          makeNotif({ _id: 'n1' }),
          makeNotif({ _id: 'n2' }),
          makeNotif({ _id: 'n3' }),
        ];
        expect(store.recentNotifications).toHaveLength(3);
      });

      it('空数组返回空数组', () => {
        store.notifications = [];
        expect(store.recentNotifications).toEqual([]);
      });
    });

    describe('hasUnread', () => {
      it('有 unread 通知时返回 true', () => {
        store.notifications = [
          makeNotif({ _id: 'n1', status: 'unread' }),
        ];
        expect(store.hasUnread).toBe(true);
      });

      it('全部已读时返回 false', () => {
        store.notifications = [
          makeNotif({ _id: 'n1', status: 'read' }),
          makeNotif({ _id: 'n2', status: 'read' }),
        ];
        expect(store.hasUnread).toBe(false);
      });

      it('数组为空时返回 false', () => {
        store.notifications = [];
        expect(store.hasUnread).toBe(false);
      });
    });
  });

  // ==========================================
  // fetchNotifications — 获取通知列表
  // ==========================================
  describe('fetchNotifications', () => {
    it('成功拉取通知并存储到 notifications', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1', title: '通知1', createdAt: new Date('2025-06-03') }),
        makeNotif({ _id: 'n2', userId: 'user1', title: '通知2', createdAt: new Date('2025-06-02') }),
        makeNotif({ _id: 'n3', userId: 'user1', title: '通知3', createdAt: new Date('2025-06-01') }),
      ]);

      await store.fetchNotifications('user1');

      expect(store.notifications).toHaveLength(3);
      expect(store.notifications[0].title).toBe('通知1');
      expect(store.notifications[1].title).toBe('通知2');
      expect(store.notifications[2].title).toBe('通知3');
      expect(store.loading).toBe(false);
      expect(store.error).toBe('');
    });

    it('只返回匹配 userId 的通知', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1', title: '用户1的通知' }),
        makeNotif({ _id: 'n2', userId: 'user2', title: '用户2的通知' }),
        makeNotif({ _id: 'n3', userId: 'user1', title: '用户1的通知2' }),
      ]);

      await store.fetchNotifications('user1');

      expect(store.notifications).toHaveLength(2);
      store.notifications.forEach((n) => {
        expect(n.userId).toBe('user1');
      });
    });

    it('按 createdAt 降序排列', async () => {
      seedNotifications([
        makeNotif({ _id: 'n_old', userId: 'user1', createdAt: new Date('2025-01-01') }),
        makeNotif({ _id: 'n_new', userId: 'user1', createdAt: new Date('2025-12-31') }),
        makeNotif({ _id: 'n_mid', userId: 'user1', createdAt: new Date('2025-06-15') }),
      ]);

      await store.fetchNotifications('user1');

      const dates = store.notifications.map((n) => n.createdAt);
      expect(dates[0]).toEqual(new Date('2025-12-31'));
      expect(dates[1]).toEqual(new Date('2025-06-15'));
      expect(dates[2]).toEqual(new Date('2025-01-01'));
    });

    it('最多返回 30 条（limit 30）', async () => {
      const manyNotifs = Array.from({ length: 50 }, (_, i) =>
        makeNotif({ _id: `n${i + 1}`, userId: 'user1', createdAt: new Date(`2025-01-${String(i + 1).padStart(2, '0')}`) })
      );
      seedNotifications(manyNotifs);

      await store.fetchNotifications('user1');

      expect(store.notifications.length).toBeLessThanOrEqual(30);
    });

    it('空 userId 时直接返回，不做任何操作', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1' }),
      ]);

      // 预先设置一些本地状态
      store.notifications = [makeNotif({ _id: 'old', status: 'unread' })];

      await store.fetchNotifications('');

      // notifications 保持不变
      expect(store.notifications).toHaveLength(1);
      expect(store.notifications[0]._id).toBe('old');
      expect(store.loading).toBe(false);
      expect(store.error).toBe('');
    });

    it('空 userId (null/undefined) 时直接返回', async () => {
      await store.fetchNotifications(null);
      expect(store.notifications).toEqual([]);
      expect(store.loading).toBe(false);

      await store.fetchNotifications(undefined);
      expect(store.notifications).toEqual([]);
      expect(store.loading).toBe(false);
    });

    it('无匹配通知时 notifications 变为空数组', async () => {
      // 先设置一些本地数据，模拟旧数据
      store.notifications = [makeNotif({ _id: 'old', userId: 'otherUser' })];

      await store.fetchNotifications('user_none');

      // 拉取结果覆盖本地数据
      expect(store.notifications).toEqual([]);
      expect(store.error).toBe('');
    });

    it('拉取失败时设置 error 并保持 loading 为 false', async () => {
      // 使用 mockImplementationOnce 修改原始 vi.fn（store 已捕获该引用）
      cloudbase.db.mockImplementationOnce(() => {
        throw new Error('数据库连接失败');
      });

      await store.fetchNotifications('user1');

      expect(store.error).toBe('数据库连接失败');
      expect(store.loading).toBe(false);
      expect(store.notifications).toEqual([]);
    });

    it('无 message 的错误对象使用默认错误消息', async () => {
      cloudbase.db.mockImplementationOnce(() => {
        throw '未知错误';
      });

      await store.fetchNotifications('user1');

      expect(store.error).toBe('获取通知失败');
    });
  });

  // ==========================================
  // markAsRead — 单条标记已读
  // ==========================================
  describe('markAsRead', () => {
    it('更新 DB 并更新本地状态', async () => {
      seedNotifications([
        makeNotif({ _id: 'notif_read', userId: 'user1', status: 'unread' }),
      ]);
      store.notifications = [
        makeNotif({ _id: 'notif_read', status: 'unread' }),
      ];

      await store.markAsRead('notif_read');

      // 本地状态已更新
      expect(store.notifications[0].status).toBe('read');

      // Mock DB 已更新
      const dbData = cloudbase.__getCollectionData('ParseNotification');
      const updated = dbData.find((d) => d._id === 'notif_read');
      expect(updated.status).toBe('read');
    });

    it('通知不在本地缓存时仍然调用 DB 更新', async () => {
      seedNotifications([
        makeNotif({ _id: 'notif_remote', userId: 'user1', status: 'unread' }),
      ]);
      // 本地没有这条通知
      store.notifications = [
        makeNotif({ _id: 'other_notif', status: 'unread' }),
      ];

      await store.markAsRead('notif_remote');

      // DB 中已更新
      const dbData = cloudbase.__getCollectionData('ParseNotification');
      const updated = dbData.find((d) => d._id === 'notif_remote');
      expect(updated.status).toBe('read');

      // 本地不存在的通知不受影响
      expect(store.notifications).toHaveLength(1);
      expect(store.notifications[0].status).toBe('unread');
    });

    it('本地有多条时只更新匹配的那一条', async () => {
      store.notifications = [
        makeNotif({ _id: 'n1', status: 'unread' }),
        makeNotif({ _id: 'n2', status: 'unread' }),
        makeNotif({ _id: 'n3', status: 'unread' }),
      ];

      await store.markAsRead('n2');

      expect(store.notifications[0].status).toBe('unread');
      expect(store.notifications[1].status).toBe('read');
      expect(store.notifications[2].status).toBe('unread');
    });

    it('DB 更新失败时静默处理（仅 console.error）', async () => {
      // markAsRead 只调用 db() 一次，使用 mockImplementationOnce 自动恢复
      cloudbase.db.mockImplementationOnce(() => ({
        collection(name) {
          return {
            doc(id) {
              return {
                async update(data) {
                  throw new Error('数据库更新失败');
                },
              };
            },
          };
        },
      }));

      store.notifications = [
        makeNotif({ _id: 'n1', status: 'unread' }),
      ];

      // 不应抛出错误，静默处理
      await expect(store.markAsRead('n1')).resolves.toBeUndefined();

      // 本地状态未更新（源码是先 await db().update()，再更新本地）
      // DB 失败时抛异常，本地不会被更新
      expect(store.notifications[0].status).toBe('unread');
    });
  });

  // ==========================================
  // markAllAsRead — 全部标记已读
  // ==========================================
  describe('markAllAsRead', () => {
    it('将所有 unread 通知标记为 read', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1', status: 'unread' }),
        makeNotif({ _id: 'n2', userId: 'user1', status: 'unread' }),
        makeNotif({ _id: 'n3', userId: 'user1', status: 'unread' }),
      ]);
      store.notifications = [
        makeNotif({ _id: 'n1', status: 'unread' }),
        makeNotif({ _id: 'n2', status: 'unread' }),
        makeNotif({ _id: 'n3', status: 'unread' }),
      ];

      await store.markAllAsRead('user1');

      // 本地所有通知变为 read
      store.notifications.forEach((n) => {
        expect(n.status).toBe('read');
      });

      // DB 中所有通知变为 read
      const dbData = cloudbase.__getCollectionData('ParseNotification');
      dbData.forEach((d) => {
        expect(d.status).toBe('read');
      });
    });

    it('混合状态时只更新 unread 的（DB 调用），但本地全部设为 read', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1', status: 'unread' }),
        makeNotif({ _id: 'n2', userId: 'user1', status: 'read' }),
        makeNotif({ _id: 'n3', userId: 'user1', status: 'unread' }),
      ]);
      store.notifications = [
        makeNotif({ _id: 'n1', status: 'unread' }),
        makeNotif({ _id: 'n2', status: 'read' }),
        makeNotif({ _id: 'n3', status: 'unread' }),
      ];

      await store.markAllAsRead('user1');

      // 本地所有通知变为 read
      store.notifications.forEach((n) => {
        expect(n.status).toBe('read');
      });

      // DB 中未读的变为 read，已读的保持 read
      const dbData = cloudbase.__getCollectionData('ParseNotification');
      expect(dbData.find((d) => d._id === 'n1').status).toBe('read');
      expect(dbData.find((d) => d._id === 'n2').status).toBe('read');
      expect(dbData.find((d) => d._id === 'n3').status).toBe('read');
    });

    it('没有 unread 通知时不调用 DB 更新（空循环）', async () => {
      store.notifications = [
        makeNotif({ _id: 'n1', status: 'read' }),
        makeNotif({ _id: 'n2', status: 'read' }),
      ];

      await store.markAllAsRead('user1');

      // 全部保持 read
      store.notifications.forEach((n) => {
        expect(n.status).toBe('read');
      });
    });

    it('通知列表为空时不报错', async () => {
      store.notifications = [];

      await expect(store.markAllAsRead('user1')).resolves.toBeUndefined();
    });

    it('单条 unread 也能正确处理', async () => {
      store.notifications = [
        makeNotif({ _id: 'n1', status: 'read' }),
        makeNotif({ _id: 'n2', status: 'unread' }),
      ];

      await store.markAllAsRead('user1');

      expect(store.notifications[0].status).toBe('read');
      expect(store.notifications[1].status).toBe('read');
    });

    it('DB 更新中发生异常时被 catch 捕获，不会向上抛出', async () => {
      // 验证 markAllAsRead 对异常的静默处理：即使底层出错也不抛给调用方
      // 这里通过 mockImplementationOnce 让第一次 db() 调用抛出异常来模拟
      cloudbase.db.mockImplementationOnce(() => {
        throw new Error('模拟数据库错误');
      });

      store.notifications = [
        makeNotif({ _id: 'n1', status: 'unread' }),
      ];

      // 不应抛出错误
      await expect(store.markAllAsRead('user1')).resolves.toBeUndefined();

      // 异常被 catch 后本地状态保持不变
      expect(store.notifications[0].status).toBe('unread');
    });
  });

  // ==========================================
  // Loading 状态转换
  // ==========================================
  describe('loading 状态转换', () => {
    it('fetchNotifications 成功后 loading 回到 false', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1' }),
      ]);

      expect(store.loading).toBe(false);
      await store.fetchNotifications('user1');
      expect(store.loading).toBe(false);
    });

    it('fetchNotifications 失败后 loading 回到 false', async () => {
      // 使用 mockImplementationOnce，不替换 vi.fn 引用
      cloudbase.db.mockImplementationOnce(() => {
        throw new Error('网络错误');
      });

      await store.fetchNotifications('user1');
      expect(store.loading).toBe(false);
      expect(store.error).toBe('网络错误');
    });

    it('fetchNotifications 空 userId 不触发 loading', async () => {
      expect(store.loading).toBe(false);
      await store.fetchNotifications('');
      expect(store.loading).toBe(false);
    });

    it('fetchNotifications 先设 loading=true 再调用 db，完成后恢复 false', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1', createdAt: new Date('2025-06-01') }),
      ]);

      // 验证调用前后的 loading 状态
      expect(store.loading).toBe(false);

      // 通过 mockImplementationOnce 在 db() 调用时捕获 loading 中间状态
      let loadingWhenDbCalled;
      cloudbase.db.mockImplementationOnce(() => {
        loadingWhenDbCalled = store.loading;
        // 返回原始 mockDbInstance（通过 __getCollectionData 和链式查询模拟）
        const docs = cloudbase.__getCollectionData('ParseNotification');
        return {
          collection(name) {
            const conditions = {};
            let orderField = null;
            let orderDir = 'asc';
            let limitCount = null;
            return {
              where(c) { Object.assign(conditions, c); return this; },
              orderBy(f, d) { orderField = f; orderDir = d || 'asc'; return this; },
              limit(n) { limitCount = n; return this; },
              async get() {
                let result = docs.slice();
                for (const [k, v] of Object.entries(conditions)) {
                  if (v !== undefined && v !== null) {
                    result = result.filter((d) => d[k] === v);
                  }
                }
                if (orderField) {
                  result.sort((a, b) => {
                    const va = a[orderField], vb = b[orderField];
                    return orderDir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
                  });
                }
                if (limitCount !== null) result = result.slice(0, limitCount);
                return { data: result };
              },
            };
          },
        };
      });

      await store.fetchNotifications('user1');

      // db() 调用时 loading 应为 true
      expect(loadingWhenDbCalled).toBe(true);
      // 执行完毕后 loading 回到 false
      expect(store.loading).toBe(false);
      // 数据正常加载
      expect(store.notifications).toHaveLength(1);
    });
  });

  // ==========================================
  // 边界和特殊情况
  // ==========================================
  describe('边界情况', () => {
    it('markAsRead 传入空 ID 也能调用 DB（由 DB 层处理）', async () => {
      seedNotifications([
        makeNotif({ _id: 'real_id', userId: 'user1', status: 'unread' }),
      ]);

      await expect(store.markAsRead('')).resolves.toBeUndefined();
    });

    it('连续两次 fetchNotifications 覆盖之前的数据', async () => {
      seedNotifications([
        makeNotif({ _id: 'n_a', userId: 'user1', title: '第一组' }),
      ]);
      await store.fetchNotifications('user1');
      expect(store.notifications).toHaveLength(1);
      expect(store.notifications[0].title).toBe('第一组');

      // 更换 seed 数据模拟新数据
      cloudbase.__resetAll();
      seedNotifications([
        makeNotif({ _id: 'n_b', userId: 'user1', title: '第二组A' }),
        makeNotif({ _id: 'n_c', userId: 'user1', title: '第二组B' }),
      ]);
      await store.fetchNotifications('user1');
      expect(store.notifications).toHaveLength(2);
      expect(store.notifications.map((n) => n.title)).toContain('第二组A');
      expect(store.notifications.map((n) => n.title)).toContain('第二组B');
    });

    it('fetchNotifications 后 computed 属性正确更新', async () => {
      seedNotifications([
        makeNotif({ _id: 'n1', userId: 'user1', status: 'unread' }),
        makeNotif({ _id: 'n2', userId: 'user1', status: 'read' }),
        makeNotif({ _id: 'n3', userId: 'user1', status: 'unread' }),
      ]);

      await store.fetchNotifications('user1');

      expect(store.unreadCount).toBe(2);
      expect(store.recentNotifications).toHaveLength(3);
      expect(store.hasUnread).toBe(true);
    });

    it('markAsRead 后 computed 属性正确更新', async () => {
      store.notifications = [
        makeNotif({ _id: 'n1', status: 'unread' }),
        makeNotif({ _id: 'n2', status: 'unread' }),
      ];

      expect(store.unreadCount).toBe(2);
      expect(store.hasUnread).toBe(true);

      await store.markAsRead('n1');

      expect(store.unreadCount).toBe(1);
      expect(store.hasUnread).toBe(true);

      await store.markAsRead('n2');

      expect(store.unreadCount).toBe(0);
      expect(store.hasUnread).toBe(false);
    });

    it('markAllAsRead 后 computed 属性正确更新', async () => {
      store.notifications = [
        makeNotif({ _id: 'n1', status: 'unread' }),
        makeNotif({ _id: 'n2', status: 'unread' }),
        makeNotif({ _id: 'n3', status: 'read' }),
      ];

      expect(store.unreadCount).toBe(2);
      expect(store.hasUnread).toBe(true);

      await store.markAllAsRead('user1');

      expect(store.unreadCount).toBe(0);
      expect(store.hasUnread).toBe(false);
    });
  });
});
