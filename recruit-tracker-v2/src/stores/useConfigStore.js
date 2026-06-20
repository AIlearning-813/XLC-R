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
  const cities = ref(['广州', '深圳', '北京', '上海', '成都', '杭州', '武汉', '南京']);
  const jobTypes = ref({ ...JOB_TYPES });
  const alertThresholds = ref({});
  const loading = ref(false);
  const error = ref('');
  const loaded = ref(false);

  // ===== 计算属性 =====
  const departmentOptions = computed(() =>
    departments.value.map(d => ({ value: d, label: d }))
  );

  const cityOptions = computed(() =>
    cities.value.map(c => ({ value: c, label: c }))
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

      const { data } = await db.collection('Config')
        .doc('system')
        .get()
        .catch(() => ({ data: null }));

      if (data) {
        if (data.departments?.length) departments.value = data.departments;
        if (data.cities?.length) cities.value = data.cities;
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

  // ===== 岗位类型 CRUD =====
  async function addJobType(key, config) {
    if (!key || jobTypes.value[key]) return;
    jobTypes.value[key] = config;
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
      const doc = {
        departments: departments.value,
        cities: cities.value,
        jobTypes: jobTypes.value,
        alertThresholds: alertThresholds.value,
        updatedAt: new Date(),
      };

      // upsert：先尝试更新，失败则创建
      const existing = await db.collection('Config').doc('system').get().catch(() => ({ data: null }));
      if (existing?.data) {
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
    cities,
    jobTypes,
    alertThresholds,
    loading,
    error,
    loaded,
    // computed
    departmentOptions,
    cityOptions,
    jobTypeOptions,
    defaultThresholds,
    // actions
    loadConfig,
    addDepartment,
    updateDepartment,
    removeDepartment,
    addCity,
    removeCity,
    addJobType,
    updateJobType,
    removeJobType,
    updateAlertThreshold,
    getAlertThreshold,
  };
});
