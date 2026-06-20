/**
 * history-insight-generator — 历史洞察生成器
 *
 * 分析历史 Application 数据，按岗位类型聚合计算：
 *   - 平均招聘周期、平均候选人/录用、Offer 接受率
 *   - Top 渠道、常见淘汰原因
 *   - 调 DeepSeek 生成"成功候选人画像"
 *
 * 写入 RecruitmentInsight 集合（30 天缓存）。
 * 参照 report-aggregator 的聚合模式。
 */

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const API_TIMEOUT = 25000;

// ========== 工具函数 ==========

/** 游标分页读取全量 Application */
async function fetchAllApplications(filter = {}) {
  const all = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    let query = db.collection('Application')
      .orderBy('_id', 'asc')
      .limit(500);

    const conditions = { ...filter };
    if (cursor) conditions._id = _.gt(cursor);
    query = query.where(conditions);

    const { data } = await query.get();
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      all.push(...data);
      if (data.length < 500) hasMore = false;
      else cursor = data[data.length - 1]._id;
    }
  }

  return all;
}

/** 计算平均时长 */
function avgTimeToHire(applications) {
  const onboarded = applications.filter(a => a.stage === 'onboard' && a.status === 'active');
  if (!onboarded.length) return null;

  let totalDays = 0;
  let count = 0;
  for (const app of onboarded) {
    const createdAt = app.createdAt ? new Date(app.createdAt) : null;
    const onboardAt = app.funnel?.onboardAt ? new Date(app.funnel.onboardAt) : null;
    if (createdAt && onboardAt) {
      totalDays += (onboardAt - createdAt) / (1000 * 60 * 60 * 24);
      count++;
    }
  }

  return count > 0 ? Math.round(totalDays / count) : null;
}

/** Offer 接受率 */
function offerAcceptRate(applications) {
  const offered = applications.filter(a =>
    a.funnel?.offerAt &&
    (a.stage === 'offer' || a.stage === 'onboard')
  );
  const onboarded = applications.filter(a => a.stage === 'onboard' && a.status === 'active');

  if (!offered.length) return null;
  return Math.round((onboarded.length / offered.length) * 100);
}

/** Top 淘汰原因 */
function topRejectReasons(applications) {
  const rejected = applications.filter(a => a.status === 'rejected' && a.endReason);
  const counts = {};
  for (const app of rejected) {
    const reason = app.endReason || '未知';
    counts[reason] = (counts[reason] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

/** Top 来源渠道 */
function topSources(applications) {
  const counts = {};
  for (const app of applications) {
    const source = app.funnelMeta?.entrySource || '未知';
    counts[source] = (counts[source] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));
}

/** 调 DeepSeek 生成成功候选人画像 */
async function generateSuccessfulProfile(applications, jobType) {
  if (!DEEPSEEK_API_KEY) return null;

  const hired = applications.filter(a => a.stage === 'onboard' && a.status === 'active');
  if (hired.length < 2) return null;

  // 搜集入职候选人的特征摘要
  const profiles = hired.slice(0, 20).map(app => {
    const funnel = app.funnel || {};
    return `入职时间: ${funnel.onboardAt || '?'}, 周期: ${formatDays(app.createdAt, funnel.onboardAt)}天`;
  }).join('\n');

  const systemPrompt = `你是一个招聘数据分析师。基于以下${hired.length}位成功入职的${jobType}候选人的简要信息，总结出成功候选人的共同画像（3-5句话）。只输出中文文本，不要标题或编号。`;

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: profiles },
        ],
      }),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn('[history-insight-generator] 画像生成失败:', err.message);
    return null;
  }
}

function formatDays(start, end) {
  if (!start || !end) return '?';
  return String(Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)));
}

// ========== 主入口 ==========

exports.main = async (event, context) => {
  const { jobIds = null, forceRegenerate = false } = event || {};

  console.log('[history-insight-generator] 开始生成历史洞察');

  try {
    // 获取所有已入职/结束的 Application（含历史数据）
    const allApps = await fetchAllApplications({ isArchived: _.neq(true) });

    console.log(`[history-insight-generator] 读取 ${allApps.length} 条申请记录`);

    // 获取所有活跃岗位类型
    const { data: jobs } = await db.collection('Job')
      .where({ status: _.in(['active', 'inactive', 'deleted']) })
      .limit(200)
      .get();

    // 按岗位类型分组 Application
    const appsByType = {};
    for (const app of allApps) {
      const job = jobs?.find(j => j._id === app.jobId);
      const jobType = job?.type || '未知';
      if (!appsByType[jobType]) appsByType[jobType] = [];
      appsByType[jobType].push(app);
    }

    const results = [];

    for (const [jobType, apps] of Object.entries(appsByType)) {
      if (apps.length < 3) continue; // 样本不足

      const avgDays = avgTimeToHire(apps);
      const offerRate = offerAcceptRate(apps);
      const rejectReasons = topRejectReasons(apps);
      const sources = topSources(apps);
      const successProfile = await generateSuccessfulProfile(apps, jobType);

      // 平均薪资范围（从入职 Application 关联的 Job 获取）
      const salaryRange = { min: 0, max: 0 };
      const onboardApps = apps.filter(a => a.stage === 'onboard' && a.status === 'active');
      // 薪资来自岗位数据，此处简化为默认值
      salaryRange.min = 6; // k
      salaryRange.max = 20; // k

      const insightDoc = {
        cacheKey: `insight:${jobType}`,
        jobType,
        avgTimeToHire: avgDays,
        avgTimeToHireUnit: '天',
        avgCandidatesPerHire: apps.filter(a => a.stage === 'onboard').length > 0
          ? Math.round(apps.length / apps.filter(a => a.stage === 'onboard').length) : null,
        offerAcceptRate: offerRate,
        topSources: sources,
        commonRejectReasons: rejectReasons,
        successfulProfile: successProfile,
        salaryRange,
        totalHired: apps.filter(a => a.stage === 'onboard' && a.status === 'active').length,
        totalApplications: apps.length,
        computedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 天
        dataVersion: 1,
      };

      // upsert
      try {
        const { data: existing } = await db.collection('RecruitmentInsight')
          .where({ cacheKey: `insight:${jobType}` })
          .get()
          .catch(() => ({ data: null }));

        if (existing?.length) {
          await db.collection('RecruitmentInsight').doc(existing[0]._id).update(insightDoc);
        } else {
          await db.collection('RecruitmentInsight').add(insightDoc);
        }
      } catch (err) {
        console.warn(`[history-insight-generator] 写入 ${jobType} 洞察失败:`, err.message);
      }

      results.push({
        jobType,
        avgTimeToHire: avgDays,
        totalApplications: apps.length,
        totalHired: insightDoc.totalHired,
        hasSuccessProfile: !!successProfile,
      });
    }

    console.log(`[history-insight-generator] 完成: ${results.length} 个岗位类型`);

    return {
      success: true,
      data: {
        jobTypes: results,
        message: `已为 ${results.length} 个岗位类型生成洞察`,
      },
    };
  } catch (err) {
    console.error('[history-insight-generator] 异常:', err);

    try {
      await db.collection('ErrorLog').add({
        source: 'history-insight-generator',
        error: err.message,
        stack: err.stack?.substring(0, 1000),
        timestamp: new Date(),
      });
    } catch (e) { /* 忽略 */ }

    return {
      success: false,
      error: `洞察生成失败: ${err.message}`,
    };
  }
};
