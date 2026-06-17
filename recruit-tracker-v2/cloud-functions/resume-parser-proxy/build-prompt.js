/**
 * build-prompt.js — System Prompt 组装 + 修正案例库注入
 *
 * 从 ParseCorrectionBank 集合查询被人工修正 >= 10 次的记录
 * 取前 5 条作为 few-shot examples 注入 system prompt
 * 帮助 DeepSeek 识别易错的字段映射
 */

/**
 * 构建增强 System Prompt
 * @param {Object} db - CloudBase 数据库实例
 * @param {string} basePrompt - 基础 System Prompt
 * @returns {Promise<string>} 增强后的 System Prompt
 */
async function buildSystemPrompt(db, basePrompt) {
  try {
    const collection = db.collection('ParseCorrectionBank');
    const { data: stats } = await collection
      .where({
        correctionCount: db.command.gte(10),
      })
      .orderBy('correctionCount', 'desc')
      .limit(5)
      .get();

    if (!stats || stats.length === 0) {
      return basePrompt;
    }

    const examples = stats
      .map((c, i) =>
        `${i + 1}. "${c.originalValue}" 应识别为 "${c.correctedValue}"（${c.field}字段，已被人工修正${c.correctionCount}次）`
      )
      .join('\n');

    return `${basePrompt}\n\n## 常见修正案例（请参考以下历史修正经验，避免重复相同错误）：\n${examples}`;
  } catch (err) {
    // 修正案例库查询失败时静默降级，仅用基础 Prompt，不阻塞主流程
    console.warn('[build-prompt] 加载修正案例库失败，降级使用基础 Prompt:', err.message);
    return basePrompt;
  }
}

module.exports = { buildSystemPrompt };
