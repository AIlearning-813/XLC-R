/**
 * imap-client.test.js — IMAP 邮件客户端纯函数测试
 *
 * 验证无需 IMAP 连接的纯函数：
 *   - isRecruitmentSender：发件人域名过滤
 */

import { describe, it, expect } from 'vitest';
import { isRecruitmentSender } from './imap-client';

describe('imap-client — isRecruitmentSender', () => {
  it('BOSS直聘 @zhipin.com → true', () => {
    expect(isRecruitmentSender('hr@zhipin.com')).toBe(true);
  });

  it('BOSS直聘 @kanzhun.com → true', () => {
    expect(isRecruitmentSender('noreply@kanzhun.com')).toBe(true);
  });

  it('智联招聘 @zhaopin.com.cn → true', () => {
    expect(isRecruitmentSender('service@zhaopin.com.cn')).toBe(true);
  });

  it('猎聘 @liepin.com → true', () => {
    expect(isRecruitmentSender('recruiter@liepin.com')).toBe(true);
  });

  it('公司内部 @xlczg.com → true', () => {
    expect(isRecruitmentSender('hr@xlczg.com')).toBe(true);
  });

  it('QQ邮箱 → false', () => {
    expect(isRecruitmentSender('friend@qq.com')).toBe(false);
  });

  it('Gmail → false', () => {
    expect(isRecruitmentSender('candidate@gmail.com')).toBe(false);
  });

  it('163邮箱 → false', () => {
    expect(isRecruitmentSender('hr@163.com')).toBe(false);
  });

  it('空值 → false', () => {
    expect(isRecruitmentSender('')).toBe(false);
    expect(isRecruitmentSender(null)).toBe(false);
    expect(isRecruitmentSender(undefined)).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(isRecruitmentSender('HR@ZHIPIN.COM')).toBe(true);
    expect(isRecruitmentSender('Noreply@LiePin.com')).toBe(true);
  });

  it('子域名不匹配（防止绕过）', () => {
    // fake-zhipin.com 不应匹配
    expect(isRecruitmentSender('hr@fake-zhipin.com')).toBe(false);
  });
});
