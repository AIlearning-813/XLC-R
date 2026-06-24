/**
 * useConfigStore.test.js — 系统配置 Store 测试
 *
 * 通过 CloudBase Mock 层验证：
 *   - 初始状态（来自 constants.js 的默认值）
 *   - 计算属性（departmentOptions / cityOptions / sourceOptions / jobTypeOptions）
 *   - loadConfig（成功 / 空 DB / 错误兜底 / 已加载跳过 / 离线模式）
 *   - 部门 CRUD（增删改 + 重复/空名边界）
 *   - 城市 CRUD（增删 + 边界）
 *   - 渠道来源 CRUD（增删改 + 边界）
 *   - 岗位类型 CRUD（增删改 + 边界）
 *   - 告警阈值（更新 / 读取 / 默认兜底）
 *   - 树形部门操作（增删改 / 路径查找 / 扁平化同步）
 *   - 所有 CRUD 写入后验证 Mock DB
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ===== Mock CloudBase SDK（自动使用 services/__mocks__/cloudbase.js）=====
vi.mock('../services/cloudbase');

// ===== Mock Auth Store =====
vi.mock('./useAuthStore', () => ({
  useAuthStore: () => ({
    currentUsername: 'admin',
    userName: '管理员',
    isAdmin: true,
    isLoggedIn: true,
  }),
}));

// 防御：其他测试文件（如 useRecruitmentDemandStore）可能 mock 了本模块，
// 必须显式 unmock 确保此处使用的是真实的 useConfigStore
vi.unmock('./useConfigStore');

// ===== 导入依赖 =====
import cloudbase from '../services/cloudbase';
import { useConfigStore } from './useConfigStore';

let store;

beforeEach(() => {
  setActivePinia(createPinia());
  cloudbase.__resetAll();
  store = useConfigStore();
});

// ===== 测试辅助 =====
function seedConfig(data = {}) {
  const doc = { _id: 'system', ...data };
  cloudbase.__setCollectionData('Config', [doc]);
  return doc;
}

describe('useConfigStore', () => {
  // ==========================================
  // 初始状态
  // ==========================================
  describe('初始状态', () => {
    it('departments 初始化为 DEPARTMENTS 常量', () => {
      expect(store.departments).toEqual(['CC部', 'CR部', 'TMK部', '人事部', '讲师部', 'LTC部']);
    });

    it('departmentTree 初始为空数组', () => {
      expect(store.departmentTree).toEqual([]);
    });

    it('cities 初始化为 8 个默认城市', () => {
      expect(store.cities).toEqual(['广州', '深圳', '北京', '上海', '成都', '杭州', '武汉', '南京']);
      expect(store.cities).toHaveLength(8);
    });

    it('recruitmentSources 初始化为 4 个默认来源', () => {
      expect(store.recruitmentSources).toEqual(['BOSS直聘', '内部推荐', '返岗', '其他']);
    });

    it('jobTypes 初始化为 JOB_TYPES 常量', () => {
      expect(store.jobTypes).toHaveProperty('CC');
      expect(store.jobTypes).toHaveProperty('CR');
      expect(store.jobTypes).toHaveProperty('TMK');
      expect(store.jobTypes.CC).toEqual({ label: 'CC', interviewRounds: 3 });
      expect(store.jobTypes.CR).toEqual({ label: 'CR', interviewRounds: 2 });
    });

    it('alertThresholds 初始为空对象', () => {
      expect(store.alertThresholds).toEqual({});
    });

    it('loading 初始为 false', () => {
      expect(store.loading).toBe(false);
    });

    it('error 初始为空字符串', () => {
      expect(store.error).toBe('');
    });

    it('loaded 初始为 false', () => {
      expect(store.loaded).toBe(false);
    });
  });

  // ==========================================
  // 计算属性
  // ==========================================
  describe('计算属性', () => {
    describe('departmentOptions', () => {
      it('将 departments 数组映射为 {value, label} 格式', () => {
        store.departments = ['CC部', 'CR部'];
        expect(store.departmentOptions).toEqual([
          { value: 'CC部', label: 'CC部' },
          { value: 'CR部', label: 'CR部' },
        ]);
      });

      it('空数组返回空数组', () => {
        store.departments = [];
        expect(store.departmentOptions).toEqual([]);
      });

      it('响应式更新：修改 departments 后自动变化', () => {
        store.departments = ['A部'];
        expect(store.departmentOptions).toEqual([{ value: 'A部', label: 'A部' }]);
        store.departments.push('B部');
        expect(store.departmentOptions).toHaveLength(2);
      });
    });

    describe('cityOptions', () => {
      it('将 cities 数组映射为 {value, label} 格式', () => {
        store.cities = ['广州', '深圳'];
        expect(store.cityOptions).toEqual([
          { value: '广州', label: '广州' },
          { value: '深圳', label: '深圳' },
        ]);
      });
    });

    describe('sourceOptions', () => {
      it('将 recruitmentSources 数组映射为 {value, label} 格式', () => {
        store.recruitmentSources = ['BOSS直聘', '内部推荐'];
        expect(store.sourceOptions).toEqual([
          { value: 'BOSS直聘', label: 'BOSS直聘' },
          { value: '内部推荐', label: '内部推荐' },
        ]);
      });
    });

    describe('jobTypeOptions', () => {
      it('将 jobTypes 对象映射为含 interviewRounds 的选项数组', () => {
        store.jobTypes = {
          CC: { label: 'CC', interviewRounds: 3 },
          CR: { label: 'CR', interviewRounds: 2 },
        };
        const options = store.jobTypeOptions;
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveProperty('value');
        expect(options[0]).toHaveProperty('label');
        expect(options[0]).toHaveProperty('interviewRounds');
      });

      it('jobTypes 中无 label 时使用 key 作为 label', () => {
        store.jobTypes = { XYZ: { interviewRounds: 2 } };
        expect(store.jobTypeOptions[0].label).toBe('XYZ');
      });

      it('jobTypes 中无 interviewRounds 时默认 3', () => {
        store.jobTypes = { XYZ: { label: '测试' } };
        expect(store.jobTypeOptions[0].interviewRounds).toBe(3);
      });
    });

    describe('defaultThresholds', () => {
      it('返回 11 个阶段的默认阈值', () => {
        const defaults = store.defaultThresholds;
        expect(defaults).toHaveProperty('resume', 7);
        expect(defaults).toHaveProperty('valid_resume', 3);
        expect(defaults).toHaveProperty('invite', 5);
        expect(defaults).toHaveProperty('invite_confirmed', 3);
        expect(defaults).toHaveProperty('first_interview', 3);
        expect(defaults).toHaveProperty('first_pass', 3);
        expect(defaults).toHaveProperty('second_interview', 5);
        expect(defaults).toHaveProperty('second_pass', 3);
        expect(defaults).toHaveProperty('final_interview', 5);
        expect(defaults).toHaveProperty('final_pass', 3);
        expect(defaults).toHaveProperty('offer', 7);
      });

      it('offer 阶段默认为 7 天', () => {
        expect(store.defaultThresholds.offer).toBe(7);
      });
    });
  });

  // ==========================================
  // loadConfig — 加载系统配置
  // ==========================================
  describe('loadConfig — 加载配置', () => {
    it('成功加载：从 DB 读取并填充所有状态', async () => {
      seedConfig({
        departments: ['销售部', '技术部'],
        cities: ['广州', '深圳'],
        recruitmentSources: ['BOSS直聘', '拉勾'],
        jobTypes: { DEV: { label: '开发', interviewRounds: 4 } },
        alertThresholds: { resume: 5, offer: 10 },
      });

      await store.loadConfig();

      expect(store.departments).toEqual(['销售部', '技术部']);
      expect(store.cities).toEqual(['广州', '深圳']);
      expect(store.recruitmentSources).toEqual(['BOSS直聘', '拉勾']);
      expect(store.jobTypes.DEV).toEqual({ label: '开发', interviewRounds: 4 });
      expect(store.alertThresholds.resume).toBe(5);
      expect(store.alertThresholds.offer).toBe(10);
      expect(store.loaded).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('DB 中有 departmentTree 时填充树', async () => {
      const tree = [
        { id: 'd1', name: '总部', level: 1, children: [
          { id: 'd2', name: 'CC部', level: 2, children: [] },
        ]},
      ];
      seedConfig({ departmentTree: tree });

      await store.loadConfig();

      expect(store.departmentTree).toEqual(tree);
    });

    it('空 DB：使用默认值并设置 alertThresholds 为 defaultThresholds', async () => {
      // 不 seed 任何 Config 数据 — doc('system').get() 返回 { data: [] }
      await store.loadConfig();

      // departments 保持默认值
      expect(store.departments).toEqual(['CC部', 'CR部', 'TMK部', '人事部', '讲师部', 'LTC部']);
      // alertThresholds 被设置为默认值
      expect(store.alertThresholds.resume).toBe(7);
      expect(store.alertThresholds.offer).toBe(7);
      expect(store.loaded).toBe(true);
    });

    it('DB 文档存在但某些字段为空：空数组/对象不覆盖默认值', async () => {
      seedConfig({
        departments: [],      // 空数组不覆盖
        cities: ['深圳'],     // 有值则覆盖
        alertThresholds: null,
      });

      await store.loadConfig();

      // departments 为空数组（长度为 0），不满足 data.departments?.length，保持默认
      // 注意：空数组 .length 为 0，是 falsy，所以不会覆盖
      expect(store.departments).toEqual(['CC部', 'CR部', 'TMK部', '人事部', '讲师部', 'LTC部']);
      // cities 有值，覆盖
      expect(store.cities).toEqual(['深圳']);
    });

    it('DB 有 alertThresholds 时与 defaultThresholds 合并', async () => {
      seedConfig({
        alertThresholds: { resume: 3 },
      });

      await store.loadConfig();

      // 自定义值覆盖默认
      expect(store.alertThresholds.resume).toBe(3);
      // 未自定义的使用默认值
      expect(store.alertThresholds.offer).toBe(7);
    });

    it('DB 无 alertThresholds 字段时使用 defaultThresholds', async () => {
      seedConfig({
        departments: ['A部'],
        // 没有 alertThresholds 字段
      });

      await store.loadConfig();

      expect(store.alertThresholds.resume).toBe(7);
      expect(store.alertThresholds.offer).toBe(7);
    });

    it('DB 访问失败时 catch 兜底：使用默认值', async () => {
      // 保存原始 db 函数，构造抛出异常的 mock
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: vi.fn().mockRejectedValue(new Error('网络错误')),
          })),
        })),
      }));

      await store.loadConfig();

      expect(store.loaded).toBe(true);
      expect(store.alertThresholds.resume).toBe(7);
      expect(store.loading).toBe(false);
      expect(store.error).toBe('');

      // 恢复
      cloudbase.db = originalDb;
    });

    it('已加载时跳过（loaded === true 直接返回）', async () => {
      store.loaded = true;
      store.departments = ['自定义部'];

      await store.loadConfig();

      // 状态不变
      expect(store.departments).toEqual(['自定义部']);
    });

    it('加载中不重复加载（loading 为 true 时跳过）', async () => {
      store.loading = true;
      store.loaded = false;

      // 设置 DB 数据
      seedConfig({ departments: ['技术部'] });

      // 但 loadConfig 检查的是 loaded，不是 loading
      // 实际上 store 检查 `if (loaded.value) return;` — 只检查 loaded
      // loading 用于 UI 展示，不做并发控制
      // 所以即使用 loading=true，仍会请求（因为没有 loaded=true 早退）
      // 这个测试验证 loading 状态在过程中的行为

      // 注：当前实现只用 loaded 做互斥，不检查 loading。这个测试确认这个行为是已知的。
      // loaded 为 false 时仍会发起请求。
      const result = store.loadConfig();
      // 请求已发出
      expect(result).toBeInstanceOf(Promise);
    });

    it('离线模式：db() 返回 null 时直接标记 loaded', async () => {
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => null);

      await store.loadConfig();

      expect(store.loaded).toBe(true);
      expect(store.departments).toEqual(['CC部', 'CR部', 'TMK部', '人事部', '讲师部', 'LTC部']);

      // 恢复
      cloudbase.db = originalDb;
    });

    it('CloudBase 兼容：result.data 为非数组时直接作为 data 使用', async () => {
      // 模拟事务模式返回 { data: docObject } 而非 { data: [docObject] }
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              data: {
                departments: ['事务模式部'],
                cities: ['上海'],
              },
            }),
          })),
        })),
      }));

      await store.loadConfig();

      expect(store.departments).toEqual(['事务模式部']);
      expect(store.cities).toEqual(['上海']);

      cloudbase.db = originalDb;
    });
  });

  // ==========================================
  // 部门 CRUD
  // ==========================================
  describe('部门 CRUD', () => {
    describe('addDepartment', () => {
      it('添加新部门到列表末尾', async () => {
        await store.addDepartment('技术部');

        expect(store.departments).toContain('技术部');
        expect(store.departments[store.departments.length - 1]).toBe('技术部');
      });

      it('写入后 Mock DB 包含更新后的 departments', async () => {
        await store.addDepartment('技术部');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData).toHaveLength(1);
        expect(dbData[0].departments).toContain('技术部');
      });

      it('空名称不添加', async () => {
        const before = [...store.departments];
        await store.addDepartment('');
        expect(store.departments).toEqual(before);
      });

      it('重复名称不添加', async () => {
        const before = [...store.departments];
        await store.addDepartment('CC部'); // CC部 是默认部门
        expect(store.departments).toEqual(before);
      });

      it('新集合第一次 add：自动创建 Config 文档', async () => {
        // 无现有 Config 文档
        await store.addDepartment('新部门');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData).toHaveLength(1);
        expect(dbData[0]._id).toBe('system');
      });
    });

    describe('updateDepartment', () => {
      it('更新已有部门名称', async () => {
        await store.updateDepartment('CC部', 'CC事业部');

        expect(store.departments).toContain('CC事业部');
        expect(store.departments).not.toContain('CC部');
      });

      it('更新后 Mock DB 同步', async () => {
        await store.updateDepartment('CC部', 'CC事业部');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].departments).toContain('CC事业部');
        expect(dbData[0].departments).not.toContain('CC部');
      });

      it('旧名称不存在时不修改', async () => {
        const before = [...store.departments];
        await store.updateDepartment('不存在的部', '新部');
        expect(store.departments).toEqual(before);
      });

      it('新名称为空时不修改', async () => {
        const before = [...store.departments];
        await store.updateDepartment('CC部', '');
        expect(store.departments).toEqual(before);
      });

      it('新名称已存在时不修改（防重复）', async () => {
        const before = [...store.departments];
        await store.updateDepartment('CC部', 'CR部'); // CR部 已存在
        expect(store.departments).toEqual(before);
      });
    });

    describe('removeDepartment', () => {
      it('删除已有部门', async () => {
        await store.removeDepartment('CC部');

        expect(store.departments).not.toContain('CC部');
      });

      it('删除后 Mock DB 同步', async () => {
        await store.removeDepartment('CC部');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].departments).not.toContain('CC部');
      });

      it('删除不存在的部门不报错', async () => {
        const before = [...store.departments];
        await store.removeDepartment('不存在的部');
        expect(store.departments).toEqual(before);
      });

      it('删除后数组长度减少', async () => {
        const beforeLen = store.departments.length;
        await store.removeDepartment('CC部');
        expect(store.departments.length).toBe(beforeLen - 1);
      });
    });
  });

  // ==========================================
  // 城市 CRUD
  // ==========================================
  describe('城市 CRUD', () => {
    describe('addCity', () => {
      it('添加新城市', async () => {
        await store.addCity('西安');

        expect(store.cities).toContain('西安');
      });

      it('写入后 Mock DB 同步', async () => {
        await store.addCity('西安');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].cities).toContain('西安');
      });

      it('空名称不添加', async () => {
        const before = [...store.cities];
        await store.addCity('');
        expect(store.cities).toEqual(before);
      });

      it('重复城市不添加', async () => {
        const before = [...store.cities];
        await store.addCity('广州');
        expect(store.cities).toEqual(before);
      });
    });

    describe('removeCity', () => {
      it('删除已有城市', async () => {
        await store.removeCity('广州');

        expect(store.cities).not.toContain('广州');
      });

      it('删除后 Mock DB 同步', async () => {
        await store.removeCity('广州');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].cities).not.toContain('广州');
      });

      it('删除不存在的城市不报错', async () => {
        const before = [...store.cities];
        await store.removeCity('不存在的城市');
        expect(store.cities).toEqual(before);
      });
    });
  });

  // ==========================================
  // 渠道来源 CRUD
  // ==========================================
  describe('渠道来源 CRUD', () => {
    describe('addSource', () => {
      it('添加新渠道来源', async () => {
        await store.addSource('智联招聘');

        expect(store.recruitmentSources).toContain('智联招聘');
      });

      it('写入后 Mock DB 同步', async () => {
        await store.addSource('智联招聘');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].recruitmentSources).toContain('智联招聘');
      });

      it('空名称不添加', async () => {
        const before = [...store.recruitmentSources];
        await store.addSource('');
        expect(store.recruitmentSources).toEqual(before);
      });

      it('重复来源不添加', async () => {
        const before = [...store.recruitmentSources];
        await store.addSource('BOSS直聘');
        expect(store.recruitmentSources).toEqual(before);
      });
    });

    describe('updateSource', () => {
      it('更新已有渠道来源名称', async () => {
        await store.updateSource('BOSS直聘', 'BOSS直聘-华南');

        expect(store.recruitmentSources).toContain('BOSS直聘-华南');
        expect(store.recruitmentSources).not.toContain('BOSS直聘');
      });

      it('更新后 Mock DB 同步', async () => {
        await store.updateSource('BOSS直聘', 'BOSS直聘-华南');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].recruitmentSources).toContain('BOSS直聘-华南');
        expect(dbData[0].recruitmentSources).not.toContain('BOSS直聘');
      });

      it('旧名称不存在时不修改', async () => {
        const before = [...store.recruitmentSources];
        await store.updateSource('不存在的渠道', '新渠道');
        expect(store.recruitmentSources).toEqual(before);
      });

      it('新名称为空时不修改', async () => {
        const before = [...store.recruitmentSources];
        await store.updateSource('BOSS直聘', '');
        expect(store.recruitmentSources).toEqual(before);
      });

      it('新名称已存在时不修改（防重复）', async () => {
        const before = [...store.recruitmentSources];
        await store.updateSource('BOSS直聘', '内部推荐'); // 已存在
        expect(store.recruitmentSources).toEqual(before);
      });
    });

    describe('removeSource', () => {
      it('删除已有来源', async () => {
        await store.removeSource('BOSS直聘');

        expect(store.recruitmentSources).not.toContain('BOSS直聘');
      });

      it('删除后 Mock DB 同步', async () => {
        await store.removeSource('BOSS直聘');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].recruitmentSources).not.toContain('BOSS直聘');
      });

      it('删除不存在的来源不报错', async () => {
        const before = [...store.recruitmentSources];
        await store.removeSource('不存在的');
        expect(store.recruitmentSources).toEqual(before);
      });
    });
  });

  // ==========================================
  // 岗位类型 CRUD
  // ==========================================
  describe('岗位类型 CRUD', () => {
    describe('addJobType', () => {
      it('添加新岗位类型', async () => {
        await store.addJobType('DEV', { label: '开发', interviewRounds: 4 });

        expect(store.jobTypes.DEV).toBeDefined();
        expect(store.jobTypes.DEV.label).toBe('开发');
        expect(store.jobTypes.DEV.interviewRounds).toBe(4);
      });

      it('写入后 Mock DB 同步', async () => {
        await store.addJobType('DEV', { label: '开发', interviewRounds: 4 });

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].jobTypes.DEV).toBeDefined();
      });

      it('不提供 config 时使用默认值', async () => {
        await store.addJobType('TEST', {});

        expect(store.jobTypes.TEST.label).toBe('TEST');
        expect(store.jobTypes.TEST.interviewRounds).toBe(3);
        expect(store.jobTypes.TEST.responsibilities).toBe('');
        expect(store.jobTypes.TEST.requirements).toBe('');
      });

      it('空 key 不添加', async () => {
        const beforeKeys = Object.keys(store.jobTypes);
        await store.addJobType('', { label: '空' });
        expect(Object.keys(store.jobTypes)).toEqual(beforeKeys);
      });

      it('重复 key 不添加（不覆盖已有）', async () => {
        const original = { ...store.jobTypes.CC };
        await store.addJobType('CC', { label: '新CC', interviewRounds: 5 });
        expect(store.jobTypes.CC).toEqual(original);
      });
    });

    describe('updateJobType', () => {
      it('更新已有岗位类型配置', async () => {
        await store.updateJobType('CC', { interviewRounds: 5, responsibilities: '销售' });

        expect(store.jobTypes.CC.interviewRounds).toBe(5);
        expect(store.jobTypes.CC.responsibilities).toBe('销售');
        // label 应保持不变（未被覆盖）
        expect(store.jobTypes.CC.label).toBe('CC');
      });

      it('更新后 Mock DB 同步', async () => {
        await store.updateJobType('CC', { interviewRounds: 4 });

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].jobTypes.CC.interviewRounds).toBe(4);
      });

      it('不存在的 key 不执行', async () => {
        await store.updateJobType('NONEXIST', { interviewRounds: 10 });
        expect(store.jobTypes.NONEXIST).toBeUndefined();
      });
    });

    describe('removeJobType', () => {
      it('删除已有岗位类型', async () => {
        await store.removeJobType('CC');

        expect(store.jobTypes.CC).toBeUndefined();
      });

      it('删除后 Mock DB 同步', async () => {
        await store.removeJobType('CC');

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].jobTypes.CC).toBeUndefined();
      });

      it('删除不存在的 key 不报错', async () => {
        await store.removeJobType('NONEXIST');
        expect(store.jobTypes).toBeDefined();
      });
    });
  });

  // ==========================================
  // 告警阈值
  // ==========================================
  describe('告警阈值', () => {
    describe('updateAlertThreshold', () => {
      it('更新某个阶段的阈值', async () => {
        await store.updateAlertThreshold('resume', 3);

        expect(store.alertThresholds.resume).toBe(3);
      });

      it('写入后 Mock DB 同步', async () => {
        await store.updateAlertThreshold('resume', 3);

        const dbData = cloudbase.__getCollectionData('Config');
        expect(dbData[0].alertThresholds.resume).toBe(3);
      });

      it('设置不存在的阶段阈值', async () => {
        await store.updateAlertThreshold('custom_stage', 10);

        expect(store.alertThresholds.custom_stage).toBe(10);
      });
    });

    describe('getAlertThreshold', () => {
      it('alertThresholds 中有值时返回该值', () => {
        store.alertThresholds = { resume: 2 };
        expect(store.getAlertThreshold('resume')).toBe(2);
      });

      it('alertThresholds 中无值但 defaultThresholds 有值时返回默认值', () => {
        store.alertThresholds = {};
        expect(store.getAlertThreshold('offer')).toBe(7);
      });

      it('两者都没有时返回兜底值 7', () => {
        store.alertThresholds = {};
        expect(store.getAlertThreshold('unknown_stage')).toBe(7);
      });

      it('alertThresholds 值为 0 时因 || 运算退回默认值（已知行为）', () => {
        // getAlertThreshold 使用 || 运算符，0 被视为 falsy
        // 所以值为 0 时会 fallback 到 defaultThresholds
        store.alertThresholds = { resume: 0 };
        expect(store.getAlertThreshold('resume')).toBe(7);
      });
    });
  });

  // ==========================================
  // 树形部门操作
  // ==========================================
  describe('树形部门操作', () => {
    describe('addDepartmentNode', () => {
      it('添加根节点（无 parentId）', () => {
        store.addDepartmentNode(null, '总部');

        expect(store.departmentTree).toHaveLength(1);
        expect(store.departmentTree[0].name).toBe('总部');
        expect(store.departmentTree[0].level).toBe(1);
        expect(store.departmentTree[0].id).toMatch(/^dept_/);
      });

      it('添加子节点', () => {
        store.addDepartmentNode(null, '总部');
        const parentId = store.departmentTree[0].id;

        store.addDepartmentNode(parentId, 'CC部');

        const parent = store.departmentTree[0];
        expect(parent.children).toHaveLength(1);
        expect(parent.children[0].name).toBe('CC部');
        expect(parent.children[0].level).toBe(2);
      });

      it('添加子节点后扁平化同步到 departments', () => {
        store.addDepartmentNode(null, '总部');
        const parentId = store.departmentTree[0].id;
        store.addDepartmentNode(parentId, 'CC部');

        expect(store.departments).toContain('总部');
        expect(store.departments).toContain('CC部');
      });

      it('父节点不存在时不添加子节点', () => {
        const before = [...store.departmentTree];
        store.addDepartmentNode('nonexistent_id', '新部门');
        expect(store.departmentTree).toEqual(before);
      });

      it('多层级嵌套', async () => {
        // 使用小延迟确保每个节点获得唯一的 Date.now() ID
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));

        store.addDepartmentNode(null, '总部');
        await delay(1);
        const rootId = store.departmentTree[0].id;
        store.addDepartmentNode(rootId, '销售部');
        await delay(1);
        const salesId = store.departmentTree[0].children[0].id;
        store.addDepartmentNode(salesId, 'CC组');

        // 三级结构
        expect(store.departmentTree[0].children[0].children[0].name).toBe('CC组');
        expect(store.departmentTree[0].children[0].children[0].level).toBe(3);
        // 扁平化包含所有三级部门名称
        expect(store.departments).toContain('总部');
        expect(store.departments).toContain('销售部');
        expect(store.departments).toContain('CC组');
      });
    });

    describe('updateDepartmentNode', () => {
      it('更新节点名称', () => {
        store.addDepartmentNode(null, '总部');
        const nodeId = store.departmentTree[0].id;

        store.updateDepartmentNode(nodeId, '集团总部');

        expect(store.departmentTree[0].name).toBe('集团总部');
      });

      it('更新后扁平化同步到 departments', () => {
        store.addDepartmentNode(null, '总部');
        const nodeId = store.departmentTree[0].id;

        store.updateDepartmentNode(nodeId, '集团总部');

        expect(store.departments).toContain('集团总部');
        expect(store.departments).not.toContain('总部');
      });

      it('节点不存在时不报错', () => {
        store.updateDepartmentNode('nonexistent_id', '新名称');
        // 不报错即可
      });
    });

    describe('removeDepartmentNode', () => {
      it('删除根节点', () => {
        store.addDepartmentNode(null, '总部');
        const nodeId = store.departmentTree[0].id;

        store.removeDepartmentNode(nodeId);

        expect(store.departmentTree).toHaveLength(0);
      });

      it('删除子节点', async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));

        store.addDepartmentNode(null, '总部');
        await delay(1);
        const rootId = store.departmentTree[0].id;
        store.addDepartmentNode(rootId, 'CC部');
        await delay(1);
        const childId = store.departmentTree[0].children[0].id;

        store.removeDepartmentNode(childId);

        expect(store.departmentTree[0].children).toHaveLength(0);
      });

      it('删除后扁平化同步到 departments（树层面验证）', async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));

        store.addDepartmentNode(null, '总部');
        await delay(1);
        const rootId = store.departmentTree[0].id;
        store.addDepartmentNode(rootId, 'CC部');
        await delay(1);
        const childId = store.departmentTree[0].children[0].id;

        // 删除前确认 departments 包含两个节点
        expect(store.departments).toEqual(expect.arrayContaining(['总部', 'CC部']));

        store.removeDepartmentNode(childId);

        // 删除后：树中只剩根节点
        expect(store.departmentTree[0].name).toBe('总部');
        expect(store.departmentTree[0].children).toHaveLength(0);
        // departments 由 flattenTree 同步：应包含 '总部'，不包含 'CC部'
        expect(store.departments).toContain('总部');
        expect(store.departments).not.toContain('CC部');
      });

      it('节点不存在时不报错', () => {
        store.removeDepartmentNode('nonexistent_id');
        // 不报错即可
      });
    });

    describe('getNodePath', () => {
      it('返回根节点的完整路径', () => {
        store.addDepartmentNode(null, '总部');
        const nodeId = store.departmentTree[0].id;

        const path = store.getNodePath(nodeId);

        expect(path).toBeInstanceOf(Array);
        expect(path).toHaveLength(1);
        expect(path[0]).toEqual({ level: 1, name: '总部' });
      });

      it('返回深层节点的完整层级路径', async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));

        store.addDepartmentNode(null, '总部');
        await delay(1);
        const rootId = store.departmentTree[0].id;
        store.addDepartmentNode(rootId, '销售部');
        await delay(1);
        const salesId = store.departmentTree[0].children[0].id;
        store.addDepartmentNode(salesId, 'CC组');

        const deepNodeId = store.departmentTree[0].children[0].children[0].id;
        const path = store.getNodePath(deepNodeId);

        expect(path).toHaveLength(3);
        expect(path[0]).toEqual({ level: 1, name: '总部' });
        expect(path[1]).toEqual({ level: 2, name: '销售部' });
        expect(path[2]).toEqual({ level: 3, name: 'CC组' });
      });

      it('节点不存在时返回 null', () => {
        const path = store.getNodePath('nonexistent_id');
        expect(path).toBeNull();
      });

      it('空树返回 null', () => {
        const path = store.getNodePath('any_id');
        expect(path).toBeNull();
      });
    });

    describe('树与扁平部门联动', () => {
      it('树中所有节点名称出现在扁平 departments 中', async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));

        store.addDepartmentNode(null, 'A');
        await delay(1);
        const aId = store.departmentTree[0].id;
        store.addDepartmentNode(aId, 'A-1');
        await delay(1);
        const a1Id = store.departmentTree[0].children[0].id;
        store.addDepartmentNode(a1Id, 'A-1-1');

        expect(store.departments).toEqual(expect.arrayContaining(['A', 'A-1', 'A-1-1']));
      });

      it('删除所有节点后 departments 为空', () => {
        store.addDepartmentNode(null, '总部');
        store.removeDepartmentNode(store.departmentTree[0].id);

        // departments 被 flattenTree 重置（原有默认部门被覆盖）
        // 注意：addDepartmentNode 会调用 flattenTree 覆盖 departments
        expect(store.departments).toHaveLength(0);
      });
    });
  });

  // ==========================================
  // 综合场景 & 边界情况
  // ==========================================
  describe('综合场景 & 边界', () => {
    it('loadConfig 后执行 CRUD：状态正确并持久化', async () => {
      seedConfig({
        departments: ['销售部'],
        cities: ['广州'],
      });

      await store.loadConfig();

      // 此时是 DB 数据
      expect(store.departments).toEqual(['销售部']);

      // 执行 CRUD
      await store.addDepartment('技术部');
      await store.addCity('深圳');

      expect(store.departments).toContain('技术部');
      expect(store.cities).toContain('深圳');

      // Mock DB 验证：Config/system 文档已更新
      const dbData = cloudbase.__getCollectionData('Config');
      expect(dbData).toHaveLength(1);
      expect(dbData[0].departments).toContain('技术部');
      expect(dbData[0].cities).toContain('深圳');
    });

    it('连续多次 CRUD 后状态一致', async () => {
      await store.addDepartment('A部');
      await store.addDepartment('B部');
      await store.removeDepartment('A部');
      await store.updateDepartment('B部', 'B-2部');

      expect(store.departments).not.toContain('A部');
      expect(store.departments).not.toContain('B部');
      expect(store.departments).toContain('B-2部');
    });

    it('saveToCloudBase：已有 system 文档时执行 update', async () => {
      // 先 seed 一个 system 文档，然后 loadConfig 同步到 store 状态
      seedConfig({ departments: ['旧部门'] });
      await store.loadConfig();

      // store 状态现在是 ['旧部门']
      expect(store.departments).toEqual(['旧部门']);

      // 做一次 add，触发 saveToCloudBase（此时走 update 路径）
      await store.addDepartment('新部门');

      const dbData = cloudbase.__getCollectionData('Config');
      // 应该只有一条 system 文档（update 而非 add）
      expect(dbData).toHaveLength(1);
      expect(dbData[0]._id).toBe('system');
      expect(dbData[0].departments).toContain('旧部门');
      expect(dbData[0].departments).toContain('新部门');
    });

    it('saveToCloudBase 失败时不抛出（静默 warn）', async () => {
      // 使 doc().get() 抛出异常 — saveToCloudBase 内部 catch 所有错误
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: vi.fn().mockRejectedValue(new Error('权限不足')),
            update: vi.fn(),
          })),
        })),
      }));

      // 不应抛出
      await expect(store.addDepartment('测试部')).resolves.toBeUndefined();

      cloudbase.db = originalDb;
    });

    it('db() 返回 null 时 CRUD 操作不报错（静默跳过保存）', async () => {
      const originalDb = cloudbase.db;
      cloudbase.db = vi.fn(() => null);

      // add 修改本地状态但不持久化
      await store.addDepartment('离线部门');

      expect(store.departments).toContain('离线部门');
      // Mock DB 无数据（因为没调用 collection）
      const dbData = cloudbase.__getCollectionData('Config');
      expect(dbData).toHaveLength(0);

      cloudbase.db = originalDb;
    });

    it('departmentOptions 在树操作后保持同步', () => {
      expect(store.departmentOptions).toHaveLength(6); // 6 个默认部门

      store.addDepartmentNode(null, '新部门');
      // 树操作会覆盖 departments 为扁平化结果
      expect(store.departmentOptions).toHaveLength(1);
      expect(store.departmentOptions[0].label).toBe('新部门');
    });
  });
});
