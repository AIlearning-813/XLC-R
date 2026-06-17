/**
 * get-file-url — 云存储文件下载代理
 *
 * 前端无法直接访问云存储（权限 + CORS），通过云函数（管理员身份）
 * 下载文件内容并以 base64 返回，前端转 Blob URL 后用于预览/下载。
 *
 * 入参：{ fileId: 'cloud://xxx' }
 * 返回：{ success: true, data: 'base64...', contentType: 'application/pdf', size: 12345 }
 */
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

exports.main = async (event) => {
  const { fileId } = event;
  if (!fileId) return { success: false, error: '缺少 fileId' };

  try {
    // 直接下载文件内容（管理员权限）
    const result = await app.downloadFile({ fileID: fileId });
    if (!result || !result.fileContent) {
      return { success: false, error: '文件内容为空' };
    }

    const buffer = Buffer.from(result.fileContent);
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB 限制（base64 后约 6.7MB，云函数返回限制 ~6MB）

    if (buffer.length > MAX_SIZE) {
      return { success: false, error: `文件过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），超过 5MB 限制` };
    }

    return {
      success: true,
      data: buffer.toString('base64'),
      contentType: result.mimeType || 'application/octet-stream',
      size: buffer.length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
};
