/**
 * CloudBase 浏览器端 Mock — E2E 测试专用
 *
 * 与 vitest mock (src/services/__mocks__/cloudbase.js) 共享核心逻辑，
 * 但不依赖 vitest，可直接在浏览器中运行。
 *
 * 通过 window.__mockDB__ 暴露测试控制接口给 Playwright。
 *
 * 用法（Playwright 测试中）:
 *   await page.evaluate(() => {
 *     window.__mockDB__.setCollectionData('Candidate', [...]);
 *   });
 */

// ===== 内存数据库（挂载到 window 供 Playwright 访问） =====
const MOCK_DB = {
  collections: {},
  callFunctionResults: {},
  authState: { loggedIn: true, uid: 'e2e-test-uid' },
};

// 暴露给 Playwright
if (typeof window !== 'undefined') {
  // 🔥 支持 addInitScript 预加载：在页面脚本执行前设置种子数据
  if (window.__preload__) {
    const preload = window.__preload__;
    if (preload.collections) {
      Object.assign(MOCK_DB.collections, preload.collections);
    }
    if (preload.callFunctionResults) {
      Object.assign(MOCK_DB.callFunctionResults, preload.callFunctionResults);
    }
    if (preload.authState) {
      Object.assign(MOCK_DB.authState, preload.authState);
    }
    delete window.__preload__; // 用后即删
  }

  window.__mockDB__ = {
    /** 重置所有数据 */
    resetAll() {
      MOCK_DB.collections = {};
      MOCK_DB.callFunctionResults = {};
      MOCK_DB.authState = { loggedIn: true, uid: 'e2e-test-uid' };
    },

    /** 设置集合数据 */
    setCollectionData(name, data) {
      MOCK_DB.collections[name] = data.map((doc, i) => ({
        _id: doc._id || `mock_${name}_${i}`,
        ...doc,
      }));
    },

    /** 追加文档到集合 */
    addToCollection(name, doc) {
      if (!MOCK_DB.collections[name]) MOCK_DB.collections[name] = [];
      MOCK_DB.collections[name].push({
        _id: doc._id || `mock_${name}_${Date.now()}`,
        ...doc,
      });
    },

    /** 设置云函数返回值 */
    setCallFunctionResult(name, result) {
      MOCK_DB.callFunctionResults[name] = result;
    },

    /** 获取集合数据（用于断言） */
    getCollectionData(name) {
      return MOCK_DB.collections[name] || [];
    },

    /** 获取集合文档数 */
    getCollectionCount(name) {
      return (MOCK_DB.collections[name] || []).length;
    },

    /** 获取完整 DB 快照（调试用） */
    getSnapshot() {
      return JSON.parse(JSON.stringify(MOCK_DB));
    },

    /** 设置登录状态 */
    setAuthState(state) {
      MOCK_DB.authState = { ...MOCK_DB.authState, ...state };
    },
  };
}

// ===== Mock Command 构建器 =====
const mockCommand = {
  inc: (n) => ({ __command: 'inc', value: n }),
  neq: (v) => ({ __command: 'neq', value: v }),
  in: (arr) => ({ __command: 'in', value: arr }),
  push: (item) => ({ __command: 'push', value: item }),
  set: (obj) => ({ __command: 'set', value: obj }),
  remove: () => ({ __command: 'remove' }),
};

// ===== Mock 链式查询构建器 =====
class MockQuery {
  constructor(collectionName) {
    this._collection = collectionName;
    this._conditions = {};
    this._orderField = null;
    this._orderDir = 'asc';
    this._limitCount = null;
    this._fieldFilter = null;
  }

  where(conditions) {
    Object.assign(this._conditions, conditions);
    return this;
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
    let docs = (MOCK_DB.collections[this._collection] || []).slice();

    // 应用条件过滤
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
    if (!MOCK_DB.collections[this._collection]) MOCK_DB.collections[this._collection] = [];
    MOCK_DB.collections[this._collection].push(newDoc);
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
    const docs = MOCK_DB.collections[this._collection] || [];
    const doc = docs.find((d) => d._id === this._docId);
    return doc ? { data: [doc] } : { data: [] };
  }

  async update(data) {
    const docs = MOCK_DB.collections[this._collection] || [];
    const idx = docs.findIndex((d) => d._id === this._docId);
    if (idx !== -1) {
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
    const docs = MOCK_DB.collections[this._collection] || [];
    const idx = docs.findIndex((d) => d._id === this._docId);
    if (idx !== -1) docs.splice(idx, 1);
    return { deleted: idx !== -1 ? 1 : 0 };
  }
}

// ===== Mock Auth =====
const mockAuth = {
  getLoginState: async () => {
    return MOCK_DB.authState.loggedIn
      ? { user: { uid: MOCK_DB.authState.uid } }
      : null;
  },
  anonymousAuthProvider: () => ({
    signIn: async () => {
      MOCK_DB.authState.loggedIn = true;
    },
  }),
  signOut: async () => {
    MOCK_DB.authState.loggedIn = false;
  },
};

// ===== Mock Storage =====
const mockStorage = {
  uploadFile: async () => ({ fileID: 'mock-file-id' }),
  downloadFile: async () => ({ fileContent: '' }),
  deleteFile: async () => ({}),
};

// ===== CloudBase Mock 实例 =====
const mockDbInstance = {
  collection(name) {
    return new MockQuery(name);
  },
  command: mockCommand,
};

/**
 * 浏览器端 CloudBase Mock — 与 src/services/cloudbase.js 导出相同接口
 */
const cloudbaseMock = {
  getApp: () => ({ env: 'e2e-mock-env' }),
  db: () => mockDbInstance,
  auth: () => mockAuth,
  storage: () => mockStorage,

  callFunction: async (name, data) => {
    const preset = MOCK_DB.callFunctionResults[name];
    if (preset !== undefined) {
      if (typeof preset === 'function') return { result: await preset(data) };
      return { result: preset };
    }
    return { result: { success: true } };
  },

  isReady: () => true,
};

export default cloudbaseMock;
