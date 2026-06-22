/**
 * 新励成招聘管理系统 V2.0 — 种子数据初始化脚本
 *
 * 用途：在新环境部署后或数据库被清空时，快速创建种子数据，
 *       解除"无岗位→无法创建Application→录入简历流程断裂"的死锁。
 *
 * 用法：node scripts/seed-data.js
 *
 * 前置条件：
 *   1. CloudBase 环境已创建
 *   2. .env.local 中已配置 VITE_CLOUDBASE_ENV_ID
 */

const cloudbase = require('@cloudbase/node-sdk');
const path = require('path');
const fs = require('fs');

// 从 .env.local 或环境变量读取 ENV_ID
let envId = process.env.CLOUDBASE_ENV_ID;

if (!envId) {
  // 尝试从 .env.local 读取
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
    const match = envFile.match(/VITE_CLOUDBASE_ENV_ID\s*=\s*(.+)/);
    if (match) {
      envId = match[1].trim();
    }
  } catch {
    // .env.local 不存在
  }
}

if (!envId) {
  console.error('❌ 未找到 CloudBase ENV_ID。请设置环境变量 CLOUDBASE_ENV_ID 或在 .env.local 中配置 VITE_CLOUDBASE_ENV_ID');
  process.exit(1);
}

const app = cloudbase.init({ env: envId });
const db = app.database();

/**
 * 默认种子岗位数据
 * 基于新励成实际的组织架构：6种岗位类型 × 4个部门
 */
const SEED_JOBS = [
  {
    title: 'CC（课程顾问）',
    department: 'CC部',
    interviewRounds: 3,
    headcount: 5,
    status: 'active',
    description: '负责课程咨询与销售，向潜在学员介绍课程体系',
    requirements: '大专及以上学历，有教育行业销售经验优先',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    title: 'CR（班主任）',
    department: 'CR部',
    interviewRounds: 2,
    headcount: 3,
    status: 'active',
    description: '负责学员服务与班级管理，跟进学员学习进度',
    requirements: '大专及以上学历，有教育行业服务经验优先',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    title: 'TMK（电话销售）',
    department: 'TMK部',
    interviewRounds: 2,
    headcount: 8,
    status: 'active',
    description: '负责电话邀约与初步筛选，转化潜在客户线索',
    requirements: '高中及以上学历，有电话销售经验优先',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    title: '讲师（口才/演讲）',
    department: '讲师部',
    interviewRounds: 3,
    headcount: 2,
    status: 'active',
    description: '负责口才演讲类课程的授课与课程研发',
    requirements: '本科及以上学历，有演讲/口才培训经验，持教师资格证优先',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    title: 'LTC负责人',
    department: 'LTC部',
    interviewRounds: 3,
    headcount: 1,
    status: 'active',
    description: '负责LTC业务线的整体运营与团队管理',
    requirements: '本科及以上学历，3年以上教育行业管理经验',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    title: '人事出纳',
    department: '人事部',
    interviewRounds: 2,
    headcount: 1,
    status: 'active',
    description: '负责公司人事行政及出纳工作',
    requirements: '大专及以上学历，有人事或财务相关经验',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// 默认 CompanyProfile 数据
const DEFAULT_COMPANY_PROFILE = {
  _id: 'singleton',
  name: '新励成教育科技集团',
  shortName: '新励成',
  logo: '',
  description: '新励成教育科技集团成立于2005年，是国内领先的软实力教育培训机构，专注于演讲口才、人际沟通、职场礼仪等软实力培训。',
  industry: '教育培训',
  subIndustry: '软实力培训',
  founded: 2005,
  size: '500-2000人',
  website: 'https://www.xlc.com',
  locations: [
    { city: '广州', type: '总部', address: '广州市天河区' },
    { city: '北京', type: '分公司', address: '北京市朝阳区' },
    { city: '上海', type: '分公司', address: '上海市浦东新区' },
    { city: '深圳', type: '分公司', address: '深圳市南山区' },
  ],
  businessLines: [
    { name: '演讲口才培训', description: '面向成人及青少年的演讲与口才训练', revenueShare: 40 },
    { name: '人际沟通培训', description: '职场沟通、人际关系处理等软技能培训', revenueShare: 25 },
    { name: '企业内训', description: '为企业定制化提供员工软实力培训方案', revenueShare: 20 },
    { name: '在线课程', description: '线上录播/直播课程', revenueShare: 15 },
  ],
  culture: ['以学员为中心', '持续创新', '团队协作', '专业专注', '共赢成长'],
  benefits: ['五险一金', '带薪年假', '节日福利', '员工培训', '晋升空间'],
  recruitmentPhilosophy: '我们寻找热爱教育、有成长心态的人才，注重候选人的沟通表达能力、学习能力和责任心。',
  employerBrand: {
    strengths: ['行业领先品牌', '完善的培训体系', '良好的发展空间', '积极正向的团队氛围'],
    challenges: ['软实力培训行业认知度有待提升', '优秀讲师资源稀缺'],
  },
  changeLog: [],
  updatedAt: new Date(),
  updatedBy: 'seed_script',
};

// 默认知识库条目
const DEFAULT_KNOWLEDGE_ITEMS = [
  {
    category: 'company_culture',
    title: '新励成企业文化核心价值观',
    content: '新励成的核心价值观是"以学员为中心、持续创新、团队协作、专业专注、共赢成长"。公司在日常管理中践行这些价值观，鼓励员工在培训服务中体现专业性和责任心。',
    source: 'manual',
    tags: ['企业文化', '核心价值观'],
    relevance: 'high',
    useCount: 0,
    status: 'published',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    category: 'job_template',
    title: 'CC（课程顾问）岗位标准描述',
    content: '课程顾问（CC）是新励成核心岗位，负责课程咨询与销售。主要职责：1）接待来访学员及家长，提供课程咨询服务；2）通过电话/微信跟进潜在学员；3）根据学员需求推荐合适的课程方案；4）完成月度销售指标。岗位要求：大专及以上学历，有教育行业销售经验优先，具备良好的沟通能力和抗压能力。',
    source: 'manual',
    tags: ['CC', '课程顾问', '岗位描述'],
    relevance: 'high',
    useCount: 0,
    status: 'published',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    category: 'interview_question',
    title: 'CC岗位常见面试问题',
    content: 'CC岗位面试重点考察沟通表达能力和销售潜力。常见问题：1）自我介绍（3分钟）；2）你为什么选择教育行业？3）你如何看待销售工作？4）情景模拟：如果家长对课程价格有异议，你会如何沟通？5）你过往最有成就感的一次销售经历是什么？',
    source: 'manual',
    tags: ['CC', '面试问题', '销售'],
    relevance: 'high',
    useCount: 0,
    status: 'published',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    category: 'recruitment_tip',
    title: '讲师岗位招聘要点',
    content: '新励成讲师招聘要点：1）优先考虑有演讲比赛获奖经历的候选人；2）形象气质佳，普通话标准（二甲及以上）；3）有成人培训经验优先于K12教学经验；4）需要现场试讲15分钟，考察台风和互动能力；5）兼职讲师可先以助教身份观察教学能力。',
    source: 'manual',
    tags: ['讲师', '招聘技巧'],
    relevance: 'medium',
    useCount: 0,
    status: 'published',
    createdBy: 'seed_script',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// 管理员默认账号（需要在 Users 集合中创建）
const DEFAULT_ADMIN = {
  username: 'admin',
  name: '系统管理员',
  role: 'admin',
  email: '',
  phone: '',
  status: 'active',
  createdAt: new Date(),
};

const FORCE_FLAG = process.argv.includes('--force');

async function main() {
  console.log(`🚀 开始初始化种子数据...\n环境ID: ${envId}${FORCE_FLAG ? ' (强制模式)' : ''}\n`);

  let totalCreated = 0;
  let totalSkipped = 0;

  // ===== 1. 岗位数据 =====
  console.log('── 📋 岗位数据 ──');
  const existingJobs = await db.collection('Job').where({ status: 'active' }).count();

  if (existingJobs.total > 0 && !FORCE_FLAG) {
    console.log(`  ⏭  数据库中已有 ${existingJobs.total} 个活跃岗位，跳过。`);
    console.log('     提示：使用 --force 参数可强制执行。\n');
  } else {
    for (const job of SEED_JOBS) {
      try {
        const dup = await db.collection('Job').where({ title: job.title, status: 'active' }).count();
        if (dup.total > 0 && !FORCE_FLAG) {
          console.log(`  ⏭  "${job.title}" 已存在，跳过`);
          totalSkipped++;
          continue;
        }
        const result = await db.collection('Job').add(job);
        console.log(`  ✅ "${job.title}" (${job.department}, ${job.interviewRounds}轮面试) — ID: ${result.id}`);
        totalCreated++;
      } catch (err) {
        console.error(`  ❌ "${job.title}" 创建失败:`, err.message);
      }
    }
  }

  // ===== 2. 公司画像 =====
  console.log('\n── 🏢 公司画像 (CompanyProfile) ──');
  try {
    const existingCP = await db.collection('CompanyProfile').doc('singleton').get();
    if (existingCP.data && existingCP.data.length > 0 && !FORCE_FLAG) {
      console.log('  ⏭  CompanyProfile 已存在，跳过。');
      totalSkipped++;
    } else {
      // 存在则更新，不存在则创建
      if (existingCP.data && existingCP.data.length > 0) {
        await db.collection('CompanyProfile').doc('singleton').update(DEFAULT_COMPANY_PROFILE);
        console.log('  ✅ CompanyProfile 已更新（覆盖模式）');
      } else {
        await db.collection('CompanyProfile').add(DEFAULT_COMPANY_PROFILE);
        console.log('  ✅ CompanyProfile 已创建');
      }
      totalCreated++;
    }
  } catch (err) {
    // 集合不存在或 doc 不存在时创建
    try {
      await db.collection('CompanyProfile').add(DEFAULT_COMPANY_PROFILE);
      console.log('  ✅ CompanyProfile 已创建（首次）');
      totalCreated++;
    } catch (e2) {
      console.error(`  ❌ CompanyProfile 创建失败:`, e2.message);
    }
  }

  // ===== 3. 知识库条目 =====
  console.log('\n── 📚 知识库 (KnowledgeBase) ──');
  for (const item of DEFAULT_KNOWLEDGE_ITEMS) {
    try {
      const existingKB = await db.collection('KnowledgeBase')
        .where({ title: item.title, category: item.category })
        .count();
      if (existingKB.total > 0 && !FORCE_FLAG) {
        console.log(`  ⏭  "${item.title}" 已存在，跳过`);
        totalSkipped++;
        continue;
      }
      const result = await db.collection('KnowledgeBase').add(item);
      console.log(`  ✅ "${item.title}" — ID: ${result.id}`);
      totalCreated++;
    } catch (err) {
      console.error(`  ❌ "${item.title}" 创建失败:`, err.message);
    }
  }

  // ===== 4. 管理员初始账号 =====
  console.log('\n── 👤 管理员账号 (Users) ──');
  try {
    const existingAdmin = await db.collection('Users')
      .where({ username: 'admin' })
      .count();
    if (existingAdmin.total > 0 && !FORCE_FLAG) {
      console.log('  ⏭  管理员账号已存在，跳过。');
      totalSkipped++;
    } else {
      await db.collection('Users').add(DEFAULT_ADMIN);
      console.log('  ✅ 管理员账号已创建（默认密码需在 CloudBase 控制台-用户管理中设置）');
      totalCreated++;
    }
  } catch (err) {
    console.error(`  ❌ 管理员账号创建失败:`, err.message);
  }

  // ===== 汇总 =====
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 种子数据初始化完成：创建 ${totalCreated} 条，跳过 ${totalSkipped} 条`);
  if (totalCreated > 0) {
    console.log('✅ 系统已具备基础运行条件：');
    console.log('   • 岗位数据 → 录入简历可正常选择岗位');
    console.log('   • 公司画像 → AI 助手可获得公司背景信息');
    console.log('   • 知识库 → RAG 检索增强生成可用');
    console.log('   • 管理员账号 → 可登录管理后台');
  }
}

main().catch(err => {
  console.error('❌ 种子数据初始化失败:', err.message);
  process.exit(1);
});
