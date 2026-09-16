/**
 * CloudBase SDK Mock — 测试用假后端
 *
 * 覆盖: db() / auth() / storage() / callFunction() / isReady() / db.command.* / db.command.aggregate.*
 * 链式调用: .collection().where().orderBy().limit().field().get() / .add() / .count() / .aggregate()
 *
 * 用法:
 *   // vitest.setup.js 自动挂载，测试中直接 import cloudbase 即可
 *   import cloudbase from './cloudbase';
 *   cloudbase.__setCollectionData('Candidate', [{ _id: 'c1', name: '张三' }]);
 *   const { data } = await cloudbase.db().collection('Candidate').where({...}).get();
 *
 *   // 每个测试前自动调用 __resetAll()
 *
 * ---------------------------------------------------------------------------
 * D-2 补强说明（为什么匹配引擎要写这么细）
 *
 * 旧版 mock 的匹配层有几个「静默失真」点，会让测试**假绿**：
 *   1. `__exec()` 的 `default: break` —— 遇到不认识的运算符直接**忽略该条件**，
 *      不报错。而生产代码里 gt/lt/gte 有 14 处调用，旧 mock 全部当作「无此条件」，
 *      于是带范围过滤的逻辑在测试里等于没过滤。现已改为**抛错**（可用
 *      `__allowUnknownOperators(true)` 临时放行）。
 *   2. `.where()` 旧实现是**合并**，而真实 SDK 是**替换**（`Query.where()` 把
 *      `_fieldFilters` 整个换成新条件，旧条件丢失）。已按真实语义改为替换，
 *      否则「链式 where 丢条件」这类 bug 在测试里永远暴露不出来。
 *   3. 字段值缺失时 `{field: null}` 在 MongoDB 里**同时匹配 null 与缺字段**，
 *      旧 mock 把 null 条件当「无条件」跳过。已按真实语义实现。
 *   4. `orderBy` 相等时返回 -1（违反反对称性）。已改为返回 0，并保留
 *      「缺失值排最后」的既有约定。**且 chain 调用改为直接抛错**：
 *      曾按「链式会累加」实现，而真实 SDK 恰恰相反——链式会静默丢掉主排序键
 *      （见 orderBy 方法的注释）。这条假象让 D-2 的下推排序在 mock 里全绿、
 *      到生产才露馅，故不再模拟「累加」，而是把链式变成硬错误。
 *   5. 无 `aggregate()`。已实现，且 `stageValue` 按真实 SDK 用 **EJSON 字符串**存储，
 *      使「不能 EJSON 序列化的载荷」在 mock 里就会炸，而不是拖到线上。
 * ---------------------------------------------------------------------------
 */

import { vi } from 'vitest';
import { EJSON } from 'bson';

// ===== 内存数据库 =====
let __collections = {};
let __callFunctionResults = {};
let __authState = { loggedIn: true, uid: 'test-uid-001' };
let __queryLog = [];
let __aggregateLog = [];   // 聚合单独记日志：D-1 的请求数断言口径不能被污染
let __queryDelay = 0;   // >0 时每次 .get() 模拟网络延迟，用于度量并发度
let __inFlight = 0;
let __maxInFlight = 0;
let __countOverride = {}; // 集合 -> 强制 count() 返回值（模拟安全规则过滤导致 count 偏小）
let __countError = {};    // 集合 -> count() 抛错（模拟 count 不可用）
let __aggregateError = {}; // 集合 -> aggregate().end() 抛错（模拟聚合不可用 / 被规则拒绝）
let __allowUnknownOps = false; // 是否放行未知运算符（默认抛错，见文件头说明）

/**
 * 强制某集合的 count() 返回指定值（用于验证「count 偏小时不截断」的兜底逻辑）。
 * value 也可以是 `({conditions, logic, real}) => number`，用于按查询条件区别对待。
 */
export function __setCountOverride(name, value) {
  __countOverride[name] = value;
}

/** 让某集合的 count() 抛错（用于验证回退路径） */
export function __setCountError(name, on = true) {
  __countError[name] = !!on;
}

/** 让某集合的 aggregate().end() 抛错（用于验证聚合不可用时的降级路径） */
export function __setAggregateError(name, on = true) {
  __aggregateError[name] = !!on;
}

/** 放行未知运算符（默认 false = 抛错，防止条件被静默忽略） */
export function __allowUnknownOperators(on = true) {
  __allowUnknownOps = !!on;
}

/** 重置所有 mock 状态（在每个测试前自动调用） */
export function __resetAll() {
  __collections = {};
  __callFunctionResults = {};
  __authState = { loggedIn: true, uid: 'test-uid-001' };
  __queryLog = [];
  __aggregateLog = [];
  __queryDelay = 0;
  __inFlight = 0;
  __maxInFlight = 0;
  __countOverride = {};
  __countError = {};
  __aggregateError = {};
  __allowUnknownOps = false;
}

/** 设置每次 .get() 的模拟网络延迟（毫秒）；0 = 关闭（默认） */
export function __setQueryDelay(ms) {
  __queryDelay = ms || 0;
}

/** 本次测试中出现过的最大并发在途查询数（>1 即证明存在并发） */
export function __getMaxInFlight() {
  return __maxInFlight;
}

function __enterQuery() {
  __inFlight += 1;
  if (__inFlight > __maxInFlight) __maxInFlight = __inFlight;
}

function __exitQuery() {
  __inFlight -= 1;
}

/**
 * 记录一次 .get() 查询（仅记录元信息，不记录数据）
 * 用途：给"首屏网络往返次数"这类性能断言提供度量口径
 */
function __logQuery(collection, { skip = null, limit = null } = {}) {
  __queryLog.push({ collection, skip, limit });
}

/** 获取查询日志（副本） */
export function __getQueryLog() {
  return __queryLog.slice();
}

/** 按集合统计查询次数（不含聚合；聚合见 __countAggregates） */
export function __countQueries(collection) {
  return __queryLog.filter((q) => q.collection === collection).length;
}

/** 清空查询日志（不影响数据） */
export function __resetQueryLog() {
  __queryLog = [];
}

/** 获取聚合日志（副本） */
export function __getAggregateLog() {
  return __aggregateLog.slice();
}

/** 按集合统计聚合次数（与 __countQueries 分开计数） */
export function __countAggregates(collection) {
  return __aggregateLog.filter((q) => q.collection === collection).length;
}

/** 清空聚合日志 */
export function __resetAggregateLog() {
  __aggregateLog = [];
}

/** 设置 mock 集合数据 */
export function __setCollectionData(name, data) {
  __collections[name] = data.map((doc, i) => ({
    _id: doc._id || `mock_${name}_${i}`,
    ...doc,
  }));
}

/** 设置 mock 云函数返回值 */
export function __setCallFunctionResult(name, result) {
  __callFunctionResults[name] = result;
}

/** 获取 mock 集合数据（用于断言） */
export function __getCollectionData(name) {
  return __collections[name] || [];
}

/** 获取集合文档数量 */
export function __getCollectionCount(name) {
  return (__collections[name] || []).length;
}

// ===================== 条件匹配引擎（对齐 MongoDB 语义） =====================

const LOGIC_OPS = new Set(['or', 'and', 'nor']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function isCommandObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.__command === 'string';
}

function isLogicCommand(v) {
  return isCommandObject(v) && LOGIC_OPS.has(v.__command);
}

/** 读取字段值，支持点路径（funnelMeta.entrySource） */
export function getPath(doc, path) {
  if (doc == null) return undefined;
  if (!path.includes('.')) return doc[path];
  let cur = doc;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** 归一化为可比较值：Date 与 ISO 日期串统一成时间戳，其余原样 */
function toComparable(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && ISO_DATE_RE.test(v)) return Date.parse(v);
  return v;
}

/**
 * 相等判定（MongoDB 语义）：
 *   - 查询值为 null 时，**同时匹配 null 与缺字段**
 *   - 任一侧是 Date 时按时间戳比较（夹具多用 ISO 串，生产存 Date，必须打通）
 */
function looseEq(a, b) {
  if (b === null) return a === null || a === undefined;
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return toComparable(a) === toComparable(b);
  return false;
}

/** 大小比较（供 gt/gte/lt/lte 与排序使用） */
function cmpValues(a, b) {
  const av = toComparable(a);
  const bv = toComparable(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

/**
 * 遇到未建模的运算符时：默认**抛错**；逃生开关打开时返回 true = 忽略该条件
 * （即还原旧版 `default: break` 的宽松行为）。
 */
function shouldIgnoreUnknownOp(where, op) {
  if (__allowUnknownOps) return true;
  throw new Error(
    `[cloudbase-mock] 未知运算符 "${op}"（出现在 ${where}）。` +
    `旧版 mock 会静默忽略该条件导致测试假绿；若确需放行请调用 __allowUnknownOperators(true)。`
  );
}

/** 字段级逻辑运算符：子条件作用于「该字段的值」而非整个文档 */
function matchFieldLogic(dv, cmd) {
  const subs = Array.isArray(cmd.value) ? cmd.value : [cmd.value];
  const test = (s) => (isCommandObject(s) ? matchFieldCommand(dv, s) : matchCondition(dv, s));
  if (cmd.__command === 'or') return subs.some(test);
  if (cmd.__command === 'and') return subs.every(test);
  return !subs.some(test); // nor
}

/** 字段级运算符 */
function matchFieldCommand(dv, cmd) {
  const v = cmd.value;
  switch (cmd.__command) {
    case 'eq': return looseEq(dv, v);
    case 'neq': return !looseEq(dv, v);
    // 范围运算符对「缺字段 / null」一律不匹配（MongoDB 同此）
    case 'gt': return dv !== undefined && dv !== null && cmpValues(dv, v) > 0;
    case 'gte': return dv !== undefined && dv !== null && cmpValues(dv, v) >= 0;
    case 'lt': return dv !== undefined && dv !== null && cmpValues(dv, v) < 0;
    case 'lte': return dv !== undefined && dv !== null && cmpValues(dv, v) <= 0;
    // $in / $nin 里的 null 同样匹配缺字段（这正是 jobId $nin ['',null] 能排除空串与缺失的依据）
    case 'in': return (v || []).some((x) => looseEq(dv, x));
    case 'nin': return !(v || []).some((x) => looseEq(dv, x));
    case 'exists': return v ? dv !== undefined : dv === undefined;
    case 'all': return (v || []).every((x) => Array.isArray(dv) && dv.some((y) => looseEq(y, x)));
    case 'size': return Array.isArray(dv) && dv.length === v;
    case 'or':
    case 'and':
    case 'nor': return matchFieldLogic(dv, cmd);
    default:
      return shouldIgnoreUnknownOp('字段条件', `$${cmd.__command}`);
  }
}

/** 字段条件：普通值 / 命令对象 */
function matchCondition(dv, cond) {
  if (isCommandObject(cond)) return matchFieldCommand(dv, cond);
  if (cond === null) return dv === null || dv === undefined;
  // MongoDB：标量条件可命中数组元素
  if (Array.isArray(dv) && typeof cond !== 'object') return dv.some((x) => looseEq(x, cond));
  return looseEq(dv, cond);
}

/** 文档级逻辑运算符（子条件是完整查询对象） */
function matchLogic(doc, cmd) {
  const subs = Array.isArray(cmd.value) ? cmd.value : [cmd.value];
  if (cmd.__command === 'or') return subs.some((s) => matchQuery(doc, s));
  if (cmd.__command === 'and') return subs.every((s) => matchQuery(doc, s));
  return !subs.some((s) => matchQuery(doc, s)); // nor
}

function matchQuery(doc, q) {
  if (isLogicCommand(q)) return matchLogic(doc, q);
  return matchDoc(doc, q);
}

/**
 * 判定单个文档是否满足条件组。
 * 注意：undefined 的条件值被跳过（沿用既有约定，便于可选筛选项写法）；
 * null 不再跳过 —— 它是有语义的查询值（匹配 null 或缺字段）。
 */
function matchDoc(doc, conditions) {
  if (!conditions) return true;
  if (isLogicCommand(conditions)) return matchLogic(doc, conditions);
  for (const [key, cond] of Object.entries(conditions)) {
    if (cond === undefined) continue;
    if (isLogicCommand(cond)) {
      if (!matchLogic(doc, cond)) return false;
      continue;
    }
    if (!matchCondition(getPath(doc, key), cond)) return false;
  }
  return true;
}

/** 排序比较：缺失值排最后（沿用既有约定），相等返回 0（旧版返回 -1，违反反对称性） */
function compareForSort(va, vb, dir) {
  const am = va === undefined || va === null;
  const bm = vb === undefined || vb === null;
  if (am && bm) return 0;
  if (am) return 1;
  if (bm) return -1;
  const c = cmpValues(va, vb);
  return dir === 'desc' ? -c : c;
}

/** 多字段排序（字段顺序即优先级） */
function applySort(docs, order) {
  if (!order || order.length === 0) return docs;
  return docs.sort((a, b) => {
    for (const { field, dir } of order) {
      const r = compareForSort(getPath(a, field), getPath(b, field), dir);
      if (r !== 0) return r;
    }
    return 0;
  });
}

// ===================== 聚合表达式求值 =====================

const ACCUMULATORS = new Set(['$max', '$min', '$sum', '$avg', '$first', '$last', '$push', '$addToSet', '$count']);

const AGG_OPERATOR_NAMES = [
  'abs', 'add', 'ceil', 'divide', 'exp', 'floor', 'ln', 'log', 'log10', 'mod', 'multiply',
  'pow', 'sqrt', 'subtract', 'trunc', 'arrayElemAt', 'arrayToObject', 'concatArrays', 'filter',
  'in', 'indexOfArray', 'isArray', 'map', 'range', 'reduce', 'reverseArray', 'size', 'slice', 'zip',
  'and', 'not', 'or', 'cmp', 'eq', 'gt', 'gte', 'lt', 'lte', 'neq', 'cond', 'ifNull', 'switch',
  'dateFromParts', 'dateFromString', 'dayOfMonth', 'dayOfWeek', 'dayOfYear', 'isoDayOfWeek',
  'isoWeek', 'isoWeekYear', 'millisecond', 'minute', 'month', 'second', 'hour', 'week', 'year',
  'literal', 'mergeObjects', 'objectToArray', 'allElementsTrue', 'anyElementTrue', 'setDifference',
  'setEquals', 'setIntersection', 'setIsSubset', 'setUnion', 'concat', 'dateToString',
  'indexOfBytes', 'indexOfCP', 'split', 'strLenBytes', 'strLenCP', 'strcasecmp', 'substr',
  'substrBytes', 'substrCP', 'toLower', 'toUpper', 'meta', 'addToSet', 'avg', 'first', 'last',
  'max', 'min', 'push', 'stdDevPop', 'stdDevSamp', 'sum', 'let',
];

/** 求值一个聚合表达式（支持 '$field' 引用、运算符对象、数组、常量） */
function aggEval(expr, doc) {
  if (typeof expr === 'string' && expr.startsWith('$')) return getPath(doc, expr.slice(1));
  if (expr === null || typeof expr !== 'object') return expr;
  if (Array.isArray(expr)) return expr.map((e) => aggEval(e, doc));
  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0].startsWith('$')) return aggEvalOp(keys[0], expr[keys[0]], doc);
  const out = {};
  for (const k of keys) out[k] = aggEval(expr[k], doc);
  return out;
}

/** 取运算符参数并求值为数组（参数为数组时逐项求值） */
function aggArgs(arg, doc) {
  return Array.isArray(arg) ? arg.map((x) => aggEval(x, doc)) : [aggEval(arg, doc)];
}

function aggEvalOp(op, arg, doc) {
  switch (op) {
    case '$literal': return arg;
    case '$ifNull': { const [x, y] = aggArgs(arg, doc); return x === null || x === undefined ? y : x; }
    case '$eq': { const [x, y] = aggArgs(arg, doc); return looseEq(x, y); }
    case '$ne': { const [x, y] = aggArgs(arg, doc); return !looseEq(x, y); }
    case '$gt': { const [x, y] = aggArgs(arg, doc); return cmpValues(x, y) > 0; }
    case '$gte': { const [x, y] = aggArgs(arg, doc); return cmpValues(x, y) >= 0; }
    case '$lt': { const [x, y] = aggArgs(arg, doc); return cmpValues(x, y) < 0; }
    case '$lte': { const [x, y] = aggArgs(arg, doc); return cmpValues(x, y) <= 0; }
    case '$and': return aggArgs(arg, doc).every(Boolean);
    case '$or': return aggArgs(arg, doc).some(Boolean);
    case '$not': { const [x] = aggArgs(arg, doc); return !x; }
    case '$cond': {
      const parts = aggArgs(arg, doc);
      if (parts.length === 3) return parts[0] ? parts[1] : parts[2];
      // 对象形式 {$cond:{if,then,else}}
      const o = aggEval(arg, doc);
      return o.if ? o.then : o.else;
    }
    case '$add': return aggArgs(arg, doc).reduce((s, v) => s + (Number(v) || 0), 0);
    case '$subtract': { const [x, y] = aggArgs(arg, doc); return (Number(x) || 0) - (Number(y) || 0); }
    case '$multiply': return aggArgs(arg, doc).reduce((s, v) => s * (Number(v) || 0), 1);
    case '$divide': { const [x, y] = aggArgs(arg, doc); return Number(x) / Number(y); }
    case '$concat': return aggArgs(arg, doc).map((v) => (v == null ? '' : String(v))).join('');
    case '$toLower': { const [x] = aggArgs(arg, doc); return x == null ? '' : String(x).toLowerCase(); }
    case '$toUpper': { const [x] = aggArgs(arg, doc); return x == null ? '' : String(x).toUpperCase(); }
    case '$size': { const [x] = aggArgs(arg, doc); return Array.isArray(x) ? x.length : 0; }
    case '$in': { const [x, arr] = aggArgs(arg, doc); return Array.isArray(arr) && arr.some((y) => looseEq(y, x)); }
    case '$arrayElemAt': { const [arr, i] = aggArgs(arg, doc); return Array.isArray(arr) ? arr[i] : null; }
    case '$sum':
    case '$max':
    case '$min':
    case '$avg': {
      // 表达式语境（非 $group）下这些按数组参数求值
      const vals = Array.isArray(arg) && arg.length === 1 && Array.isArray(arg[0])
        ? aggEval(arg[0], doc)
        : aggArgs(arg, doc);
      const nums = (vals || []).filter((v) => typeof v === 'number');
      if (op === '$sum') return nums.reduce((s, v) => s + v, 0);
      if (op === '$max') return nums.length ? Math.max(...nums) : null;
      if (op === '$min') return nums.length ? Math.min(...nums) : null;
      return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
    }
    default:
      shouldIgnoreUnknownOp('聚合表达式', op);
      return null;
  }
}

/** 求值累加器（$group 的输出字段） */
function evalAccumulator(spec, docs) {
  const keys = Object.keys(spec || {});
  if (keys.length === 1 && ACCUMULATORS.has(keys[0])) {
    const op = keys[0];
    const arg = spec[op];
    const vals = docs.map((d) => aggEval(arg, d));
    switch (op) {
      case '$max': return vals.length ? vals.reduce((a, b) => (cmpValues(b, a) > 0 ? b : a)) : null;
      case '$min': return vals.length ? vals.reduce((a, b) => (cmpValues(b, a) < 0 ? b : a)) : null;
      case '$sum': return vals.reduce((s, v) => s + (Number(v) || 0), 0);
      case '$avg': return vals.length ? vals.reduce((s, v) => s + (Number(v) || 0), 0) / vals.length : null;
      case '$first': return vals.length ? vals[0] : null;
      case '$last': return vals.length ? vals[vals.length - 1] : null;
      case '$push': return vals;
      case '$addToSet': return vals.filter((v, i) => vals.findIndex((x) => looseEq(x, v)) === i);
      case '$count': return docs.length;
      default: return null;
    }
  }
  // 常量 / 普通表达式：以组内首条文档为求值上下文
  return aggEval(spec, docs[0] || {});
}

// ===================== 聚合管道 =====================

/**
 * Mock 聚合管道。
 * stageValue 按真实 SDK 的 `stringifyByEJSON(relaxed:false)` 存成 **EJSON 字符串**，
 * 这样「不能 EJSON 序列化的载荷」在 mock 里就会暴露（例如 undefined / 函数 / 类实例）。
 */
class MockAggregation {
  constructor(collectionName) {
    this._collection = collectionName;
    this._stages = [];
  }

  _pipe(stage, param) {
    const value = param !== null && typeof param === 'object'
      ? EJSON.stringify(param, { relaxed: false })
      : JSON.stringify(param);
    this._stages.push({ stageKey: `$${stage}`, stageValue: value });
    return this;
  }

  match(p) { return this._pipe('match', p); }
  group(p) { return this._pipe('group', p); }
  count(p) { return this._pipe('count', p); }
  sort(p) { return this._pipe('sort', p); }
  skip(n) { return this._pipe('skip', n); }
  limit(n) { return this._pipe('limit', n); }
  project(p) { return this._pipe('project', p); }
  addFields(p) { return this._pipe('addFields', p); }
  unwind(p) { return this._pipe('unwind', p); }

  unwrap() { return this._stages; }

  async end() {
    __aggregateLog.push({
      collection: this._collection,
      stages: this._stages.map((s) => s.stageKey),
      // 参数另存一份（按真实 SDK 的口径从 EJSON 字符串解回）：
      // 断言「排序键本身」必须能看到 $sort 的载荷，否则「漏写 _id tiebreaker」
      // 这类 bug 在 mock 里永远抓不到——JS 的稳定排序会替它掩盖。
      stageParams: this._stages.map((s) => (
        typeof s.stageValue === 'string' ? EJSON.parse(s.stageValue) : s.stageValue
      )),
    });
    __enterQuery();
    try {
      if (__aggregateError[this._collection]) throw new Error('aggregate not permitted');
      if (__queryDelay > 0) await new Promise((r) => setTimeout(r, __queryDelay));
      return { requestId: 'mock-req', data: this.__run() };
    } finally {
      __exitQuery();
    }
  }

  __run() {
    let docs = (__collections[this._collection] || []).map((d) => ({ ...d }));

    for (const { stageKey, stageValue } of this._stages) {
      const param = typeof stageValue === 'string' ? EJSON.parse(stageValue) : stageValue;
      switch (stageKey) {
        case '$match':
          docs = docs.filter((d) => matchDoc(d, param));
          break;
        case '$group': {
          const { _id, ...accs } = param;
          const buckets = new Map();
          for (const d of docs) {
            const key = aggEval(_id, d);
            const k = key !== null && typeof key === 'object' ? EJSON.stringify(key) : String(key);
            if (!buckets.has(k)) buckets.set(k, { key, docs: [] });
            buckets.get(k).docs.push(d);
          }
          docs = [...buckets.values()].map((b) => {
            const row = { _id: b.key };
            for (const [f, spec] of Object.entries(accs)) row[f] = evalAccumulator(spec, b.docs);
            return row;
          });
          break;
        }
        case '$count': {
          const field = typeof param === 'string' ? param : param && param.field;
          docs = docs.length ? [{ [field]: docs.length }] : [];
          break;
        }
        case '$sort':
          docs = applySort(docs, Object.entries(param).map(([field, dir]) => ({ field, dir: dir < 0 ? 'desc' : 'asc' })));
          break;
        case '$skip': docs = docs.slice(param > 0 ? param : 0); break;
        case '$limit': docs = docs.slice(0, param); break;
        case '$addFields':
          docs = docs.map((d) => {
            const extra = {};
            for (const [k, v] of Object.entries(param)) extra[k] = aggEval(v, d);
            return { ...d, ...extra };
          });
          break;
        case '$project': {
          const keys = Object.keys(param);
          const excluding = keys.filter((k) => param[k] === 0 || param[k] === false);
          docs = docs.map((d) => {
            if (excluding.length) {
              const o = { ...d };
              for (const k of excluding) delete o[k];
              return o;
            }
            const o = {};
            for (const k of keys) o[k] = param[k] === 1 || param[k] === true ? d[k] : aggEval(param[k], d);
            return o;
          });
          break;
        }
        case '$unwind': {
          const path = typeof param === 'string' ? param : param.path;
          const field = path.replace(/^\$/, '');
          const out = [];
          for (const d of docs) {
            const arr = getPath(d, field);
            if (Array.isArray(arr)) {
              for (const item of arr) out.push({ ...d, [field]: item });
            } else {
              out.push(d);
            }
          }
          docs = out;
          break;
        }
        default:
          shouldIgnoreUnknownOp('聚合阶段', stageKey);
      }
    }
    return docs;
  }
}

// ===== Mock Command 构建器 =====
const mockCommand = {
  // 查询类
  eq: (v) => ({ __command: 'eq', value: v }),
  neq: (v) => ({ __command: 'neq', value: v }),
  gt: (v) => ({ __command: 'gt', value: v }),
  gte: (v) => ({ __command: 'gte', value: v }),
  lt: (v) => ({ __command: 'lt', value: v }),
  lte: (v) => ({ __command: 'lte', value: v }),
  in: (arr) => ({ __command: 'in', value: arr }),
  nin: (arr) => ({ __command: 'nin', value: arr }),
  exists: (v) => ({ __command: 'exists', value: !!v }),
  all: (arr) => ({ __command: 'all', value: arr }),
  size: (n) => ({ __command: 'size', value: n }),
  // 逻辑类
  and: (conditions) => ({ __command: 'and', value: conditions }),
  or: (conditions) => ({ __command: 'or', value: conditions }),
  nor: (conditions) => ({ __command: 'nor', value: conditions }),
  // 更新类
  inc: (n) => ({ __command: 'inc', value: n }),
  mul: (n) => ({ __command: 'mul', value: n }),
  push: (item) => ({ __command: 'push', value: item }),
  pull: (v) => ({ __command: 'pull', value: v }),
  pop: () => ({ __command: 'pop' }),
  shift: () => ({ __command: 'shift' }),
  addToSet: (v) => ({ __command: 'addToSet', value: v }),
  set: (obj) => ({ __command: 'set', value: obj }),
  remove: () => ({ __command: 'remove' }),
  // 聚合表达式构造器（形状与真实 SDK 一致：{$名字: 参数}）
  aggregate: {},
};
for (const name of AGG_OPERATOR_NAMES) {
  if (!mockCommand.aggregate[name]) {
    mockCommand.aggregate[name] = (param) => ({ [`$${name}`]: param });
  }
}
mockCommand.aggregate.pipeline = () => new MockAggregation('');

// ===== Mock 链式查询构建器 =====
class MockQuery {
  constructor(collectionName) {
    this._collection = collectionName;
    this._conditions = {};
    this._logic = [];
    this._order = [];
    this._limitCount = null;
    this._skipCount = null;
    this._fieldFilter = null;
  }

  /** 浅拷贝（保留既有约定：where 返回新对象，limit/skip/orderBy 就地修改） */
  _clone() {
    const c = new MockQuery(this._collection);
    c._conditions = { ...this._conditions };
    c._logic = [...this._logic];
    c._order = [...this._order];
    c._limitCount = this._limitCount;
    c._skipCount = this._skipCount;
    c._fieldFilter = this._fieldFilter;
    return c;
  }

  /**
   * 注意：真实 SDK 的 `Query.where()` 是**替换** `_fieldFilters` 而非合并
   * （已用 SDK 实测确认：`.where(A).where(B)` 只剩 B）。这里如实还原，
   * 以便「链式 where 丢条件」这类 bug 能被测试发现。
   * 多条件请在**同一次** where 里传完。
   */
  where(conditions) {
    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
      throw new Error('[cloudbase-mock] where() 需要传入对象');
    }
    const cloned = this._clone();
    if (isLogicCommand(conditions)) {
      cloned._logic = [conditions];
    } else {
      cloned._conditions = {};
      cloned._logic = [];
      for (const [k, v] of Object.entries(conditions)) {
        if (isLogicCommand(v)) cloned._logic.push(v);
        else cloned._conditions[k] = v;
      }
    }
    return cloned;
  }

  /**
   * 真实 SDK（@cloudbase/js-sdk 3.4.6）的 `orderBy` **不叠加**，且**不报错**：
   * 实测 `.orderBy('updatedAt','desc').orderBy('_id','asc')` 的当页与
   * 「只写 `.orderBy('_id','asc')`」逐条相同——主排序键被静默顶掉。
   * （同一实验里把两次调用换个顺序，结果仍等于 `_id asc`。）
   *
   * 这种静默错序在真实环境里极难发现，所以 mock **选择直接抛错**：
   * 宁可让默认套件炸，也不要让链式 orderBy 再流进生产代码。
   * 需要多键排序请走聚合的 `$sort`（实测支持多键且与 JS 全序逐条一致）。
   */
  orderBy(field, direction) {
    if (this._order.length > 0) {
      throw new Error(
        '[cloudbase-mock] orderBy 不支持链式调用（真实 SDK 会静默丢弃主排序键且不报错）；'
        + '多键排序请改用 aggregate().sort({...})'
      );
    }
    this._order.push({ field, dir: direction || 'asc' });
    return this;
  }

  limit(n) {
    this._limitCount = n;
    return this;
  }

  skip(n) {
    this._skipCount = n;
    return this;
  }

  field(fields) {
    this._fieldFilter = fields;
    return this;
  }

  aggregate() {
    return new MockAggregation(this._collection);
  }

  async get() {
    __logQuery(this._collection, { skip: this._skipCount, limit: this._limitCount });
    __enterQuery();
    try {
      if (__queryDelay > 0) {
        await new Promise((r) => setTimeout(r, __queryDelay));
      }
      return this.__exec();
    } finally {
      __exitQuery();
    }
  }

  /** 施加全部条件与排序/跳过/截断，返回 { data }（不含日志与延迟） */
  __exec() {
    let docs = (__collections[this._collection] || []).slice();

    docs = docs.filter((d) => matchDoc(d, this._conditions) && this._logic.every((l) => matchLogic(d, l)));

    docs = applySort(docs, this._order);

    // 应用 skip（排序后、limit 前）
    if (this._skipCount !== null && this._skipCount > 0) {
      docs = docs.slice(this._skipCount);
    }

    // 应用 limit
    if (this._limitCount !== null) {
      docs = docs.slice(0, this._limitCount);
    }

    return { data: docs };
  }

  /** 条件匹配后的全量（不含 skip/limit）—— count() 与 total 推断必须用它 */
  __countDocs() {
    return (__collections[this._collection] || []).filter(
      (d) => matchDoc(d, this._conditions) && this._logic.every((l) => matchLogic(d, l))
    ).length;
  }

  async count() {
    __logQuery(this._collection, { skip: this._skipCount, limit: this._limitCount });
    if (__countError[this._collection]) {
      throw new Error('count not permitted');
    }
    const override = __countOverride[this._collection];
    if (override !== undefined) {
      // 也支持传函数：用于模拟「同一集合前后两次 count 口径不一致」
      // （例如安全规则放行了 {ownerId} 却过滤掉了 {ownerId, _id:{$in:[...]}}）
      return {
        total: typeof override === 'function'
          ? override({ conditions: this._conditions, logic: this._logic, real: this.__countDocs() })
          : override,
      };
    }
    // 注意：count 必须忽略 skip/limit，否则分页查询会数错
    return { total: this.__countDocs() };
  }

  async add(doc) {
    const newDoc = { _id: `mock_${this._collection}_${Date.now()}`, ...doc };
    if (!__collections[this._collection]) __collections[this._collection] = [];
    __collections[this._collection].push(newDoc);
    return { id: newDoc._id };
  }

  doc(id) {
    return new MockDocument(this._collection, id);
  }
}

// ===== Mock 文档操作 =====
class MockDocument {
  constructor(collectionName, docId) {
    this._collection = collectionName;
    this._docId = docId;
  }

  async get() {
    const docs = __collections[this._collection] || [];
    const doc = docs.find((d) => d._id === this._docId);
    return doc ? { data: [doc] } : { data: [] };
  }

  async update(data) {
    const docs = __collections[this._collection] || [];
    const idx = docs.findIndex((d) => d._id === this._docId);
    if (idx !== -1) {
      // 处理 command 操作
      for (const [key, value] of Object.entries(data)) {
        if (!value || typeof value !== 'object') continue;
        if (value.__command === 'inc') {
          docs[idx][key] = (docs[idx][key] || 0) + (value.value || 1);
          delete data[key];
        } else if (value.__command === 'mul') {
          docs[idx][key] = (docs[idx][key] || 0) * (value.value || 1);
          delete data[key];
        } else if (value.__command === 'push') {
          if (!Array.isArray(docs[idx][key])) docs[idx][key] = [];
          docs[idx][key].push(value.value);
          delete data[key];
        } else if (value.__command === 'set') {
          docs[idx][key] = value.value;
          delete data[key];
        } else if (value.__command === 'remove') {
          delete docs[idx][key];
          delete data[key];
        } else if (value.__command === 'pop') {
          if (Array.isArray(docs[idx][key])) docs[idx][key].pop();
          delete data[key];
        } else if (value.__command === 'shift') {
          if (Array.isArray(docs[idx][key])) docs[idx][key].shift();
          delete data[key];
        } else if (value.__command === 'addToSet') {
          if (!Array.isArray(docs[idx][key])) docs[idx][key] = [];
          if (!docs[idx][key].some((x) => looseEq(x, value.value))) docs[idx][key].push(value.value);
          delete data[key];
        }
      }
      Object.assign(docs[idx], data);
    }
    return { updated: idx !== -1 ? 1 : 0 };
  }

  async remove() {
    const docs = __collections[this._collection] || [];
    const idx = docs.findIndex((d) => d._id === this._docId);
    if (idx !== -1) docs.splice(idx, 1);
    return { deleted: idx !== -1 ? 1 : 0 };
  }
}

// ===== Mock Auth =====
const mockAuth = {
  getLoginState: vi.fn(async () => {
    return __authState.loggedIn ? { user: { uid: __authState.uid } } : null;
  }),
  anonymousAuthProvider: () => ({
    signIn: vi.fn(async () => {
      __authState.loggedIn = true;
    }),
  }),
  signOut: vi.fn(async () => {
    __authState.loggedIn = false;
  }),
};

// ===== Mock Storage =====
const mockStorage = {
  uploadFile: vi.fn(async () => ({ fileID: 'mock-file-id' })),
  downloadFile: vi.fn(async () => ({ fileContent: '' })),
  deleteFile: vi.fn(async () => ({})),
};

// ===== CloudBase Mock 实例 =====
const mockDbInstance = {
  collection(name) {
    return new MockQuery(name);
  },
  command: mockCommand,
};

const cloudbaseMock = {
  // 核心方法
  getApp: vi.fn(() => ({ env: 'mock-env' })),
  db: vi.fn(() => mockDbInstance),
  auth: vi.fn(() => mockAuth),
  storage: vi.fn(() => mockStorage),

  // 云函数调用
  callFunction: vi.fn(async (name, data) => {
    const preset = __callFunctionResults[name];
    if (preset !== undefined) {
      if (typeof preset === 'function') return await preset(data);
      return preset;
    }
    return { success: true };
  }),

  isReady: vi.fn(() => true),

  // 测试辅助方法（挂载在 default export 上）
  __resetAll,
  __setCollectionData,
  __setCallFunctionResult,
  __getCollectionData,
  __getCollectionCount,
  __authState,
  __collections, // 直接暴露内存数据库，用于高级断言
  __getQueryLog,
  __countQueries,
  __resetQueryLog,
  __setQueryDelay,
  __getMaxInFlight,
  __setCountOverride,
  __setCountError,
  // D-2 新增
  __getAggregateLog,
  __countAggregates,
  __resetAggregateLog,
  __setAggregateError,
  __allowUnknownOperators,
};

export default cloudbaseMock;
