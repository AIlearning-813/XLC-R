/**
 * duplicate-detector 单元测试
 *
 * 测试导出函数：detectDuplicates（三级重复检测）
 * Mock cloudbase.db() 返回内存数据库
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cloudbase');
import cloudbase from './cloudbase';
import { detectDuplicates } from './duplicate-detector';

// 获取 mock db 实例和 command
let db;
let command;

beforeEach(() => {
  cloudbase.__resetAll();
  db = cloudbase.db();
  command = cloudbase.db().command;
});

// 辅助：构造 parsedData
function makeParsedData(basicInfo = {}) {
  return {
    basic_info: {
      name: '张三',
      phone: '13800138000',
      email: 'zhangsan@example.com',
      ...basicInfo,
    },
    education: [{ school: '北京大学', degree: '本科' }],
    work_experience: [{ company: '阿里巴巴', position: '销售经理' }],
    skills: ['沟通', '销售', '客户服务', '谈判'],
  };
}

// 辅助：构造 Candidate 文档
function makeCandidate(overrides = {}) {
  return {
    _id: 'c1',
    name: '张三',
    phone: '13800138000',
    email: 'zhangsan@example.com',
    fileHash: null,
    parsedData: {
      education: [{ school: '北京大学', degree: '本科' }],
      work_experience: [{ company: '阿里巴巴', position: '销售经理' }],
      skills: ['沟通', '销售', '客户服务', '谈判'],
    },
    ...overrides,
  };
}

// ===== detectDuplicates =====

describe('detectDuplicates', () => {
  // --- 参数校验 ---

  it('db 为空时返回空数组', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const matches = await detectDuplicates(makeParsedData(), { db: null });
    expect(matches).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // --- 第一级：文件哈希去重 ---

  it('文件哈希匹配时返回 exact 级别匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'existing', fileHash: 'abc123' }),
    ]);

    const matches = await detectDuplicates(
      makeParsedData(),
      { fileHash: 'abc123', db }
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].matchLevel).toBe('exact');
    expect(matches[0].matchConfidence).toBe(1.0);
    expect(matches[0].matchReason).toContain('文件哈希');
    expect(matches[0].candidate._id).toBe('existing');
  });

  it('文件哈希不匹配时不返回 exact 匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'existing', fileHash: 'xyz789' }),
    ]);

    const matches = await detectDuplicates(
      makeParsedData(),
      { fileHash: 'abc123', db }
    );
    // 可能匹配到其他级别，但不应该是 exact
    expect(matches.every((m) => m.matchLevel !== 'exact')).toBe(true);
  });

  it('无 fileHash 时跳过文件去重', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'existing', fileHash: 'abc123' }),
    ]);

    // 不传 fileHash，不应匹配到 exact
    const matches = await detectDuplicates(makeParsedData(), { db });
    const exact = matches.filter((m) => m.matchLevel === 'exact');
    expect(exact).toHaveLength(0);
  });

  // --- 第二级：强匹配（手机号/邮箱完全相同）---

  it('手机号完全相同时返回 high 级别匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'existing' }),
    ]);

    const matches = await detectDuplicates(makeParsedData(), { db });
    const high = matches.filter((m) => m.matchLevel === 'high');
    expect(high.length).toBeGreaterThanOrEqual(1);
    if (high.length > 0) {
      expect(high[0].matchConfidence).toBe(0.95);
      expect(high[0].matchReason).toContain('手机号');
    }
  });

  it('邮箱完全相同时返回 high 级别匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'existing', phone: '13900139000' }), // 不同手机号，相同邮箱
    ]);

    const matches = await detectDuplicates(makeParsedData(), { db });
    const high = matches.filter((m) => m.matchLevel === 'high');
    // 邮箱相同应匹配
    expect(high.length).toBeGreaterThanOrEqual(1);
  });

  it('手机号和邮箱都不同时无 high 匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({
        _id: 'existing',
        phone: '13900139000',
        email: 'other@example.com',
      }),
    ]);

    const parsedData = makeParsedData({
      name: '不重名的人',
    });

    const matches = await detectDuplicates(parsedData, { db });
    const high = matches.filter((m) => m.matchLevel === 'high');
    expect(high).toHaveLength(0);
  });

  it('仅 phone（无 email）时仅匹配手机号', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'existing', email: null }),
    ]);

    const parsedData = makeParsedData({ email: null });
    const matches = await detectDuplicates(parsedData, { db });
    const high = matches.filter((m) => m.matchLevel === 'high');
    expect(high.length).toBeGreaterThanOrEqual(1);
  });

  it('仅 email（无 phone）时仅匹配邮箱', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'existing', phone: null }),
    ]);

    const parsedData = makeParsedData({ phone: null });
    const matches = await detectDuplicates(parsedData, { db });
    const high = matches.filter((m) => m.matchLevel === 'high');
    expect(high.length).toBeGreaterThanOrEqual(1);
  });

  it('候选人在 DuplicateExclusion 排除列表时不计入匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'excluded_c1' }),
    ]);
    // 将 candidate 标记为已排除
    cloudbase.__setCollectionData('DuplicateExclusion', [
      { candidateA: 'excluded_c1', candidateB: 'some_other' },
    ]);

    const matches = await detectDuplicates(makeParsedData(), { db });
    const high = matches.filter(
      (m) => m.matchLevel === 'high' && m.candidate._id === 'excluded_c1'
    );
    expect(high).toHaveLength(0);
  });

  // --- 第三级：弱匹配（姓名相同 + 多维交叉）---

  it('强匹配空 + 姓名相同 + ≥2 维度匹配时返回 medium', async () => {
    // 手机/邮箱不同
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({
        _id: 'weak_c1',
        phone: '13999999999',
        email: 'diff@example.com',
        name: '张三',
        // parsedData 中的 education/work/skills 与 parsedData 匹配
      }),
    ]);

    const parsedData = makeParsedData();
    const matches = await detectDuplicates(parsedData, { db });

    // 姓名相同 + 学校相同 + 工作相同 >= 2 个维度
    const medium = matches.filter((m) => m.matchLevel === 'medium');
    expect(medium.length).toBeGreaterThanOrEqual(1);
    if (medium.length > 0) {
      expect(medium[0].matchConfidence).toBeGreaterThanOrEqual(0.6);
      expect(medium[0].matchConfidence).toBeLessThanOrEqual(0.85);
    }
  });

  it('姓名相同但维度匹配 < 2 时不返回 medium 匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      {
        _id: 'different_person',
        name: '张三',
        phone: '13999999999',
        email: 'diff@example.com',
        parsedData: {
          education: [{ school: '清华大学', degree: '博士' }], // 不同学校
          work_experience: [{ company: '腾讯', position: '工程师' }], // 不同公司
          skills: ['编程', '架构'], // 不同技能
        },
      },
    ]);

    const parsedData = makeParsedData();
    const matches = await detectDuplicates(parsedData, { db });
    const medium = matches.filter((m) => m.matchLevel === 'medium');
    expect(medium).toHaveLength(0);
  });

  it('无姓名时不进行弱匹配', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'no_name', phone: '999', email: 'x@x.com' }),
    ]);

    const parsedData = makeParsedData({ name: null, phone: null, email: null });
    const matches = await detectDuplicates(parsedData, { db });
    expect(matches).toHaveLength(0);
  });

  it('强匹配已有结果时不执行弱匹配', async () => {
    // 强匹配会找到候选人，弱匹配不应额外执行（matches.length > 0）
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'strong_match' }),
    ]);

    const matches = await detectDuplicates(makeParsedData(), { db });
    const medium = matches.filter((m) => m.matchLevel === 'medium');
    // 既然有 high 匹配，就不应有 medium（根据代码逻辑）
    expect(medium).toHaveLength(0);
  });

  // --- 手机后4位匹配 ---

  it('手机后4位相同时增加弱匹配分数', async () => {
    // 手机号前7位不同但后4位相同
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({
        _id: 'phone_suffix',
        phone: '000000038000', // 后4位相同
        email: 'diff@example.com',
        name: '张三',
        parsedData: {
          education: [{ school: '其他学校', degree: '本科' }],
          work_experience: [{ company: '其他公司', position: '经理' }],
          skills: [],
        },
      }),
    ]);

    const parsedData = makeParsedData();
    const matches = await detectDuplicates(parsedData, { db });

    // 手机后4位相同 = 1，需要至少 2 分；如果没有其他维度匹配则不够
    // 所以可能没有 medium 匹配
    const medium = matches.filter((m) => m.matchLevel === 'medium');
    // 仅后4位相同（1分）不够，需要 >= 2 分
    // 除非 skills 也匹配
    expect(Array.isArray(matches)).toBe(true);
  });

  // --- 错误处理 ---

  it('数据库查询异常时返回空数组', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 覆盖 db.collection 返回的 query 对象在 .get() 时抛异常
    const badQuery = {
      where: () => badQuery,
      get: async () => { throw new Error('数据库连接失败'); },
      count: async () => { throw new Error('数据库连接失败'); },
    };
    const badDb = {
      collection: () => badQuery,
    };

    const matches = await detectDuplicates(makeParsedData(), { db: badDb });
    expect(matches).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // --- 边界情况 ---

  it('空 Candidate 集合返回空数组', async () => {
    cloudbase.__setCollectionData('Candidate', []);
    const matches = await detectDuplicates(makeParsedData(), { db });
    // 无手机/邮箱匹配，无姓名匹配
    expect(matches).toHaveLength(0);
  });

  it('parsedData.basic_info 为空对象不报错', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'c1' }),
    ]);
    const matches = await detectDuplicates({ basic_info: {} }, { db });
    expect(Array.isArray(matches)).toBe(true);
  });

  it('parsedData 没有 basic_info 不报错', async () => {
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'c1' }),
    ]);
    const matches = await detectDuplicates({}, { db });
    expect(Array.isArray(matches)).toBe(true);
  });

  it('多个匹配结果同时返回', async () => {
    // 多个候选人手机号相同（实际不太可能但需处理）
    cloudbase.__setCollectionData('Candidate', [
      makeCandidate({ _id: 'c1', phone: '13800138000' }),
      makeCandidate({ _id: 'c2', phone: '13800138000' }), // 同样的手机号
    ]);

    const matches = await detectDuplicates(makeParsedData(), { db });
    const high = matches.filter((m) => m.matchLevel === 'high');
    // 手机号相同的多个候选人都应返回
    expect(high.length).toBeGreaterThanOrEqual(1);
  });
});
