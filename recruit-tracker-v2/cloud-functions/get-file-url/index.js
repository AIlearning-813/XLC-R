/**
 * get-file-url — 云存储文件下载代理
 *
 * 前端无法直接访问云存储（权限 + CORS），通过云函数下载文件内容并以 base64 返回。
 *
 * 权限模型（2026-09-14 第 3 阶段加固后重写）：
 *   ⚠️ 加固前的实现是：调用方传 callerUsername 与 candidateOwnerId，
 *   函数比对 `caller.username !== candidateOwnerId` 就放行。两个值**都由请求体提供**，
 *   专员把自己名字同时填进两个字段，即可下载存储桶里任意简历——等于没有校验。
 *
 *   现在：调用方只提供 fileId 与 sessionToken。
 *   服务端先校验令牌拿到可信身份，再**按 fileId 反查数据库**得到候选人，
 *   用数据库里的归属判定放行（规则见 access-policy.js）。
 *   请求体里任何自称的归属信息一律不采信。
 *
 * 入参：{ fileId: 'cloud://xxx', sessionToken: '<登录时下发的签名令牌>' }
 * 返回：{ success: true, data: 'base64...', contentType: 'application/pdf', size: 12345 }
 */
const cloudbase = require('@cloudbase/node-sdk');
const { createAccessGuard, guardError } = require('./access-guard');
const { decideFileAccess } = require('./access-policy');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

const SIGNING_KEY = process.env.MASTER_SECRET || '';
if (!SIGNING_KEY) {
  console.error('[get-file-url] 致命配置错误：环境变量 MASTER_SECRET 未配置，所有请求将被拒绝');
}

/** 按用户名回查账号当前状态（守卫生效的前提） */
async function findUser(username) {
  const { data } = await db.collection('Users')
    .where({ username })
    .field({ username: true, role: true, name: true })
    .limit(1)
    .get();
  return data && data[0] ? data[0] : null;
}

/** 密钥缺失时的降级实现：一律拒绝，绝不退回「不校验」 */
const guard = SIGNING_KEY
  ? createAccessGuard({ signingKey: SIGNING_KEY, findUser })
  : {
      requireUser: async () => ({
        ok: false,
        code: 'FORBIDDEN',
        error: '服务配置错误：缺少签名密钥 MASTER_SECRET',
      }),
    };

exports.main = async (event = {}) => {
  const { fileId, sessionToken } = event;
  console.log('[get-file-url] 收到请求, fileId:', fileId);

  if (!fileId || typeof fileId !== 'string') {
    return { success: false, error: '缺少 fileId' };
  }

  // ---- 1. 校验身份（令牌 + 回查数据库，角色以库中为准）----
  const actor = await guard.requireUser(sessionToken);
  if (!actor.ok) {
    console.warn('[get-file-url] 身份校验失败:', actor.error);
    return guardError(actor);
  }

  // ---- 2. 按 fileId 反查候选人，归属取自数据库 ----
  let candidate = null;
  try {
    const { data } = await db.collection('Candidate')
      .where({ fileId })
      .field({ _id: true, ownerId: true, name: true })
      .limit(1)
      .get();
    candidate = data && data[0] ? data[0] : null;
  } catch (err) {
    console.error('[get-file-url] 反查候选人失败:', err.message);
    return { success: false, error: '校验文件归属失败，请稍后重试' };
  }

  // ---- 3. 关联 Application 归属（管理员导入、专员接手的常见流程）----
  let applicationOwnerIds = [];
  if (candidate && actor.role !== 'admin' && candidate.ownerId !== actor.username) {
    try {
      // 直接问「有没有一条我负责的 Application 关联该候选人」，避免 limit 截断漏判
      const { data } = await db.collection('Application')
        .where({ candidateId: candidate._id, ownerId: actor.username })
        .field({ ownerId: true })
        .limit(1)
        .get();
      if (data && data.length > 0) applicationOwnerIds = [actor.username];
    } catch (err) {
      // 失败关闭：查不到关联就按无权限处理
      console.error('[get-file-url] 查询关联 Application 失败:', err.message);
    }
  }

  const decision = decideFileAccess({ actor, candidate, applicationOwnerIds });
  if (!decision.allowed) {
    console.warn(`[get-file-url] 权限拒绝: ${actor.username} (${actor.role}) → ${decision.reason}`);
    return { success: false, error: decision.reason };
  }

  console.log(`[get-file-url] 权限通过: ${actor.username} (${actor.role}) 候选人=${candidate.name || candidate._id}`);

  // ---- 4. 下载并返回 ----
  try {
    const result = await app.downloadFile({ fileID: fileId });

    // 兼容不同版本的 SDK：result 可能是 { fileContent: Buffer } 或直接是 Buffer
    let fileContent = null;
    if (Buffer.isBuffer(result)) {
      fileContent = result;
    } else if (result && result.fileContent) {
      fileContent = result.fileContent;
    }

    if (!fileContent) {
      console.log('[get-file-url] 文件内容为空');
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
    return { success: false, error: errMsg };
  }
};
