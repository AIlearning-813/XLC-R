/**
 * parse-queue-processor — ParseQueue 消费云函数（完整实现）
 *
 * 职责：
 *   1. 查询 ParseQueue 中 status: "pending" 或 "retry" 的条目（FIFO，每次最多 20 条）
 *   2. 逐条：下载文件 → format-router 提取文本 → 调 resume-parser-proxy 解析
 *   3. 创建 Candidate + Application 记录
 *   4. 创建 ParseNotification 通知专员
 *   5. 失败处理：指数退避重试 / 标记 failed
 *   6. 超时保护：剩余 < 30s 时停止取新条目
 *
 * 触发方式：定时触发器（每 5 分钟）
 */

const cloudbase = require('@cloudbase/node-sdk');
const { route: extractText } = require('./format-router');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const storage = app.storage();

// 配置
const BATCH_SIZE = 20;
const MAX_RETRY_COUNT = 3;
const TIMEOUT_BUFFER_MS = 30000;     // 剩余 30 秒时停止
const FUNCTION_TIMEOUT_MS = 180000;   // 云函数总超时 180 秒

// 指数退避时间表（分钟）
const RETRY_BACKOFF_MINUTES = [5, 10, 20];

exports.main = async (event, context) => {
  const startTime = Date.now();
  const summary = {
    processed: 0,
    done: 0,
    failed: 0,
    retried: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
  };

  console.log('[parse-queue-processor] 开始消费循环');

  try {
    // 查询待处理条目（FIFO：pending + 到期的 retry）
    const now = new Date();
    const pendingResult = await db
      .collection('ParseQueue')
      .where({
        status: db.command.in(['pending', 'retry']),
      })
      .orderBy('createdAt', 'asc')
      .limit(BATCH_SIZE)
      .get();

    const entries = pendingResult.data || [];
    console.log(`[parse-queue-processor] 获取到 ${entries.length} 条待处理条目`);

    if (entries.length === 0) {
      return { success: true, summary: { ...summary, message: '无待处理条目' } };
    }

    // 逐条处理
    for (const entry of entries) {
      // 超时保护
      if (Date.now() - startTime > FUNCTION_TIMEOUT_MS - TIMEOUT_BUFFER_MS) {
        console.log('[parse-queue-processor] 剩余时间不足，停止处理，剩余条目下轮继续');
        summary.errors.push('超时保护触发');
        break;
      }

      // 跳过 retry 但未到重试时间的条目
      if (entry.status === 'retry' && entry.nextRetryAt) {
        if (new Date(entry.nextRetryAt) > now) {
          summary.skipped++;
          continue;
        }
      }

      try {
        await processOneEntry(db, storage, entry, summary);
      } catch (err) {
        console.error(`[parse-queue-processor] 处理条目 ${entry._id} 异常:`, err.message);
        summary.errors.push(`${entry._id}: ${err.message}`);
        await markEntryFailed(db, entry, `未预期的处理异常：${err.message}`);
      }
    }

    console.log('[parse-queue-processor] 消费完成:', JSON.stringify(summary));
    return { success: true, summary };
  } catch (err) {
    console.error('[parse-queue-processor] 全局异常:', err.message);
    return { success: false, error: err.message, summary };
  }
};

/**
 * 处理单个 ParseQueue 条目
 */
async function processOneEntry(db, storage, entry, summary) {
  summary.processed++;

  // 检查重试次数
  if (entry.retryCount >= MAX_RETRY_COUNT) {
    await markEntryFailed(db, entry, '重试次数已达上限');
    summary.failed++;
    return;
  }

  // 标记为处理中
  await db.collection('ParseQueue').doc(entry._id).update({
    status: 'parsing',
    parseStartedAt: new Date(),
  });

  // 步骤 1：获取文本内容
  let resumeText = entry.preExtractedText || '';

  if (!resumeText) {
    // 从云存储下载文件并提取文本
    try {
      if (entry.fileId) {
        const downloadResult = await storage.downloadFile({ fileID: entry.fileId });
        const fileBuffer = Buffer.from(downloadResult.fileContent);

        const extractResult = await extractText(
          fileBuffer,
          entry.fileName || 'resume',
          entry.mimeType || 'application/octet-stream'
        );
        resumeText = extractResult.text;
      } else {
        throw new Error('没有可提取的文件（fileId 和 preExtractedText 均为空）');
      }
    } catch (extractErr) {
      // 文本提取失败 → 判断是否可重试
      if (isRetryableError(extractErr)) {
        await scheduleRetry(db, entry, extractErr.message);
        summary.retried++;
      } else {
        await markEntryFailed(db, entry, `文本提取失败：${extractErr.message}`);
        summary.failed++;
      }
      return;
    }
  }

  if (!resumeText || resumeText.trim().length < 10) {
    await markEntryFailed(db, entry, '文本内容过短，无法解析');
    summary.failed++;
    return;
  }

  // 步骤 2：调用 resume-parser-proxy 进行 AI 解析
  let parseResult;
  try {
    parseResult = await app.callFunction({
      name: 'resume-parser-proxy',
      data: { resumeText },
    });
  } catch (parseErr) {
    if (isRetryableError(parseErr)) {
      await scheduleRetry(db, entry, `AI 解析失败：${parseErr.message}`);
      summary.retried++;
    } else {
      await markEntryFailed(db, entry, `AI 解析失败：${parseErr.message}`);
      summary.failed++;
    }
    return;
  }

  // 检查解析结果
  const parseData = parseResult.result;
  if (!parseData || !parseData.success) {
    const errMsg = parseData?.error || '未知解析错误';
    await scheduleRetry(db, entry, errMsg);
    summary.retried++;
    return;
  }

  // 步骤 3：创建 Candidate + Application
  try {
    const candidateData = parseData.data || {};
    const basicInfo = candidateData.basic_info || {};

    // 重复检测（候选人级：phone + email）
    const existingCandidate = await checkCandidateDuplicate(db, basicInfo);
    if (existingCandidate) {
      await db.collection('ParseQueue').doc(entry._id).update({
        status: 'done',
        parsedCandidateId: existingCandidate._id,
        processedAt: new Date(),
        note: '候选人已存在，合并至已有记录',
        duplicateCandidateId: existingCandidate._id,
      });

      // 仍然创建通知
      await createNotification(db, {
        userId: entry.userId,
        type: 'parse_duplicate',
        candidateId: existingCandidate._id,
        candidateName: existingCandidate.name || basicInfo.name || '未知',
        parseQueueId: entry._id,
        detail: {
          source: entry.sourceEmailFrom || '邮件',
          fileName: entry.fileName,
          duplicateReason: '手机号或邮箱与已有候选人匹配',
        },
      });

      summary.duplicates++;
      return;
    }

    // 创建 Candidate
    const candidateDoc = {
      name: basicInfo.name || '',
      phone: basicInfo.phone || '',
      email: basicInfo.email || '',
      parsedData: candidateData,
      source: entry.source || 'email',
      fileHash: entry.fileHash || '',
      fileId: entry.fileId || '',
      fileName: entry.fileName || '',
      createdBy: entry.userId || 'system',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const candidateResult = await db.collection('Candidate').add(candidateDoc);
    const candidateId = candidateResult.id;

    // 创建 Application（自动分配岗位或留待专员分配）
    const applicationDoc = {
      candidateId,
      jobId: '', // 邮件解析的简历由专员后续分配岗位
      stage: 'resume',
      stageEnteredAt: new Date(),
      status: 'active',
      funnel: { resumeAt: new Date() },
      funnelMeta: { entrySource: 'email', anchorDate: entry.sourceEmailDate || new Date() },
      source: 'email',
      ownerId: entry.userId || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('Application').add(applicationDoc);

    // 更新 ParseQueue 状态
    await db.collection('ParseQueue').doc(entry._id).update({
      status: 'done',
      parsedCandidateId: candidateId,
      processedAt: new Date(),
    });

    // 创建成功通知
    await createNotification(db, {
      userId: entry.userId,
      type: 'parse_success',
      candidateId,
      candidateName: basicInfo.name || '未知名',
      parseQueueId: entry._id,
      detail: {
        source: entry.sourceEmailFrom || '邮件',
        fileName: entry.fileName,
        emailSubject: entry.sourceEmailSubject || '',
        parsedFields: Object.keys(basicInfo).filter((k) => basicInfo[k]),
      },
    });

    // 写入审计日志（通过云函数确保权限）
    try {
      await app.callFunction({
        name: 'write-audit-log',
        data: {
          action: 'candidate_created',
          entityType: 'Candidate',
          entityIds: [candidateId],
          detail: {
            source: 'email',
            fileName: entry.fileName,
            emailFrom: entry.sourceEmailFrom,
          },
          operator: 'parse-queue-processor',
        },
      });
    } catch (auditErr) {
      console.warn('[parse-queue-processor] AuditLog 写入失败:', auditErr.message);
    }

    summary.done++;
  } catch (createErr) {
    console.error('[parse-queue-processor] 创建 Candidate 失败:', createErr.message);
    await scheduleRetry(db, entry, `创建记录失败：${createErr.message}`);
    summary.retried++;
  }
}

/**
 * 检查候选人级重复（phone + email）
 */
async function checkCandidateDuplicate(db, basicInfo) {
  const { phone, email } = basicInfo;

  if (!phone && !email) return null;

  const conditions = [];
  if (phone) conditions.push({ phone });
  if (email) conditions.push({ email });

  if (conditions.length === 0) return null;

  try {
    const result = await db
      .collection('Candidate')
      .where(db.command.or(conditions))
      .limit(1)
      .get();

    return result.data?.[0] || null;
  } catch (err) {
    console.warn('[parse-queue-processor] 重复检测失败:', err.message);
    return null;
  }
}

/**
 * 创建 ParseNotification
 */
async function createNotification(db, data) {
  try {
    await db.collection('ParseNotification').add({
      userId: data.userId,
      type: data.type,
      candidateId: data.candidateId || '',
      candidateName: data.candidateName || '',
      parseQueueId: data.parseQueueId || '',
      title: buildNotificationTitle(data),
      detail: data.detail || {},
      status: 'unread',
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('[parse-queue-processor] 通知创建失败:', err.message);
  }
}

/**
 * 构建通知标题
 */
function buildNotificationTitle(data) {
  switch (data.type) {
    case 'parse_success':
      return `新简历解析成功：${data.candidateName}`;
    case 'parse_failed':
      return `简历解析失败：${data.detail?.fileName || '未知文件'}`;
    case 'parse_duplicate':
      return `检测到重复简历：${data.candidateName}`;
    default:
      return '简历处理通知';
  }
}

/**
 * 安排重试（指数退避）
 */
async function scheduleRetry(db, entry, errorMsg) {
  const retryCount = (entry.retryCount || 0) + 1;

  if (retryCount >= MAX_RETRY_COUNT) {
    await markEntryFailed(db, entry, `重试次数已达上限（${MAX_RETRY_COUNT}次）：${errorMsg}`);
    return;
  }

  const backoffIndex = Math.min(retryCount - 1, RETRY_BACKOFF_MINUTES.length - 1);
  const backoffMs = RETRY_BACKOFF_MINUTES[backoffIndex] * 60 * 1000;
  const nextRetryAt = new Date(Date.now() + backoffMs);

  await db.collection('ParseQueue').doc(entry._id).update({
    status: 'retry',
    retryCount,
    nextRetryAt,
    lastError: errorMsg,
  });
}

/**
 * 标记为永久失败
 */
async function markEntryFailed(db, entry, reason) {
  await db.collection('ParseQueue').doc(entry._id).update({
    status: 'failed',
    failReason: reason,
    processedAt: new Date(),
  });

  // 创建失败通知
  if (entry.userId) {
    await createNotification(db, {
      userId: entry.userId,
      type: 'parse_failed',
      candidateId: '',
      candidateName: '',
      parseQueueId: entry._id,
      detail: {
        fileName: entry.fileName,
        failReason: reason,
        source: entry.sourceEmailFrom || '',
      },
    });
  }
}

/**
 * 判断错误是否可重试
 * 可重试：超时、临时网络错误、API 速率限制
 * 不可重试：格式不支持、文件损坏、数据校验失败
 */
function isRetryableError(err) {
  const message = (err.message || '').toLowerCase();

  // 不可重试的关键词
  const nonRetryable = [
    '不支持的文件格式',
    '文件内容为空',
    '文件损坏',
    '文本内容过短',
    '未找到可提取的内容',
    '图片过大',
  ];

  return !nonRetryable.some((keyword) => message.includes(keyword));
}
