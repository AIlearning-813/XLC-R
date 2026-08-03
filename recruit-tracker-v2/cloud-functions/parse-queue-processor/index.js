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
 * 触发方式：定时触发器（每 30 分钟兜底；主链路为 email-scanner 扫描到简历后链式触发）
 */

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');

// P0-2 修复：升级为 HMAC-SHA256，使用专用 HMAC 密钥防止彩虹表攻击
// 旧 SHA-256 无盐哈希可被彩虹表快速反查（手机号 ~10^11、邮箱常见模式有限）
// HMAC-SHA256(key, value) 即使攻击者知道 value，没有 key 也无法计算哈希
function computeHash(value) {
  if (!value || typeof value !== 'string') return '';
  const hmacKey = process.env.DEDUP_HMAC_KEY || process.env.MASTER_SECRET || '';
  if (!hmacKey) {
    console.warn('[parse-queue-processor] ⚠️ DEDUP_HMAC_KEY 未配置，回退到 SHA-256（不安全）');
    return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  }
  return crypto.createHmac('sha256', hmacKey).update(value.trim().toLowerCase()).digest('hex');
}

// format-router 可能因依赖问题加载失败，用 try-catch 保护
let extractText = null;
try {
  extractText = require('./format-router').route;
  console.log('[parse-queue-processor] ✅ format-router 加载成功');
} catch (err) {
  console.warn('[parse-queue-processor] ⚠️ format-router 加载失败，将依赖 preExtractedText:', err.message);
}

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
// app.storage() 在 SDK v3.x 中不可用，直接使用 app.downloadFile()

// 配置
const BATCH_SIZE = 20;
const MAX_RETRY_COUNT = 3;
const TIMEOUT_BUFFER_MS = 30000;     // 剩余 30 秒时停止
const FUNCTION_TIMEOUT_MS = 180000;   // 云函数总超时 180 秒
const LOCK_TTL_MS = 300000;           // 分布式锁 TTL（5 分钟，超过此时间自动释放）

// 指数退避时间表（分钟）
const RETRY_BACKOFF_MINUTES = [5, 10, 20];

/**
 * 获取分布式锁（P0-6 并发安全修复 + P1-8 加固）
 *
 * 加固措施：
 *   1. 使用 lockType 字段区分不同锁（避免与其他业务锁冲突）
 *   2. 先清理过期锁再检查活跃锁，缩小竞态窗口
 *   3. 每个实例生成唯一 instanceId，便于排查锁归属
 *   4. 降级模式更保守：其他错误不持锁执行（告警但放行）
 *
 * @returns {Promise<{ acquired: boolean, lockId?: string }>}
 */
async function acquireLock(db) {
  const LOCK_TYPE = 'parse_queue_processor';
  const instanceId = `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();

  try {
    // P1-8：先原子清理所有过期锁，减少 check-then-act 窗口
    try {
      const removed = await db
        .collection('ProcessingLock')
        .where({
          lockKey: LOCK_TYPE,
          expiresAt: db.command.lt(now),
        })
        .remove();
      if (removed && removed.deleted > 0) {
        console.log(`[parse-queue-processor] 清理了 ${removed.deleted} 个过期锁`);
      }
    } catch (cleanErr) {
      console.warn('[parse-queue-processor] 清理过期锁失败:', cleanErr.message);
    }

    // 检查是否有活跃锁
    const { data: activeLocks } = await db
      .collection('ProcessingLock')
      .where({
        lockKey: LOCK_TYPE,
        expiresAt: db.command.gt(now),
      })
      .limit(1)
      .get();

    if (activeLocks && activeLocks.length > 0) {
      const lock = activeLocks[0];
      const lockAge = now.getTime() - new Date(lock.createdAt).getTime();
      console.log(`[parse-queue-processor] 检测到活跃锁（${Math.round(lockAge / 1000)}s 前创建，实例: ${lock.instanceId || 'unknown'}），跳过本次执行`);
      return { acquired: false };
    }

    // 创建新锁（竞态窗口 ~5ms，CloudBase 集合唯一索引可彻底消除）
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    const lockResult = await db.collection('ProcessingLock').add({
      lockKey: LOCK_TYPE,      // P1-8：区分锁类型
      instanceId,               // P1-8：唯一实例标识
      createdAt: now,
      expiresAt,
    });

    console.log(`[parse-queue-processor] ✅ 分布式锁获取成功 (实例: ${instanceId})`);
    return { acquired: true, lockId: lockResult.id, instanceId };
  } catch (err) {
    if (err.code === 'DUPLICATE_KEY' || err.message?.includes('duplicate')) {
      console.log('[parse-queue-processor] 锁已被其他实例获取，跳过本次执行');
      return { acquired: false };
    }
    // P1-8：其他错误降级执行（无锁），避免锁服务故障阻塞管道
    console.warn('[parse-queue-processor] 锁获取异常，降级执行（无锁保护）:', err.message);
    return { acquired: true, lockId: null, degraded: true, instanceId };
  }
}

/**
 * 释放分布式锁
 */
async function releaseLock(db, lockId) {
  if (!lockId) return;
  try {
    await db.collection('ProcessingLock').doc(lockId).remove();
    console.log('[parse-queue-processor] 🔓 分布式锁已释放');
  } catch (err) {
    console.warn('[parse-queue-processor] 释放锁失败:', err.message);
  }
}

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

  // P0-6：获取分布式锁，防止多实例并发消费同一队列
  const lock = await acquireLock(db);
  if (!lock.acquired) {
    return { success: true, summary: { ...summary, message: '锁被占用，跳过本次执行（并发保护）' } };
  }

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
        await processOneEntry(db, entry, summary);
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
  } finally {
    // P0-6：无论成功或失败，都释放分布式锁
    await releaseLock(db, lock.lockId);
  }
};

/**
 * 校验候选人姓名质量
 *
 * 过滤明显无效的姓名（单字母、数字、邮箱地址、手机号等），
 * 确保入库的候选人姓名至少达到基本质量标准。
 *
 * @param {string} rawName - DeepSeek 解析的原始姓名
 * @returns {{ valid: boolean, cleanedName: string, reason: string }}
 */
function validateAndCleanName(rawName) {
  if (!rawName || rawName.trim().length === 0) {
    return { valid: false, cleanedName: '', reason: '姓名为空' };
  }

  let name = rawName.trim();

  // 去掉常见 OCR/提取噪音前缀和后缀
  name = name.replace(/^[_\-\s·•●◎○■□★☆♦♥♣♠▲△▼▽◆◇|/\\:;]+/, '');
  name = name.replace(/[_\-\s·•●◎○■□★☆♦♥♣♠▲△▼▽◆◇|/\\:;]+$/, '');

  if (name.length === 0) {
    return { valid: false, cleanedName: '', reason: '去除噪音后姓名为空' };
  }

  // 单字母英文名 → 无效（如 "B", "A", "X"）
  if (/^[a-zA-Z]$/.test(name)) {
    return { valid: false, cleanedName: name, reason: '姓名为单字母，无效' };
  }

  // 两个相同字母 → 无效（如 "BB", "aa"）
  if (/^[a-zA-Z]{2}$/.test(name) && name[0].toLowerCase() === name[1].toLowerCase()) {
    return { valid: false, cleanedName: name, reason: '姓名为重复单字母，无效' };
  }

  // 纯数字或含特殊符号 → 无效
  if (/^\d+$/.test(name)) {
    return { valid: false, cleanedName: name, reason: '姓名为纯数字，无效' };
  }

  if (/^[!@#$%^&*()+\-=\[\]{};':"\\|,.<>\/?]+$/.test(name)) {
    return { valid: false, cleanedName: name, reason: '姓名为纯特殊符号，无效' };
  }

  // 邮箱地址/手机号 → 无效
  if (/@/.test(name) || /^1[3-9]\d{9}$/.test(name)) {
    return { valid: false, cleanedName: name, reason: '姓名被误识别为邮箱/手机号' };
  }

  // "未知" 或 "不详" 等占位符 → 无效
  if (/^(未知|不详|无|未知名|匿名|佚名|unnamed|unknown|n\/a|null|none)$/i.test(name)) {
    return { valid: false, cleanedName: name, reason: '姓名为占位符' };
  }

  // 中文姓名：至少2个汉字
  const chineseChars = name.match(/[一-鿿]/g);
  if (chineseChars && chineseChars.length >= 2) {
    return { valid: true, cleanedName: name, reason: '' };
  }

  // 英文姓名：至少2个字符，包含字母（排除纯数字/符号）
  if (/^[a-zA-Z\s\-'.]{2,30}$/.test(name) && name.replace(/[^a-zA-Z]/g, '').length >= 2) {
    return { valid: true, cleanedName: name, reason: '' };
  }

  // 中英混合（如某些外企简历）
  if (name.length >= 2 && /[一-鿿]/.test(name)) {
    return { valid: true, cleanedName: name, reason: '' };
  }

  // 日文/韩文姓名（含假名/谚文）
  if (/[぀-ゟ゠-ヿ가-힯]/.test(name) && name.length >= 2) {
    return { valid: true, cleanedName: name, reason: '' };
  }

  return { valid: false, cleanedName: name, reason: `姓名格式异常: "${name}"` };
}

/**
 * 从邮件主题/发件人中尝试提取候选人姓名（兜底策略）
 *
 * 招聘平台邮件主题常见格式：
 *   - "张三的简历" → "张三"
 *   - "张三- Java开发工程师" → "张三"
 *   - "\"张三\" <zhangsan@example.com>" → "张三"
 *   - "张三 应聘 产品经理" → "张三"
 *   - "【BOSS直聘】张三投递了Java开发" → "张三"
 *
 * @param {string} subject - 邮件主题
 * @param {string} from - 发件人地址
 * @returns {string|null} 提取到的姓名，或 null
 */
function extractNameFromEmailMeta(subject, from) {
  if (subject) {
    // 常见主题模式
    const patterns = [
      // "XXX的简历" / "XXX 的简历"
      /^(.{2,4})的简历/,
      // "XXX-职位名" / "XXX - 职位名"
      /^(.{2,4})[-_\s—]+.{1,}/,
      // "XXX应聘XXX"
      /^(.{2,4})应聘/,
      // "XXX投递XXX"
      /^(.{2,4})投递/,
      // "XXX_职位名"
      /^(.{2,4})_/,
      // "XXX 职位名"
      /^(.{2,4})\s.{1,}/,
      // "【平台】XXX投递了..."
      /】(.{2,4})投递/,
      // "【平台】XXX的简历"
      /】(.{2,4})的简历/,
      // "简历：XXX" / "候选人：XXX"
      /[：:]\s*(.{2,4})\s*$/,
      // "Resume of XXX" → 英文名
      /resume\s+(?:of\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    ];

    for (const pattern of patterns) {
      const match = subject.match(pattern);
      if (match) {
        const candidate = match[1].trim();
        // 验证确实是中文姓名（2-4个汉字）
        if (/^[一-鿿]{2,4}$/.test(candidate)) {
          return candidate;
        }
        // 英文名：2-20字符，首字母大写
        if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(candidate) && candidate.length <= 20) {
          return candidate;
        }
      }
    }

    // 通用中文姓名正则（主题开头2-4个连续汉字）
    const generalMatch = subject.match(/^([一-鿿]{2,4})/);
    if (generalMatch) {
      const candidate = generalMatch[1];
      // 排除常见的非姓名开头词
      const nonNameWords = ['回复', '转发', '关于', '您好', '你好', '尊敬', '请查', '附件', '简历', '应聘',
        '招聘', '求职', '个人', '最新', '更新', '自动', '系统', '通知', '提醒', '测试'];
      if (!nonNameWords.some(w => candidate.startsWith(w))) {
        return candidate;
      }
    }
  }

  // 策略2：从发件人名称中提取（格式: "张三" <email> 或 张三 <email>）
  if (from) {
    const quotedMatch = from.match(/"(.{2,4})"/);
    if (quotedMatch && /^[一-鿿]{2,4}$/.test(quotedMatch[1])) {
      return quotedMatch[1];
    }
    // 格式: 张三 <email>（无引号）
    const angleMatch = from.match(/^(.{2,4})\s*</);
    if (angleMatch && /^[一-鿿]{2,4}$/.test(angleMatch[1])) {
      // 排除明显的部门/职位名称
      const nonPersonNames = ['人事部', '行政部', '财务部', '技术部', '市场部', '销售部'];
      if (!nonPersonNames.includes(angleMatch[1])) {
        return angleMatch[1];
      }
    }
  }

  return null;
}

/**
 * 处理单个 ParseQueue 条目
 */
async function processOneEntry(db, entry, summary) {
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
    if (!extractText) {
      await markEntryFailed(db, entry, 'format-router 未加载，无法提取文本');
      summary.failed++;
      return;
    }
    // 从云存储下载文件并提取文本
    try {
      if (entry.fileId) {
        const downloadResult = await app.downloadFile({ fileID: entry.fileId });
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
      data: {
        resumeText,
        emailContext: {
          subject: entry.sourceEmailSubject || '',
          from: entry.sourceEmailFrom || '',
          fileName: entry.fileName || '',
        },
      },
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

    // 🆕 姓名质量校验 + 邮件元数据兜底提取
    let nameSource = 'ai_parsed';  // 姓名来源追踪
    const nameCheck = validateAndCleanName(basicInfo.name);
    if (!nameCheck.valid) {
      console.log(`[parse-queue-processor] 姓名校验失败: ${nameCheck.reason}，原始值: "${basicInfo.name}"，尝试从邮件元数据提取`);

      // 尝试从邮件主题/发件人提取姓名
      const fallbackName = extractNameFromEmailMeta(
        entry.sourceEmailSubject || '',
        entry.sourceEmailFrom || ''
      );

      if (fallbackName) {
        console.log(`[parse-queue-processor] ✅ 从邮件元数据提取到姓名: "${fallbackName}"`);
        basicInfo.name = fallbackName;
        nameSource = 'email_meta';
      } else {
        console.warn(`[parse-queue-processor] ⚠️ 无法提取有效姓名，降级使用原始值`);
        nameSource = 'unresolved';
        // 姓名无效但仍有其他信息（手机/邮箱），创建候选人但标注姓名不确定
        // 不阻塞管道，让专员后续手动修正
      }
    }

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

    // 创建 Candidate（扁平化 DeepSeek 解析结果到顶层字段）
    const phoneVal = basicInfo.phone || '';
    const emailVal = basicInfo.email || '';
    const candidateDoc = {
      // 基本信息（顶层，方便直接查询和展示）
      name: basicInfo.name || '',
      _nameSource: nameSource,  // 🆕 姓名来源追踪：ai_parsed / email_meta / unresolved
      gender: basicInfo.gender || '',
      phone: phoneVal,
      email: emailVal,
      // P1-3：哈希值用于去重（不暴露明文）
      phoneHash: computeHash(phoneVal),
      emailHash: computeHash(emailVal),
      age: basicInfo.age || null,
      city: basicInfo.city || '',
      yearsOfExperience: basicInfo.years_of_experience || null,
      // 结构化数据（从 parsedData 扁平化到顶层）
      education: candidateData.education || [],
      workExperience: candidateData.work_experience || [],
      skills: candidateData.skills || [],
      certificates: candidateData.certificates || [],
      expectedPosition: candidateData.expected_position || '',
      expectedSalary: candidateData.expected_salary || '',
      selfEvaluation: candidateData.self_evaluation || '',
      // 简历原文（用于详情页"简历原文"Tab 展示）
      resumeRawText: resumeText || '',
      // 完整解析结果（保留用于调试和后续分析）
      parsedData: candidateData,
      // 来源元数据
      source: entry.source || 'email',
      sourceEmailFrom: entry.sourceEmailFrom || '',
      sourceEmailSubject: entry.sourceEmailSubject || '',
      fileHash: entry.fileHash || '',
      fileId: entry.fileId || '',
      fileName: entry.fileName || '',
      createdBy: entry.userId || 'system',
      ownerId: entry.userId || 'system',
      _version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const candidateResult = await db.collection('Candidate').add(candidateDoc);
    const candidateId = candidateResult.id;

    // 🆕 自动匹配岗位并创建 Application
    // 匹配成功 → Application 挂在匹配的岗位下，直接出现在看板对应岗位管道中
    // 匹配失败 → Application 挂在 jobId: '' 下，出现在看板"未分配"区域，等待专员手动分配
    let matchedJobId = '';
    let matchedJobTitle = '';
    try {
      const jobId = await autoMatchJob(db, {
        expectedPosition: candidateDoc.expectedPosition,
        expectedSalary: candidateDoc.expectedSalary,
      });
      if (jobId) {
        matchedJobId = jobId;
        // 获取岗位名称用于展示
        try {
          const { data: jobData } = await db.collection('Job').doc(jobId).field({ title: true, name: true }).get();
          if (jobData?.[0]) matchedJobTitle = jobData[0].title || jobData[0].name || '';
        } catch (_) { /* 非关键 */ }
      }
    } catch (matchErr) {
      console.warn('[parse-queue-processor] 自动匹配岗位失败:', matchErr.message);
    }

    // 创建 Application（确保候选人出现在招聘看板）
    const applicationDoc = {
      candidateId,
      jobId: matchedJobId,
      demandId: '',
      demandTitle: matchedJobTitle,
      stage: 'resume',
      stageEnteredAt: new Date(),
      status: 'active',
      funnel: { resumeAt: new Date() },
      funnelMeta: { entrySource: 'email' },
      source: entry.source || 'email',
      ownerId: entry.userId || 'system',
      isArchived: false,
      _version: 0,
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

    // 创建通知（提示自动匹配结果）
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
        autoMatchedJob: matchedJobId ? matchedJobTitle || matchedJobId : null,
        needsAssignment: !matchedJobId,  // 仅未匹配时需要手动分配
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
    // P1 修复：仅可重试错误才调度重试（与 extractErr/parseErr 处理一致）
    if (isRetryableError(createErr)) {
      await scheduleRetry(db, entry, `创建记录失败：${createErr.message}`);
      summary.retried++;
    } else {
      await markEntryFailed(db, entry, `创建记录失败（不可重试）：${createErr.message}`);
      summary.failed++;
    }
  }
}

/**
 * 自动匹配岗位：根据候选人的期望岗位名称匹配已有招聘需求的岗位
 *
 * 🔴 关键约束：只匹配有 RecruitmentDemand（招聘需求）的岗位，
 * 不匹配系统"凭空造出来"的无需求岗位。
 *
 * 匹配逻辑：
 *   1. 查询 RecruitmentDemand（status: 'recruiting'），获取 demand title + linkedJobId
 *   2. 用候选人的 expectedPosition（简历中的意向岗位）去匹配 demand title
 *   3. 匹配成功返回 linkedJobId（需求关联的真实岗位），失败返回 null
 *
 * @param {object} db - CloudBase 数据库实例
 * @param {object} candidateInfo - { expectedPosition, expectedSalary }
 * @returns {Promise<string|null>} 匹配到的 jobId，或 null
 */
async function autoMatchJob(db, candidateInfo) {
  const { expectedPosition } = candidateInfo;

  if (!expectedPosition || expectedPosition.trim().length < 2) {
    console.log('[parse-queue-processor] 期望岗位为空或过短，跳过自动匹配');
    return null;
  }

  try {
    // 🔴 查询有招聘需求的岗位（RecruitmentDemand），而非全部活跃岗位（Job）
    const { data: demands } = await db
      .collection('RecruitmentDemand')
      .where({ status: 'recruiting' })
      .field({ title: true, linkedJobId: true, department: true })
      .get();

    if (!demands || demands.length === 0) {
      console.log('[parse-queue-processor] 无进行中的招聘需求，跳过自动匹配');
      return null;
    }

    // 过滤掉没有 linkedJobId 的需求（尚未创建关联岗位）
    const validDemands = demands.filter(d => d.linkedJobId);
    if (validDemands.length === 0) {
      console.log('[parse-queue-processor] 所有需求均未关联岗位，跳过自动匹配');
      return null;
    }

    const position = expectedPosition.trim().toLowerCase();

    // 策略1：精确匹配（需求标题包含期望岗位 或 期望岗位包含需求标题）
    for (const demand of validDemands) {
      const demandTitle = (demand.title || '').toLowerCase().trim();
      if (!demandTitle) continue;

      if (demandTitle === position || demandTitle.includes(position) || position.includes(demandTitle)) {
        console.log(`[parse-queue-processor] ✅ 精确匹配需求: "${expectedPosition}" → "${demand.title}" (jobId: ${demand.linkedJobId})`);
        return demand.linkedJobId;
      }
    }

    // 策略2：关键词匹配（候选人的意向岗位关键词命中需求标题）
    const keywords = position.split(/[\s,，、/]+/).filter((k) => k.length >= 2);
    for (const demand of validDemands) {
      const demandTitle = (demand.title || '').toLowerCase().trim();
      if (!demandTitle) continue;

      const matchCount = keywords.filter((kw) => demandTitle.includes(kw)).length;
      if (matchCount >= Math.ceil(keywords.length * 0.5) || matchCount >= 2) {
        console.log(`[parse-queue-processor] ✅ 关键词匹配需求: "${expectedPosition}" → "${demand.title}" (${matchCount}/${keywords.length}, jobId: ${demand.linkedJobId})`);
        return demand.linkedJobId;
      }
    }

    // 策略3：单关键词部分匹配
    for (const demand of validDemands) {
      const demandTitle = (demand.title || '').toLowerCase().trim();
      if (!demandTitle) continue;

      for (const kw of keywords) {
        if (kw.length >= 2 && demandTitle.includes(kw)) {
          console.log(`[parse-queue-processor] ✅ 单关键词匹配需求: "${expectedPosition}" → "${demand.title}" (关键词: "${kw}", jobId: ${demand.linkedJobId})`);
          return demand.linkedJobId;
        }
      }
    }

    console.log(`[parse-queue-processor] ❌ 未匹配到招聘需求: "${expectedPosition}", 可选需求: ${validDemands.map(d => d.title).join(', ')}`);
    return null;
  } catch (err) {
    console.error('[parse-queue-processor] 自动匹配岗位失败:', err.message);
    return null;
  }
}

/**
 * 检查候选人级重复（phone + email）
 */
async function checkCandidateDuplicate(db, basicInfo) {
  const phoneVal = basicInfo.phone || '';
  const emailVal = basicInfo.email || '';

  if (!phoneVal && !emailVal) return null;

  // P1-3：优先用哈希匹配（不暴露明文查询），回退到明文匹配
  const conditions = [];
  if (phoneVal) {
    const phoneHash = computeHash(phoneVal);
    conditions.push({ phoneHash });
    conditions.push({ phone: phoneVal }); // 兼容旧数据无哈希字段
  }
  if (emailVal) {
    const emailHash = computeHash(emailVal);
    conditions.push({ emailHash });
    conditions.push({ email: emailVal }); // 兼容旧数据无哈希字段
  }

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
 * 判断错误是否可重试（P1-4 修复：白名单模式）
 *
 * 仅以下情况安全重试——其他一律视为不可重试：
 *   可重试：网络超时、临时连接错误、速率限制、服务暂时不可用
 *   不可重试：文件格式不支持、损坏、数据校验失败、认证失败、配额耗尽等
 *
 * 白名单模式比黑名单更安全：新出现的错误类型不会被自动重试，
 * 避免对永久性错误做无用重试。
 */
function isRetryableError(err) {
  const message = (err.message || '').toLowerCase();
  const code = (err.code || '').toString().toLowerCase();

  // 可重试模式（白名单）
  const retryablePatterns = [
    // 网络/超时
    'econnrefused', 'econnreset', 'econnaborted',
    'etimedout', 'enetunreach', 'enotfound',
    'timeout', 'timed out', 'time-out',
    'socket hang up', 'socket disconnected',
    'network error', 'networkerror',
    'dns lookup failed',
    // HTTP 5xx（服务端临时错误）
    '500', '502', '503', '504',
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    // 速率限制
    'rate limit', 'rate exceeded', 'too many requests',
    '429', 'throttle',
    // 临时不可用
    'temporarily unavailable',
    'service temporarily',
    'try again later',
    // CloudBase 特定
    'database request timeout',
    'resource temporarily unavailable',
    'server is busy',
  ];

  const isRetryable = retryablePatterns.some(p => message.includes(p) || code.includes(p));

  if (!isRetryable) {
    console.log(`[parse-queue-processor] 不可重试错误: ${(err.message || '').slice(0, 100)}`);
  }

  return isRetryable;
}
