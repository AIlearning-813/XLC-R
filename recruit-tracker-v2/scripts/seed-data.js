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

async function main() {
  console.log(`🚀 开始初始化种子数据...\n环境ID: ${envId}\n`);

  // 检查已有岗位
  const existing = await db.collection('Job')
    .where({ status: 'active' })
    .count();

  if (existing.total > 0) {
    console.log(`✅ 数据库中已有 ${existing.total} 个活跃岗位，跳过种子数据创建。`);
    console.log('   如需强制重新创建，请先手动清空 Job 集合后再运行此脚本。');
    process.exit(0);
  }

  console.log('📋 数据库中无活跃岗位，开始创建种子岗位...\n');

  let created = 0;
  let skipped = 0;

  for (const job of SEED_JOBS) {
    try {
      // 检查是否已存在同名岗位
      const dup = await db.collection('Job')
        .where({ title: job.title, status: 'active' })
        .count();

      if (dup.total > 0) {
        console.log(`  ⏭  "${job.title}" 已存在，跳过`);
        skipped++;
        continue;
      }

      const result = await db.collection('Job').add(job);
      console.log(`  ✅ "${job.title}" (${job.department}, ${job.interviewRounds}轮面试) — ID: ${result.id}`);
      created++;
    } catch (err) {
      console.error(`  ❌ "${job.title}" 创建失败:`, err.message);
    }
  }

  console.log(`\n📊 种子数据初始化完成：创建 ${created} 条，跳过 ${skipped} 条`);
  console.log('✅ 现在录入简历页面可以正常选择岗位了。');
}

main().catch(err => {
  console.error('❌ 种子数据初始化失败:', err.message);
  process.exit(1);
});
