<script setup>
/**
 * DepartmentManageTab.vue — 部门与城市管理 Tab
 *
 * 包含：四级部门架构（DepartmentTreeEditor）+ 工作城市管理
 */
import { ref } from 'vue';
import { useConfigStore } from '../../stores/useConfigStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { usePendingChangeStore } from '../../stores/usePendingChangeStore';
import DepartmentTreeEditor from './DepartmentTreeEditor.vue';

const config = useConfigStore();
const auth = useAuthStore();
const pendingStore = usePendingChangeStore();

// ===== Toast 反馈 =====
const submitMsg = ref('');
const submitMsgType = ref('success');
function showMsg(msg, type = 'success') {
  submitMsg.value = msg;
  submitMsgType.value = type;
  setTimeout(() => { submitMsg.value = ''; }, 3000);
}

// ===== 城市管理 =====
const newCity = ref('');

async function submitAddCity() {
  const name = newCity.value.trim();
  if (!name) return;
  if (auth.isAdmin) {
    config.addCity(name);
    showMsg(`已添加城市：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'city',
        entityId: 'system', entityLabel: `添加城市: ${name}`,
        before: { cities: config.cities },
        after: { cities: [...config.cities, name] },
      });
      showMsg(`已提交"添加城市：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
  newCity.value = '';
}

async function removeCity(name) {
  if (!confirm(`确定删除城市「${name}」？`)) return;
  if (auth.isAdmin) {
    config.removeCity(name);
    showMsg(`已删除城市：${name}`);
  } else {
    try {
      await pendingStore.submitChange({
        type: 'config', action: 'update', entityType: 'city',
        entityId: 'system', entityLabel: `删除城市: ${name}`,
        before: { cities: config.cities },
        after: { cities: config.cities.filter(c => c !== name) },
      });
      showMsg(`已提交"删除城市：${name}"，待管理员审批`);
    } catch (e) { showMsg(`提交失败：${e.message}`, 'error'); }
  }
}
</script>

<template>
  <div class="dept-manage">
    <!-- Toast -->
    <transition name="fade">
      <div v-if="submitMsg" class="submit-toast" :class="submitMsgType === 'error' ? 'toast-error' : 'toast-success'">
        {{ submitMsg }}
      </div>
    </transition>

    <!-- 部门管理（四级树形） -->
    <section class="config-section">
      <h3 class="section-title">部门管理（四级架构）</h3>
      <DepartmentTreeEditor />
      <p class="section-hint">来源于员工名册：12个一级部门 / 30个二级部门 / 25个三级部门 / 54个校区</p>
    </section>

    <!-- 工作城市 -->
    <section class="config-section">
      <h3 class="section-title">工作城市</h3>
      <p class="section-desc">招聘岗位所在城市，新建招聘需求时供选择</p>
      <div class="chip-group">
        <span v-for="city in config.cities" :key="city" class="chip">
          {{ city }}
          <button class="chip-remove" @click="removeCity(city)" title="删除">&times;</button>
        </span>
        <span class="chip chip-add">
          <input v-model="newCity" class="chip-input" placeholder="新城市" @keyup.enter="submitAddCity" size="8" />
          <button class="chip-confirm" @click="submitAddCity">+</button>
        </span>
      </div>
    </section>

    <!-- 权限提示 -->
    <p v-if="!auth.isAdmin" class="hint-recruiter">⚠ 你的修改将提交给管理员审核后生效</p>
  </div>
</template>

<style scoped>
.dept-manage { max-width: 800px; }

.config-section {
  margin-bottom: var(--spacing-xl);
  padding-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--gray-100);
}
.config-section:last-child { border-bottom: none; }

.section-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--gray-700);
  margin: 0 0 var(--spacing-xs);
}
.section-desc {
  font-size: var(--font-size-sm);
  color: var(--gray-400);
  margin: 0 0 var(--spacing-md);
}
.section-hint {
  font-size: var(--font-size-xs);
  color: var(--gray-400);
  margin: var(--spacing-sm) 0 0;
}

/* Toast */
.submit-toast {
  position: fixed; top: 16px; right: 16px; z-index: 9999;
  padding: 12px 20px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm); font-weight: 500;
  box-shadow: var(--shadow-lg); max-width: 400px;
}
.toast-success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
.toast-error { background: #fce4ec; color: #c62828; border: 1px solid #ef9a9a; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Chip 组 */
.chip-group {
  display: flex; flex-wrap: wrap; gap: var(--spacing-xs); align-items: center;
}
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  background: var(--gray-50); border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm); color: var(--gray-600);
}
.chip-add { background: var(--primary-bg); border-color: var(--primary-border); }
.chip-input {
  border: none; background: transparent;
  font-size: var(--font-size-sm); color: var(--gray-700);
  outline: none; min-width: 40px;
}
.chip-input:focus { background: rgba(255,255,255,0.5); }
.chip-remove, .chip-confirm {
  border: none; background: none; cursor: pointer;
  font-size: 13px; padding: 0 2px; color: var(--gray-400); line-height: 1;
}
.chip-confirm:hover { color: var(--primary); }
.chip-remove:hover { color: var(--danger); }

.hint-recruiter {
  margin-top: var(--spacing-md);
  padding: var(--spacing-sm);
  background: var(--warning-bg); color: var(--warning);
  border-radius: var(--radius-sm); font-size: var(--font-size-sm);
}
</style>
