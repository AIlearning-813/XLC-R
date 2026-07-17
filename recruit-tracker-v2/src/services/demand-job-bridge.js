/* 新励成招聘管理系统 V2.0 — Demand→Job 桥接服务
 *
 * 消除 useRecruitmentDemandStore 和 usePendingChangeStore 之间
 * 重复的"先创建 Job，再创建 Demand"逻辑。
 *
 * 使用方式：
 *   import { createJobFromDemand } from '../services/demand-job-bridge';
 *   const jobId = await createJobFromDemand(demandData);
 */

/**
 * 根据招聘需求数据创建关联的 Job
 * @param {Object} demandData - 招聘需求数据
 * @param {string} demandData.title - 需求标题
 * @param {string} [demandData.jobType] - 岗位类型（默认 'CC'）
 * @param {Object} [demandData.department] - 部门信息 { level1, level2, level3, level4, displayName }
 * @param {number} [demandData.headcount=1] - 招聘人数
 * @param {string} [demandData.jobRequirements] - 岗位要求
 * @param {string} demandData.ownerId - 负责人 ID
 * @returns {Promise<string>} jobId
 */
export async function createJobFromDemand(demandData) {
  const { useConfigStore } = await import('../stores/useConfigStore');
  const configStore = useConfigStore();
  await configStore.loadConfig();

  const jobType = demandData.jobType || 'CC';
  const jobTypeConfig = configStore.jobTypes[jobType] || {};

  const dept = demandData.department || {};
  const deptName = dept.displayName
    || [dept.level1, dept.level2, dept.level3, dept.level4].filter(Boolean).join(' / ')
    || '';

  const { useJobStore } = await import('../stores/useJobStore');
  const jobStore = useJobStore();

  const jobResult = await jobStore.add({
    title: demandData.title,
    department: deptName,
    type: jobType,
    headcount: demandData.headcount || 1,
    requirements: jobTypeConfig.requirements || demandData.jobRequirements || '',
    responsibilities: jobTypeConfig.responsibilities || '',
    ownerId: demandData.ownerId,
    createdBy: demandData.ownerId,
    status: 'active',
  });

  return jobResult._id || jobResult.id;
}
