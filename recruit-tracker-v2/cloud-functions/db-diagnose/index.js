/**
 * db-diagnose — 一次性诊断云函数，查看各集合数据状态
 */
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

async function countAndSample(colName, filter = {}, limit = 5) {
  try {
    const { total } = await db.collection(colName).where(filter).count();
    const { data } = await db.collection(colName).where(filter).limit(limit).get();
    return { total, sample: (data || []).map(d => ({
      _id: d._id, title: d.title || d.name, status: d.status,
      linkedJobId: d.linkedJobId, jobType: d.jobType, type: d.type,
      department: d.department, ownerId: d.ownerId,
      submittedBy: d.submittedBy, entityLabel: d.entityLabel
    })) };
  } catch (err) {
    return { error: err.message };
  }
}

exports.main = async () => {
  const results = {};

  results.Job_active = await countAndSample('Job', { status: 'active' });
  results.Job_all = await countAndSample('Job', {});
  results.RecruitmentDemand = await countAndSample('RecruitmentDemand', {});
  results.PendingChanges = await countAndSample('PendingChanges', {});

  return { success: true, results };
};
