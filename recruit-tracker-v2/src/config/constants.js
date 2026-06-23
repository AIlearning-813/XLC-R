/* 新励成招聘管理系统 V2.0 — 业务常量 */

// P2-20：管道阶段定义（13 步漏斗 + 1 可选 inviteConfirmed 节点，含背景调查）
export const FUNNEL_STAGES = [
  { key: 'resume', label: '简历', order: 0 },
  { key: 'valid_resume', label: '有效简历', order: 1 },
  { key: 'invite', label: '邀约', order: 2 },
  { key: 'invite_confirmed', label: '已确认面试', order: 3, optional: true },
  { key: 'first_interview', label: '初试', order: 4 },
  { key: 'first_pass', label: '初试通过', order: 5 },
  { key: 'second_interview', label: '复试', order: 6 },
  { key: 'second_pass', label: '复试通过', order: 7 },
  { key: 'final_interview', label: '终试', order: 8 },
  { key: 'final_pass', label: '终试通过', order: 9 },
  { key: 'offer', label: 'Offer', order: 10 },
  { key: 'background_check', label: '背景调查', order: 11 },
  { key: 'onboard', label: '入职', order: 12 },
];

// 岗位类型及面试轮次
export const JOB_TYPES = {
  CC: { label: 'CC', interviewRounds: 3 },
  'LTC负责人': { label: 'LTC负责人', interviewRounds: 3 },
  '讲师': { label: '讲师', interviewRounds: 3 },
  CR: { label: 'CR', interviewRounds: 2 },
  '人事出纳': { label: '人事出纳', interviewRounds: 2 },
  TMK: { label: 'TMK', interviewRounds: 2 },
};

// 部门列表
export const DEPARTMENTS = ['CC部', 'CR部', 'TMK部', '人事部', '讲师部', 'LTC部'];

// 结束状态预设原因
export const END_REASONS = {
  rejected: [
    { key: 'qualification', label: '资历不符' },
    { key: 'skill_mismatch', label: '技能不匹配' },
    { key: 'interview_fail', label: '面试未通过' },
    { key: 'culture_fit', label: '文化不匹配' },
    { key: 'other_reject', label: '其他' },
  ],
  withdrawn: [
    { key: 'salary', label: '薪资不满意' },
    { key: 'location', label: '地点不合适' },
    { key: 'other_offer', label: '已有其他Offer' },
    { key: 'no_response', label: '失联/无回应' },
    { key: 'personal', label: '个人原因' },
    { key: 'job_mismatch', label: '岗位期望不符' },
    { key: 'schedule', label: '时间安排冲突' },
    { key: 'other_withdraw', label: '其他' },
  ],
};

// 沟通方式
export const COMMUNICATION_METHODS = ['电话', '微信', '短信', '邮件', '当面'];

// 简历来源
export const RESUME_SOURCES = ['email', 'manual', 'import'];

// 解析置信度
export const PARSE_CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

// ===== P2-18：GDPR / 个保法合规常量 =====

// 数据保留期限（天）
export const DATA_RETENTION_DAYS_DEFAULT = 365; // 默认保留 1 年
export const DATA_RETENTION_DAYS_MAX = 730;     // 最多保留 2 年

// 同意状态
export const CONSENT_STATUS = {
  PENDING: 'pending',     // 待获取
  GIVEN: 'given',         // 已同意
  DECLINED: 'declined',   // 已拒绝
  EXPIRED: 'expired',     // 已过期
  WITHDRAWN: 'withdrawn', // 已撤回
};

// 数据处理目的
export const DATA_PURPOSE = {
  RECRUITMENT: 'recruitment',     // 招聘录用
  CONTACT: 'contact',            // 联系沟通
  RETENTION: 'retention',        // 人才库保留
};

// 删除请求状态
export const DELETION_REQUEST_STATUS = {
  NONE: 'none',           // 无请求
  PENDING: 'pending',     // 待处理
  PROCESSING: 'processing', // 处理中
  COMPLETED: 'completed', // 已完成
  REJECTED: 'rejected',   // 已拒绝
};

// ===== 阶段 2：简历录入常量 =====

// 文件上传限制
export const UPLOAD_MAX_SIZE = 20 * 1024 * 1024; // 单文件 20MB
export const UPLOAD_MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 合计 100MB

// 允许的 MIME 类型白名单
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/msword', // DOC
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'application/rtf', // 可能不标准
  'text/rtf',
  'text/html',
  'application/zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
];

// 允许的文件扩展名白名单（用于回退检测，MIME 不可靠时按扩展名判断）
export const ALLOWED_EXTENSIONS = [
  '.pdf', '.docx', '.doc', '.txt',
  '.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.webp',
  '.rtf', '.html', '.htm',
  '.zip', '.rar',
];

// 浏览器端可直接提取文本的格式（不需要 OCR）
export const BROWSER_EXTRACTABLE_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/rtf',
  'application/rtf',
  'text/html',
];

// 需要 OCR 的图片格式
export const OCR_REQUIRED_MIME = [
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/tiff',
  'image/webp',
];

// 重复检测匹配级别
export const DUPLICATE_MATCH_LEVELS = {
  EXACT: { level: 'exact', label: '文件完全相同', confidence: 1.0 },
  HIGH: { level: 'high', label: '高置信度重复', confidence: 0.95 },
  MEDIUM: { level: 'medium', label: '可能重复', confidence: 0.7 },
};

// 弱匹配所需的最低交叉维度数
export const DUPLICATE_WEAK_MATCH_MIN_DIMENSIONS = 2;

// ===== 阶段 3：邮箱自动归集常量 =====

// 招聘平台发件人域名过滤
export const EMAIL_SENDER_FILTERS = [
  { domain: '@zhipin.com', label: 'BOSS直聘' },
  { domain: '@kanzhun.com', label: 'BOSS直聘/看准' },
  { domain: '@zhaopin.com.cn', label: '智联招聘' },
  { domain: '@liepin.com', label: '猎聘' },
];

// 支持的邮箱类型
export const EMAIL_PROVIDERS = [
  { value: 'qq', label: 'QQ邮箱', imapHost: 'imap.qq.com', imapPort: 993 },
  { value: 'exmail', label: '腾讯企业邮箱', imapHost: 'imap.exmail.qq.com', imapPort: 993 },
  { value: '163', label: '网易163邮箱', imapHost: 'imap.163.com', imapPort: 993 },
  { value: 'other', label: '其他邮箱', imapHost: '', imapPort: 993 },
];

// 邮箱扫描间隔（分钟）
export const EMAIL_SCAN_INTERVAL = 10;

// 邮件附件大小限制
export const EMAIL_ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024; // 20MB

// 邮件扫描通知类型
export const NOTIFICATION_TYPES = {
  parse_success: { label: '解析成功', icon: 'success' },
  parse_failed: { label: '解析失败', icon: 'danger' },
  parse_duplicate: { label: '检测到重复', icon: 'warning' },
  scan_summary: { label: '日报摘要', icon: 'info' },
};

// ===== P1-7：Job 模型完整字段定义 =====
// Job 文档的推荐字段及默认值（确保数据一致性）

export const JOB_REQUIRED_FIELDS = ['title', 'type', 'department'];

export const JOB_OPTIONAL_FIELDS = {
  headcount: { type: 'number', default: 1, label: '招聘人数' },
  salaryRange: { type: 'object', default: () => ({ min: 0, max: 0 }), label: '薪资范围' },
  workCity: { type: 'string', default: '', label: '工作城市' },
  requirements: { type: 'string', default: '', label: '岗位要求' },
  expiryDate: { type: 'date', default: null, label: '招聘截止日期' },
  priority: { type: 'string', default: 'normal', label: '优先级' },
};

export const JOB_PRIORITIES = ['urgent', 'high', 'normal', 'low'];

/**
 * 为 Job 数据填充缺失的默认字段
 * @param {Object} jobData - 原始岗位数据
 * @returns {Object} 补充默认值后的数据
 */
export function normalizeJobData(jobData) {
  const result = { ...jobData };
  for (const [key, config] of Object.entries(JOB_OPTIONAL_FIELDS)) {
    if (result[key] === undefined || result[key] === null) {
      result[key] = typeof config.default === 'function' ? config.default() : config.default;
    }
  }
  return result;
}

/**
 * 校验 Job 必填字段
 * @param {Object} jobData
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateJobData(jobData) {
  const missing = JOB_REQUIRED_FIELDS.filter(f => !jobData[f]);
  return { valid: missing.length === 0, missing };
}

// ===== 阶段 6：数据导入列映射预置 =====

export const COLUMN_MAPPING_PRESETS = {
  boss: {
    _label: 'BOSS直聘',
    name: '姓名',
    phone: '手机号',
    email: '邮箱',
    expectedPosition: '应聘岗位',
    currentStage: '当前状态',
    source: '来源',
    gender: '性别',
    age: '年龄',
    education: '学历',
    workYears: '工作年限',
  },
  zhilian: {
    _label: '智联招聘',
    name: '姓名',
    phone: '联系电话',
    email: '电子邮箱',
    expectedPosition: '期望职位',
    currentStage: '求职状态',
    source: '渠道',
    gender: '性别',
    age: '年龄',
    education: '最高学历',
    workYears: '工作经验',
  },
  liepin: {
    _label: '猎聘',
    name: '候选人姓名',
    phone: '手机号码',
    email: '邮箱地址',
    expectedPosition: '期望岗位',
    currentStage: '当前状态',
    source: '推荐来源',
    gender: '性别',
    age: '年龄',
    education: '学历',
    workYears: '工作年限',
  },
};
