<script setup>
/**
 * DepartmentTreeEditor — 四级部门平铺表格编辑器
 *
 * 将部门树展开为表格，每行显示完整的 L1/L2/L3/L4 路径。
 * 支持行内编辑、删除、添加子部门。
 * Admin 直接操作，Recruiter 走 PendingChanges 审批。
 */
import { ref, computed } from 'vue';
import { useAuthStore } from '../../stores/useAuthStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { usePendingChangeStore } from '../../stores/usePendingChangeStore';

const auth = useAuthStore();
const config = useConfigStore();
const pendingStore = usePendingChangeStore();

const msg = ref('');

// 将树展开为平铺行：每行 { id, l1, l2, l3, l4, node }
// 每个节点都生成一行（含中间节点），方便编辑任意层级
function flattenTree(nodes, l1 = '', l2 = '', l3 = '') {
  const rows = [];
  for (const n of nodes) {
    const curL1 = n.level === 1 ? n.name : l1;
    const curL2 = n.level === 2 ? n.name : (n.level > 2 ? l2 : '');
    const curL3 = n.level === 3 ? n.name : (n.level > 3 ? l3 : '');
    const curL4 = n.level === 4 ? n.name : '';

    const row = {
      id: n.id,
      l1: curL1,
      l2: curL2,
      l3: curL3,
      l4: curL4,
      level: n.level,
      node: n,
    };

    // 当前节点本身也作为一行（可编辑/删除/添加子节点）
    rows.push(row);

    // 递归子节点
    if (n.children && n.children.length > 0) {
      rows.push(...flattenTree(
        n.children,
        curL1,
        n.level === 2 ? n.name : l2,
        n.level === 3 ? n.name : l3,
      ));
    }
  }
  return rows;
}

const rows = computed(() => {
  if (!config.departmentTree?.length) return [];
  return flattenTree(config.departmentTree);
});

// 按一级部门分组
const l1Groups = computed(() => {
  const groups = [];
  for (const row of rows.value) {
    const last = groups[groups.length - 1];
    if (last && last.l1 === row.l1) {
      last.rows.push(row);
    } else {
      groups.push({ l1: row.l1, rows: [row] });
    }
  }
  return groups;
});

// ===== 编辑状态 =====
const editingId = ref(null);
const editValue = ref('');
const editLevel = ref(0);

function startEdit(row) {
  editingId.value = row.id;
  // 编辑当前行最深层的值
  if (row.l4) { editValue.value = row.l4; editLevel.value = 4; }
  else if (row.l3) { editValue.value = row.l3; editLevel.value = 3; }
  else if (row.l2) { editValue.value = row.l2; editLevel.value = 2; }
  else { editValue.value = row.l1; editLevel.value = 1; }
}

async function saveEdit(row) {
  const name = editValue.value.trim();
  if (!name) { editingId.value = null; return; }

  if (auth.isAdmin) {
    config.updateDepartmentNode(row.id, name);
    msg.value = '已更新';
  } else {
    await pendingStore.submitChange({
      type: 'config', action: 'update', entityType: 'department',
      entityId: row.id, entityLabel: row.node.name,
      before: { name: row.node.name },
      after: { name },
    });
    msg.value = '已提交审批';
  }
  editingId.value = null;
  setTimeout(() => { msg.value = ''; }, 2000);
}

function cancelEdit() { editingId.value = null; }

// ===== 添加子部门 =====
const addingParentId = ref(null);
const addingLevel = ref(0);
const newChildName = ref('');

function startAdd(row) {
  addingParentId.value = row.id;
  addingLevel.value = row.level + 1;
  newChildName.value = '';
}

async function confirmAdd(row) {
  const name = newChildName.value.trim();
  if (!name) { addingParentId.value = null; return; }

  if (auth.isAdmin) {
    config.addDepartmentNode(row.id, name);
    msg.value = '已添加';
  } else {
    await pendingStore.submitChange({
      type: 'config', action: 'create', entityType: 'department',
      entityId: row.id, entityLabel: row.node.name,
      after: { parentId: row.id, name, level: row.level + 1 },
    });
    msg.value = '已提交审批';
  }
  addingParentId.value = null;
  newChildName.value = '';
  setTimeout(() => { msg.value = ''; }, 2000);
}

function cancelAdd() { addingParentId.value = null; newChildName.value = ''; }

// ===== 删除 =====
async function removeNode(row) {
  const displayName = row.l4 || row.l3 || row.l2 || row.l1;
  if (!confirm(`确定删除「${displayName}」${row.node.children?.length ? '及其所有子部门' : ''}？`)) return;

  if (auth.isAdmin) {
    config.removeDepartmentNode(row.id);
    msg.value = '已删除';
  } else {
    await pendingStore.submitChange({
      type: 'config', action: 'delete', entityType: 'department',
      entityId: row.id, entityLabel: displayName,
      before: { name: displayName, level: row.level },
    });
    msg.value = '已提交审批';
  }
  setTimeout(() => { msg.value = ''; }, 2000);
}

const levelLabels = { 1: '一级', 2: '二级', 3: '三级', 4: '四级' };
</script>

<template>
  <div class="dept-editor">
    <!-- Toast -->
    <transition name="fade">
      <div v-if="msg" class="toast">{{ msg }}</div>
    </transition>

    <!-- 空状态 -->
    <div v-if="!config.departmentTree?.length" class="empty">
      暂无部门数据，请初始化
    </div>

    <!-- 平铺表格（按一级部门分组） -->
    <div v-else class="dept-table-wrapper">
      <table class="dept-table">
        <thead>
          <tr>
            <th class="col-l1">一级部门</th>
            <th class="col-l2">二级部门</th>
            <th class="col-l3">三级部门</th>
            <th class="col-l4">四级部门（校区）</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in l1Groups" :key="group.l1">
            <tr
              v-for="(row, ri) in group.rows"
              :key="row.id"
              :class="{
                'row-l1-first': ri === 0,
                'row-editing': editingId === row.id,
              }"
            >
              <!-- L1：仅每组第一行显示 -->
              <td class="col-l1" :class="{ 'cell-merged': ri > 0 }">
                <span v-if="ri === 0" class="cell-value level-1">{{ row.l1 }}</span>
              </td>

              <!-- L2 -->
              <td class="col-l2">
                <template v-if="editingId === row.id && editLevel === 2">
                  <div class="edit-inline">
                    <input
                      v-model="editValue"
                      class="edit-input"
                      @keyup.enter="saveEdit(row)"
                      @keyup.escape="cancelEdit"
                      autofocus
                    />
                    <button class="btn-mini btn-save" @click="saveEdit(row)">✓</button>
                    <button class="btn-mini btn-cancel" @click="cancelEdit">✕</button>
                  </div>
                </template>
                <span v-else class="cell-value" :class="{ 'level-2': row.level === 2 }">{{ row.l2 }}</span>
              </td>

              <!-- L3 -->
              <td class="col-l3">
                <template v-if="editingId === row.id && editLevel === 3">
                  <div class="edit-inline">
                    <input
                      v-model="editValue"
                      class="edit-input"
                      @keyup.enter="saveEdit(row)"
                      @keyup.escape="cancelEdit"
                      autofocus
                    />
                    <button class="btn-mini btn-save" @click="saveEdit(row)">✓</button>
                    <button class="btn-mini btn-cancel" @click="cancelEdit">✕</button>
                  </div>
                </template>
                <span v-else class="cell-value" :class="{ 'level-3': row.level === 3 }">{{ row.l3 }}</span>
              </td>

              <!-- L4 -->
              <td class="col-l4">
                <template v-if="editingId === row.id && editLevel === 4">
                  <div class="edit-inline">
                    <input
                      v-model="editValue"
                      class="edit-input"
                      @keyup.enter="saveEdit(row)"
                      @keyup.escape="cancelEdit"
                      autofocus
                    />
                    <button class="btn-mini btn-save" @click="saveEdit(row)">✓</button>
                    <button class="btn-mini btn-cancel" @click="cancelEdit">✕</button>
                  </div>
                </template>
                <template v-else-if="editingId === row.id && editLevel === 1">
                  <div class="edit-inline">
                    <input
                      v-model="editValue"
                      class="edit-input"
                      @keyup.enter="saveEdit(row)"
                      @keyup.escape="cancelEdit"
                      autofocus
                    />
                    <button class="btn-mini btn-save" @click="saveEdit(row)">✓</button>
                    <button class="btn-mini btn-cancel" @click="cancelEdit">✕</button>
                  </div>
                </template>
                <span v-else class="cell-value level-4">{{ row.l4 }}</span>
              </td>

              <!-- 操作 -->
              <td class="col-actions">
                <div class="action-btns">
                  <button class="btn-icon" title="编辑" @click="startEdit(row)">✎</button>
                  <button
                    v-if="row.level < 4"
                    class="btn-icon btn-add"
                    title="添加子部门"
                    @click="startAdd(row)"
                  >+</button>
                  <button class="btn-icon btn-del" title="删除" @click="removeNode(row)">✕</button>
                </div>

                <!-- 添加子部门输入框 -->
                <div v-if="addingParentId === row.id" class="add-inline">
                  <input
                    v-model="newChildName"
                    class="edit-input"
                    :placeholder="'新' + levelLabels[addingLevel] + '部门名称'"
                    @keyup.enter="confirmAdd(row)"
                    @keyup.escape="cancelAdd"
                    autofocus
                  />
                  <button class="btn-mini btn-save" @click="confirmAdd(row)">✓</button>
                  <button class="btn-mini btn-cancel" @click="cancelAdd">✕</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.dept-editor {
  font-size: var(--font-size-sm);
}

.dept-table-wrapper {
  max-height: 600px;
  overflow-y: auto;
  border: 1px solid var(--gray-100);
  border-radius: var(--radius-md);
}

.dept-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.dept-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.dept-table th {
  background: var(--gray-50);
  color: var(--gray-500);
  font-weight: 600;
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 10px 12px;
  text-align: left;
  border-bottom: 2px solid var(--gray-100);
}

.dept-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--gray-50);
  vertical-align: middle;
}

.row-l1-first td {
  border-top: 2px solid var(--gray-100);
}

.row-editing td {
  background: var(--primary-bg, #f0f4ff);
}

.cell-merged {
  opacity: 0;
}

.cell-value {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.level-1 {
  color: var(--gray-800);
  font-weight: 700;
  font-size: var(--font-size-sm);
}

.level-2 {
  color: var(--gray-700);
}

.level-3 {
  color: var(--gray-600);
  font-size: var(--font-size-sm);
}

.level-4 {
  color: var(--primary, #4a6cf7);
  background: rgba(74, 108, 247, 0.06);
}

/* 列宽 */
.col-l1 { width: 18%; }
.col-l2 { width: 18%; }
.col-l3 { width: 18%; }
.col-l4 { width: 24%; }
.col-actions { width: 22%; }

/* 操作按钮 */
.action-btns {
  display: flex;
  gap: 2px;
  align-items: center;
}

.btn-icon {
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--gray-400);
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  font-family: inherit;
}

.btn-icon:hover {
  background: var(--gray-50);
  color: var(--gray-600);
  border-color: var(--gray-200);
}

.btn-add:hover {
  color: var(--primary, #4a6cf7);
  border-color: rgba(74, 108, 247, 0.3);
  background: rgba(74, 108, 247, 0.06);
}

.btn-del:hover {
  color: var(--danger, #e53e3e);
  border-color: rgba(229, 62, 62, 0.3);
  background: rgba(229, 62, 62, 0.06);
}

/* 内联编辑 */
.edit-inline, .add-inline {
  display: flex;
  gap: 4px;
  align-items: center;
}

.edit-input {
  padding: 4px 8px;
  border: 1px solid var(--primary, #4a6cf7);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-family: inherit;
  outline: none;
  width: 110px;
  box-shadow: 0 0 0 2px rgba(74, 108, 247, 0.12);
}

.btn-mini {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}

.btn-save {
  background: var(--primary, #4a6cf7);
  color: #fff;
}

.btn-cancel {
  background: var(--gray-100);
  color: var(--gray-500);
}

/* Toast */
.toast {
  padding: 6px 14px;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: var(--radius-sm);
  margin-bottom: 10px;
  font-size: var(--font-size-xs);
  display: inline-block;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 空状态 */
.empty {
  color: var(--gray-400);
  padding: var(--spacing-lg);
  text-align: center;
  border: 1px dashed var(--gray-200);
  border-radius: var(--radius-md);
}
</style>
