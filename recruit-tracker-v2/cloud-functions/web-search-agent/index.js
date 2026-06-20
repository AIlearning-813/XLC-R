/**
 * web-search-agent — AI 网络搜索代理
 *
 * 调 DeepSeek API 搜索新励成相关信息，提取结构化知识写入 KnowledgeBase。
 * 所有条目 status='draft'、sourceVerified=false，需管理员审核后发布。
 *
 * 参照 rag-assistant-proxy 的 DeepSeek API 调用模式。
 */

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const API_TIMEOUT = 30000; // 30s（云函数 60s 超时）

// 默认搜索维度
const DEFAULT_QUERIES = [
  '新励成教育科技集团 公司简介 规模 业务',
  '新励成 企业文化 价值观 使命',
  '新励成 员工福利 薪酬 工作环境',
  '演讲口才培训行业 市场趋势 2025 2026',
  '新励成 招聘 岗位',
];

/**
 * 单次搜索：调 DeepSeek 搜集某个主题的结构化信息
 */
async function searchOne(query) {
  const systemPrompt = `你是一个公司信息搜集助手。请基于你的训练数据，以 JSON 数组格式输出关于查询主题的结构化知识条目。
每个条目包含：
{
  "title": "简短标题",
  "content": "1-3 句话的实质内容，尽可能具体",
  "category": "company_intro|culture|benefits|recruitment|jd_template|interview|industry|competitor|policy",
  "tags": ["标签1", "标签2"],
  "confidence": "high|medium|low"
}
如果对某个信息不确定，confidence 设为 "low"。仅返回 JSON 数组，不要额外文字。`;

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `查询：${query}` },
        ],
      }),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '[]';

    // 提取 JSON 数组
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    return JSON.parse(jsonMatch[0]).filter(item => item.title && item.content);
  } catch (err) {
    console.warn(`[web-search-agent] 搜索 "${query}" 失败:`, err.message);
    return [];
  }
}

// ========== 主入口 ==========

exports.main = async (event, context) => {
  const { searchQueries = null } = event || {};

  console.log('[web-search-agent] 开始信息采集');

  if (!DEEPSEEK_API_KEY) {
    return { success: false, error: 'DEEPSEEK_API_KEY 环境变量未配置' };
  }

  const queries = searchQueries?.length ? searchQueries : DEFAULT_QUERIES;
  let totalNew = 0;
  let totalSkipped = 0;

  try {
    for (const query of queries) {
      console.log(`[web-search-agent] 搜索: "${query}"`);
      const items = await searchOne(query);

      for (const item of items) {
        // 去重：按标题检查是否已存在
        try {
          const { data: existing } = await db.collection('KnowledgeBase')
            .where({ title: item.title })
            .limit(1)
            .get();

          if (existing?.length > 0) {
            totalSkipped++;
            continue;
          }

          // 写入 draft 条目
          await db.collection('KnowledgeBase').add({
            title: item.title,
            category: item.category || 'general',
            content: item.content,
            tags: item.tags || [],
            relevance: 'common',
            source: 'web_search',
            sourceUrl: `search:${query}`,
            sourceVerified: false,
            confidence: item.confidence || 'medium',
            status: 'draft',
            useCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          totalNew++;
        } catch (err) {
          console.warn(`[web-search-agent] 写入条目失败:`, err.message);
        }
      }
    }

    console.log(`[web-search-agent] 完成: 新增 ${totalNew}, 跳过 ${totalSkipped}`);

    return {
      success: true,
      data: {
        total: totalNew + totalSkipped,
        new: totalNew,
        skipped: totalSkipped,
        queries,
        message: `采集完成：新增 ${totalNew} 条，跳过重复 ${totalSkipped} 条。请在知识库草稿中审核。`,
      },
    };
  } catch (err) {
    console.error('[web-search-agent] 异常:', err);

    try {
      await db.collection('ErrorLog').add({
        source: 'web-search-agent',
        error: err.message,
        stack: err.stack?.substring(0, 1000),
        context: { queries },
        timestamp: new Date(),
      });
    } catch (logErr) { /* 忽略 */ }

    return {
      success: false,
      error: `信息采集失败: ${err.message}`,
    };
  }
};
