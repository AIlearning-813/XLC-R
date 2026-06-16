/* 新励成招聘管理系统 V2.0 — 三级重复检测 */

import cloudbase from './cloudbase';

/**
 * 三级重复检测
 *
 * ① 文件去重：SHA-256 hash 相同 → 确定重复
 * ② 强匹配：手机号完全相同 或 邮箱完全相同 → high confidence
 * ③ 弱匹配：姓名相同 + ≥2 个维度匹配 → medium confidence
 *
 * @param {Object} parsedData - DeepSeek 解析的结构化数据 { basic_info, education[], work_experience[], ... }
 * @param {Object} options - { fileHash, db }
 * @returns {Promise<Array<{ candidate: Object, matchLevel: string, matchReason: string, matchConfidence: number }>>}
 */
export async function detectDuplicates(parsedData, options) {
  const { fileHash, db } = options;
  const matches = [];

  if (!db) {
    console.warn('[duplicate-detector] CloudBase DB 未初始化，跳过重复检测');
    return matches;
  }

  const Candidate = db.collection('Candidate');
  const DuplicateExclusion = db.collection('DuplicateExclusion');

  try {
    // ===== 第一级：文件 SHA-256 去重 =====
    if (fileHash) {
      const hashMatch = await Candidate.where({ fileHash }).get();
      if (hashMatch.data && hashMatch.data.length > 0) {
        return [{
          candidate: hashMatch.data[0],
          matchLevel: 'exact',
          matchReason: '文件哈希完全相同（同一份文件已录入系统）',
          matchConfidence: 1.0,
        }];
      }
    }

    const { phone, email, name } = parsedData.basic_info || {};

    // ===== 第二级：强匹配（手机号 或 邮箱完全相同）=====
    if (phone || email) {
      const orConditions = [];
      if (phone) orConditions.push({ phone });
      if (email) orConditions.push({ email });

      if (orConditions.length > 0) {
        const strongResult = await Candidate
          .where(orConditions.length === 1 ? orConditions[0] : db.command.or(orConditions))
          .get();

        if (strongResult.data) {
          for (const c of strongResult.data) {
            // 检查是否在排除列表中
            const excluded = await checkExclusion(DuplicateExclusion, c._id);
            if (!excluded) {
              const reasons = [];
              if (phone && c.phone === phone) reasons.push('手机号完全相同');
              if (email && c.email === email) reasons.push('邮箱完全相同');
              matches.push({
                candidate: c,
                matchLevel: 'high',
                matchReason: reasons.join('，'),
                matchConfidence: 0.95,
              });
            }
          }
        }
      }
    }

    // ===== 第三级：弱匹配（姓名相同 + 多维交叉）=====
    // 仅在强匹配未找到结果时执行
    if (name && matches.length === 0) {
      const nameResult = await Candidate.where({ name }).get();
      const weakMatches = [];

      for (const c of (nameResult.data || [])) {
        let score = 0;
        const reasons = [];

        // 手机后 4 位匹配
        if (phone && c.phone) {
          const phoneSuffix = phone.slice(-4);
          const cPhoneSuffix = c.phone.slice(-4);
          if (phoneSuffix && cPhoneSuffix && phoneSuffix === cPhoneSuffix) {
            score++;
            reasons.push('手机后4位相同');
          }
        }

        // 最高学历 + 院校匹配
        const edu1 = parsedData.education?.[0];
        const cData = c.parsedData || {};
        const cEducation = cData.education?.[0];
        if (edu1 && cEducation) {
          if (edu1.school === cEducation.school && edu1.degree === cEducation.degree) {
            score++;
            reasons.push('最高学历和院校相同');
          } else if (edu1.school === cEducation.school) {
            score += 0.5;
            reasons.push('最高学历院校相同');
          }
        }

        // 最近工作公司匹配
        const work1 = parsedData.work_experience?.[0];
        const cWork = cData.work_experience?.[0];
        if (work1 && cWork && work1.company === cWork.company) {
          score++;
          reasons.push('最近工作公司相同');
        }

        // 技能重叠（≥3 个相同技能）
        const skills1 = parsedData.skills || [];
        const skills2 = cData.skills || [];
        const commonSkills = skills1.filter(s => skills2.includes(s));
        if (commonSkills.length >= 3 && skills1.length > 0 && skills2.length > 0) {
          score++;
          reasons.push(`重叠技能≥3个（${commonSkills.slice(0, 3).join('、')}）`);
        }

        // score >= 2（≥2 个维度匹配）即视为可能重复
        if (score >= 2) {
          // 检查排除列表
          const excluded = await checkExclusion(DuplicateExclusion, c._id);
          if (!excluded) {
            weakMatches.push({
              candidate: c,
              matchLevel: 'medium',
              matchReason: `姓名相同 + ${reasons.join('、')}`,
              matchConfidence: Math.min(0.6 + score * 0.1, 0.85),
            });
          }
        }
      }

      matches.push(...weakMatches);
    }

    return matches;
  } catch (err) {
    console.error('[duplicate-detector] 重复检测查询失败:', err);
    // 失败不阻塞主流程，返回空结果
    return [];
  }
}

/**
 * 检查候选人是否在 DuplicateExclusion 排除列表中
 * @returns {Promise<boolean>} true = 已排除（不是同一个人）
 */
async function checkExclusion(collection, candidateId) {
  try {
    // 检查 candidateId 是否作为 candidateA 或 candidateB 出现在排除列表中
    const resultA = await collection.where({ candidateA: candidateId }).count();
    const resultB = await collection.where({ candidateB: candidateId }).count();
    return (resultA.total || 0) + (resultB.total || 0) > 0;
  } catch {
    return false; // 查询失败默认不算排除
  }
}
