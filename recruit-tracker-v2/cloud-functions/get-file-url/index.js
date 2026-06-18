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
  console.log('[get-file-url] 收到请求, fileId:', fileId);

  if (!fileId) {
    console.log('[get-file-url] 缺少 fileId');
    return { success: false, error: '缺少 fileId' };
  }

  try {
    console.log('[get-file-url] 开始下载文件...');
    const result = await app.downloadFile({ fileID: fileId });
    console.log('[get-file-url] downloadFile 返回类型:', typeof result);
    console.log('[get-file-url] downloadFile 返回 keys:', result ? Object.keys(result) : 'null/undefined');

    // 兼容不同版本的 SDK：result 可能是 { fileContent: Buffer } 或直接是 Buffer
    let fileContent = null;
    if (Buffer.isBuffer(result)) {
      fileContent = result;
    } else if (result && result.fileContent) {
      fileContent = result.fileContent;
    }

    if (!fileContent) {
      console.log('[get-file-url] 文件内容为空, result:', JSON.stringify(Object.keys(result || {})));
      return { success: false, error: '文件内容为空' };
    }

    const buffer = Buffer.from(fileContent);
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB 限制

    if (buffer.length > MAX_SIZE) {
      const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
      console.log('[get-file-url] 文件过大:', sizeMB + 'MB');
      return { success: false, error: `文件过大（${sizeMB}兆），超过 5兆 限制` };
    }

    const mimeType = (result && result.mimeType) || 'application/octet-stream';
    console.log('[get-file-url] 成功, 大小:', buffer.length, '类型:', mimeType);

    return {
      success: true,
      data: buffer.toString('base64'),
      contentType: mimeType,
      size: buffer.length,
    };
  } catch (err) {
    const errMsg = err ? (err.message || err.code || String(err)) : '未知错误';
    console.error('[get-file-url] 下载失败:', errMsg);
    console.error('[get-file-url] 错误详情:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    return { success: false, error: errMsg };
  }
};
