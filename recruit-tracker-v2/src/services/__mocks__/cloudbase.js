/**
 * CloudBase SDK Mock — 测试用假后端
 *
 * 覆盖: db() / auth() / storage() / callFunction() / isReady() / db.command.*
 * 链式调用: .collection().where().orderBy().limit().field().get() / .add()
 *
 * 用法:
 *   // vitest.setup.js 自动挂载，测试中直接 import cloudbase 即可
 *   import cloudbase from './cloudbase';
 *   cloudbase.__setCollectionData('Candidate', [{ _id: 'c1', name: '张三' }]);
 *   const { data } = await cloudbase.db().collection('Candidate').where({...}).get();
 *
 *   // 每个测试前自动调用 __resetAll()
 */

import { vi } from 'vitest';

// ===== 内存数据库 =====
let __collections = {};
let __callFunctionResults = {};
let __authState = { loggedIn: true, uid: 'test-uid-001' };

/** 重置所有 mock 状态（在每个测试前自动调用） */
export function __resetAll() {
  __collections = {};
  __callFunctionResults = {};
  __authState = { loggedIn: true, uid: 'test-uid-001' };
}

/** 设置 mock 集合数据 */
export function __setCollectionData(name, data) {
  __collections[name] = data.map((doc, i) => ({
    _id: doc._id || `mock_${name}_${i}`,
    ...doc,
  }));
}

/** 设置 mock 云函数返回值 */
export function __setCallFunctionResult(name, result) {
  __callFunctionResults[name] = result;
}

/** 获取 mock 集合数据（用于断言） */
export function __getCollectionData(name) {
  return __collections[name] || [];
}

/** 获取集合文档数量 */
export function __getCollectionCount(name) {
  return (__collections[name] || []).length;
}

// ===== Mock Command 构建器 =====
const mockCommand = {
  inc: (n) => ({ __command: 'inc', value: n }),
  neq: (v) => ({ __command: 'neq', value: v }),
  in: (arr) => ({ __command: 'in', value: arr }),
  or: (conditions) => ({ __command: 'or', value: conditions }),
  push: (item) => ({ __command: 'push', value: item }),
  set: (obj) => ({ __command: 'set', value: obj }),
  remove: () => ({ __command: 'remove' }),
};

// ===== Mock 链式查询构建器 =====
class MockQuery {
  constructor(collectionName) {
    this._collection = collectionName;
    this._conditions = {};
    this._orConditions = null;
    this._orderField = null;
    this._orderDir = 'asc';
    this._limitCount = null;
    this._fieldFilter = null;
  }

  where(conditions) {
    // 克隆当前查询以支持独立查询（模拟真实 SDK 行为）
    const cloned = new MockQuery(this._collection);
    cloned._conditions = { ...this._conditions };
    cloned._orConditions = this._orConditions ? [...this._orConditions] : null;
    cloned._orderField = this._orderField;
    cloned._orderDir = this._orderDir;
    cloned._limitCount = this._limitCount;
    cloned._fieldFilter = this._fieldFilter;

    // 处理 db.command.or() — 将其拆分为 _orConditions 存储
    if (conditions && typeof conditions === 'object' && conditions.__command === 'or') {
      cloned._orConditions = conditions.value || [];
    } else {
      Object.assign(cloned._conditions, conditions);
    }
    return cloned;
  }

  orderBy(field, direction) {
    this._orderField = field;
    this._orderDir = direction || 'asc';
    return this;
  }

  limit(n) {
    this._limitCount = n;
    return this;
  }

  field(fields) {
    this._fieldFilter = fields;
    return this;
  }

  async get() {
    let docs = (__collections[this._collection] || []).slice();

    // 应用条件过滤（支持 command 对象）
    for (const [key, value] of Object.entries(this._conditions)) {
      if (value && typeof value === 'object' && value.__command) {
        switch (value.__command) {
          case 'neq':
            docs = docs.filter((d) => d[key] !== value.value);
            break;
          case 'in':
            docs = docs.filter((d) => value.value.includes(d[key]));
            break;
          default:
            break;
        }
      } else if (value !== undefined && value !== null) {
        docs = docs.filter((d) => d[key] === value);
      }
    }

    // 应用 or 条件（任一子条件匹配即保留）
    if (this._orConditions && this._orConditions.length > 0) {
      docs = docs.filter((d) =>
        this._orConditions.some((cond) =>
          Object.entries(cond).every(([k, v]) => d[k] === v)
        )
      );
    }

    // 应用排序
    if (this._orderField) {
      docs.sort((a, b) => {
        const va = a[this._orderField];
        const vb = b[this._orderField];
        if (va === undefined && vb === undefined) return 0;
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        return this._orderDir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
      });
    }

    // 应用 limit
    if (this._limitCount !== null) {
      docs = docs.slice(0, this._limitCount);
    }

    return { data: docs };
  }

  async count() {
    const { data } = await this.get();
    return { total: data.length };
  }

  async add(doc) {
    const newDoc = { _id: `mock_${this._collection}_${Date.now()}`, ...doc };
    if (!__collections[this._collection]) __collections[this._collection] = [];
    __collections[this._collection].push(newDoc);
    return { id: newDoc._id };
  }

  doc(id) {
    return new MockDocument(this._collection, id);
  }
}

// ===== Mock 文档操作 =====
class MockDocument {
  constructor(collectionName, docId) {
    this._collection = collectionName;
    this._docId = docId;
  }

  async get() {
    const docs = __collections[this._collection] || [];
    const doc = docs.find((d) => d._id === this._docId);
    return doc ? { data: [doc] } : { data: [] };
  }

  async update(data) {
    const docs = __collections[this._collection] || [];
    const idx = docs.findIndex((d) => d._id === this._docId);
    if (idx !== -1) {
      // 处理 command 操作
      for (const [key, value] of Object.entries(data)) {
        if (!value || typeof value !== 'object') continue;
        if (value.__command === 'inc') {
          docs[idx][key] = (docs[idx][key] || 0) + (value.value || 1);
          delete data[key];
        } else if (value.__command === 'push') {
          if (!Array.isArray(docs[idx][key])) docs[idx][key] = [];
          docs[idx][key].push(value.value);
          delete data[key];
        } else if (value.__command === 'set') {
          docs[idx][key] = value.value;
          delete data[key];
        } else if (value.__command === 'remove') {
          delete docs[idx][key];
          delete data[key];
        }
      }
      Object.assign(docs[idx], data);
    }
    return { updated: idx !== -1 ? 1 : 0 };
  }

  async remove() {
    const docs = __collections[this._collection] || [];
    const idx = docs.findIndex((d) => d._id === this._docId);
    if (idx !== -1) docs.splice(idx, 1);
    return { deleted: idx !== -1 ? 1 : 0 };
  }
}

// ===== Mock Auth =====
const mockAuth = {
  getLoginState: vi.fn(async () => {
    return __authState.loggedIn ? { user: { uid: __authState.uid } } : null;
  }),
  anonymousAuthProvider: () => ({
    signIn: vi.fn(async () => {
      __authState.loggedIn = true;
    }),
  }),
  signOut: vi.fn(async () => {
    __authState.loggedIn = false;
  }),
};

// ===== Mock Storage =====
const mockStorage = {
  uploadFile: vi.fn(async () => ({ fileID: 'mock-file-id' })),
  downloadFile: vi.fn(async () => ({ fileContent: '' })),
  deleteFile: vi.fn(async () => ({})),
};

// ===== CloudBase Mock 实例 =====
const mockDbInstance = {
  collection(name) {
    return new MockQuery(name);
  },
  command: mockCommand,
};

const cloudbaseMock = {
  // 核心方法
  getApp: vi.fn(() => ({ env: 'mock-env' })),
  db: vi.fn(() => mockDbInstance),
  auth: vi.fn(() => mockAuth),
  storage: vi.fn(() => mockStorage),

  // 云函数调用
  callFunction: vi.fn(async (name, data) => {
    const preset = __callFunctionResults[name];
    if (preset !== undefined) {
      if (typeof preset === 'function') return await preset(data);
      return preset;
    }
    return { success: true };
  }),

  isReady: vi.fn(() => true),

  // 测试辅助方法（挂载在 default export 上）
  __resetAll,
  __setCollectionData,
  __setCallFunctionResult,
  __getCollectionData,
  __getCollectionCount,
  __authState,
  __collections, // 直接暴露内存数据库，用于高级断言
};

export default cloudbaseMock;
