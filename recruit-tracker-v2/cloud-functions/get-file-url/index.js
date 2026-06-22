/**
 * get-file-url — 云存储文件下载代理
 *
 * 前端无法直接访问云存储（权限 + CORS），通过云函数下载文件内容并以 base64 返回。
 *
 * ⚠️ P0-2 修复：增加权限校验
 *   - 必须传入 callerUsername（由 auth-proxy 验证过的账号名）
 *   - 非管理员只能下载自己的文件（fileId 路径中包含自己的 username）
 *   - 管理员可下载所有文件
 *
 * 入参：{ fileId: 'cloud://xxx', callerUsername: 'admin' }
 * 返回：{ success: true, data: 'base64...', contentType: 'application/pdf', size: 12345 }
 */
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

/** 验证调用者身份，返回 { valid, isAdmin, username } */
async function verifyCaller(callerUsername) {
  if (!callerUsername) {
    return { valid: false, isAdmin: false, username: '', reason: '缺少调用者身份信息' };
  }
  try {
    const { data } = await db.collection('Users')
      .where({ username: callerUsername.trim() })
      .field({ username: true, role: true })
      .limit(1)
      .get();
    if (!data || data.length === 0) {
      return { valid: false, isAdmin: false, username: '', reason: '调用者账号不存在' };
    }
    return { valid: true, isAdmin: data[0].role === 'admin', username: data[0].username };
  } catch (err) {
    console.error('[get-file-url] 校验调用者失败:', err.message);
    return { valid: false, isAdmin: false, username: '', reason: '身份校验异常' };
  }
}

/** 检查 fileId 路径是否属于指定用户（CloudBase 文件路径通常为 cloud://envId/resumes/username/...） */
function fileBelongsToUser(fileId, username) {
  if (!fileId || !username) return false;
  // fileId 格式: cloud://envId.bucket/path/to/file
  const parts = fileId.split('/');
  // 跳过协议和 bucket（前 3 段），检查后续路径
  const pathParts = parts.slice(3);
  // 如果路径包含 resumes/{username} 则认为属于该用户
  return pathParts.some((part, i) =>
    part === username || (pathParts[i - 1] === 'resumes' && part === username)
  ) || fileId.includes(`/resumes/${username}/`) || fileId.includes(`/${username}/`);
}

exports.main = async (event) => {
  const { fileId, callerUsername } = event;
  console.log('[get-file-url] 收到请求, fileId:', fileId, 'caller:', callerUsername);

  if (!fileId) {
    console.log('[get-file-url] 缺少 fileId');
    return { success: false, error: '缺少 fileId' };
  }

  // ===== P0-2 修复：权限校验 =====
  const caller = await verifyCaller(callerUsername);
  if (!caller.valid) {
    console.log('[get-file-url] 身份校验失败:', caller.reason);
    return { success: false, error: caller.reason };
  }

  // 非管理员只能访问自己的文件
  if (!caller.isAdmin && !fileBelongsToUser(fileId, caller.username)) {
    console.log(`[get-file-url] 权限拒绝: ${caller.username} 试图访问不属于自己的文件`);
    return { success: false, error: '无权访问该文件' };
  }

  console.log(`[get-file-url] 权限通过: ${caller.username} (${caller.isAdmin ? 'admin' : 'recruiter'})`);

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
