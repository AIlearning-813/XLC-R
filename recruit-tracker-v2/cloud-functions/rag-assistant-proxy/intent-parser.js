/**
 * intent-parser.js — 从模型返回的文本里稳健地提取意图 JSON
 *
 * 为什么单独成模块：原先这段逻辑内联在 index.js 的 recognizeIntent 里，只用
 * 非贪婪正则 /\{[\s\S]*?\}/ 提取。但模型按 system prompt 的 schema 返回的内容里有
 * 嵌套对象 entities：
 *
 *   {"intent":"write_jd","entities":{"jobType":"销售顾问"},...}
 *                                       ^ 非贪婪匹配在这里就闭合了
 *
 * 截出的片段不是合法 JSON，JSON.parse 抛「Expected ',' or '}' after property value」，
 * 被 catch 吞掉后统一降级为 general —— 于是意图识别恒定返回 general，
 * RAG 管道的「按岗位类型匹配历史洞察」和「意图分支指令」两步永远不触发。
 *
 * 本模块改用括号配对扫描，能正确处理嵌套对象、字符串内的花括号与转义字符、
 * 以及 JSON 前后夹杂的模型废话。零依赖，纯函数，随手可测。
 *
 * 回归测试见同目录 intent-parser.test.js。
 */

/** 与 recognizeIntent 的 system prompt schema 保持一致 */
const VALID_INTENTS = [
  'write_jd',
  'answer_question',
  'analyze_candidate',
  'recruitment_advice',
  'general',
];

/** 缺省返回：每次新对象，避免调用方改动污染后续调用 */
function fallbackIntent() {
  return { intent: 'general', entities: {}, keywords: [] };
}

/**
 * 从 fromIndex 起的第一个 `{` 开始，截出「括号配对完整」的片段。
 *
 * 扫描时会跟踪是否处于字符串字面量内部，因此：
 *   - 嵌套对象整体截出（旧正则的病根）
 *   - `"jobType": "销售{顾问}"` 这类值里的花括号不干扰层级
 *   - `\"` 转义引号不会被误认为字符串结束
 *
 * @returns {string|null} 配对成功的片段；括号不配平（输出被截断）或无 `{` 时返回 null
 */
function extractBalancedJson(text, fromIndex = 0) {
  if (typeof text !== 'string') return null;

  const start = text.indexOf('{', fromIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null; // 括号没配平，说明模型输出被截断
}

/**
 * 依次尝试文本里每一个 `{` 起点，返回第一个能解析成对象的 JSON。
 *
 * 逐个尝试而非只取第一个，是为了处理「散文里先出现一对配平的花括号」的情况，
 * 例如：`分类格式为 {intent, entities} 三部分。结果：{"intent":"write_jd"}`
 */
function parseFirstJsonObject(text) {
  if (typeof text !== 'string') return null;

  let from = 0;
  while (from <= text.length) {
    const candidate = extractBalancedJson(text, from);
    if (candidate === null) return null;

    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch {
      // 这一段不是合法 JSON，从它的下一个字符继续找
    }

    from = text.indexOf('{', from) + 1;
    if (from <= 0) return null;
  }
  return null;
}

/** 归一为 string[]，丢掉非字符串与空串 */
function normalizeKeywords(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(k => typeof k === 'string' && k.length > 0);
}

/** 归一为普通对象，数组/原始值一律视为缺失 */
function normalizeEntities(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

/**
 * 解析模型返回的意图 JSON。任何异常输入都安全降级为 general，绝不抛错。
 *
 * @param {string} text 模型返回的原始文本
 * @returns {{intent: string, entities: object, keywords: string[], category?: string}}
 */
function parseIntent(text) {
  const obj = parseFirstJsonObject(text);
  if (!obj) return fallbackIntent();

  return {
    // 白名单外的取值一律归一为 general，不把模型的臆造值透传给下游 switch
    intent: VALID_INTENTS.includes(obj.intent) ? obj.intent : 'general',
    entities: normalizeEntities(obj.entities),
    keywords: normalizeKeywords(obj.keywords),
    category: typeof obj.category === 'string' ? obj.category : 'general',
  };
}

module.exports = { parseIntent, extractBalancedJson, fallbackIntent, VALID_INTENTS };
