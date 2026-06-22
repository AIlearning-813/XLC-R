/* 新励成招聘管理系统 V2.0 — AI 匹配度计算引擎（纯函数，无副作用）
 *
 * 计算候选人与岗位之间的匹配度分数，支持多维度加权评分。
 * 所有函数均为纯函数，不依赖外部状态，不访问数据库。
 *
 * 评分维度（权重可配置）：
 *   1. 期望岗位匹配（20%）— 候选人期望岗位与 Job title/type 的匹配度
 *   2. 技能匹配（30%）— 候选人技能与岗位要求的覆盖度
 *   3. 经验匹配（20%）— 工作年限与岗位要求的匹配度
 *   4. 学历匹配（15%）— 最高学历与岗位要求的匹配度
 *   5. 地点匹配（10%）— 候选人所在城市与岗位所在城市的匹配度
 *   6. 薪资期望匹配（5%）— 期望薪资与岗位薪资范围的匹配度
 *
 * 返回结构：
 *   { score: number, breakdown: {...}, level: 'excellent'|'good'|'fair'|'low' }
 */

// ===== 学历层级映射 =====
const EDUCATION_LEVELS = {
  '初中': 1, '中专': 2, '高中': 3,
  '大专': 4, '专科': 4,
  '本科': 5, '学士': 5,
  '硕士': 6, '研究生': 6, 'MBA': 6,
  '博士': 7, '博士后': 8,
};

// 默认权重
const DEFAULT_WEIGHTS = {
  position: 0.20,
  skills: 0.30,
  experience: 0.20,
  education: 0.15,
  location: 0.10,
  salary: 0.05,
};

// 匹配等级
const MATCH_LEVELS = [
  { min: 80, level: 'excellent', label: '优秀匹配' },
  { min: 60, level: 'good', label: '良好匹配' },
  { min: 40, level: 'fair', label: '一般匹配' },
  { min: 0, level: 'low', label: '匹配度低' },
];

// ===== 工具函数 =====

/**
 * 提取学历层级数值
 * @param {string} degreeName - 学历名称
 * @returns {number} 层级值（0 表示无法识别）
 */
function getEducationLevel(degreeName) {
  if (!degreeName) return 0;
  const cleaned = degreeName.trim();
  // 精确匹配
  if (EDUCATION_LEVELS[cleaned]) return EDUCATION_LEVELS[cleaned];
  // 模糊匹配
  for (const [key, value] of Object.entries(EDUCATION_LEVELS)) {
    if (cleaned.includes(key)) return value;
  }
  return 0;
}

/**
 * 计算两个字符串之间的简单关键词相似度（Jaccard 系数的简化版）
 * @param {string} textA
 * @param {string} textB
 * @returns {number} 0-1 之间的相似度
 */
function keywordSimilarity(textA, textB) {
  if (!textA || !textB) return 0;
  // 分词：按常见分隔符拆分
  const tokenize = (s) => {
    const cleaned = s.replace(/[，,、/；;.。\s]+/g, ' ').toLowerCase();
    return new Set(cleaned.split(' ').filter(t => t.length > 0));
  };
  const setA = tokenize(textA);
  const setB = tokenize(textB);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * 计算技能列表的覆盖度
 * @param {string[]} candidateSkills - 候选人技能列表
 * @param {string} jobRequirements - 岗位要求文本
 * @returns {number} 0-1 之间的覆盖度
 */
function skillCoverage(candidateSkills, jobRequirements) {
  if (!candidateSkills || candidateSkills.length === 0) return 0;
  if (!jobRequirements) return 0.3; // 岗位未写要求时给一个中等偏低的默认分

  const reqLower = jobRequirements.toLowerCase();
  let matched = 0;

  for (const skill of candidateSkills) {
    if (!skill) continue;
    // 检查技能词是否出现在岗位要求中（支持部分匹配）
    if (reqLower.includes(skill.toLowerCase())) {
      matched++;
    } else {
      // 尝试部分匹配（技能关键词至少 2 个字且在要求中出现）
      const skillLower = skill.toLowerCase();
      for (let i = 0; i <= skillLower.length - 2; i++) {
        const sub = skillLower.substring(i, i + 2);
        if (reqLower.includes(sub)) {
          matched += 0.5;
          break;
        }
      }
    }
  }

  return Math.min(1, matched / Math.max(1, candidateSkills.length));
}

// ===== 维度评分函数 =====

/**
 * 期望岗位匹配（20%）
 * 比较 candidate.expectedPosition / parsedData.expected_position 与 job.title / job.type
 */
function scorePosition(candidate, job) {
  const candidatePos = candidate.expectedPosition
    || candidate.parsedData?.expected_position
    || candidate.parsedData?.basic_info?.expected_position
    || '';
  const jobTitle = `${job.title || ''} ${job.type || ''}`;

  if (!candidatePos) return 50; // 候选人未填期望岗位，给中等分
  if (!job.title && !job.type) return 50;

  // 精确匹配
  const posLower = candidatePos.toLowerCase();
  const titleLower = (job.title || '').toLowerCase();
  const typeLower = (job.type || '').toLowerCase();

  if (posLower === titleLower || posLower === typeLower) return 100;
  if (posLower.includes(titleLower) || titleLower.includes(posLower)) return 90;
  if (posLower.includes(typeLower) || typeLower.includes(posLower)) return 85;

  // 关键词相似度
  const sim = keywordSimilarity(candidatePos, jobTitle);
  return Math.round(sim * 100);
}

/**
 * 技能匹配（30%）
 * 比较 candidate.skills / parsedData.skills 与 job.requirements
 */
function scoreSkills(candidate, job) {
  const skills = candidate.skills
    || candidate.parsedData?.skills
    || [];
  const requirements = job.requirements || job.description || '';

  if (skills.length === 0 && !requirements) return 60; // 双方都无信息
  if (skills.length === 0) return 40; // 候选人无技能数据
  if (!requirements) return 70; // 岗位无要求，给偏高分

  const coverage = skillCoverage(skills, requirements);
  return Math.round(coverage * 100);
}

/**
 * 经验匹配（20%）
 * 比较 candidate.workYears / parsedData.years_of_experience 与岗位要求
 */
function scoreExperience(candidate, job) {
  const candidateYears = candidate.workYears
    || candidate.parsedData?.basic_info?.years_of_experience
    || candidate.parsedData?.years_of_experience
    || 0;

  // 从岗位要求中提取经验要求（如"3年以上"、"5年经验"）
  const requirements = job.requirements || '';
  const yearMatch = requirements.match(/(\d+)\s*年/);
  const requiredYears = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!requiredYears && candidateYears === 0) return 70; // 双方都无信息
  if (!requiredYears) return 80; // 岗位无明确要求
  if (candidateYears === 0) return 40; // 候选人无经验数据

  if (candidateYears >= requiredYears) {
    // 超出要求给满分，但超过太多也满分
    return 100;
  } else {
    // 按比例扣分
    const ratio = candidateYears / requiredYears;
    return Math.round(ratio * 100);
  }
}

/**
 * 学历匹配（15%）
 */
function scoreEducation(candidate, job) {
  const candidateDegree = candidate.education
    || candidate.parsedData?.basic_info?.education
    || candidate.parsedData?.education?.[0]?.degree
    || '';
  const requirements = job.requirements || '';
  const jobDegreeLevel = getEducationLevel(requirements); // 从要求文本中找学历层级

  const candidateLevel = Array.isArray(candidateDegree)
    ? Math.max(...candidateDegree.map(d => getEducationLevel(d.degree || d)))
    : getEducationLevel(candidateDegree);

  if (candidateLevel === 0 && jobDegreeLevel === 0) return 70;
  if (candidateLevel === 0) return 50;
  if (jobDegreeLevel === 0) return 80;

  if (candidateLevel >= jobDegreeLevel) return 100;
  if (candidateLevel === jobDegreeLevel - 1) return 70;
  return Math.round((candidateLevel / jobDegreeLevel) * 60);
}

/**
 * 地点匹配（10%）
 */
function scoreLocation(candidate, job) {
  const candidateCity = candidate.city
    || candidate.parsedData?.basic_info?.city
    || '';
  const jobCity = job.workCity || job.location || '';

  if (!candidateCity || !jobCity) return 70; // 信息不全不扣分

  const cCity = candidateCity.replace(/市$/, '').trim();
  const jCity = jobCity.replace(/市$/, '').trim();

  if (cCity === jCity) return 100;
  // 简单省份匹配
  const cProvince = cCity.substring(0, 2);
  const jProvince = jCity.substring(0, 2);
  if (cProvince === jProvince) return 70;
  return 30;
}

/**
 * 薪资期望匹配（5%）
 */
function scoreSalary(candidate, job) {
  const candidateSalary = candidate.expectedSalary
    || candidate.parsedData?.expected_salary
    || '';
  const jobSalaryMin = job.salaryRange?.min || 0;
  const jobSalaryMax = job.salaryRange?.max || 0;

  if (!candidateSalary || (jobSalaryMin === 0 && jobSalaryMax === 0)) return 60;
  if (jobSalaryMin === 0 && jobSalaryMax === 0) return 70;

  // 从期望薪资字符串中提取数字（单位：千/万）
  let expectedK = 0;
  const cleaned = String(candidateSalary).replace(/[,，]/g, '');
  const matchK = cleaned.match(/([\d.]+)\s*[kK千]/);
  const matchW = cleaned.match(/([\d.]+)\s*[wW万]/);
  const matchNum = cleaned.match(/([\d.]+)/);

  if (matchW) {
    expectedK = parseFloat(matchW[1]) * 10; // 1万 = 10K
  } else if (matchK) {
    expectedK = parseFloat(matchK[1]);
  } else if (matchNum) {
    // 纯数字，假设单位为 K
    expectedK = parseFloat(matchNum[1]);
    if (expectedK < 100) expectedK *= 1000; // 可能是月薪元，转为K
  }

  if (expectedK === 0) return 60;

  // 期望薪资在岗位范围内
  if (expectedK >= jobSalaryMin && expectedK <= jobSalaryMax) return 100;
  // 期望薪资低于岗位最低值
  if (expectedK < jobSalaryMin) return 85;
  // 期望薪资高于岗位最高值但不超过 20%
  if (expectedK <= jobSalaryMax * 1.2) return 60;
  // 期望薪资过高
  return 30;
}

// ===== 主函数 =====

/**
 * 计算候选人与岗位的匹配度
 *
 * @param {Object} candidate - Candidate 文档对象
 * @param {Object} job - Job 文档对象
 * @param {Object} [weights] - 可选的自定义权重（覆盖默认值）
 * @returns {{
 *   score: number,
 *   breakdown: {
 *     position: { score: number, weight: number, label: string },
 *     skills: { score: number, weight: number, label: string },
 *     experience: { score: number, weight: number, label: string },
 *     education: { score: number, weight: number, label: string },
 *     location: { score: number, weight: number, label: string },
 *     salary: { score: number, weight: number, label: string },
 *   },
 *   level: string,
 *   levelLabel: string,
 * }}
 */
export function calculateMatch(candidate, job, weights) {
  if (!candidate) throw new Error('候选人数据不能为空');
  if (!job) throw new Error('岗位数据不能为空');

  const w = { ...DEFAULT_WEIGHTS, ...weights };

  // 验证权重和为 1
  const totalWeight = Object.values(w).reduce((a, b) => a + b, 0);
  if (Math.abs(totalWeight - 1) > 0.001) {
    console.warn('[matching-engine] 权重合计不等于1，将按比例归一化');
    for (const key of Object.keys(w)) {
      w[key] = w[key] / totalWeight;
    }
  }

  // 逐维度评分
  const breakdown = {
    position: { score: scorePosition(candidate, job), weight: w.position, label: '期望岗位' },
    skills: { score: scoreSkills(candidate, job), weight: w.skills, label: '技能匹配' },
    experience: { score: scoreExperience(candidate, job), weight: w.experience, label: '经验年限' },
    education: { score: scoreEducation(candidate, job), weight: w.education, label: '学历匹配' },
    location: { score: scoreLocation(candidate, job), weight: w.location, label: '地点匹配' },
    salary: { score: scoreSalary(candidate, job), weight: w.salary, label: '薪资期望' },
  };

  // 加权总分
  let totalScore = 0;
  for (const dim of Object.values(breakdown)) {
    totalScore += dim.score * dim.weight;
  }

  totalScore = Math.round(totalScore);

  // 匹配等级
  const levelInfo = MATCH_LEVELS.find(l => totalScore >= l.min) || MATCH_LEVELS[MATCH_LEVELS.length - 1];

  return {
    score: totalScore,
    breakdown,
    level: levelInfo.level,
    levelLabel: levelInfo.label,
  };
}

/**
 * 为候选人批量计算与所有活跃岗位的匹配度，返回排序后的结果
 *
 * @param {Object} candidate - Candidate 文档对象
 * @param {Object[]} jobs - Job 文档数组
 * @param {Object} [weights] - 可选的自定义权重
 * @returns {Array<{ job: Object, match: Object }>} 按匹配度降序排列
 */
export function rankJobsForCandidate(candidate, jobs, weights) {
  if (!jobs || jobs.length === 0) return [];

  const results = jobs
    .filter(job => job.status === 'active')
    .map(job => ({
      job,
      match: calculateMatch(candidate, job, weights),
    }))
    .sort((a, b) => b.match.score - a.match.score);

  return results;
}

/**
 * 为岗位批量计算所有候选人的匹配度，返回排序后的结果
 *
 * @param {Object} job - Job 文档对象
 * @param {Object[]} candidates - Candidate 文档数组
 * @param {Object} [weights] - 可选的自定义权重
 * @returns {Array<{ candidate: Object, match: Object }>} 按匹配度降序排列
 */
export function rankCandidatesForJob(job, candidates, weights) {
  if (!candidates || candidates.length === 0) return [];

  const results = candidates
    .filter(c => c.status === 'active')
    .map(candidate => ({
      candidate,
      match: calculateMatch(candidate, job, weights),
    }))
    .sort((a, b) => b.match.score - a.match.score);

  return results;
}

/**
 * 获取匹配度的简短摘要文本
 * @param {Object} matchResult - calculateMatch 的返回结果
 * @returns {string} 如 "优秀匹配(85分)：技能和经验高度契合，学历满足要求"
 */
export function getMatchSummary(matchResult) {
  const { score, breakdown, levelLabel } = matchResult;

  // 找出最突出的维度（得分最高的前 2 个）
  const sorted = Object.values(breakdown)
    .sort((a, b) => b.score - a.score);

  const highlights = sorted.slice(0, 2)
    .filter(d => d.score >= 70)
    .map(d => d.label)
    .join('和');

  // 找出短板（得分最低的维度）
  const lowest = sorted[sorted.length - 1];
  const concern = lowest.score < 40 ? `，${lowest.label}需关注` : '';

  const highlightText = highlights ? `${highlights}高度契合` : '综合评估';
  return `${levelLabel}(${score}分)：${highlightText}${concern}`;
}

// ===== 权重预设 =====

/** 技术岗位偏好：技能权重更高 */
export const TECH_WEIGHTS = {
  position: 0.15,
  skills: 0.40,
  experience: 0.20,
  education: 0.10,
  location: 0.10,
  salary: 0.05,
};

/** 管理岗位偏好：经验权重更高 */
export const MANAGEMENT_WEIGHTS = {
  position: 0.20,
  skills: 0.20,
  experience: 0.35,
  education: 0.15,
  location: 0.05,
  salary: 0.05,
};

/** 销售岗位偏好：经验+地点权重更高 */
export const SALES_WEIGHTS = {
  position: 0.15,
  skills: 0.25,
  experience: 0.25,
  education: 0.10,
  location: 0.15,
  salary: 0.10,
};

// 按岗位类型自动选择权重
const JOB_TYPE_WEIGHT_MAP = {
  '讲师': TECH_WEIGHTS,
  'CC': SALES_WEIGHTS,
  'CR': SALES_WEIGHTS,
  'TMK': SALES_WEIGHTS,
  'LTC负责人': MANAGEMENT_WEIGHTS,
  '人事出纳': DEFAULT_WEIGHTS,
};

/**
 * 根据岗位类型获取推荐的权重配置
 * @param {string} jobType - 岗位类型
 * @returns {Object} 权重配置
 */
export function getRecommendedWeights(jobType) {
  return JOB_TYPE_WEIGHT_MAP[jobType] || DEFAULT_WEIGHTS;
}

export { MATCH_LEVELS, DEFAULT_WEIGHTS };
