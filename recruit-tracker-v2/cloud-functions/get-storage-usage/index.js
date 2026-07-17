/**
 * get-storage-usage — 云存储用量统计云函数
 *
 * 扫描云存储各目录，汇总文件数量和总大小。
 * 前端通过 callFunction('get-storage-usage') 调用。
 */
const cloudbase = require('@cloudbase/node-sdk');

// 要扫描的目录前缀列表（空字符串表示根目录）
const SCAN_PREFIXES = [
  { prefix: 'email-attachments/', label: '邮箱附件（简历）' },
  { prefix: 'backups/', label: '数据库备份' },
  { prefix: 'resumes/', label: '简历文件' },
];

/** 将字节数转换为人类可读格式 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/** 递归列出指定目录下所有文件 */
async function listAllFiles(app, prefix, maxKeys = 200) {
  const allFiles = [];
  let marker = null;

  do {
    try {
      const params = { prefix, maxKeys };
      if (marker) params.marker = marker;

      const result = await app.listDirectoryFiles(params);
      const fileList = result.fileList || [];

      if (fileList.length === 0) break;

      for (const f of fileList) {
        allFiles.push({
          key: f.Key || '',
          fileId: f.FileID || '',
          size: f.Size || 0,
        });
      }

      // 检查是否还有更多结果
      marker = result.nextMarker || (result.isTruncated ? fileList[fileList.length - 1]?.Key : null);
      if (fileList.length < maxKeys) break;
    } catch (err) {
      console.warn(`[get-storage-usage] 列出前缀 "${prefix}" 失败:`, err.message);
      break;
    }
  } while (marker);

  return allFiles;
}

exports.main = async (event, context) => {
  try {
    const app = cloudbase.init({
      env: context?.envId || event?.envId || process.env.TCB_ENV_ID,
    });

    const breakdown = [];
    let totalFiles = 0;
    let totalSize = 0;
    const allKeys = new Set();

    for (const { prefix, label } of SCAN_PREFIXES) {
      const files = await listAllFiles(app, prefix);

      const count = files.length;
      const size = files.reduce((sum, f) => sum + (f.size || 0), 0);

      // 记录全局去重（同一文件不应出现在多个前缀中，但以防万一）
      for (const f of files) {
        if (!allKeys.has(f.key)) {
          allKeys.add(f.key);
          totalFiles++;
          totalSize += f.size || 0;
        }
      }

      breakdown.push({
        prefix,
        label,
        count,
        size,
        sizeFormatted: formatSize(size),
      });
    }

    return {
      ok: true,
      totalFiles,
      totalSize,
      totalSizeFormatted: formatSize(totalSize),
      // 19.9元/月 个人版：3GB 存储配额
      quotaBytes: 3 * 1024 * 1024 * 1024,
      quotaFormatted: '3 GB',
      usagePercent: totalSize > 0 ? ((totalSize / (3 * 1024 * 1024 * 1024)) * 100).toFixed(1) : '0.0',
      breakdown,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[get-storage-usage] 执行失败:', err);
    return {
      ok: false,
      error: err.message || '获取存储用量失败',
    };
  }
};
