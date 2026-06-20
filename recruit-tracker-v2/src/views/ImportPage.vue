<script setup>
/**
 * ImportPage.vue — 历史数据导入向导
 *
 * 4 步导入流程：
 *   ① 上传文件（CSV/Excel，自动检测编码）
 *   ② 列映射（预置模板：BOSS直聘/智联/猎聘）
 *   ③ 去重策略（跳过/覆盖/全部导入）
 *   ④ 确认导入 + 进度 + 结果
 */
import { ref, computed } from 'vue';
import cloudbase from '../services/cloudbase';
import { useAuthStore } from '../stores/useAuthStore';
import { COLUMN_MAPPING_PRESETS } from '../config/constants';

const db = cloudbase.db();
const auth = useAuthStore();

// ===== 步骤控制 =====
const step = ref(1); // 1-4
const maxStep = ref(1);

// ===== 步骤 1：文件上传 =====
const fileData = ref(null);    // 解析后的行数据
const columns = ref([]);       // 检测到的列名
const previewRows = ref([]);   // 前 10 行预览
const encoding = ref('UTF-8');
const fileError = ref('');

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  fileError.value = '';

  const ext = file.name.split('.').pop().toLowerCase();
  if (!['csv', 'xlsx', 'xls'].includes(ext)) {
    fileError.value = '仅支持 CSV 和 Excel（.xlsx/.xls）文件';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    if (ext === 'csv') {
      parseCSV(text);
    } else {
      // Excel 需要 xlsx 库，此处用 CSV 回退提示
      fileError.value = 'Excel 解析需要安装 xlsx 库。当前支持 CSV 格式，请将 Excel 另存为 CSV 后导入。';
      // 尝试 CSV 解析
      parseCSV(text);
    }
  };
  reader.readAsText(file, encoding.value);
}

function parseCSV(text) {
  // 自动检测分隔符
  const sep = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) {
    fileError.value = '文件为空或只有标题行';
    return;
  }

  // 解析表头
  const parseRow = (line) => {
    const result = [];
    let field = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === sep && !inQuotes) { result.push(field.trim()); field = ''; continue; }
      field += ch;
    }
    result.push(field.trim());
    return result;
  };

  const header = parseRow(lines[0]);
  columns.value = header;

  // 解析数据行
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseRow(lines[i]);
    const row = {};
    header.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    rows.push(row);
  }

  fileData.value = rows;
  previewRows.value = rows.slice(0, 10);
  maxStep.value = 2;
  step.value = 2;
}

// ===== 步骤 2：列映射 =====
const FIELD_OPTIONS = [
  { value: '', label: '— 不导入 —' },
  { value: 'name', label: '姓名 *' },
  { value: 'phone', label: '手机号 *' },
  { value: 'email', label: '邮箱' },
  { value: 'expectedPosition', label: '应聘岗位' },
  { value: 'currentStage', label: '当前阶段' },
  { value: 'source', label: '来源' },
  { value: 'note', label: '备注' },
  { value: 'gender', label: '性别' },
  { value: 'age', label: '年龄' },
  { value: 'education', label: '学历' },
  { value: 'workYears', label: '工作年限' },
];

const mapping = ref({});
const presetName = ref('');

// 初始化映射（自动匹配列名）
function initMapping() {
  const m = {};
  for (const col of columns.value) {
    const lower = col.toLowerCase().replace(/[\s\-_]/g, '');
    if (lower.includes('姓名') || lower === 'name' || lower === '姓名') m[col] = 'name';
    else if (lower.includes('手机') || lower.includes('电话') || lower === 'phone' || lower.includes('mobile')) m[col] = 'phone';
    else if (lower.includes('邮箱') || lower === 'email' || lower.includes('mail')) m[col] = 'email';
    else if (lower.includes('岗位') || lower.includes('职位') || lower.includes('应聘')) m[col] = 'expectedPosition';
    else if (lower.includes('阶段') || lower.includes('状态')) m[col] = 'currentStage';
    else if (lower.includes('来源') || lower.includes('渠道')) m[col] = 'source';
    else if (lower.includes('备注') || lower.includes('说明')) m[col] = 'note';
    else if (lower.includes('性别')) m[col] = 'gender';
    else if (lower.includes('年龄')) m[col] = 'age';
    else if (lower.includes('学历')) m[col] = 'education';
    else if (lower.includes('年限') || lower.includes('经验')) m[col] = 'workYears';
  }
  mapping.value = m;
}

// 预置模板
function applyPreset(key) {
  const preset = COLUMN_MAPPING_PRESETS[key];
  if (!preset) return;

  const m = {};
  for (const col of columns.value) {
    const lower = col.toLowerCase().replace(/[\s\-_]/g, '');
    // 用预设的列名反向匹配
    for (const [field, presetCol] of Object.entries(preset)) {
      const presetLower = presetCol.toLowerCase().replace(/[\s\-_]/g, '');
      if (lower.includes(presetLower) || presetLower.includes(lower)) {
        m[col] = field;
        break;
      }
    }
  }
  mapping.value = m;
  presetName.value = key;
}

// 映射预览
const mappedPreview = computed(() => {
  if (!fileData.value) return [];
  return fileData.value.slice(0, 5).map(row => {
    const out = {};
    for (const [col, field] of Object.entries(mapping.value)) {
      if (field) out[field] = row[col] || '';
    }
    return out;
  });
});

function goToStep3() {
  const hasName = Object.values(mapping.value).includes('name');
  const hasPhone = Object.values(mapping.value).includes('phone');
  if (!hasName || !hasPhone) {
    alert('请至少映射"姓名"和"手机号"字段');
    return;
  }
  step.value = 3;
  maxStep.value = 3;
}

// ===== 步骤 3：去重策略 =====
const dedupStrategy = ref('skip'); // 'skip' | 'override' | 'all'
const dedupPreview = ref(null);
const dedupLoading = ref(false);

async function checkDuplicates() {
  if (!db) {
    alert('数据库未连接');
    dedupPreview.value = { conflicts: 0, skip: 0, override: 0 };
    return;
  }

  dedupLoading.value = true;
  const mapped = mappedPreview.value;
  let conflicts = 0;

  // 对每条映射数据检查手机号重复
  for (const row of mapped) {
    if (!row.phone) continue;
    try {
      const { data: existing } = await db.collection('Candidate')
        .where({ phone: row.phone })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }));
      if (existing?.length > 0) conflicts++;
    } catch (e) { /* 忽略单条错误 */ }
  }

  dedupPreview.value = {
    total: fileData.value?.length || 0,
    conflicts,
    skip: dedupStrategy.value === 'skip' ? conflicts : 0,
    override: dedupStrategy.value === 'override' ? conflicts : 0,
  };
  dedupLoading.value = false;
}

function goToStep4() {
  step.value = 4;
  maxStep.value = 4;
}

// ===== 步骤 4：执行导入 =====
const importing = ref(false);
const importProgress = ref({ done: 0, total: 0 });
const importResult = ref(null);

async function startImport() {
  if (!db) {
    alert('数据库未连接');
    return;
  }

  importing.value = true;
  const mapped = mappedPreview.value; // 全量
  let success = 0;
  let skipped = 0;
  let failed = 0;

  // 实际导入全量数据
  const allRows = [];
  for (const row of fileData.value) {
    const out = {};
    for (const [col, field] of Object.entries(mapping.value)) {
      if (field) out[field] = row[col] || '';
    }
    allRows.push(out);
  }

  importProgress.value = { done: 0, total: allRows.length };

  for (const row of allRows) {
    try {
      // 检查重复
      // 简单去重：按手机号检查
      const { data: existing } = await db.collection('Candidate')
        .where({ phone: row.phone || '' })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }));
      const isDup = existing?.length > 0;
      const existingId = isDup ? existing[0]._id : null;

      if (isDup && dedupStrategy.value === 'skip') {
        skipped++;
        continue;
      }

      if (isDup && dedupStrategy.value === 'override') {
        // 更新已有候选人
        if (existingId) {
          await db.collection('Candidate').doc(existingId).update({
            name: row.name,
            phone: row.phone,
            email: row.email,
            updatedAt: new Date(),
          });
          success++;
          continue;
        }
      }

      // 新建 Candidate
      const candidateData = {
        name: row.name || '',
        phone: row.phone || '',
        email: row.email || '',
        gender: row.gender || '',
        age: row.age ? Number(row.age) : null,
        education: row.education || '',
        workYears: row.workYears ? Number(row.workYears) : null,
        source: row.source || 'import',
        note: row.note || '',
        _version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: auth.currentUser?.uid || 'system',
      };

      const candResult = await db.collection('Candidate').add(candidateData);

      // 创建 Application（如果映射了岗位和阶段）
      if (row.expectedPosition || row.currentStage) {
        await db.collection('Application').add({
          candidateId: candResult.id,
          stage: row.currentStage || 'resume',
          stageEnteredAt: new Date(),
          status: 'active',
          funnelMeta: { entrySource: row.source || 'import' },
          _version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ownerId: auth.currentUser?.uid || 'system',
        });
      }

      success++;
    } catch (err) {
      console.warn('[ImportPage] 导入行失败:', err.message);
      failed++;
    }

    importProgress.value.done++;
  }

  importResult.value = { success, skipped, failed, total: allRows.length };
  importing.value = false;

  // 审计日志
  try {
    await cloudbase.callFunction('write-audit-log', {
      action: 'history_import',
      entityType: 'Candidate',
      entityIds: [],
      detail: { success, skipped, failed, total: allRows.length },
      operator: auth.currentUser?.uid || 'system',
    });
  } catch (e) { /* 忽略 */ }
}
</script>

<template>
  <div class="import-page">
    <div class="page-header">
      <h2 class="page-title">历史数据导入</h2>
      <p class="page-desc">批量导入历史候选人数据（CSV 格式），支持列映射、去重策略</p>
    </div>

    <!-- 步骤指示器 -->
    <div class="steps-bar">
      <div class="step-item" :class="{ active: step === 1, done: maxStep > 1 }">
        <span class="step-num">1</span> 上传文件
      </div>
      <div class="step-line" :class="{ done: maxStep > 1 }"></div>
      <div class="step-item" :class="{ active: step === 2, done: maxStep > 2 }">
        <span class="step-num">2</span> 列映射
      </div>
      <div class="step-line" :class="{ done: maxStep > 2 }"></div>
      <div class="step-item" :class="{ active: step === 3, done: maxStep > 3 }">
        <span class="step-num">3</span> 去重策略
      </div>
      <div class="step-line" :class="{ done: maxStep > 3 }"></div>
      <div class="step-item" :class="{ active: step === 4, done: false }">
        <span class="step-num">4</span> 确认导入
      </div>
    </div>

    <!-- ===== 步骤 1：文件上传 ===== -->
    <div v-if="step === 1" class="card step-content upload-step">
      <div class="upload-zone" @click="$refs.fileInput?.click()">
        <input
          ref="fileInput"
          type="file"
          accept=".csv,.xlsx,.xls"
          class="file-input-hidden"
          @change="handleFileUpload"
        />
        <div class="upload-icon">📁</div>
        <p class="upload-text">点击或拖拽上传 CSV 文件</p>
        <p class="upload-hint">支持 UTF-8 / GBK 编码，最大 50MB</p>
      </div>
      <p v-if="fileError" class="error-text">{{ fileError }}</p>
    </div>

    <!-- ===== 步骤 2：列映射 ===== -->
    <div v-else-if="step === 2" class="card step-content">
      <h3 class="step-title">字段映射</h3>

      <!-- 预置模板 -->
      <div class="preset-bar">
        <span class="preset-label">快速映射：</span>
        <button
          v-for="(preset, key) in COLUMN_MAPPING_PRESETS"
          :key="key"
          class="preset-btn"
          :class="{ active: presetName === key }"
          @click="applyPreset(key)"
        >
          {{ preset._label }}
        </button>
        <button class="preset-btn" @click="initMapping">🔄 自动匹配</button>
      </div>

      <!-- 映射表 -->
      <div class="mapping-table">
        <div class="map-row map-header">
          <span>文件列名</span>
          <span>→</span>
          <span>系统字段</span>
          <span>示例数据</span>
        </div>
        <div v-for="col in columns" :key="col" class="map-row">
          <span class="map-col-name">{{ col }}</span>
          <span class="map-arrow">→</span>
          <select v-model="mapping[col]" class="map-select">
            <option v-for="f in FIELD_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
          <span class="map-sample">{{ previewRows[0]?.[col] || '' }}</span>
        </div>
      </div>

      <div class="step-actions">
        <button class="btn" @click="step = 1">← 上一步</button>
        <button class="btn btn-primary" @click="goToStep3">下一步：去重策略 →</button>
      </div>
    </div>

    <!-- ===== 步骤 3：去重策略 ===== -->
    <div v-else-if="step === 3" class="card step-content">
      <h3 class="step-title">去重策略</h3>
      <p class="step-desc">检测到与已有候选人手机号/邮箱重复时的处理方式</p>

      <div class="strategy-options">
        <label class="strategy-card" :class="{ selected: dedupStrategy === 'skip' }">
          <input type="radio" v-model="dedupStrategy" value="skip" />
          <div class="strategy-info">
            <strong>跳过重复</strong>
            <span>自动跳过重复候选人，只导入新数据</span>
          </div>
        </label>
        <label class="strategy-card" :class="{ selected: dedupStrategy === 'override' }">
          <input type="radio" v-model="dedupStrategy" value="override" />
          <div class="strategy-info">
            <strong>覆盖重复</strong>
            <span>用新数据更新已有候选人的姓名和联系方式</span>
          </div>
        </label>
        <label class="strategy-card" :class="{ selected: dedupStrategy === 'all' }">
          <input type="radio" v-model="dedupStrategy" value="all" />
          <div class="strategy-info">
            <strong>全部导入</strong>
            <span>不检测重复，全部作为新数据导入（可能产生重复记录）</span>
          </div>
        </label>
      </div>

      <button class="btn btn-sm" @click="checkDuplicates" :disabled="dedupLoading" style="margin-top: var(--spacing-md);">
        {{ dedupLoading ? '检测中…' : '🔍 检测重复' }}
      </button>

      <div v-if="dedupPreview" class="dedup-result" style="margin-top: var(--spacing-md);">
        <div class="dedup-stat">
          <span class="dedup-num">{{ dedupPreview.total }}</span> 总行数
        </div>
        <div class="dedup-stat warn">
          <span class="dedup-num">{{ dedupPreview.conflicts }}</span> 重复
        </div>
        <div class="dedup-stat success">
          <span class="dedup-num">{{ dedupStrategy === 'skip' ? dedupPreview.total - dedupPreview.conflicts : dedupPreview.total }}</span> 将导入
        </div>
      </div>

      <div class="step-actions">
        <button class="btn" @click="step = 2">← 上一步</button>
        <button class="btn btn-primary" @click="goToStep4">下一步：确认导入 →</button>
      </div>
    </div>

    <!-- ===== 步骤 4：确认导入 ===== -->
    <div v-else-if="step === 4" class="card step-content">
      <h3 class="step-title">确认导入</h3>

      <div v-if="!importing && !importResult" class="confirm-info">
        <p>即将导入 <strong>{{ fileData?.length || 0 }}</strong> 条候选人数据</p>
        <p>去重策略：<strong>{{ { skip: '跳过重复', override: '覆盖重复', all: '全部导入' }[dedupStrategy] }}</strong></p>
        <button class="btn btn-primary btn-lg" @click="startImport">🚀 开始导入</button>
      </div>

      <!-- 导入进度 -->
      <div v-if="importing" class="import-progress">
        <p>正在导入… {{ importProgress.done }}/{{ importProgress.total }}</p>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: (importProgress.done / importProgress.total * 100) + '%' }"></div>
        </div>
      </div>

      <!-- 导入结果 -->
      <div v-if="importResult" class="import-result">
        <h4>✅ 导入完成</h4>
        <div class="result-stats">
          <div class="result-stat success">
            <span class="result-num">{{ importResult.success }}</span> 成功
          </div>
          <div class="result-stat warn">
            <span class="result-num">{{ importResult.skipped }}</span> 跳过
          </div>
          <div class="result-stat danger">
            <span class="result-num">{{ importResult.failed }}</span> 失败
          </div>
        </div>
        <button class="btn" @click="step = 1; fileData = null; importResult = null; maxStep = 1">
          🔄 导入更多数据
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.import-page { max-width: 800px; }

.page-header { margin-bottom: var(--spacing-lg); }
.page-title { font-size: var(--font-size-2xl); font-weight: 700; color: var(--gray-800); }
.page-desc { font-size: var(--font-size-sm); color: var(--gray-400); margin-top: 2px; }

/* 步骤条 */
.steps-bar {
  display: flex; align-items: center; gap: 0;
  margin-bottom: var(--spacing-xl); padding: 0 var(--spacing-lg);
}
.step-item {
  display: flex; align-items: center; gap: var(--spacing-xs);
  font-size: var(--font-size-sm); color: var(--gray-400); white-space: nowrap;
}
.step-item.active { color: var(--primary); font-weight: 600; }
.step-item.done { color: var(--success); }
.step-num {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--gray-100); color: var(--gray-500);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--font-size-xs); font-weight: 600;
}
.step-item.active .step-num { background: var(--primary); color: #fff; }
.step-item.done .step-num { background: var(--success); color: #fff; }
.step-line { flex: 1; height: 2px; background: var(--gray-100); min-width: 24px; }
.step-line.done { background: var(--success); }

/* 步骤内容 */
.step-content { padding: var(--spacing-xl); }
.step-title { font-size: var(--font-size-lg); font-weight: 600; margin: 0 0 var(--spacing-xs); }
.step-desc { font-size: var(--font-size-sm); color: var(--gray-400); margin-bottom: var(--spacing-md); }
.step-actions { display: flex; justify-content: space-between; margin-top: var(--spacing-xl); }

/* 上传区 */
.upload-zone {
  border: 2px dashed var(--gray-200); border-radius: var(--radius-md);
  padding: var(--spacing-3xl); text-align: center; cursor: pointer;
  transition: border-color var(--transition);
}
.upload-zone:hover { border-color: var(--primary); }
.file-input-hidden { display: none; }
.upload-icon { font-size: 48px; margin-bottom: var(--spacing-sm); }
.upload-text { font-size: var(--font-size-md); color: var(--gray-600); margin: 0; }
.upload-hint { font-size: var(--font-size-xs); color: var(--gray-400); margin-top: 4px; }

/* 映射表 */
.preset-bar { display: flex; gap: var(--spacing-xs); align-items: center; margin-bottom: var(--spacing-md); flex-wrap: wrap; }
.preset-label { font-size: var(--font-size-sm); color: var(--gray-500); }
.preset-btn {
  padding: 4px 12px; border: 1px solid var(--gray-200); border-radius: var(--radius-full);
  background: #fff; font-size: var(--font-size-xs); cursor: pointer; color: var(--gray-600);
  font-family: inherit;
}
.preset-btn:hover, .preset-btn.active { border-color: var(--primary); color: var(--primary); }

.mapping-table { border: 1px solid var(--gray-100); border-radius: var(--radius-sm); overflow: hidden; }
.map-row { display: flex; align-items: center; gap: var(--spacing-sm); padding: 8px 12px; border-bottom: 1px solid var(--gray-50); font-size: var(--font-size-sm); }
.map-row:last-child { border-bottom: none; }
.map-header { background: var(--gray-50); font-weight: 600; color: var(--gray-500); }
.map-col-name { width: 160px; flex-shrink: 0; color: var(--gray-600); font-weight: 500; }
.map-arrow { color: var(--primary); flex-shrink: 0; }
.map-select { flex: 1; padding: 4px 8px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; }
.map-sample { width: 160px; flex-shrink: 0; color: var(--gray-400); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 去重策略 */
.strategy-options { display: flex; flex-direction: column; gap: var(--spacing-sm); }
.strategy-card {
  display: flex; align-items: flex-start; gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md); border: 2px solid var(--gray-100);
  border-radius: var(--radius-sm); cursor: pointer; transition: border-color var(--transition);
}
.strategy-card:hover { border-color: var(--primary-border); }
.strategy-card.selected { border-color: var(--primary); background: var(--primary-bg); }
.strategy-info { display: flex; flex-direction: column; gap: 2px; }
.strategy-info strong { font-size: var(--font-size-sm); color: var(--gray-700); }
.strategy-info span { font-size: var(--font-size-xs); color: var(--gray-400); }

.dedup-result { display: flex; gap: var(--spacing-lg); padding: var(--spacing-md); background: var(--gray-50); border-radius: var(--radius-sm); }
.dedup-stat { text-align: center; font-size: var(--font-size-sm); color: var(--gray-500); }
.dedup-num { display: block; font-size: var(--font-size-xl); font-weight: 700; }
.dedup-stat.warn .dedup-num { color: var(--warning); }
.dedup-stat.success .dedup-num { color: var(--success); }

/* 确认 + 结果 */
.confirm-info { text-align: center; padding: var(--spacing-xl); }
.btn-lg { padding: 12px 32px; font-size: var(--font-size-md); }

.import-progress { text-align: center; padding: var(--spacing-xl); }
.progress-bar { height: 8px; background: var(--gray-100); border-radius: 4px; margin-top: var(--spacing-sm); overflow: hidden; }
.progress-fill { height: 100%; background: var(--primary); border-radius: 4px; transition: width 0.3s; }

.import-result { text-align: center; padding: var(--spacing-xl); }
.result-stats { display: flex; justify-content: center; gap: var(--spacing-xl); margin: var(--spacing-lg) 0; }
.result-stat { text-align: center; font-size: var(--font-size-sm); }
.result-num { display: block; font-size: var(--font-size-2xl); font-weight: 700; }
.result-stat.success .result-num { color: var(--success); }
.result-stat.warn .result-num { color: var(--warning); }
.result-stat.danger .result-num { color: var(--danger); }

.error-text { color: var(--danger); font-size: var(--font-size-sm); margin-top: var(--spacing-sm); }
</style>
