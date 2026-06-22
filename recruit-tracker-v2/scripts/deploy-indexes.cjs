/**
 * deploy-indexes.js — 创建 CloudBase 数据库索引
 *
 * 使用方法：node scripts/deploy-indexes.js
 * 需要：项目中已安装 @cloudbase/node-sdk
 */

const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

const app = cloudbase.init({ env: ENV_ID });
const db = app.database();

/**
 * 索引定义
 * 每个索引：{ collection, indexName, fields: [{ name, direction }], unique? }
 */
const INDEXES = [
  // ===== 原有 19 条索引 =====
  { collection: 'Users', indexName: 'openid_unique', fields: [{ name: '_openid', direction: 'asc' }], unique: true },
  { collection: 'Job', indexName: 'dept_status', fields: [{ name: 'department', direction: 'asc' }, { name: 'status', direction: 'asc' }] },
  { collection: 'Candidate', indexName: 'phone_idx', fields: [{ name: 'phone', direction: 'asc' }] },
  { collection: 'Application', indexName: 'owner_status', fields: [{ name: 'ownerId', direction: 'asc' }, { name: 'status', direction: 'asc' }] },
  { collection: 'Application', indexName: 'job_status', fields: [{ name: 'jobId', direction: 'asc' }, { name: 'status', direction: 'asc' }] },
  { collection: 'EmailConfig', indexName: 'user_unique', fields: [{ name: 'userId', direction: 'asc' }], unique: true },
  { collection: 'ParseQueue', indexName: 'status_time', fields: [{ name: 'status', direction: 'asc' }, { name: 'createdAt', direction: 'asc' }] },
  { collection: 'ParseNotification', indexName: 'user_status_time', fields: [{ name: 'userId', direction: 'asc' }, { name: 'status', direction: 'asc' }, { name: 'createdAt', direction: 'desc' }] },
  { collection: 'AuditLog', indexName: 'time_desc', fields: [{ name: 'createdAt', direction: 'desc' }] },
  { collection: 'PendingChanges', indexName: 'status_time', fields: [{ name: 'status', direction: 'asc' }, { name: 'submittedAt', direction: 'asc' }] },
  { collection: 'ErrorLog', indexName: 'time_desc', fields: [{ name: 'createdAt', direction: 'desc' }] },
  { collection: 'ErrorLog', indexName: 'severity_time', fields: [{ name: 'severity', direction: 'asc' }, { name: 'createdAt', direction: 'desc' }] },
  { collection: 'KnowledgeBase', indexName: 'category_status', fields: [{ name: 'category', direction: 'asc' }, { name: 'status', direction: 'asc' }] },
  { collection: 'KnowledgeBase', indexName: 'time_desc', fields: [{ name: 'createdAt', direction: 'desc' }] },
  { collection: 'RecruitmentInsight', indexName: 'type_idx', fields: [{ name: 'type', direction: 'asc' }] },
  { collection: 'DuplicateExclusion', indexName: 'candA', fields: [{ name: 'candidateA', direction: 'asc' }] },
  { collection: 'DuplicateExclusion', indexName: 'candB', fields: [{ name: 'candidateB', direction: 'asc' }] },
  { collection: 'ReportCache', indexName: 'type_expires', fields: [{ name: 'reportType', direction: 'asc' }, { name: 'expiresAt', direction: 'asc' }] },

  // ===== P0-3 新增 4 条索引 =====
  { collection: 'CommunicationLog', indexName: 'cand_time', fields: [{ name: 'candidateId', direction: 'asc' }, { name: 'createdAt', direction: 'desc' }] },
  { collection: 'ParseCorrectionBank', indexName: 'field_ov_cv', fields: [{ name: 'field', direction: 'asc' }, { name: 'originalValue', direction: 'asc' }, { name: 'correctedValue', direction: 'asc' }] },
  { collection: 'ProcessingLock', indexName: 'lock_unique', fields: [{ name: 'lockKey', direction: 'asc' }], unique: true },
];

async function main() {
  console.log(`🚀 开始部署索引到环境: ${ENV_ID}\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const idx of INDEXES) {
    const label = `${idx.collection}.${idx.indexName}`;
    try {
      await db.collection(idx.collection).createIndex({
        name: idx.indexName,
        unique: idx.unique || false,
        keys: idx.fields.reduce((acc, f) => {
          acc[f.name] = f.direction === 'desc' ? -1 : 1;
          return acc;
        }, {}),
      });
      console.log(`  ✅ ${label}`);
      created++;
    } catch (err) {
      // 索引已存在时忽略
      if (err.message && (err.message.includes('already exist') || err.message.includes('已存在') || err.message.includes('duplicate'))) {
        console.log(`  ⏭️  ${label} (已存在)`);
        skipped++;
      } else {
        console.log(`  ❌ ${label}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n📊 结果: 新建 ${created} / 跳过 ${skipped} / 失败 ${failed}`);
  console.log('✅ 索引部署完成');
}

main().catch(err => {
  console.error('❌ 索引部署失败:', err.message);
  process.exit(1);
});
