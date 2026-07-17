/* 新励成招聘管理系统 V2.0 — 知识库 Store
 *
 * 管理招聘知识条目（KnowledgeBase 集合）：
 *   - 9 种分类、关键字搜索、标签匹配
 *   - CRUD + 归档 + 审核（针对 web_search draft 条目）
 *   - RAG 检索接口（关键字+标签，非向量检索）
 *   - 反馈闭环：useCount 递增
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { handleError } from '../services/error-handler';
import { useAuthStore } from './useAuthStore';
import { captureError } from '../services/error-capture';
import { writeAuditLog } from '../services/audit-log';

// 知识库 9 种分类
export const KNOWLEDGE_CATEGORIES = [
  { key: 'company_intro', label: '公司介绍' },
  { key: 'culture', label: '企业文化' },
  { key: 'benefits', label: '薪酬福利' },
  { key: 'recruitment', label: '招聘话术' },
  { key: 'jd_template', label: 'JD模板' },
  { key: 'interview', label: '面试题库' },
  { key: 'industry', label: '行业知识' },
  { key: 'competitor', label: '竞品分析' },
  { key: 'policy', label: '政策法规' },
];

export const useKnowledgeStore = defineStore('knowledge', () => {
  // ===== 状态 =====
  const entries = ref([]);
  const loading = ref(false);
  const error = ref('');
  const totalCount = ref(0);

  // ===== 计算属性 =====
  const publishedEntries = computed(() =>
    entries.value.filter(e => e.status === 'published')
  );

  const draftEntries = computed(() =>
    entries.value.filter(e => e.status === 'draft')
  );

  const entriesByCategory = computed(() => {
    const map = {};
    for (const e of entries.value) {
      const cat = e.category || 'general';
      if (!map[cat]) map[cat] = [];
      map[cat].push(e);
    }
    return map;
  });

  // ===== 查询 =====

  /**
   * @param {Object} filters
   * @param {string} [filters.category]
   * @param {string} [filters.status] - 'published' | 'draft' | 'archived'
   * @param {string} [filters.search] - 关键字搜索（标题+内容）
   * @param {string[]} [filters.tags]
   * @param {number} [filters.limit=50]
   */
  async function fetchEntries(filters = {}) {
    const db = cloudbase.db();
    if (!db) return [];

    loading.value = true;
    error.value = '';

    try {
      const conditions = {};

      if (filters.category) conditions.category = filters.category;
      if (filters.status) conditions.status = filters.status;
      if (filters.tags?.length) {
        conditions.tags = db.command.in(filters.tags);
      }

      let query = db.collection('KnowledgeBase')
        .where(conditions)
        .orderBy('useCount', 'desc')
        .limit(filters.limit || 50);

      const { data } = await query.get();
      const result = data || [];

      // 客户端侧关键字搜索（CloudBase 不支持全文检索）
      if (filters.search) {
        const q = filters.search.toLowerCase();
        entries.value = result.filter(e =>
          (e.title || '').toLowerCase().includes(q) ||
          (e.content || '').toLowerCase().includes(q)
        );
      } else {
        entries.value = result;
      }

      return entries.value;
    } catch (err) {
      handleError(err, { context: '查询知识库' });
      error.value = err.message;
      return [];
    } finally {
      loading.value = false;
    }
  }

  // ===== CRUD =====

  async function addEntry(entry) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const auth = useAuthStore();
    const doc = {
      title: entry.title || '',
      category: entry.category || 'general',
      content: entry.content || '',
      tags: entry.tags || [],
      structuredData: entry.structuredData || null,
      relevance: entry.relevance || 'common',
      source: entry.source || 'manual',
      sourceUrl: entry.sourceUrl || '',
      sourceVerified: entry.sourceVerified !== undefined ? entry.sourceVerified : true,
      status: entry.status || 'published', // manual entries default published
      useCount: 0,
      createdBy: auth.currentUsername || 'system',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('KnowledgeBase').add(doc);
    const newEntry = { ...doc, _id: result.id };
    entries.value.unshift(newEntry);

    writeAuditLog('knowledge_store', 'kb_entry_created', 'KnowledgeBase', [result.id], { title: entry.title, category: entry.category }, auth.currentUsername);

    return newEntry;
  }

  async function updateEntry(id, data) {
    const db = cloudbase.db();
    if (!db) throw new Error('数据库未初始化');

    const updateData = { ...data, updatedAt: new Date() };
    await db.collection('KnowledgeBase').doc(id).update(updateData);

    const idx = entries.value.findIndex(e => e._id === id);
    if (idx !== -1) {
      entries.value[idx] = { ...entries.value[idx], ...updateData };
    }
  }

  async function archiveEntry(id) {
    return updateEntry(id, { status: 'archived' });
  }

  /** 审核 web_search draft → published */
  async function approveEntry(id) {
    return updateEntry(id, { status: 'published', sourceVerified: true });
  }

  // ===== RAG 检索（关键字+标签匹配）=====

  /**
   * 供 rag-assistant-proxy 或前端检索使用
   * @param {string[]} keywords - 提取的关键字列表
   * @param {Object} [context] - { category, tags }
   * @returns {Promise<Array>} 匹配的知识条目
   */
  async function searchByKeywords(keywords, context = {}) {
    const db = cloudbase.db();
    if (!db || !keywords?.length) return [];

    try {
      const conditions = { status: 'published' };

      // 按分类过滤
      if (context.category) {
        conditions.category = context.category;
      }

      // 标签匹配
      if (context.tags?.length) {
        conditions.tags = db.command.in(context.tags);
      }

      const { data } = await db.collection('KnowledgeBase')
        .where(conditions)
        .orderBy('useCount', 'desc')
        .limit(30)
        .get();

      if (!data?.length) return [];

      // 客户端关键字打分：标题命中权重 3，内容命中权重 1
      const scored = data.map(entry => {
        let score = 0;
        const title = (entry.title || '').toLowerCase();
        const content = (entry.content || '').toLowerCase();
        const tags = (entry.tags || []).map(t => t.toLowerCase());

        for (const kw of keywords) {
          const k = kw.toLowerCase();
          if (title.includes(k)) score += 3;
          if (content.includes(k)) score += 1;
          if (tags.some(t => t.includes(k))) score += 2;
        }

        return { ...entry, _score: score };
      });

      // 按评分降序，取前 10
      return scored
        .filter(e => e._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, 10);
    } catch (err) {
      console.warn('[useKnowledgeStore] RAG检索失败:', err.message);
      return [];
    }
  }

  // ===== 反馈闭环 =====

  /**
   * 用户点击"使用此内容"时调用
   */
  async function incrementUseCount(id) {
    const db = cloudbase.db();
    if (!db) return;

    try {
      await db.collection('KnowledgeBase').doc(id).update({
        useCount: db.command.inc(1),
      });

      // 更新本地缓存
      const idx = entries.value.findIndex(e => e._id === id);
      if (idx !== -1) {
        entries.value[idx] = {
          ...entries.value[idx],
          useCount: (entries.value[idx].useCount || 0) + 1,
        };
      }
    } catch (err) {
      console.warn('[useKnowledgeStore] useCount更新失败:', err.message);
    }
  }

  /**
   * 快速创建知识条目（从 AI 对话中沉淀）
   */
  async function quickAdd({ title, content, category = 'recruitment', tags = [] }) {
    return addEntry({
      title,
      content,
      category,
      tags,
      source: 'ai_conversation',
      sourceVerified: false,
      status: 'draft',
      relevance: 'specific',
    });
  }

  return {
    // state
    entries,
    loading,
    error,
    totalCount,
    // computed
    publishedEntries,
    draftEntries,
    entriesByCategory,
    // actions
    fetchEntries,
    addEntry,
    updateEntry,
    archiveEntry,
    approveEntry,
    searchByKeywords,
    incrementUseCount,
    quickAdd,
  };
});
