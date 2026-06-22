/**
 * matching-engine 单元测试
 *
 * 测试核心函数：calculateMatch / rankJobsForCandidate / rankCandidatesForJob /
 * getMatchSummary / getRecommendedWeights
 */
import { describe, it, expect } from 'vitest';
import {
  calculateMatch,
  rankJobsForCandidate,
  rankCandidatesForJob,
  getMatchSummary,
  getRecommendedWeights,
  MATCH_LEVELS,
  DEFAULT_WEIGHTS,
  TECH_WEIGHTS,
  MANAGEMENT_WEIGHTS,
  SALES_WEIGHTS,
} from './matching-engine';

// 测试数据
const mockCandidate = {
  _id: 'c1',
  name: '张三',
  expectedPosition: '课程顾问',
  skills: ['沟通', '销售', '客户服务', '电话营销'],
  workYears: 3,
  education: '本科',
  city: '广州',
  expectedSalary: '8K-12K',
  parsedData: {
    skills: ['沟通', '销售', '客户服务', '电话营销'],
    basic_info: {
      years_of_experience: 3,
      city: '广州',
    },
    expected_position: '课程顾问',
    expected_salary: '8K-12K',
  },
  status: 'active',
};

const mockJob = {
  _id: 'j1',
  title: 'CC',
  type: 'CC',
  department: 'CC部',
  requirements: '大专及以上学历，2年以上销售经验，具备良好的沟通能力和客户服务意识',
  workCity: '广州',
  salaryRange: { min: 6, max: 15 },
  status: 'active',
};

describe('calculateMatch', () => {
  it('缺少 candidate 参数应抛出异常', () => {
    expect(() => calculateMatch(null, mockJob)).toThrow('候选人数据不能为空');
  });

  it('缺少 job 参数应抛出异常', () => {
    expect(() => calculateMatch(mockCandidate, null)).toThrow('岗位数据不能为空');
  });

  it('返回正确的结构', () => {
    const result = calculateMatch(mockCandidate, mockJob);
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('breakdown');
    expect(result).toHaveProperty('level');
    expect(result).toHaveProperty('levelLabel');
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('breakdown 包含全部 6 个维度', () => {
    const result = calculateMatch(mockCandidate, mockJob);
    const dims = Object.keys(result.breakdown);
    expect(dims).toContain('position');
    expect(dims).toContain('skills');
    expect(dims).toContain('experience');
    expect(dims).toContain('education');
    expect(dims).toContain('location');
    expect(dims).toContain('salary');
  });

  it('每个维度包含 score/weight/label', () => {
    const result = calculateMatch(mockCandidate, mockJob);
    for (const dim of Object.values(result.breakdown)) {
      expect(dim).toHaveProperty('score');
      expect(dim).toHaveProperty('weight');
      expect(dim).toHaveProperty('label');
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
    }
  });

  it('高度匹配的候选人和岗位应得高分', () => {
    const result = calculateMatch(mockCandidate, mockJob);
    // 期望岗位匹配 CC，技能匹配销售类，经验3年 > 要求2年，学历本科 > 大专，地点相同
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('不匹配的候选人和岗位应得低分', () => {
    const mismatchedCandidate = {
      ...mockCandidate,
      expectedPosition: 'Java开发工程师',
      skills: ['Java', 'Spring', 'MySQL'],
      city: '北京',
      expectedSalary: '30K-50K',
    };
    const result = calculateMatch(mismatchedCandidate, mockJob);
    expect(result.score).toBeLessThan(60);
  });

  it('缺少信息的候选人仍能计算分数', () => {
    const emptyCandidate = { _id: 'c2', name: '未知' };
    const result = calculateMatch(emptyCandidate, mockJob);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('使用自定义权重', () => {
    const customWeights = {
      position: 0.40,
      skills: 0.30,
      experience: 0.10,
      education: 0.05,
      location: 0.10,
      salary: 0.05,
    };
    const defaultResult = calculateMatch(mockCandidate, mockJob);
    const customResult = calculateMatch(mockCandidate, mockJob, customWeights);
    // 权重不同，分数应该不同
    expect(customResult.score).not.toBe(defaultResult.score);
  });

  it('权重不归一化时自动归一化', () => {
    // 总和不等于1
    const badWeights = {
      position: 2,
      skills: 3,
      experience: 2,
      education: 1.5,
      location: 1,
      salary: 0.5,
    };
    const result = calculateMatch(mockCandidate, mockJob, badWeights);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('rankJobsForCandidate', () => {
  const jobs = [
    { ...mockJob, _id: 'j1', title: 'CC', type: 'CC' },
    { ...mockJob, _id: 'j2', title: 'Java开发', type: '讲师', requirements: '计算机本科，5年Java经验，熟悉Spring框架' },
    { ...mockJob, _id: 'j3', title: 'TMK', type: 'TMK', workCity: '深圳' },
  ];

  it('返回结果按分数降序排列', () => {
    const results = rankJobsForCandidate(mockCandidate, jobs);
    expect(results.length).toBe(3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].match.score).toBeLessThanOrEqual(results[i - 1].match.score);
    }
  });

  it('空岗位列表返回空数组', () => {
    expect(rankJobsForCandidate(mockCandidate, [])).toEqual([]);
  });

  it('过滤掉非活跃岗位', () => {
    const mixedJobs = [
      { ...mockJob, _id: 'j1', status: 'active' },
      { ...mockJob, _id: 'j2', status: 'deleted' },
    ];
    const results = rankJobsForCandidate(mockCandidate, mixedJobs);
    expect(results.length).toBe(1);
    expect(results[0].job._id).toBe('j1');
  });
});

describe('rankCandidatesForJob', () => {
  const candidates = [
    { ...mockCandidate, _id: 'c1', name: '张三', expectedPosition: '课程顾问' },
    { ...mockCandidate, _id: 'c2', name: '李四', expectedPosition: 'Java开发', skills: ['Java', 'Spring'] },
    { ...mockCandidate, _id: 'c3', name: '王五', status: 'deleted' },
  ];

  it('返回结果按分数降序排列', () => {
    const results = rankCandidatesForJob(mockJob, candidates);
    expect(results.length).toBe(2); // 排除 deleted
    for (let i = 1; i < results.length; i++) {
      expect(results[i].match.score).toBeLessThanOrEqual(results[i - 1].match.score);
    }
  });

  it('空候选人列表返回空数组', () => {
    expect(rankCandidatesForJob(mockJob, [])).toEqual([]);
  });

  it('过滤掉非活跃候选人', () => {
    const results = rankCandidatesForJob(mockJob, candidates);
    expect(results.find(r => r.candidate._id === 'c3')).toBeUndefined();
  });
});

describe('getMatchSummary', () => {
  it('返回中文摘要', () => {
    const match = calculateMatch(mockCandidate, mockJob);
    const summary = getMatchSummary(match);
    expect(summary).toBeTruthy();
    expect(summary).toContain('分');
  });

  it('低分匹配包含关注提示', () => {
    const badMatch = calculateMatch(
      { ...mockCandidate, expectedPosition: 'Python开发', skills: ['Python'], city: '上海', expectedSalary: '50K' },
      mockJob
    );
    const summary = getMatchSummary(badMatch);
    expect(summary).toBeTruthy();
  });
});

describe('getRecommendedWeights', () => {
  it('已知类型返回对应权重', () => {
    expect(getRecommendedWeights('讲师')).toEqual(TECH_WEIGHTS);
    expect(getRecommendedWeights('LTC负责人')).toEqual(MANAGEMENT_WEIGHTS);
    expect(getRecommendedWeights('CC')).toEqual(SALES_WEIGHTS);
  });

  it('未知类型返回默认权重', () => {
    expect(getRecommendedWeights('不存在的类型')).toEqual(DEFAULT_WEIGHTS);
  });

  it('无参数返回默认权重', () => {
    expect(getRecommendedWeights()).toEqual(DEFAULT_WEIGHTS);
  });
});

describe('MATCH_LEVELS', () => {
  it('等级定义完整', () => {
    expect(MATCH_LEVELS.length).toBe(4);
    for (const level of MATCH_LEVELS) {
      expect(level).toHaveProperty('min');
      expect(level).toHaveProperty('level');
      expect(level).toHaveProperty('label');
    }
  });
});
