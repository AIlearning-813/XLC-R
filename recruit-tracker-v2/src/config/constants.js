/* 新励成招聘管理系统 V2.0 — 业务常量 */

// 管道阶段定义（12 步漏斗 + 1 可选 inviteConfirmed 节点）
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
  { key: 'onboard', label: '入职', order: 11 },
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
