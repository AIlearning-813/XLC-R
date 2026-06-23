<script setup>
/**
 * InputDialog.vue — 通用输入弹窗组件
 *
 * 替代浏览器原生 prompt()，支持密码/文本输入。
 * 使用方式：
 *   <InputDialog v-model:visible="show" title="重置密码" type="password" @confirm="onConfirm" />
 */
import { ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '请输入' },
  placeholder: { type: String, default: '' },
  type: { type: String, default: 'text' }, // 'text' | 'password'
  confirmText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  minLength: { type: Number, default: 0 },
  errorMsg: { type: String, default: '' },
});

const emit = defineEmits(['update:visible', 'confirm', 'cancel']);

const inputValue = ref('');
const localError = ref('');

watch(() => props.visible, (val) => {
  if (val) {
    inputValue.value = '';
    localError.value = '';
  }
});

function handleConfirm() {
  localError.value = '';
  if (props.minLength > 0 && inputValue.value.length < props.minLength) {
    localError.value = `至少需要 ${props.minLength} 个字符`;
    return;
  }
  emit('confirm', inputValue.value);
  emit('update:visible', false);
}

function handleCancel() {
  emit('cancel');
  emit('update:visible', false);
}

function onKeyup(e) {
  if (e.key === 'Enter') handleConfirm();
  if (e.key === 'Escape') handleCancel();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="dialog-overlay" @click.self="handleCancel">
        <div class="dialog" @keyup="onKeyup">
          <h3 class="dialog-title">{{ title }}</h3>
          <p v-if="placeholder" class="dialog-hint">{{ placeholder }}</p>
          <input
            ref="inputEl"
            v-model="inputValue"
            :type="type"
            class="dialog-input"
            :placeholder="placeholder"
            autofocus
          />
          <p v-if="localError || errorMsg" class="dialog-error">{{ localError || errorMsg }}</p>
          <div class="dialog-actions">
            <button class="btn" @click="handleCancel">{{ cancelText }}</button>
            <button class="btn btn-primary" @click="handleConfirm" :disabled="!inputValue && minLength > 0">
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog {
  background: #fff;
  border-radius: var(--radius-md, 12px);
  box-shadow: var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.15));
  width: 380px;
  max-width: 92vw;
  padding: 24px;
}

.dialog-title {
  margin: 0 0 8px;
  font-size: var(--font-size-lg, 16px);
  font-weight: 600;
  color: var(--gray-800, #1a1a1a);
}

.dialog-hint {
  margin: 0 0 12px;
  font-size: var(--font-size-sm, 13px);
  color: var(--gray-400, #999);
}

.dialog-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--gray-200, #ddd);
  border-radius: var(--radius-sm, 6px);
  font-size: var(--font-size-base, 14px);
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}

.dialog-input:focus {
  border-color: var(--primary, #4f46e5);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.dialog-error {
  margin: 8px 0 0;
  font-size: var(--font-size-xs, 12px);
  color: var(--danger, #dc4c4c);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  padding: 8px 18px;
  border: 1px solid var(--gray-200, #ddd);
  border-radius: var(--radius-sm, 6px);
  background: #fff;
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  font-family: inherit;
  color: var(--gray-600, #666);
}

.btn-primary {
  background: var(--primary, #4f46e5);
  color: #fff;
  border-color: var(--primary, #4f46e5);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 过渡动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-fade-enter-active .dialog,
.dialog-fade-leave-active .dialog {
  transition: transform 0.2s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog {
  transform: scale(0.95) translateY(8px);
}

.dialog-fade-leave-to .dialog {
  transform: scale(0.95) translateY(8px);
}
</style>
