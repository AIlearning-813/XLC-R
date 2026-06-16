/* 新励成招聘管理系统 V2.0 — 数据库自动备份云函数 */
/* 触发：定时触发器（每日凌晨 3:00） */
/* 超时：300s，内存：512MB */

const cloudbase = require('@cloudbase/node-sdk');

exports.main = async (event, context) => {
  const app = cloudbase.init({ env: process.env.ENV_ID });
  const db = app.database();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = {
    exportedAt: new Date().toISOString(),
    collections: {},
    summary: { totalDocs: 0, totalSize: 0 },
  };

  // 需要备份的集合列表
  const COLLECTIONS = [
    'Users',
    'Job',
    'Candidate',
    'Application',
    'EmailConfig',
    'ParseQueue',
    'ParseNotification',
    'AuditLog',
    'PendingChanges',
    'KnowledgeBase',
    'CompanyProfile',
    'RecruitmentInsight',
    'DuplicateExclusion',
    'ReportCache',
    'ErrorLog',
  ];

  let totalDocs = 0;

  for (const colName of COLLECTIONS) {
    try {
      // 分批读取（CloudBase 单次 limit 最大 1000）
      const allDocs = [];
      let offset = 0;
      const BATCH_SIZE = 1000;

      while (true) {
        const { data } = await db.collection(colName)
          .skip(offset)
          .limit(BATCH_SIZE)
          .get();

        if (data.length === 0) break;
        allDocs.push(...data);
        offset += data.length;

        if (data.length < BATCH_SIZE) break;
      }

      backup.collections[colName] = {
        count: allDocs.length,
        documents: allDocs,
      };
      totalDocs += allDocs.length;
      console.log(`✅ ${colName}: ${allDocs.length} 条`);
    } catch (err) {
      // 集合可能还未创建，跳过
      console.warn(`⚠️ ${colName}: ${err.message}`);
      backup.collections[colName] = { count: 0, documents: [], error: err.message };
    }
  }

  backup.summary.totalDocs = totalDocs;
  backup.summary.totalSize = JSON.stringify(backup).length;

  // 上传到云存储（日期命名）
  const backupPath = `backups/${timestamp}.json`;
  const upload = await app.uploadFile({
    cloudPath: backupPath,
    fileContent: Buffer.from(JSON.stringify(backup, null, 2), 'utf-8'),
  });

  // 清理 30 天前的旧备份
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  try {
    const { fileList } = await app.getTempFileURL({ fileList: [] });
    // 注意：CloudBase 云存储不支持按前缀批量删除，需通过控制台配置生命周期策略
    // 此处仅记录，实际清理建议在 CloudBase 控制台配置：
    //   云存储 → 生命周期 → backups/ 前缀 → 30 天后自动删除
  } catch (cleanupErr) {
    console.warn('清理旧备份异常（可忽略）:', cleanupErr.message);
  }

  console.log(`✅ 备份完成: ${backupPath}（${totalDocs} 条文档）`);
  return {
    ok: true,
    path: backupPath,
    totalDocs,
    fileID: upload.fileID,
    timestamp,
  };
};
