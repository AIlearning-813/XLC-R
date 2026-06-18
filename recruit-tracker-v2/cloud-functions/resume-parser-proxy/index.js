/**
 * resume-parser-proxy — DeepSeek API 代理云函数
 *
 * 职责：
 *   1. 接收前端传来的简历纯文本
 *   2. 构建 System Prompt（含修正案例 few-shot examples）
 *   3. 调用 DeepSeek API（Tool Use 模式）提取结构化信息
 *   4. 返回结构化 JSON 给前端
 *
 * API Key 存储在环境变量 DEEPSEEK_API_KEY，永不出现在前端代码中
 */
const cloudbase = require('@cloudbase/node-sdk');
const { buildSystemPrompt } = require('./build-prompt');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// Tool Use Schema — DeepSeek 将按此 schema 输出结构化简历数据
const EXTRACT_RESUME_TOOL = {
  type: 'function',
  function: {
    name: 'extract_resume',
    description: '从简历文本中提取候选人结构化信息，包括基本信息、教育经历、工作经历、技能、证书、求职意向和自我评价',
    parameters: {
      type: 'object',
      properties: {
        basic_info: {
          type: 'object',
          description: '候选人基本信息',
          properties: {
            name: { type: 'string', description: '候选人姓名' },
            gender: { type: 'string', enum: ['男', '女', null], description: '性别' },
            phone: { type: 'string', description: '手机号码，11位中国大陆手机号' },
            email: { type: 'string', description: '电子邮箱地址' },
            age: { type: 'integer', description: '年龄' },
            city: { type: 'string', description: '所在城市' },
            years_of_experience: { type: 'integer', description: '工作年限' },
          },
          required: ['name'],
        },
        education: {
          type: 'array',
          description: '教育经历列表',
          items: {
            type: 'object',
            properties: {
              school: { type: 'string', description: '学校名称' },
              major: { type: 'string', description: '专业' },
              degree: { type: 'string', description: '学历：高中/中专/大专/本科/硕士/博士/MBA' },
              start_date: { type: 'string', description: '入学时间，格式 YYYY-MM 或 YYYY-MM-DD' },
              end_date: { type: 'string', description: '毕业时间，格式 YYYY-MM 或 YYYY-MM-DD' },
            },
            required: ['school'],
          },
        },
        work_experience: {
          type: 'array',
          description: '工作经历列表（不包含项目经历）',
          items: {
            type: 'object',
            properties: {
              company: { type: 'string', description: '公司名称' },
              position: { type: 'string', description: '职位名称' },
              start_date: { type: 'string', description: '入职时间' },
              end_date: { type: 'string', description: '离职时间，至今则填"至今"' },
              description: { type: 'string', description: '工作描述，最多150字' },
            },
            required: ['company'],
          },
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: '技能列表',
        },
        certificates: {
          type: 'array',
          items: { type: 'string' },
          description: '证书/资质列表',
        },
        expected_position: { type: 'string', description: '期望岗位' },
        expected_salary: { type: 'string', description: '期望薪资，保留原始表述（如"8-12K"）' },
        self_evaluation: { type: 'string', description: '自我评价，最多200字' },
      },
      required: ['basic_info'],
    },
  },
};

// 基础 System Prompt
const BASE_SYSTEM_PROMPT = `你是一位专业的招聘系统简历解析助手。请从用户提供的简历文本中，使用 extract_resume 工具提取结构化信息。

规则：
- 只提取明确出现在简历中的信息，不要猜测或编造
- 如果某项信息未找到，对应的字段不要出现在输出中（不要输出 null 或空字符串）
- 手机号码应为 11 位中国大陆手机号
- 日期格式统一为 YYYY-MM 或 YYYY-MM-DD
- 学历取值：高中/中专/大专/本科/硕士/博士/MBA
- 工作经历和项目经历要区分（项目经历不提取到 work_experience 中）
- 期望薪资若以范围形式出现（如"8-12K"），保留原始表述
- 自我评价最多提取 200 字`;

/**
 * 主入口
 */
exports.main = async (event, context) => {
  const { resumeText } = event;

  // 参数校验
  if (!resumeText || resumeText.trim().length === 0) {
    return { success: false, error: '简历文本为空' };
  }

  if (!DEEPSEEK_API_KEY) {
    console.error('[resume-parser-proxy] DEEPSEEK_API_KEY 环境变量未配置');
    return { success: false, error: 'AI解析服务密钥未配置，请在云函数环境变量中设置' };
  }

  try {
    // 构建增强 System Prompt（含修正案例库 few-shot examples）
    const systemPrompt = await buildSystemPrompt(db, BASE_SYSTEM_PROMPT);

    console.log(`[resume-parser-proxy] 开始解析，文本长度: ${resumeText.length}`);

    // 调用 DeepSeek API
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: resumeText },
        ],
        tools: [EXTRACT_RESUME_TOOL],
        tool_choice: 'required',
      }),
      signal: AbortSignal.timeout(25000), // 25 秒超时（云函数 30s 超时留 5s buffer）
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[resume-parser-proxy] DeepSeek API 错误 HTTP ${response.status}: ${errorBody}`);

      // 写入 ErrorLog
      try {
        await db.collection('ErrorLog').add({
          type: 'cloudFunction',
          source: 'resume-parser-proxy',
          message: `AI解析服务请求失败（状态码 ${response.status}）`,
          context: { status: response.status, body: errorBody.slice(0, 500) },
          severity: response.status === 402 ? 'critical' : 'warning',
          createdAt: new Date(),
        });
      } catch (_) { /* 静默 */ }

      if (response.status === 402) {
        return { success: false, error: 'AI解析服务余额不足，请联系管理员充值' };
      }
      return { success: false, error: `AI解析服务返回异常（状态码 ${response.status}）` };
    }

    const data = await response.json();

    // 提取 tool_calls 结果
    const message = data.choices?.[0]?.message;
    if (!message || !message.tool_calls || message.tool_calls.length === 0) {
      console.error('[resume-parser-proxy] DeepSeek 未返回 tool_calls:', JSON.stringify(data).slice(0, 500));
      return { success: false, error: 'AI解析未返回有效结果，请重试' };
    }

    const toolCall = message.tool_calls[0];
    let parsed;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      console.error('[resume-parser-proxy] tool_calls 参数 JSON 解析失败:', toolCall.function.arguments.slice(0, 500));
      return { success: false, error: 'AI解析结果解析失败，请重试' };
    }

    console.log(`[resume-parser-proxy] 解析成功, tokens: ${data.usage?.total_tokens || '未知'}`);

    return {
      success: true,
      data: parsed,
      meta: {
        model: data.model,
        usage: data.usage, // { prompt_tokens, completion_tokens, total_tokens }
      },
    };
  } catch (err) {
    console.error('[resume-parser-proxy] 异常:', err.message);

    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';

    return {
      success: false,
      error: isTimeout
        ? 'AI解析服务调用超时或网络异常，请重试'
        : `解析失败: ${err.message}`,
    };
  }
};
