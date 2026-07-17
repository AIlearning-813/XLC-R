/**
 * communication.js — 沟通记录服务
 *
 * 封装 CommunicationLog 集合的 CRUD 操作
 */

import cloudbase from './cloudbase';
import { handleError } from './error-handler';

const db = cloudbase.db;

/**
 * 获取候选人的沟通记录
 * @param {string} candidateId
 * @returns {Promise<Array>}
 */
export async function getCommunications(candidateId) {
  if (!candidateId) return [];

  try {
    const result = await db()
      .collection('CommunicationLog')
      .where({ candidateId })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return result.data || [];
  } catch (err) {
    handleError(err, { context: '获取沟通记录', silent: true });
    return [];
  }
}

/**
 * 添加沟通记录
 * @param {Object} data - { candidateId, applicationId?, method, content, operator }
 * @returns {Promise<Object>}
 */
export async function addCommunication(data) {
  if (!data.candidateId || !data.content || !data.method) {
    throw new Error('候选人、沟通方式、沟通内容为必填项');
  }

  const doc = {
    candidateId: data.candidateId,
    applicationId: data.applicationId || null,
    method: data.method,
    content: data.content,
    operator: data.operator || '未知',
    createdAt: new Date(),
  };

  const result = await db().collection('CommunicationLog').add(doc);
  return { ...doc, _id: result.id };
}

/**
 * 删除沟通记录
 * @param {string} id
 */
export async function deleteCommunication(id) {
  await db().collection('CommunicationLog').doc(id).remove();
}
