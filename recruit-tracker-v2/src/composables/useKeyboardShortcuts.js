/* 新励成招聘管理系统 V2.0 — 键盘快捷键 composable
 *
 * 看板和列表页的键盘快捷操作，支持：
 *   - 快速查看候选人详情（Space）
 *   - 移动阶段（Ctrl+→/←）
 *   - 淘汰/放弃/确认面试（E/W/A）
 *   - 关闭弹窗/取消选择（Esc）
 *   - 显示快捷键帮助（?）
 *   - 输入框内自动禁用（防止冲突）
 *
 * 用法：
 *   const shortcuts = useKeyboardShortcuts({
 *     onMoveNext: () => { ... },
 *     onMovePrev: () => { ... },
 *     ...
 *   });
 *   // 组件卸载时自动解除绑定
 */

import { onMounted, onUnmounted } from 'vue';

// 默认快捷键映射
const DEFAULT_SHORTCUTS = [
  { key: ' ', ctrl: false, description: '快速查看候选人详情', handler: 'onQuickView' },
  { key: 'ArrowRight', ctrl: true, description: '移动到下一阶段', handler: 'onMoveNext' },
  { key: 'ArrowLeft', ctrl: true, description: '移动到上一阶段', handler: 'onMovePrev' },
  { key: 'e', ctrl: false, description: '淘汰候选人', handler: 'onReject' },
  { key: 'w', ctrl: false, description: '标记放弃', handler: 'onWithdraw' },
  { key: 'a', ctrl: false, description: '标记已确认面试', handler: 'onInviteConfirm' },
  { key: 'Escape', ctrl: false, description: '关闭弹窗/取消选择', handler: 'onEscape' },
  { key: '?', ctrl: false, description: '显示快捷键帮助', handler: 'onHelp' },
];

/**
 * @param {Object} handlers - 快捷键处理函数映射
 * @param {Function} [handlers.onQuickView] - 快速查看
 * @param {Function} [handlers.onMoveNext] - 移动到下一阶段
 * @param {Function} [handlers.onMovePrev] - 移动到上一阶段
 * @param {Function} [handlers.onReject] - 淘汰候选人
 * @param {Function} [handlers.onWithdraw] - 标记放弃
 * @param {Function} [handlers.onInviteConfirm] - 标记已确认面试
 * @param {Function} [handlers.onEscape] - 关闭弹窗
 * @param {Function} [handlers.onHelp] - 显示帮助
 * @returns {{ shortcuts: Array, isHelpVisible: Ref<boolean>, toggleHelp: () => void }}
 */
export function useKeyboardShortcuts(handlers = {}) {
  let isHelpVisible = false;

  /**
   * 判断当前焦点是否在输入框内（输入框内不响应快捷键）
   */
  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute('role') === 'textbox') return true;
    return false;
  }

  function handleKeydown(e) {
    // 输入框内不响应快捷键（Esc 除外）
    if (isInputFocused() && e.key !== 'Escape') return;

    // 检测修饰键
    const ctrl = e.ctrlKey || e.metaKey;

    // 匹配快捷键
    for (const shortcut of DEFAULT_SHORTCUTS) {
      if (e.key === shortcut.key && ctrl === shortcut.ctrl) {
        // 防止 Space 滚动页面
        if (shortcut.key === ' ') {
          e.preventDefault();
        }

        const handler = handlers[shortcut.handler];
        if (handler) {
          e.preventDefault();
          handler();
        }
        return;
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown);
  });

  function toggleHelp() {
    isHelpVisible = !isHelpVisible;
  }

  return {
    shortcuts: DEFAULT_SHORTCUTS,
    isHelpVisible,
    toggleHelp,
  };
}

export { DEFAULT_SHORTCUTS };
