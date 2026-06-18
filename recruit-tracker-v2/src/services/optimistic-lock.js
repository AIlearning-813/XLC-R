/* 新励成招聘管理系统 V2.0 — 乐观锁服务
 *
 * 使用 _version 字段实现乐观并发控制（Optimistic Concurrency Control）。
 * 每次更新时检查版本号匹配 → 不匹配则说明已被其他人修改 → 抛出冲突错误。
 *
 * 使用方式：
 *   import { versionedUpdate } from '../services/optimistic-lock';
 *   await versionedUpdate('Candidate', candidateId, candidate._version, { name: '新名字' });
 */

import cloudbase from './cloudbase';

/**
 * 版本冲突错误
 */
export class VersionConflictError extends Error {
  constructor(collection, docId, expectedVersion, actualVersion) {
    super(
      `数据已被他人修改（集合: ${collection}, 文档: ${docId}, ` +
      `期望版本: ${expectedVersion}, 实际版本: ${actualVersion || '未知'}）。` +
      `请刷新页面后重试。`
    );
    this.name = 'VersionConflictError';
    this.collection = collection;
    this.docId = docId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * 带版本检查的文档更新
 *
 * 流程：
 *   1. 先读取文档当前 _version
 *   2. 比较是否与调用方持有的 expectedVersion 一致
 *   3. 一致 → 执行更新，_version+1
 *   4. 不一致 → 抛出 VersionConflictError
 *
 * @param {string} collectionName - 集合名称
 * @param {string} docId - 文档 ID
 * @param {number} expectedVersion - 调用方持有的版本号
 * @param {Object} updateData - 要更新的字段（不包含 _version 和 updatedAt，自动处理）
 * @returns {Promise<number>} 新版本号
 */
export async function versionedUpdate(collectionName, docId, expectedVersion, updateData) {
  const db = cloudbase.db();
  if (!db) throw new Error('数据库未初始化');

  if (docId === undefined || docId === null) {
    throw new Error('文档 ID 不能为空');
  }

  if (typeof expectedVersion !== 'number') {
    throw new Error(`版本号必须是数字，收到: ${typeof expectedVersion}`);
  }

  // 1. 读取当前文档（只取 _version 字段，减少带宽）
  let currentDoc;
  try {
    const result = await db.collection(collectionName).doc(docId).get();
    currentDoc = result.data?.[0] || null;
  } catch (err) {
    throw new Error(`读取文档失败 (${collectionName}/${docId}): ${err.message}`);
  }

  if (!currentDoc) {
    throw new Error(`文档不存在 (${collectionName}/${docId})，可能已被删除`);
  }

  const currentVersion = currentDoc._version;

  // CloudBase 的 _version 字段可能不存在于旧数据中，做兼容处理
  const actualVersion = typeof currentVersion === 'number' ? currentVersion : 0;

  // 2. 版本对比
  if (expectedVersion !== actualVersion) {
    throw new VersionConflictError(collectionName, docId, expectedVersion, actualVersion);
  }

  // 3. 执行更新
  const newVersion = actualVersion + 1;
  try {
    await db.collection(collectionName).doc(docId).update({
      ...updateData,
      _version: newVersion,
      updatedAt: new Date(),
    });
  } catch (err) {
    throw new Error(`更新文档失败 (${collectionName}/${docId}): ${err.message}`);
  }

  return newVersion;
}

/**
 * 带版本检查的批量更新（逐个执行）
 *
 * @param {Array<{ collection: string, docId: string, expectedVersion: number, data: Object }>} operations
 * @returns {Promise<Array<{ docId: string, newVersion: number }>>}
 */
export async function versionedBatchUpdate(operations) {
  const results = [];
  const errors = [];

  for (const op of operations) {
    try {
      const newVersion = await versionedUpdate(op.collection, op.docId, op.expectedVersion, op.data);
      results.push({ docId: op.docId, newVersion });
    } catch (err) {
      errors.push({ docId: op.docId, error: err });
    }
  }

  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `${e.docId}: ${e.error.message}`).join('; ');
    throw new Error(`批量更新部分失败: ${errorMessages}`);
  }

  return results;
}

/**
 * 为新文档创建初始版本号
 * @returns {number} 0
 */
export function initialVersion() {
  return 0;
}

/**
 * 检查错误是否为版本冲突
 * @param {Error} err
 * @returns {boolean}
 */
export function isVersionConflict(err) {
  return err instanceof VersionConflictError || err?.name === 'VersionConflictError';
}

/**
 * 获取版本冲突的用户友好提示
 * @param {Error} err
 * @returns {string}
 */
export function conflictMessage(err) {
  if (isVersionConflict(err)) {
    return '数据已被其他用户修改，请刷新页面获取最新数据后再操作。';
  }
  return null;
}
