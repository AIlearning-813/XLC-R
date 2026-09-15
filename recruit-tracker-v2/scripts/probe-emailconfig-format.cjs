#!/usr/bin/env node
/**
 * probe-emailconfig-format.cjs — 只读：判断匿名可读的 imapPassword 是密文还是明文
 *
 * 为什么需要它：
 *   匿名探针发现 EmailConfig 集合 8 条全部可读，字段含 imapPassword。
 *   如果存的是明文，等于 8 个收件邮箱的密码直接对公网公开（可登录邮箱读全部招聘邮件）；
 *   如果存的是 AES-256-GCM 密文（密钥在云函数环境变量里），危害等级完全不同。
 *   这个区别直接决定修复优先级，必须实测而不是猜。
 *
 * 加密格式（见 cloud-functions/email-scanner/crypto.js）：
 *   base64( salt(16B) + iv(12B) + ciphertext(N) + authTag(16B) )
 *   → 总字节数 = 44 + 明文长度，base64 长度 ≥ 60 且必为 4 的倍数
 *   → 明文的密码通常 8~20 字符，长度上就能区分
 *
 * 安全约束：**不打印任何字段值**，只打印长度与判定结论。
 *
 * 用法：node scripts/probe-emailconfig-format.cjs
 */

const cloudbase = require('@cloudbase/js-sdk');

const ENV_ID = 'xlc-recruit-d1gmbx8gybc8a3565';

async function main() {
  console.log(`探针目标环境：${ENV_ID}`);
  console.log('身份：匿名登录（与外部访客完全相同）');
  console.log('目的：判断 imapPassword 是密文还是明文（只打印长度，不打印值）\n');

  const app = cloudbase.init({ env: ENV_ID });
  const auth = app.auth({ persistence: 'none' });
  await auth.anonymousAuthProvider().signIn();

  const db = app.database();
  const res = await db.collection('EmailConfig').get();
  const rows = (res && res.data) || [];
  console.log(`匿名读到 EmailConfig 文档：${rows.length} 条\n`);

  let encrypted = 0;
  let plaintextLike = 0;
  let missing = 0;

  rows.forEach((doc, i) => {
    const v = doc.imapPassword;
    if (typeof v !== 'string' || v === '') {
      missing++;
      console.log(`  #${i + 1}  imapPassword 缺失或非字符串`);
      return;
    }
    // 判定：长度 ≥ 60、长度是 4 的倍数、且能通过严格 base64 校验 → 符合加密包格式
    const looksBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length % 4 === 0;
    const isCipher = v.length >= 60 && looksBase64;
    if (isCipher) encrypted++; else plaintextLike++;
    console.log(
      `  #${i + 1}  长度 ${String(v.length).padStart(3)}  格式校验 ${looksBase64 ? '通过' : '不通过'}` +
      `  → ${isCipher ? '符合 AES-GCM 加密包格式（密文）' : '⚠️ 疑似明文'}`,
    );
  });

  console.log('\n================ 结论 ================');
  console.log(`疑似密文：${encrypted} 条`);
  console.log(`疑似明文：${plaintextLike} 条`);
  if (missing > 0) console.log(`缺失：${missing} 条`);
  if (plaintextLike > 0) {
    console.log('\n⚠️ 存在疑似明文的邮箱密码，且该集合匿名可读 —— 等同于邮箱凭据公开。');
  } else if (encrypted > 0) {
    console.log('\n密文形态：泄露的是加密包，攻击者还需拿到云函数环境变量 MASTER_SECRET /');
    console.log('SALT_PEPPER 才能解密。危害等级低于明文，但这些密文仍不应对公网可读。');
  }
}

main().catch((err) => {
  console.error('探针异常：', err && err.message ? err.message : err);
  process.exit(1);
});
