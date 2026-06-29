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

exports.main = async (event) => {
  const action = event?.action || 'diagnose';

  // ---- 🆕 fix-department-tree：修复空 departmentTree ----
  if (action === 'fix-department-tree') {
    try {
      const { data: configData } = await db.collection('Config').doc('system').get();
      const config = (Array.isArray(configData) ? configData[0] : configData) || {};
      if (config.departmentTree && config.departmentTree.length > 0) {
        return { success: true, message: 'departmentTree 已有数据，无需修复', tree: config.departmentTree };
      }
      const depts = config.departments || [];
      if (depts.length === 0) {
        return { success: false, message: 'departments 也为空，无法修复' };
      }
      const tree = depts.map(name => ({
        id: 'dept_' + name.replace(/\s/g, '_'),
        name, level: 1, children: [],
      }));
      await db.collection('Config').doc('system').update({
        departmentTree: tree, updatedAt: new Date(),
      });
      return { success: true, message: `departmentTree 已从 ${depts.length} 个扁平部门重建`, tree };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ---- diagnose ----
  const results = {};
  results.Job_active = await countAndSample('Job', { status: 'active' });
  results.RecruitmentDemand = await countAndSample('RecruitmentDemand', {});

  // Candidate 数量
  try {
    const { total: candidateTotal } = await db.collection('Candidate').where({ status: 'active' }).count();
    const { total: candidateAll } = await db.collection('Candidate').count();
    results.Candidate = { active: candidateTotal, total: candidateAll };
  } catch (err) {
    results.Candidate = { error: err.message };
  }

  // Application 数量
  try {
    const { total: appTotal } = await db.collection('Application').count();
    results.Application = { total: appTotal };
  } catch (err) {
    results.Application = { error: err.message };
  }

  // ===== EmailConfig 邮箱配置诊断 =====
  try {
    const { total: emailTotal, data: emailConfigs } = await db.collection('EmailConfig').limit(20).get();
    results.EmailConfig = {
      total: emailTotal,
      configs: (emailConfigs || []).map(c => ({
        _id: c._id,
        email: c.email,
        userId: c.userId,
        enabled: c.enabled,
        imapHost: c.imapHost,
        failureCount: c.failureCount || 0,
        lastScanAt: c.lastScanAt,
        lastSuccessfulScanAt: c.lastSuccessfulScanAt,
        lastError: c.lastError,
        nextRetryAt: c.nextRetryAt,
      })),
    };
  } catch (err) {
    results.EmailConfig = { error: err.message };
  }

  // ===== ParseQueue 解析队列诊断 =====
  try {
    const { total: pqTotal, data: pqData } = await db.collection('ParseQueue').limit(5).get();
    results.ParseQueue = {
      total: pqTotal,
      sample: (pqData || []).map(e => ({
        _id: e._id,
        status: e.status,
        source: e.source,
        sourceEmailFrom: e.sourceEmailFrom,
        sourceEmailSubject: e.sourceEmailSubject,
        fileName: e.fileName,
        createdAt: e.createdAt,
      })),
    };
    // 统计各状态数量
    const { total: pendingCount } = await db.collection('ParseQueue').where({ status: 'pending' }).count();
    const { total: processingCount } = await db.collection('ParseQueue').where({ status: 'processing' }).count();
    const { total: doneCount } = await db.collection('ParseQueue').where({ status: 'done' }).count();
    results.ParseQueue.byStatus = { pending: pendingCount, processing: processingCount, done: doneCount };
  } catch (err) {
    results.ParseQueue = { error: err.message };
  }

  // ===== Config 诊断 🆕 =====
  try {
    const { data: configData } = await db.collection('Config').doc('system').get();
    const sysConfig = (Array.isArray(configData) ? configData[0] : configData) || {};
    results.Config = {
      exists: !!sysConfig,
      departmentTreeCount: sysConfig.departmentTree?.length || 0,
      departmentTree: sysConfig.departmentTree || [],
      departmentsCount: sysConfig.departments?.length || 0,
      departments: sysConfig.departments || [],
      citiesCount: sysConfig.cities?.length || 0,
      cities: sysConfig.cities || [],
      jobTypesCount: sysConfig.jobTypes ? Object.keys(sysConfig.jobTypes).length : 0,
      recruitmentSourcesCount: sysConfig.recruitmentSources?.length || 0,
      updatedAt: sysConfig.updatedAt || null,
    };
  } catch (err) {
    results.Config = { error: err.message };
  }

  return { success: true, results };
};
