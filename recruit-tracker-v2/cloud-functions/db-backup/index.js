/* 新励成招聘管理系统 V2.0 — 数据库自动备份云函数 */
/* 触发：定时触发器（每日凌晨 3:00） */
/* 超时：300s，内存：512MB */

const cloudbase = require('@cloudbase/node-sdk');

exports.main = async (event, context) => {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
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

  // P2-19：清理 30 天前的旧备份
  let deletedCount = 0;
  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // 列出 backups/ 目录下的所有文件
    const { fileList } = await app.listDirectoryFiles({ prefix: 'backups/' });
    if (fileList && fileList.length > 0) {
      const oldFiles = fileList.filter(f => {
        // 从文件名中提取时间戳（格式：YYYY-MM-DDTHH-mm-ss）
        const match = f.Key?.match(/backups\/(\d{4}-\d{2}-\d{2})/);
        if (!match) return false;
        const fileDate = new Date(match[1]).getTime();
        return fileDate < thirtyDaysAgo;
      });

      if (oldFiles.length > 0) {
        const fileIDs = oldFiles.map(f => f.FileID).filter(Boolean);
        if (fileIDs.length > 0) {
          await app.deleteFile({ fileList: fileIDs });
          deletedCount = fileIDs.length;
        }
      }
    }
  } catch (cleanupErr) {
    console.warn('清理旧备份异常（可忽略，建议在控制台配置生命周期策略）:', cleanupErr.message);
  }

  console.log(`✅ 备份完成: ${backupPath}（${totalDocs} 条文档，清理 ${deletedCount} 个旧备份）`);
  return {
    ok: true,
    path: backupPath,
    totalDocs,
    fileID: upload.fileID,
    timestamp,
    deletedOldBackups: deletedCount,
  };
};
