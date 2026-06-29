/* 新励成招聘管理系统 V2.0 — 系统配置 Store
 *
 * 管理系统级配置：部门、城市、岗位类型、告警阈值等。
 * Admin 直接写入，Recruiter 通过 PendingChanges 间接修改。
 * 首次加载从 CloudBase Config 集合读取，兜底用 constants.js 默认值。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { DEPARTMENTS, JOB_TYPES } from '../config/constants';

export const useConfigStore = defineStore('config', () => {
  // ===== 状态 =====
  const departments = ref([...DEPARTMENTS]);
  const departmentTree = ref([]);  // Phase 4: 四级部门树
  const cities = ref(['广州', '深圳', '北京', '上海', '成都', '杭州', '武汉', '南京']);
  const recruitmentSources = ref(['BOSS直聘', '内部推荐', '返岗', '其他']);
  const jobTypes = ref({ ...JOB_TYPES });
  const alertThresholds = ref({});
  const loading = ref(false);
  const error = ref('');
  const loaded = ref(false);

  // 从树生成扁平的部门名列表（用于向后兼容）
  function flattenTree(nodes) {
    const names = [];
    function walk(list) {
      for (const n of list) {
        names.push(n.name);
        if (n.children?.length) walk(n.children);
      }
    }
    walk(nodes);
    return names;
  }

  // ===== 计算属性 =====
  const departmentOptions = computed(() =>
    departments.value.map(d => ({ value: d, label: d }))
  );

  const cityOptions = computed(() =>
    cities.value.map(c => ({ value: c, label: c }))
  );

  const sourceOptions = computed(() =>
    recruitmentSources.value.map(s => ({ value: s, label: s }))
  );

  const jobTypeOptions = computed(() =>
    Object.entries(jobTypes.value).map(([key, val]) => ({
      value: key,
      label: val.label || key,
      interviewRounds: val.interviewRounds || 3,
    }))
  );

  // 默认告警阈值（每阶段的自然天数上限，超期触发"待跟进"提醒）
  const defaultThresholds = {
    resume: 7,
    valid_resume: 3,
    invite: 5,
    invite_confirmed: 3,
    first_interview: 3,
    first_pass: 3,
    second_interview: 5,
    second_pass: 3,
    final_interview: 5,
    final_pass: 3,
    offer: 7,
  };

  // ===== 初始化 =====
  async function loadConfig() {
    if (loaded.value) return;
    loading.value = true;
    error.value = '';

    try {
      const db = cloudbase.db();
      if (!db) {
        // 离线：使用默认值
        loaded.value = true;
        return;
      }

      const result = await db.collection('Config')
        .doc('system')
        .get()
        .catch(() => ({ data: null }));

      // CloudBase JS SDK v3 非事务模式下 doc().get() 返回 { data: [doc] }
      // 事务模式下返回 { data: doc }，这里兼容两种格式
      const data = Array.isArray(result.data) ? result.data[0] : result.data;

      if (data) {
        if (data.departments?.length) departments.value = data.departments;
        if (data.departmentTree?.length) {
          departmentTree.value = data.departmentTree;
        } else if (data.departments?.length) {
          // 🛡 兜底：departmentTree 为空但扁平列表有数据 → 自动构建一级树
          departmentTree.value = data.departments.map(name => ({
            id: 'dept_' + name.replace(/\s/g, '_'),
            name,
            level: 1,
            children: [],
          }));
          // 同步扁平列表（从树生成）
          departments.value = flattenTree(departmentTree.value);
          console.warn('[useConfigStore] departmentTree 为空，已从扁平列表自动恢复');
        }
        if (data.cities?.length) cities.value = data.cities;
        if (data.recruitmentSources?.length) recruitmentSources.value = data.recruitmentSources;
        if (data.jobTypes) jobTypes.value = { ...JOB_TYPES, ...data.jobTypes };
        if (data.alertThresholds) {
          alertThresholds.value = { ...defaultThresholds, ...data.alertThresholds };
        } else {
          alertThresholds.value = { ...defaultThresholds };
        }
      } else {
        alertThresholds.value = { ...defaultThresholds };
      }

      loaded.value = true;
    } catch (err) {
      console.warn('[useConfigStore] 加载配置失败，使用默认值:', err.message);
      alertThresholds.value = { ...defaultThresholds };
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  // ===== 部门 CRUD =====
  async function addDepartment(name) {
    if (!name || departments.value.includes(name)) return;
    departments.value.push(name);
    await saveToCloudBase();
  }

  async function updateDepartment(oldName, newName) {
    const idx = departments.value.indexOf(oldName);
    if (idx === -1 || !newName || departments.value.includes(newName)) return;
    departments.value[idx] = newName;
    await saveToCloudBase();
  }

  async function removeDepartment(name) {
    departments.value = departments.value.filter(d => d !== name);
    await saveToCloudBase();
  }

  // ===== 树形部门 CRUD（Phase 4） =====

  /** 在树中查找节点 */
  function findNode(id, nodes = departmentTree.value) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children?.length) {
        const found = findNode(id, n.children);
        if (found) return found;
      }
    }
    return null;
  }

  /** 移除树中节点 */
  function removeFromTree(id, nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
      if (nodes[i].children?.length) {
        if (removeFromTree(id, nodes[i].children)) return true;
      }
    }
    return false;
  }

  function addDepartmentNode(parentId, name) {
    const node = { id: 'dept_' + Date.now(), name, level: 1, children: [] };
    if (!parentId) {
      departmentTree.value.push(node);
    } else {
      const parent = findNode(parentId);
      if (parent) {
        node.level = parent.level + 1;
        parent.children = parent.children || [];
        parent.children.push(node);
      }
    }
    departments.value = flattenTree(departmentTree.value);
    saveToCloudBase();
  }

  function updateDepartmentNode(id, newName) {
    const node = findNode(id);
    if (node) { node.name = newName; departments.value = flattenTree(departmentTree.value); saveToCloudBase(); }
  }

  function removeDepartmentNode(id) {
    if (removeFromTree(id, departmentTree.value)) {
      departments.value = flattenTree(departmentTree.value);
      saveToCloudBase();
    }
  }

  /** 获取节点的完整层级路径 */
  function getNodePath(id) {
    function walk(nodes, path) {
      for (const n of nodes) {
        const p = [...path, { level: n.level, name: n.name }];
        if (n.id === id) return p;
        if (n.children?.length) {
          const r = walk(n.children, p);
          if (r) return r;
        }
      }
      return null;
    }
    return walk(departmentTree.value, []);
  }

  // ===== 城市 CRUD =====
  async function addCity(name) {
    if (!name || cities.value.includes(name)) return;
    cities.value.push(name);
    await saveToCloudBase();
  }

  async function removeCity(name) {
    cities.value = cities.value.filter(c => c !== name);
    await saveToCloudBase();
  }

  // ===== 渠道来源 CRUD =====
  async function addSource(name) {
    if (!name || recruitmentSources.value.includes(name)) return;
    recruitmentSources.value.push(name);
    await saveToCloudBase();
  }

  async function updateSource(oldName, newName) {
    const idx = recruitmentSources.value.indexOf(oldName);
    if (idx === -1 || !newName || recruitmentSources.value.includes(newName)) return;
    recruitmentSources.value[idx] = newName;
    await saveToCloudBase();
  }

  async function removeSource(name) {
    recruitmentSources.value = recruitmentSources.value.filter(s => s !== name);
    await saveToCloudBase();
  }

  // ===== 岗位类型 CRUD =====
  async function addJobType(key, config) {
    if (!key || jobTypes.value[key]) return;
    jobTypes.value[key] = { label: key, interviewRounds: 3, responsibilities: '', requirements: '', ...config };
    await saveToCloudBase();
  }

  async function updateJobType(key, config) {
    if (!jobTypes.value[key]) return;
    jobTypes.value[key] = { ...jobTypes.value[key], ...config };
    await saveToCloudBase();
  }

  async function removeJobType(key) {
    delete jobTypes.value[key];
    await saveToCloudBase();
  }

  // ===== 告警阈值 =====
  async function updateAlertThreshold(stage, days) {
    alertThresholds.value[stage] = days;
    await saveToCloudBase();
  }

  // ===== 持久化 =====
  async function saveToCloudBase() {
    const db = cloudbase.db();
    if (!db) return;

    try {
      // 🛡 保护：departmentTree 为空但 departments 有数据时，从扁动构建树
      let treeToSave = departmentTree.value;
      if ((!treeToSave || treeToSave.length === 0) && departments.value.length > 0) {
        treeToSave = departments.value.map(name => ({
          id: 'dept_' + name.replace(/\s/g, '_'),
          name,
          level: 1,
          children: [],
        }));
        console.warn('[useConfigStore] saveToCloudBase: departmentTree 为空，已从扁平列表自动构建');
      }

      const doc = {
        departments: departments.value,
        departmentTree: treeToSave,
        cities: cities.value,
        recruitmentSources: recruitmentSources.value,
        jobTypes: jobTypes.value,
        alertThresholds: alertThresholds.value,
        updatedAt: new Date(),
      };

      // upsert：先尝试更新，失败则创建
      const existing = await db.collection('Config').doc('system').get().catch(() => ({ data: [] }));
      if (existing?.data && existing.data.length > 0) {
        await db.collection('Config').doc('system').update(doc);
      } else {
        await db.collection('Config').add({ _id: 'system', ...doc, createdAt: new Date() });
      }
    } catch (err) {
      console.warn('[useConfigStore] 保存配置失败:', err.message);
    }
  }

  // ===== 工具函数 =====
  function getAlertThreshold(stage) {
    return alertThresholds.value[stage] || defaultThresholds[stage] || 7;
  }

  return {
    // state
    departments,
    departmentTree,
    cities,
    recruitmentSources,
    jobTypes,
    alertThresholds,
    loading,
    error,
    loaded,
    // computed
    departmentOptions,
    cityOptions,
    sourceOptions,
    jobTypeOptions,
    defaultThresholds,
    // actions
    loadConfig,
    addDepartment,
    updateDepartment,
    removeDepartment,
    addDepartmentNode,
    updateDepartmentNode,
    removeDepartmentNode,
    getNodePath,
    addCity,
    removeCity,
    addSource,
    updateSource,
    removeSource,
    addJobType,
    updateJobType,
    removeJobType,
    updateAlertThreshold,
    getAlertThreshold,
  };
});
