/**
 * rag-assistant-proxy — RAG 检索增强生成代理
 *
 * 招聘 AI 助手的核心云函数。实现 5 步 RAG 管道：
 *   1. 意图识别（DeepSeek 快速分类）
 *   2. 知识检索（CompanyProfile + KnowledgeBase + RecruitmentInsight）
 *   3. Prompt 组装（注入公司人设 + 知识 + 历史洞察）
 *   4. DeepSeek 生成
 *   5. 返回 { response, sourcesUsed, confidence }
 *
 * 参照 resume-parser-proxy 的 DeepSeek API 调用模式。
 */

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1/chat/completions';

// 云函数超时 30s，API 调用给 25s 缓冲
const API_TIMEOUT = 25000;

// ========== RAG 管道 ==========

/**
 * Step 1：意图识别（轻量调用，~200 tokens）
 */
async function recognizeIntent(userMessage) {
  const systemPrompt = `你是一个招聘助手意图分类器。分析用户输入，返回 JSON：
{
  "intent": "write_jd" | "answer_question" | "analyze_candidate" | "recruitment_advice" | "general",
  "entities": { "jobType": "岗位类型", "department": "部门", "city": "城市" },
  "keywords": ["关键字1", "关键字2"],
  "category": "recruitment" | "jd_template" | "interview" | "company_intro" | "culture" | "benefits" | "general"
}
仅返回 JSON，不要任何额外文字。`;

  try {
    const response = await fetch(DEEPSEEK_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`意图识别 API ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '{}';

    // 提取 JSON（可能在 markdown code block 中）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { intent: 'general', entities: {}, keywords: [] };
  } catch (err) {
    console.warn('[rag-assistant-proxy] 意图识别失败，回退到 general:', err.message);
    return { intent: 'general', entities: {}, keywords: [] };
  }
}

/**
 * Step 2：知识检索
 */
async function retrieveKnowledge(intent, keywords) {
  const results = {
    companyProfile: null,
    knowledgeEntries: [],
    insights: null,
  };

  try {
    // 2a. CompanyProfile（单例文档）
    const cpRes = await db.collection('CompanyProfile')
      .doc('singleton')
      .get()
      .catch(() => ({ data: null }));
    if (cpRes?.data) {
      results.companyProfile = cpRes.data;
    }
  } catch (err) {
    console.warn('[rag-assistant-proxy] CompanyProfile 查询失败:', err.message);
  }

  try {
    // 2b. KnowledgeBase 关键字匹配
    if (keywords?.length) {
      const { data } = await db.collection('KnowledgeBase')
        .where({ status: 'published' })
        .orderBy('useCount', 'desc')
        .limit(30)
        .get();

      if (data?.length) {
        // 关键字打分
        const scored = data.map(entry => {
          let score = 0;
          const title = (entry.title || '').toLowerCase();
          const content = (entry.content || '').toLowerCase();
          for (const kw of keywords) {
            const k = kw.toLowerCase();
            if (title.includes(k)) score += 3;
            if (content.includes(k)) score += 1;
          }
          return { ...entry, _score: score };
        });

        results.knowledgeEntries = scored
          .filter(e => e._score > 0)
          .sort((a, b) => b._score - a._score)
          .slice(0, 8);
      }
    }
  } catch (err) {
    console.warn('[rag-assistant-proxy] KnowledgeBase 查询失败:', err.message);
  }

  try {
    // 2c. RecruitmentInsight（按岗位类型匹配）
    if (intent?.entities?.jobType) {
      const cacheKey = `insight:${intent.entities.jobType}`;
      const insRes = await db.collection('RecruitmentInsight')
        .where({ cacheKey })
        .get()
        .catch(() => ({ data: [] }));
      if (insRes?.data?.length) {
        results.insights = insRes.data[0];
      }
    }
  } catch (err) {
    console.warn('[rag-assistant-proxy] RecruitmentInsight 查询失败:', err.message);
  }

  return results;
}

/**
 * Step 3：组装增强 Prompt
 */
function buildEnhancedPrompt(userMessage, intent, knowledge) {
  let systemPrompt = '你是新励成教育科技集团的招聘AI助手。你专业、亲切、有深度。\n\n';

  // 注入公司人设
  if (knowledge.companyProfile) {
    const cp = knowledge.companyProfile;
    systemPrompt += '【公司信息】\n';
    if (cp.shortIntro) systemPrompt += `${cp.shortIntro}\n`;
    if (cp.fullDescription) systemPrompt += `${cp.fullDescription}\n`;
    if (cp.culture?.length) systemPrompt += `企业文化：${cp.culture.join('、')}\n`;
    if (cp.benefits?.length) systemPrompt += `员工福利：${cp.benefits.join('、')}\n`;
    if (cp.recruitmentPhilosophy) systemPrompt += `招聘理念：${cp.recruitmentPhilosophy}\n`;
    systemPrompt += '\n';
  }

  // 注入知识库条目
  if (knowledge.knowledgeEntries?.length) {
    systemPrompt += '【参考知识】\n';
    for (const entry of knowledge.knowledgeEntries) {
      systemPrompt += `- ${entry.title}：${(entry.content || '').substring(0, 300)}\n`;
    }
    systemPrompt += '\n';
  }

  // 注入历史洞察
  if (knowledge.insights) {
    const ins = knowledge.insights;
    systemPrompt += '【历史招聘数据】\n';
    if (ins.avgTimeToHire) systemPrompt += `- 平均招聘周期：${ins.avgTimeToHire}天\n`;
    if (ins.salaryRange) systemPrompt += `- 历史薪资范围：${ins.salaryRange.min}k-${ins.salaryRange.max}k\n`;
    if (ins.successfulProfile) systemPrompt += `- 成功候选人画像：${ins.successfulProfile}\n`;
    if (ins.commonRejectReasons?.length) systemPrompt += `- 常见淘汰原因：${ins.commonRejectReasons.join('、')}\n`;
    systemPrompt += '\n';
  }

  // 意图指令
  switch (intent?.intent) {
    case 'write_jd':
      systemPrompt += '请根据以上信息，撰写一份专业的招聘JD。包括：岗位职责、任职要求、我们提供的价值。格式整洁，语言有吸引力。';
      break;
    case 'answer_question':
      systemPrompt += '请根据公司实际情况如实回答用户问题。如果信息不足，请明确说明，不要编造。';
      break;
    case 'analyze_candidate':
      systemPrompt += '请结合公司岗位需求和历史数据，分析该候选人的匹配度，给出具体建议。';
      break;
    case 'recruitment_advice':
      systemPrompt += '请基于历史招聘数据给出专业建议，引用具体数据支持。';
      break;
    default:
      systemPrompt += '请根据公司实际情况回答用户问题。保持专业、亲切。如果信息不足，建议用户联系HR部门。';
  }

  return systemPrompt;
}

/**
 * Step 4：DeepSeek 生成
 */
async function generateResponse(systemPrompt, userMessage) {
  const response = await fetch(DEEPSEEK_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.3,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(API_TIMEOUT),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`DeepSeek API ${response.status}: ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ========== 主入口 ==========

exports.main = async (event, context) => {
  const { userMessage, conversationHistory = [], jobContext = null } = event;

  console.log(`[rag-assistant-proxy] 收到请求: "${userMessage?.substring(0, 80)}"`);

  if (!userMessage) {
    return { success: false, error: '缺少 userMessage 参数' };
  }

  if (!DEEPSEEK_API_KEY) {
    return { success: false, error: 'DEEPSEEK_API_KEY 环境变量未配置' };
  }

  try {
    // Step 1: 意图识别
    const intent = await recognizeIntent(userMessage);
    console.log('[rag-assistant-proxy] 意图:', JSON.stringify(intent));

    // Step 2: 知识检索
    const knowledge = await retrieveKnowledge(intent, intent.keywords || []);
    console.log(`[rag-assistant-proxy] 检索到: CP=${!!knowledge.companyProfile}, KB=${knowledge.knowledgeEntries.length}条, INS=${!!knowledge.insights}`);

    // Step 3: 组装 Prompt
    const systemPrompt = buildEnhancedPrompt(userMessage, intent, knowledge);

    // Step 4: 生成
    const response = await generateResponse(systemPrompt, userMessage);

    // Step 5: 返回（含引用来源）
    const sourcesUsed = (knowledge.knowledgeEntries || []).map(e => ({
      id: e._id,
      title: e.title,
      category: e.category,
    }));

    return {
      success: true,
      data: {
        response,
        intent: intent.intent || 'general',
        sourcesUsed,
        companyProfileLoaded: !!knowledge.companyProfile,
        insightsLoaded: !!knowledge.insights,
      },
    };

  } catch (err) {
    console.error('[rag-assistant-proxy] 异常:', err);

    // 写入 ErrorLog
    try {
      await db.collection('ErrorLog').add({
        source: 'rag-assistant-proxy',
        error: err.message,
        stack: err.stack?.substring(0, 1000),
        context: { userMessage: userMessage?.substring(0, 200) },
        timestamp: new Date(),
      });
    } catch (logErr) { /* 忽略 */ }

    return {
      success: false,
      error: `AI 助手暂时不可用：${err.message}`,
    };
  }
};
