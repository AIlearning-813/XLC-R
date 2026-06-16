/* 新励成招聘管理系统 V2.0 — Toast 通知 composable */

import { ref, readonly } from 'vue';

// 全局单例 toast 状态
const toasts = ref([]);
let nextId = 1;

/**
 * 使用 Toast 通知
 *
 * @returns {{ toasts, show, success, error, warning, info, remove }}
 *
 * 用法：
 *   const toast = useToast();
 *   toast.success('候选人创建成功');
 *   toast.error('创建失败: 网络错误');
 *   toast.warning('发现可能重复的候选人');
 *   toast.info('简历文件已保存');
 */
export function useToast() {
  /**
   * 显示一条 toast 通知
   * @param {string} message - 通知内容
   * @param {'success'|'error'|'warning'|'info'} type - 通知类型
   * @param {number} duration - 自动消失时间（毫秒），0 表示不自动消失
   */
  function show(message, type = 'info', duration = 5000) {
    const id = nextId++;

    // 同类型同内容的 toast 去重（避免重复提示）
    const dup = toasts.value.find(t => t.message === message && t.type === type);
    if (dup) {
      // 刷新已存在 toast 的倒计时
      dup._timer && clearTimeout(dup._timer);
      dup.id = id;
      if (duration > 0) {
        dup._timer = setTimeout(() => remove(id), duration);
      }
      return id;
    }

    const toast = {
      id,
      message,
      type,
      createdAt: Date.now(),
      _timer: null,
    };

    if (duration > 0) {
      toast._timer = setTimeout(() => remove(id), duration);
    }

    toasts.value.push(toast);

    // 限制最多显示 5 条
    if (toasts.value.length > 5) {
      const oldest = toasts.value.shift();
      oldest._timer && clearTimeout(oldest._timer);
    }

    return id;
  }

  function success(message, duration) {
    return show(message, 'success', duration);
  }

  function error(message, duration) {
    return show(message, 'error', duration || 0); // 错误默认不自动消失
  }

  function warning(message, duration) {
    return show(message, 'warning', duration || 8000);
  }

  function info(message, duration) {
    return show(message, 'info', duration);
  }

  function remove(id) {
    const idx = toasts.value.findIndex(t => t.id === id);
    if (idx !== -1) {
      const toast = toasts.value[idx];
      toast._timer && clearTimeout(toast._timer);
      toasts.value.splice(idx, 1);
    }
  }

  function clear() {
    toasts.value.forEach(t => t._timer && clearTimeout(t._timer));
    toasts.value = [];
  }

  return {
    toasts: readonly(toasts),
    show,
    success,
    error,
    warning,
    info,
    remove,
    clear,
  };
}
