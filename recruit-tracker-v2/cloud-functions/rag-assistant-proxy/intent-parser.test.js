/**
 * intent-parser.test.js — 意图 JSON 解析的回归测试
 *
 * 起因（2026-09-14 生产冒烟测试实测）：
 *   [rag-assistant-proxy] 意图识别失败，回退到 general:
 *   Expected ',' or '}' after property value in JSON at position 41
 *
 * 根因：旧实现用非贪婪正则 /\{[\s\S]*?\}/ 提取 JSON，而模型按 schema 返回的内容里
 * 有嵌套对象 entities，非贪婪匹配在第一个内层 `}` 处就截断，截出的片段不是合法 JSON。
 * 后果：识别到的 intent 恒为 general，RAG 管道的「按岗位类型匹配历史洞察」与
 * 「意图分支指令」两步永远不会触发，AI 助手退化成通用问答。
 *
 * 本文件锁死修复后的行为，防止有人改回正则。
 */

import { describe, it, expect } from 'vitest';
import { parseIntent, extractBalancedJson, fallbackIntent, VALID_INTENTS } from './intent-parser';

/** 按 rag-assistant-proxy 的 system prompt schema 拼一个合法返回 */
function schemaJson(overrides = {}) {
  return JSON.stringify({
    intent: 'write_jd',
    entities: { jobType: '销售顾问', department: '', city: '广州' },
    keywords: ['销售', 'JD'],
    category: 'jd_template',
    ...overrides,
  });
}

describe('intent-parser — 正常场景', () => {
  it('解析含嵌套 entities 的完整 JSON（这是旧正则翻车的那一种）', () => {
    const r = parseIntent(schemaJson());
    expect(r.intent).toBe('write_jd');
    expect(r.entities).toEqual({ jobType: '销售顾问', department: '', city: '广州' });
    expect(r.keywords).toEqual(['销售', 'JD']);
    expect(r.category).toBe('jd_template');
  });

  it('解析带缩进换行的美化 JSON（模型最常见的输出形态）', () => {
    const text = `{
  "intent": "answer_question",
  "entities": { "jobType": "", "department": "", "city": "" },
  "keywords": ["福利", "年假"],
  "category": "benefits"
}`;
    const r = parseIntent(text);
    expect(r.intent).toBe('answer_question');
    expect(r.category).toBe('benefits');
    expect(r.keywords).toEqual(['福利', '年假']);
  });

  it('解析被 ```json 代码块包裹的 JSON', () => {
    const text = '```json\n' + schemaJson({ intent: 'analyze_candidate' }) + '\n```';
    expect(parseIntent(text).intent).toBe('analyze_candidate');
  });

  it('JSON 前后带模型的多余解释文字', () => {
    const text = `好的，我来分析一下用户的意图。
${schemaJson({ intent: 'recruitment_advice' })}
以上是分类结果，请查收。`;
    expect(parseIntent(text).intent).toBe('recruitment_advice');
  });
});

describe('intent-parser — 边界场景', () => {
  it('entities 为空对象时不报错', () => {
    const r = parseIntent(schemaJson({ entities: {} }));
    expect(r.entities).toEqual({});
    expect(r.intent).toBe('write_jd');
  });

  it('缺失 keywords 时归一为 []', () => {
    const r = parseIntent(JSON.stringify({ intent: 'general' }));
    expect(r.keywords).toEqual([]);
    expect(r.entities).toEqual({});
  });

  it('keywords 混入非字符串时过滤掉而不是抛错', () => {
    // 关键：下游 retrieveKnowledge 会对每个 keyword 调 toLowerCase()，
    // 混入数字/null 会在那里抛错并被 catch 吞掉，导致知识库检索静默失效。
    const r = parseIntent(schemaJson({ keywords: ['销售', 123, null, '', { a: 1 }] }));
    expect(r.keywords).toEqual(['销售']);
  });

  it('字符串值里含花括号时不误判括号层级', () => {
    const r = parseIntent(schemaJson({ entities: { jobType: '销售{顾问}', city: '' } }));
    expect(r.entities.jobType).toBe('销售{顾问}');
  });

  it('字符串值里含转义引号时不误判', () => {
    const r = parseIntent(JSON.stringify({
      intent: 'general',
      entities: { jobType: 'a"b\\c' },
      keywords: [],
    }));
    expect(r.entities.jobType).toBe('a"b\\c');
  });

  it('返回多个 JSON 对象时取第一个完整的', () => {
    const text = `${schemaJson({ intent: 'write_jd' })}\n${schemaJson({ intent: 'answer_question' })}`;
    expect(parseIntent(text).intent).toBe('write_jd');
  });

  it('散文里先出现一对配平的花括号时，继续往后找真正的 JSON', () => {
    const text = `分类格式为 {intent, entities} 三部分。结果如下：\n${schemaJson({ intent: 'write_jd' })}`;
    expect(parseIntent(text).intent).toBe('write_jd');
  });
});

describe('intent-parser — 异常场景（一律安全降级，不抛错）', () => {
  const badInputs = [
    ['空字符串', ''],
    ['null', null],
    ['undefined', undefined],
    ['纯散文', '我不太确定用户想干什么。'],
    ['被 max_tokens 截断的 JSON', '{\n  "intent": "write_jd",\n  "entities": { "jobType": "销'],
    ['json 字面量但不是对象', '[1, 2, 3]'],
    ['括号不配平', '{{{'],
  ];

  for (const [name, input] of badInputs) {
    it(`${name} → 回退到 general 且不抛错`, () => {
      expect(() => parseIntent(input)).not.toThrow();
      const r = parseIntent(input);
      expect(r.intent).toBe('general');
      expect(r.entities).toEqual({});
      expect(r.keywords).toEqual([]);
    });
  }

  it('intent 是合法 JSON 但取值不在白名单内 → 归一为 general', () => {
    const r = parseIntent(schemaJson({ intent: 'delete_everything' }));
    expect(r.intent).toBe('general');
  });

  it('entities 是数组（模型跑偏）→ 归一为 {}', () => {
    const r = parseIntent(JSON.stringify({ intent: 'general', entities: ['销售'] }));
    expect(r.entities).toEqual({});
  });
});

describe('intent-parser — fallbackIntent 每次返回新对象', () => {
  it('不共享引用，避免调用方改动污染后续调用', () => {
    const a = fallbackIntent();
    a.keywords.push('污染');
    expect(fallbackIntent().keywords).toEqual([]);
  });

  it('白名单与 rag-assistant-proxy 的 system prompt schema 一致', () => {
    expect(VALID_INTENTS).toEqual([
      'write_jd', 'answer_question', 'analyze_candidate', 'recruitment_advice', 'general',
    ]);
  });
});

describe('extractBalancedJson — 括号配对截取', () => {
  it('嵌套对象整体截出，不再在内层 } 处断掉', () => {
    const inner = '{"intent":"general","entities":{"jobType":"x"}}';
    expect(extractBalancedJson(inner)).toBe(inner);
  });

  it('从指定位置起找', () => {
    expect(extractBalancedJson('xx{"a":1}yy', 2)).toBe('{"a":1}');
  });

  it('括号不配平时返回 null', () => {
    expect(extractBalancedJson('{"a":')).toBeNull();
  });

  it('没有任何 { 时返回 null', () => {
    expect(extractBalancedJson('abc')).toBeNull();
  });
});
