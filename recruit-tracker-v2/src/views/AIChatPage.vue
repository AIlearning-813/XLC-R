<script setup>
/**
 * AIChatPage.vue — AI 招聘助手聊天页
 *
 * 用户与 AI 招聘助手对话：
 *   - 聊天界面（用户右对齐 / AI 左对齐）
 *   - RAG 增强生成（调 rag-assistant-proxy 云函数）
 *   - 引用来源展示、复制/使用功能
 *   - 反馈闭环
 */
import { ref, nextTick, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import cloudbase from '../services/cloudbase';
import { useKnowledgeStore } from '../stores/useKnowledgeStore';
import { useAuthStore } from '../stores/useAuthStore';
import { captureError } from '../services/error-capture';

const router = useRouter();
const kbStore = useKnowledgeStore();
const auth = useAuthStore();

// 消息列表
const messages = ref([]);
const inputText = ref('');
const loading = ref(false);
const chatEl = ref(null);

// ===== 聊天记录持久化（localStorage） =====
const MAX_MESSAGES = 200; // 最多保留 200 条消息（避免 localStorage 撑满）
const STORAGE_KEY_PREFIX = 'ai_chat_history_';

function getStorageKey() {
  const userId = auth.currentUsername || 'anonymous';
  return STORAGE_KEY_PREFIX + userId;
}

/** 从 localStorage 恢复聊天记录 */
function loadHistory() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // 恢复 Date 对象（JSON 序列化后是字符串）
        messages.value = parsed.map(m => ({
          ...m,
          time: m.time ? new Date(m.time) : new Date(),
        }));
        return;
      }
    }
  } catch (e) {
    console.warn('[AIChatPage] 恢复聊天记录失败:', e.message);
  }
  messages.value = [];
}

/** 保存聊天记录到 localStorage */
function saveHistory() {
  try {
    // 限制条数，裁剪旧消息
    const toSave = messages.value.length > MAX_MESSAGES
      ? messages.value.slice(-MAX_MESSAGES)
      : messages.value;
    localStorage.setItem(getStorageKey(), JSON.stringify(toSave));
  } catch (e) {
    // localStorage 满了则清掉最旧的 50 条重试一次
    console.warn('[AIChatPage] 保存聊天记录失败:', e.message);
    try {
      const trimmed = messages.value.slice(-100);
      localStorage.setItem(getStorageKey(), JSON.stringify(trimmed));
    } catch {
      // 放弃保存，不影响聊天功能
    }
  }
}

// 监听消息变化，自动保存（防抖：每次变化后 500ms 内只写一次）
let saveTimer = null;
watch(messages, () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveHistory, 500);
}, { deep: true });

onMounted(() => {
  loadHistory();
  // 恢复后滚动到底部
  if (messages.value.length > 0) {
    nextTick(scrollToBottom);
  }
});

// 建议快捷问题
const quickQuestions = [
  '帮我写一份广州CC岗的招聘JD',
  '公司有哪些福利？',
  '公司文化是什么？',
  '最近CC岗的招聘情况怎么样？',
  '如何判断一个CC候选人是否合适？',
];

// 滚动到底部
async function scrollToBottom() {
  await nextTick();
  if (chatEl.value) {
    chatEl.value.scrollTop = chatEl.value.scrollHeight;
  }
}

// 发送消息
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || loading.value) return;

  // 添加用户消息
  messages.value.push({ role: 'user', content: text, time: new Date() });
  inputText.value = '';
  await scrollToBottom();

  // 调 AI
  loading.value = true;
  try {
    const result = await cloudbase.callFunction('rag-assistant-proxy', {
      userMessage: text,
    });

    if (result?.success && result.data) {
      messages.value.push({
        role: 'assistant',
        content: result.data.response,
        sources: result.data.sourcesUsed || [],
        intent: result.data.intent,
        time: new Date(),
      });
    } else {
      messages.value.push({
        role: 'assistant',
        content: '抱歉，AI 助手暂时不可用。请稍后再试。',
        error: true,
        time: new Date(),
      });
    }
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: `抱歉，发生错误：${err.message}`,
      error: true,
      time: new Date(),
    });
  }

  loading.value = false;
  await scrollToBottom();
}

// 快捷问题
function useQuickQuestion(q) {
  inputText.value = q;
  sendMessage();
}

// 复制文本
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    // 轻提示
  }).catch(() => {});
}

// 使用此内容（跳转岗位创建）
function useContent(text) {
  // 将 AI 生成的 JD 内容带到岗位创建页
  router.push({ path: '/pipeline', query: { aiContent: text } });
}

// 反馈"没用"
async function markNotHelpful(msgIdx) {
  const msg = messages.value[msgIdx];
  if (!msg || msg.feedbackGiven) return;
  msg.feedbackGiven = true;

  // 尝试创建草稿知识条目以改进
  try {
    await kbStore.quickAdd({
      title: `用户反馈: AI回答不够好 (${new Date().toISOString().slice(0, 10)})`,
      content: `原始问题：${messages.value[msgIdx - 1]?.content || ''}\nAI回答：${msg.content?.substring(0, 500)}`,
      category: 'recruitment',
      tags: ['feedback', 'low_quality'],
    });
  } catch (e) { captureError('ai_chat', '用户反馈快速添加知识库失败', { message: e.message, context: 'markBadAnswer' }); }
}

// 格式化时间
function fmtTime(d) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 清空对话
function clearHistory() {
  if (!confirm('确定要清空所有对话记录吗？')) return;
  messages.value = [];
  try {
    localStorage.removeItem(getStorageKey());
  } catch {}
}
</script>

<template>
  <div class="ai-chat-page">
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h2 class="page-title">✨ AI 招聘助手</h2>
          <p class="page-desc">基于公司知识库和招聘历史数据的智能助手，帮你写JD、回答问题、分析候选人</p>
        </div>
        <button
          v-if="messages.length > 0"
          class="btn btn-sm btn-secondary clear-btn"
          @click="clearHistory"
          title="清空对话记录"
        >
          🗑 清空对话
        </button>
      </div>
    </div>

    <div class="chat-container">
      <!-- 空状态 -->
      <div v-if="messages.length === 0 && !loading" class="chat-welcome">
        <div class="welcome-icon">🤖</div>
        <h3 class="welcome-title">你好！我是新励成招聘AI助手</h3>
        <p class="welcome-desc">我可以帮你撰写招聘JD、回答公司相关问题、分析候选人匹配度</p>
        <div class="quick-questions">
          <button
            v-for="q in quickQuestions"
            :key="q"
            class="quick-btn"
            @click="useQuickQuestion(q)"
          >
            {{ q }}
          </button>
        </div>
      </div>

      <!-- 聊天区域 -->
      <div v-else class="chat-messages" ref="chatEl">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="message"
          :class="msg.role"
        >
          <div class="message-avatar">
            {{ msg.role === 'user' ? '👤' : '🤖' }}
          </div>
          <div class="message-body">
            <div class="message-content" :class="{ error: msg.error }">
              {{ msg.content }}
            </div>

            <!-- AI 消息的引用来源 -->
            <div v-if="msg.role === 'assistant' && msg.sources?.length" class="message-sources">
              <span class="sources-label">📚 参考：</span>
              <span v-for="s in msg.sources" :key="s.id" class="source-chip">
                {{ s.title }}
              </span>
            </div>

            <!-- AI 消息的操作按钮 -->
            <div v-if="msg.role === 'assistant' && !msg.error" class="message-actions">
              <button class="action-btn" @click="copyText(msg.content)" title="复制">📋 复制</button>
              <button
                v-if="msg.intent === 'write_jd'"
                class="action-btn"
                @click="useContent(msg.content)"
                title="使用此内容"
              >
                ✅ 使用
              </button>
              <button
                class="action-btn"
                :class="{ disabled: msg.feedbackGiven }"
                @click="markNotHelpful(i)"
                title="没用"
              >
                {{ msg.feedbackGiven ? '已反馈' : '👎 没用' }}
              </button>
            </div>

            <div class="message-time">{{ fmtTime(msg.time) }}</div>

            <!-- 沉淀提示 -->
            <div v-if="msg.role === 'assistant' && msg.intent === 'write_jd' && !msg.feedbackGiven" class="knowledge-hint">
              💡 提示：修改AI生成的内容后使用，可以将修改经验沉淀到知识库
            </div>
          </div>
        </div>

        <!-- 加载中 -->
        <div v-if="loading" class="message assistant">
          <div class="message-avatar">🤖</div>
          <div class="message-body">
            <div class="message-content thinking">
              <span class="dot-pulse">思考中</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="chat-input-area">
        <input
          v-model="inputText"
          class="chat-input"
          placeholder="输入你的问题，如：帮我写一份CC岗的招聘JD…"
          @keyup.enter="sendMessage"
          :disabled="loading"
        />
        <button
          class="btn btn-primary send-btn"
          @click="sendMessage"
          :disabled="!inputText.trim() || loading"
        >
          {{ loading ? '…' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-chat-page {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
}

.page-header { margin-bottom: var(--spacing-md); }
.page-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--spacing-md); }
.page-title { font-size: var(--font-size-2xl); font-weight: 700; color: var(--gray-800); }
.page-desc { font-size: var(--font-size-sm); color: var(--gray-400); margin-top: 2px; }
.clear-btn { flex-shrink: 0; margin-top: 4px; }

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-md);
  overflow: hidden;
  min-height: 0;
}

/* 欢迎页 */
.chat-welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl);
  text-align: center;
}
.welcome-icon { font-size: 48px; margin-bottom: var(--spacing-md); }
.welcome-title { font-size: var(--font-size-lg); font-weight: 600; color: var(--gray-700); margin: 0 0 var(--spacing-xs); }
.welcome-desc { font-size: var(--font-size-sm); color: var(--gray-400); margin-bottom: var(--spacing-lg); }

.quick-questions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  justify-content: center;
  max-width: 500px;
}
.quick-btn {
  padding: 8px 16px;
  border: 1px solid var(--primary-border);
  border-radius: var(--radius-full);
  background: var(--primary-bg);
  color: var(--primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all var(--transition);
  font-family: inherit;
}
.quick-btn:hover {
  background: var(--primary);
  color: #fff;
}

/* 聊天消息 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.message {
  display: flex;
  gap: var(--spacing-sm);
  max-width: 85%;
}
.message.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.message.assistant {
  align-self: flex-start;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--gray-50);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.message-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-content {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  white-space: pre-wrap;
}
.message.user .message-content {
  background: var(--primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.message.assistant .message-content {
  background: var(--gray-50);
  color: var(--gray-700);
  border-bottom-left-radius: 4px;
}
.message-content.error {
  background: #fce4ec;
  color: var(--danger);
}
.message-content.thinking {
  background: var(--gray-50);
  color: var(--gray-400);
  font-style: italic;
}

.dot-pulse::after {
  content: '';
  animation: dots 1.5s steps(4, end) infinite;
}
@keyframes dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
}

.message-sources {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
  font-size: var(--font-size-xs);
}
.sources-label { color: var(--gray-400); }
.source-chip {
  padding: 1px 8px;
  background: var(--gray-100);
  border-radius: var(--radius-full);
  color: var(--gray-500);
}

.message-actions {
  display: flex;
  gap: var(--spacing-xs);
}
.action-btn {
  border: none;
  background: none;
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: all var(--transition);
}
.action-btn:hover { color: var(--primary); background: var(--primary-bg); }
.action-btn.disabled { opacity: 0.5; cursor: default; }

.message-time {
  font-size: var(--font-size-xs);
  color: var(--gray-300);
  padding: 0 4px;
}

.knowledge-hint {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  padding: 2px 4px;
  background: var(--warning-bg);
  border-radius: var(--radius-sm);
  margin-top: 2px;
}

/* 输入区 */
.chat-input-area {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-top: 1px solid var(--gray-100);
  background: #fff;
}
.chat-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  font-family: inherit;
  outline: none;
}
.chat-input:focus { border-color: var(--primary); }
.send-btn { padding: 10px 24px; border-radius: var(--radius-full); }
</style>
