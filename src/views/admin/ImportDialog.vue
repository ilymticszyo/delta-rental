<template>
  <el-dialog :model-value="modelValue" @update:model-value="close" title="批量导入账号（Excel / CSV）" width="980px" top="4vh" class="import-dialog">
    <el-steps :active="step" finish-status="success" simple style="margin-bottom:14px">
      <el-step title="下载模板并填写" /><el-step title="上传并逐行校验" /><el-step title="确认导入" />
    </el-steps>
    <el-alert type="info" :closable="false" style="margin-bottom:12px"
      title="导入的账号统一为「待确认」，运营在库存里「人工确认上架」后才会出现在大厅；资产截图不随表格导入，请导入后进入账号编辑页单独上传。" />
    <div class="row-gap" style="margin-bottom:12px">
      <el-button :loading="tplLoading" @click="downloadTpl">下载模板（.xlsx）</el-button>
      <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx,.csv" :on-change="onFile" class="import-upload">
        <el-button type="primary" :loading="parsing">选择文件（.xlsx / .csv）</el-button>
      </el-upload>
      <span v-if="fileName" class="muted">{{ fileName }}</span>
    </div>
    <el-alert v-for="e in headerErrors" :key="e" type="error" :closable="false" :title="e" style="margin-bottom:6px" class="import-header-error" />
    <template v-if="result && !headerErrors.length">
      <div class="row-gap import-summary" style="margin-bottom:8px">
        <el-tag type="success">合法 {{ result.valid }} 行</el-tag>
        <el-tag type="danger">有误 {{ result.invalid }} 行（将跳过）</el-tag>
        <el-radio-group v-model="view" size="small"><el-radio-button value="all">全部</el-radio-button><el-radio-button value="bad">只看有误</el-radio-button></el-radio-group>
      </div>
      <el-table :data="shown" border size="small" max-height="380" :row-class-name="({ row }: any) => row.errors.length ? 'import-row-bad' : ''">
        <el-table-column label="行号" width="64" prop="rowNo" />
        <el-table-column label="账号编号" width="110"><template #default="{ row }">{{ row.accountNo || '（空）' }}</template></el-table-column>
        <el-table-column label="结果" width="80"><template #default="{ row }"><el-tag size="small" :type="row.errors.length ? 'danger' : 'success'">{{ row.errors.length ? '跳过' : '可导入' }}</el-tag></template></el-table-column>
        <el-table-column label="原因 / 摘要" min-width="500"><template #default="{ row }">
          <div v-if="row.errors.length" class="import-errors"><div v-for="(e, i) in row.errors" :key="i">第 {{ row.rowNo }} 行：{{ e }}</div></div>
          <span v-else class="muted">{{ row.input.source === 'buyin' ? '自收' : '号主寄租 ' + row.input.ownerContact }} · {{ row.input.region }} · {{ row.input.rank }} · {{ row.input.safeBox }} 格 · 纯币 {{ row.input.coinAmount }}M · 1:{{ row.input.coinRatio }}</span>
        </template></el-table-column>
      </el-table>
    </template>
    <el-result v-if="outcome" icon="success" :title="`已导入 ${outcome.imported.length} 个账号（待确认）`" :sub-title="outcome.skipped.length ? `跳过 ${outcome.skipped.length} 行：第 ${outcome.skipped.map((x) => x.rowNo).join('、')} 行` : '无跳过行'" class="import-outcome" />
    <template #footer>
      <el-button @click="close(false)">{{ outcome ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!outcome" type="primary" :disabled="!result || !!headerErrors.length || !result.valid" :loading="importing" @click="confirm">
        确认导入 {{ result?.valid ?? 0 }} 行{{ result?.invalid ? `（跳过 ${result.invalid} 行）` : '' }}
      </el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UploadFile } from 'element-plus'
import { ElMessage } from 'element-plus'
import { api } from '../../api'
import type { ImportOutcome } from '../../api/types'
import { IMPORT_MAX_ROWS, parseImport, type ImportParseResult } from '../../domain/importAccounts'
import { createSubmitKey } from '../../api/idempotency'
import { run } from '../../utils'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'imported', nos: string[]): void }>()
const tplLoading = ref(false), parsing = ref(false), importing = ref(false)
const fileName = ref(''), aoa = ref<unknown[][]>([]), result = ref<ImportParseResult>(), outcome = ref<ImportOutcome>()
const headerErrors = ref<string[]>([]), view = ref<'all' | 'bad'>('all')
const step = computed(() => (outcome.value ? 3 : result.value && !headerErrors.value.length ? 2 : 1))
const shown = computed(() => (result.value?.rows ?? []).filter((r) => view.value === 'all' || r.errors.length))

// 同一份文件的“确认导入”共用一个 Idempotency-Key：超时 / 断网后再点不会重复入库
const submitKey = createSubmitKey()
function reset() { submitKey.reset(); fileName.value = ''; aoa.value = []; result.value = undefined; outcome.value = undefined; headerErrors.value = []; view.value = 'all' }
function close(v: boolean) { if (!v) { emit('update:modelValue', false); reset() } }
async function downloadTpl() {
  tplLoading.value = true
  try { const { downloadTemplate } = await import('../../domain/importXlsx'); await downloadTemplate(await api.importContext()) }
  catch (e: any) { ElMessage.error(e?.message ?? String(e)) } finally { tplLoading.value = false }
}
async function onFile(f: UploadFile) {
  if (!f.raw) return
  outcome.value = undefined; result.value = undefined; headerErrors.value = []
  fileName.value = f.name
  if (f.raw.size > 5 * 1024 * 1024) { headerErrors.value = ['文件超过 5MB'] ; return }
  parsing.value = true
  try {
    const { readSheet } = await import('../../domain/importXlsx')
    aoa.value = await readSheet(f.name, await f.raw.arrayBuffer())
    if (aoa.value.length - 1 > IMPORT_MAX_ROWS) { headerErrors.value = [`单次最多导入 ${IMPORT_MAX_ROWS} 行，当前 ${aoa.value.length - 1} 行`]; return }
    result.value = parseImport(aoa.value, await api.importContext())
    headerErrors.value = result.value.headerErrors
  } catch (e: any) { headerErrors.value = [`文件读取失败：${e?.message ?? e}`] } finally { parsing.value = false }
}
async function confirm() {
  importing.value = true
  const body = { fileName: fileName.value, rows: aoa.value }
  const r = await run(() => submitKey.submit(body, (idempotencyKey) => api.importAccounts(body.rows, body.fileName, { idempotencyKey })))
  importing.value = false
  if (r) { outcome.value = r; ElMessage.success(`已导入 ${r.imported.length} 个账号，状态为待确认`); emit('imported', r.imported) }
}
</script>
<style>
.import-row-bad td { background: #fef0f0 !important; }
.import-errors { color: #f56c6c; line-height: 1.6; }
.import-upload { display: inline-block; }
</style>
