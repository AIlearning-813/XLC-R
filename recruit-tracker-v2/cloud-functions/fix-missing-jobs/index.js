/**
 * fix-missing-jobs — 一次性修复云函数：为 linkedJobId 为 null 的 demand 补建 Job
 */
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

exports.main = async () => {
  const results = [];

  // 查找所有 linkedJobId 为 null 的 recruiting 需求
  const { data: demands } = await db.collection('RecruitmentDemand')
    .where({ status: 'recruiting' })
    .get();

  for (const demand of (demands || [])) {
    if (demand.linkedJobId) {
      results.push({ title: demand.title, status: 'skip', reason: '已有 linkedJobId' });
      continue;
    }

    try {
      const jobDoc = {
        title: demand.title,
        type: demand.jobType || 'CC',
        department: demand.department?.displayName || '',
        headcount: demand.headcount || 1,
        requirements: demand.jobRequirements || '',
        ownerId: demand.ownerId || 'system',
        createdBy: demand.ownerId || 'system',
        status: 'active',
        _version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const jobResult = await db.collection('Job').add(jobDoc);
      await db.collection('RecruitmentDemand').doc(demand._id).update({
        linkedJobId: jobResult.id,
        updatedAt: new Date(),
      });

      results.push({ title: demand.title, status: 'fixed', jobId: jobResult.id });
    } catch (err) {
      results.push({ title: demand.title, status: 'error', error: err.message });
    }
  }

  return { success: true, fixed: results };
};
