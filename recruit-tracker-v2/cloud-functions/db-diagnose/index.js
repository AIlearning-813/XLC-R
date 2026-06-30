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

  // ---- 🆕 fix-orphan-demands：修复 linkedJobId 为 null 的招聘需求 ----
  if (action === 'fix-orphan-demands') {
    try {
      // 查找 linkedJobId 为 null/null 且状态为 recruiting/active/pending 的需求
      const { data: demands } = await db.collection('RecruitmentDemand')
        .where({ linkedJobId: null })
        .limit(100)
        .get();

      if (!demands || demands.length === 0) {
        return { success: true, message: '没有需要修复的孤儿需求', fixed: 0 };
      }

      // 只修复非 deleted 状态的
      const orphanDemands = demands.filter(d => d.status !== 'deleted');
      const results = [];
      for (const demand of orphanDemands) {
        try {
          const dept = demand.department || {};
          const deptName = dept.displayName
            || [dept.level1, dept.level2, dept.level3, dept.level4].filter(Boolean).join(' / ')
            || '';

          const jobResult = await db.collection('Job').add({
            title: demand.title,
            type: demand.jobType || 'CC',
            department: deptName,
            headcount: demand.headcount || 1,
            requirements: demand.jobRequirements || '',
            ownerId: demand.ownerId || 'system',
            createdBy: demand.ownerId || 'system',
            status: 'active',
            _version: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          await db.collection('RecruitmentDemand').doc(demand._id).update({
            linkedJobId: jobResult.id,
            updatedAt: new Date(),
          });

          results.push({ demandId: demand._id, title: demand.title, jobId: jobResult.id, status: 'fixed' });
        } catch (e) {
          results.push({ demandId: demand._id, title: demand.title, error: e.message, status: 'failed' });
        }
      }

      const fixed = results.filter(r => r.status === 'fixed').length;
      const failed = results.filter(r => r.status === 'failed').length;
      return {
        success: true,
        message: `已修复 ${fixed} 个需求，${failed} 个失败（共 ${orphanDemands.length} 个孤儿需求，${demands.length} 个 linkedJobId 为 null 的需求中 ${demands.length - orphanDemands.length} 个已删除已跳过）`,
        fixed,
        failed,
        results,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ---- 🆕 fix-candidate-recorder：回填缺失的 createdBy/ownerId ----
  if (action === 'fix-candidate-recorder') {
    try {
      // 查找 createdBy 为空或 null 的候选人（非 deleted）
      const { data: candidates } = await db.collection('Candidate')
        .where({ status: db.command.neq('deleted') })
        .limit(200)
        .get();

      const missing = (candidates || []).filter(c => !c.createdBy && !c.ownerId);
      if (missing.length === 0) {
        return { success: true, message: '所有候选人都有录入人信息，无需修复', fixed: 0 };
      }

      let fixed = 0;
      const results = [];
      for (const c of missing) {
        // 尝试从关联 Application 推断录入人
        let recorder = 'system';
        try {
          const { data: apps } = await db.collection('Application')
            .where({ candidateId: c._id }).limit(1).get();
          if (apps?.[0]?.ownerId) recorder = apps[0].ownerId;
        } catch (_) {}

        try {
          await db.collection('Candidate').doc(c._id).update({
            createdBy: recorder,
            ownerId: c.ownerId || recorder,
            updatedAt: new Date(),
          });
          fixed++;
          results.push({ _id: c._id, name: c.name, recorder, status: 'fixed' });
        } catch (e) {
          results.push({ _id: c._id, name: c.name, error: e.message, status: 'failed' });
        }
      }

      return {
        success: true,
        message: `已修复 ${fixed} 个候选人（共 ${missing.length} 个缺失录入人）`,
        fixed,
        total: missing.length,
        results,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ---- 🆕 import-department-tree：从花名册 JSON 文件导入四级部门树 ----
  if (action === 'import-department-tree') {
    try {
      const fs = require('fs');
      const path = require('path');
      const treeFile = path.join(__dirname, 'dept_tree_clean.json');
      const raw = fs.readFileSync(treeFile, 'utf-8');
      const { departmentTree, departments } = JSON.parse(raw);

      // 同时保留原有扁平 departments 作为兼容
      await db.collection('Config').doc('system').update({
        departmentTree,
        departments,
        updatedAt: new Date(),
      });

      return {
        success: true,
        message: `部门树已从花名册导入：${departmentTree.length} 个一级部门，${departments.length} 个总节点`,
        l1Count: departmentTree.length,
        totalNodes: departments.length,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ---- 🆕 rebuild-tree-from-demands：从 RecruitmentDemand 重建四级部门树 ----
  if (action === 'rebuild-tree-from-demands') {
    try {
      // 拉取所有 RecruitmentDemand（不限状态）
      const all = [];
      let cursor = null;
      let hasMore = true;
      while (hasMore) {
        let query = db.collection('RecruitmentDemand').limit(100);
        if (cursor) query = query.where({ _id: db.command.gt(cursor) });
        const { data } = await query.get();
        if (data && data.length > 0) {
          all.push(...data);
          cursor = data[data.length - 1]._id;
          if (data.length < 100) hasMore = false;
        } else { hasMore = false; }
      }

      // 提取所有不重复的四级路径
      const pathSet = new Set();
      for (const d of all) {
        if (d.department?.level1) {
          const path = [
            d.department.level1,
            d.department.level2 || '',
            d.department.level3 || '',
            d.department.level4 || '',
          ].join('|||'); // 用 ||| 分隔，避免部门名含 / 冲突
          pathSet.add(path);
        }
      }

      if (pathSet.size === 0) {
        return { success: false, message: 'RecruitmentDemand 中没有部门数据' };
      }

      // 构建树：{ name → { children: { name → ... } } }
      const root = {};
      for (const path of pathSet) {
        const parts = path.split('|||').filter(Boolean);
        let current = root;
        for (const part of parts) {
          if (!current[part]) current[part] = {};
          current = current[part];
        }
      }

      // 递归转树节点
      let nodeIdCounter = 0;
      function buildTree(obj, level) {
        return Object.entries(obj).map(([name, children]) => {
          const childObj = buildTree(children, level + 1);
          return {
            id: 'dept_recovered_' + (nodeIdCounter++),
            name,
            level,
            children: childObj.length > 0 ? childObj : [],
          };
        });
      }
      const tree = buildTree(root, 1);

      // 更新 Config
      const flatNames = [];
      function collectNames(nodes) {
        for (const n of nodes) {
          flatNames.push(n.name);
          if (n.children?.length) collectNames(n.children);
        }
      }
      collectNames(tree);

      await db.collection('Config').doc('system').update({
        departmentTree: tree,
        departments: flatNames,
        updatedAt: new Date(),
      });

      return {
        success: true,
        message: `从 ${all.length} 条招聘需求中恢复了 ${pathSet.size} 条不重复部门路径，重建为 ${tree.length} 个一级部门`,
        tree,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

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

  // Candidate 数量 + 字段抽查
  try {
    const { total: candidateTotal } = await db.collection('Candidate').where({ status: 'active' }).count();
    const { total: candidateAll } = await db.collection('Candidate').count();
    const { data: candidateSample } = await db.collection('Candidate').limit(5).get();
    results.Candidate = {
      active: candidateTotal,
      total: candidateAll,
      sample: (candidateSample || []).map(c => ({
        _id: c._id, name: c.name, source: c.source,
        ownerId: c.ownerId, createdBy: c.createdBy, submittedBy: c.submittedBy,
      })),
      // 统计有/无录入人的数量
      withRecorder: (candidateSample || []).filter(c => c.ownerId || c.createdBy).length,
      withoutRecorder: (candidateSample || []).filter(c => !c.ownerId && !c.createdBy).length,
    };
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

  // ===== PendingChanges 审批记录诊断 🆕 =====
  try {
    const { total: pcTotal, data: pcData } = await db.collection('PendingChanges')
      .orderBy('submittedAt', 'desc').limit(20).get();
    results.PendingChanges = {
      total: pcTotal,
      records: (pcData || []).map(c => ({
        _id: c._id,
        type: c.type,
        action: c.action,
        entityType: c.entityType,
        entityId: c.entityId,
        entityLabel: c.entityLabel,
        status: c.status,
        submittedBy: c.submittedBy,
        submittedAt: c.submittedAt,
        reviewedBy: c.reviewedBy,
        reviewedAt: c.reviewedAt,
        reviewComment: c.reviewComment,
      })),
    };
  } catch (err) {
    results.PendingChanges = { error: err.message };
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
