<script setup>
/**
 * DepartmentTreeEditor — 四级部门树编辑器
 *
 * 用于 SystemConfigTab 中的部门管理。
 * 支持展开/折叠、增删改节点，Admin 直接操作 / Recruiter 走审批。
 */
import { ref } from 'vue';
import { useAuthStore } from '../../stores/useAuthStore';
import { useConfigStore } from '../../stores/useConfigStore';
import { usePendingChangeStore } from '../../stores/usePendingChangeStore';

const auth = useAuthStore();
const config = useConfigStore();
const pendingStore = usePendingChangeStore();

const expanded = ref(new Set());
const editingId = ref(null);
const editName = ref('');
const newChildParentId = ref(null);
const newChildName = ref('');
const msg = ref('');

function toggleExpand(id) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
}

function startEdit(node) { editingId.value = node.id; editName.value = node.name; }
async function saveEdit(node) {
  if (!editName.value.trim()) return;
  const oldName = node.name;
  if (auth.isAdmin) {
    config.updateDepartmentNode(node.id, editName.value.trim());
    msg.value = '已更新';
  } else {
    await pendingStore.submitChange({ type: 'config', action: 'update', entityType: 'department', entityId: node.id, entityLabel: oldName, before: { name: oldName }, after: { name: editName.value.trim() } });
    msg.value = '已提交审批';
  }
  editingId.value = null;
  setTimeout(() => msg.value = '', 2000);
}
function cancelEdit() { editingId.value = null; }

async function addChild(node) {
  if (!newChildName.value.trim()) return;
  if (auth.isAdmin) {
    config.addDepartmentNode(node.id, newChildName.value.trim());
    msg.value = '已添加';
  } else {
    await pendingStore.submitChange({ type: 'config', action: 'create', entityType: 'department', entityId: node.id, entityLabel: node.name, after: { parentId: node.id, name: newChildName.value.trim(), level: node.level + 1 } });
    msg.value = '已提交审批';
  }
  newChildParentId.value = null; newChildName.value = '';
  setTimeout(() => msg.value = '', 2000);
}

async function removeNode(node) {
  if (!confirm(`确定删除「${node.name}」及其所有子部门？`)) return;
  if (auth.isAdmin) {
    config.removeDepartmentNode(node.id);
    msg.value = '已删除';
  } else {
    await pendingStore.submitChange({ type: 'config', action: 'delete', entityType: 'department', entityId: node.id, entityLabel: node.name, before: { name: node.name, level: node.level } });
    msg.value = '已提交审批';
  }
  setTimeout(() => msg.value = '', 2000);
}
</script>

<template>
  <div class="dept-tree-editor">
    <div v-if="msg" class="toast">{{ msg }}</div>
    <div v-if="!config.departmentTree?.length" class="empty">暂无部门数据，请初始化</div>
    <template v-for="node in config.departmentTree" :key="node.id">
      <DeptNode
        :node="node" :depth="0" :expanded="expanded" :editingId="editingId"
        :editName="editName" :newChildParentId="newChildParentId" :newChildName="newChildName"
        @toggle="toggleExpand" @startEdit="startEdit" @saveEdit="saveEdit" @cancelEdit="cancelEdit"
        @addChild="(n) => { newChildParentId = n.id; newChildName = ''; }"
        @confirmAdd="addChild" @cancelAdd="() => { newChildParentId = null; }"
        @remove="removeNode"
      />
    </template>
  </div>
</template>

<script>
import { defineComponent, h } from 'vue';

const DeptNode = defineComponent({
  name: 'DeptNode',
  props: ['node', 'depth', 'expanded', 'editingId', 'editName', 'newChildParentId', 'newChildName'],
  emits: ['toggle', 'startEdit', 'saveEdit', 'cancelEdit', 'addChild', 'confirmAdd', 'cancelAdd', 'remove'],
  setup(props, { emit }) {
    const hasChildren = () => props.node.children && props.node.children.length > 0;
    const isExpanded = () => props.expanded.has(props.node.id);
    const padLeft = () => props.depth * 20 + 'px';

    return () => {
      const children = [];
      // Current node
      children.push(h('div', { class: 'tree-node', style: { paddingLeft: padLeft() } }, [
        h('span', { class: 'tree-toggle', onClick: () => emit('toggle', props.node.id) },
          hasChildren() ? (isExpanded() ? '▼' : '▶') : '　'
        ),
        props.editingId === props.node.id
          ? h('span', { class: 'tree-edit-group' }, [
              h('input', { class: 'tree-input', value: props.editName, onInput: e => emit('update:editName', e.target.value), onKeyup: e => { if (e.key === 'Enter') emit('saveEdit', props.node); if (e.key === 'Escape') emit('cancelEdit'); } }),
              h('button', { class: 'btn btn-xs', onClick: () => emit('saveEdit', props.node) }, '保存'),
              h('button', { class: 'btn btn-xs', onClick: () => emit('cancelEdit') }, '取消'),
            ])
          : h('span', { class: 'tree-name' }, [
              h('span', { class: 'tree-label' }, props.node.name),
              h('span', { class: 'tree-level-tag' }, `L${props.node.level}`),
              h('button', { class: 'tree-btn', title: '编辑', onClick: () => emit('startEdit', props.node) }, '✎'),
              h('button', { class: 'tree-btn', title: '添加子部门', onClick: () => emit('addChild', props.node) }, '+'),
              h('button', { class: 'tree-btn tree-btn-danger', title: '删除', onClick: () => emit('remove', props.node) }, '✕'),
            ]),
        props.newChildParentId === props.node.id
          ? h('div', { class: 'tree-add-group', style: { paddingLeft: (props.depth + 1) * 20 + 'px' } }, [
              h('input', { class: 'tree-input', placeholder: '新部门名称', value: props.newChildName, onInput: e => emit('update:newChildName', e.target.value), onKeyup: e => { if (e.key === 'Enter') emit('confirmAdd', props.node); if (e.key === 'Escape') emit('cancelAdd'); } }),
              h('button', { class: 'btn btn-xs btn-primary', onClick: () => emit('confirmAdd', props.node) }, '添加'),
              h('button', { class: 'btn btn-xs', onClick: () => emit('cancelAdd') }, '取消'),
            ])
          : null,
      ]));

      // Children (if expanded)
      if (hasChildren() && isExpanded()) {
        for (const child of props.node.children) {
          children.push(h(DeptNode, {
            node: child, depth: props.depth + 1, expanded: props.expanded, editingId: props.editingId,
            editName: props.editName, newChildParentId: props.newChildParentId, newChildName: props.newChildName,
            onToggle: (id) => emit('toggle', id),
            onStartEdit: (n) => emit('startEdit', n),
            onSaveEdit: (n) => emit('saveEdit', n),
            onCancelEdit: () => emit('cancelEdit'),
            onAddChild: (n) => emit('addChild', n),
            onConfirmAdd: (n) => emit('confirmAdd', n),
            onCancelAdd: () => emit('cancelAdd'),
            onRemove: (n) => emit('remove', n),
          }, child.id));
        }
      }
      return h('div', null, children);
    };
  },
});

export default { components: { DeptNode } };
</script>

<style scoped>
.dept-tree-editor { font-size: var(--font-size-sm); }
.tree-node { display: flex; align-items: center; gap: 4px; padding: 4px 0; border-radius: var(--radius-sm); }
.tree-node:hover { background: var(--gray-25); }
.tree-toggle { cursor: pointer; width: 16px; font-size: 10px; color: var(--gray-400); user-select: none; }
.tree-name { display: flex; align-items: center; gap: 6px; flex: 1; }
.tree-label { font-weight: 500; color: var(--gray-700); }
.tree-level-tag { font-size: 10px; color: var(--gray-400); background: var(--gray-50); padding: 1px 5px; border-radius: 3px; }
.tree-btn { border: none; background: transparent; color: var(--gray-400); cursor: pointer; font-size: 11px; padding: 2px 4px; border-radius: 3px; }
.tree-btn:hover { background: var(--gray-100); color: var(--gray-600); }
.tree-btn-danger:hover { color: var(--danger); }
.tree-input { padding: 3px 6px; border: 1px solid var(--gray-200); border-radius: 3px; font-size: var(--font-size-sm); font-family: inherit; width: 120px; }
.tree-edit-group, .tree-add-group { display: flex; align-items: center; gap: 4px; }
.tree-add-group { padding: 4px 0; }
.btn-xs { padding: 2px 8px; font-size: 11px; border: 1px solid var(--gray-200); border-radius: 3px; background: #fff; cursor: pointer; font-family: inherit; }
.btn-xs:hover { background: var(--gray-25); }
.btn-primary.btn-xs { background: var(--primary); color: #fff; border-color: var(--primary); }
.toast { padding: 6px 12px; background: var(--success-bg); color: var(--success); border-radius: var(--radius-sm); margin-bottom: 8px; font-size: var(--font-size-xs); }
.empty { color: var(--gray-400); padding: var(--spacing-md); text-align: center; }
</style>
