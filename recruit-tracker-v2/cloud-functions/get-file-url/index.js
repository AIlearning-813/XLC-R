/**
 * get-file-url — 云存储文件临时链接代理
 *
 * 前端拿不到 storage 权限（STORAGE_EXCEED_AUTHORITY）时，
 * 通过云函数（管理员身份）获取临时下载链接。
 *
 * 入参：{ fileId: 'cloud://xxx' }
 * 返回：{ success: true, tempFileURL: 'https://...' }
 */
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

exports.main = async (event) => {
  const { fileId } = event;
  if (!fileId) return { success: false, error: '缺少 fileId' };

  try {
    const result = await app.getTempFileURL({ fileList: [fileId] });
    const fileInfo = result.fileList?.[0];
    if (fileInfo?.tempFileURL) {
      return { success: true, tempFileURL: fileInfo.tempFileURL };
    }
    return { success: false, error: fileInfo?.code || '获取链接失败' };
  } catch (err) {
    return { success: false, error: err.message };
  }
};
