/* 新励成招聘管理系统 V2.0 — parsedData 同步工具
 *
 * P1-9：候选人的顶层扁平字段（name, phone, email 等）与嵌套的
 * parsedData.basic_info 需要保持同步。当通过 update() 修改顶层字段时，
 * 本模块自动将变更同步回 parsedData，避免双源数据不一致。
 *
 * 使用方式：
 *   import { syncToParsedData } from '../services/candidate-sync';
 *   const updateData = syncToParsedData(originalCandidate, changedFields);
 */

/** 顶层字段 → parsedData 路径映射 */
const FIELD_TO_PARSED_PATH = {
  name: 'basic_info.name',
  gender: 'basic_info.gender',
  phone: 'basic_info.phone',
  email: 'basic_info.email',
  age: 'basic_info.age',
  city: 'basic_info.city',
  yearsOfExperience: 'basic_info.years_of_experience',
  expectedPosition: 'expected_position',
  expectedSalary: 'expected_salary',
  selfEvaluation: 'self_evaluation',
};

/** parsedData 路径 → 顶层字段（反向映射） */
const PARSED_PATH_TO_FIELD = Object.fromEntries(
  Object.entries(FIELD_TO_PARSED_PATH).map(([field, path]) => [path, field])
);

/**
 * 将顶层字段变更同步回 parsedData
 *
 * @param {Object} originalCandidate - 修改前的完整候选人数据
 * @param {Object} changedFields - 要更新的字段（顶层扁平格式）
 * @returns {Object} 附加了 parsedData 同步的更新数据
 */
export function syncToParsedData(originalCandidate, changedFields) {
  if (!originalCandidate || !changedFields) return { ...changedFields };

  const result = { ...changedFields };
  const existingParsedData = originalCandidate.parsedData || {};

  // 检查是否有需要同步到 parsedData 的字段
  let hasChanges = false;
  const updatedParsedData = JSON.parse(JSON.stringify(existingParsedData));

  for (const [field, value] of Object.entries(changedFields)) {
    const parsedPath = FIELD_TO_PARSED_PATH[field];
    if (parsedPath && value !== undefined) {
      setNestedValue(updatedParsedData, parsedPath, value);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    result.parsedData = updatedParsedData;
  }

  return result;
}

/**
 * 从 parsedData 同步回顶层字段（用于页面初始化时补全缺失的顶层字段）
 *
 * @param {Object} candidate - 候选人数据
 * @returns {Object} 补全了顶层字段的数据副本
 */
export function syncFromParsedData(candidate) {
  if (!candidate || !candidate.parsedData) return candidate;

  const result = { ...candidate };

  for (const [parsedPath, field] of Object.entries(PARSED_PATH_TO_FIELD)) {
    if (!result[field]) {
      const value = getNestedValue(candidate.parsedData, parsedPath);
      if (value) {
        result[field] = value;
      }
    }
  }

  return result;
}

/** 按点分隔路径设置嵌套对象值 */
function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

/** 按点分隔路径获取嵌套对象值 */
function getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
