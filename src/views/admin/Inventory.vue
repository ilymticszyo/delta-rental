<template>
  <el-card shadow="never">
    <div class="row-gap" style="margin-bottom:12px">
      <el-select v-model="status" placeholder="全部状态" clearable style="width:140px">
        <el-option v-for="(l, k) in ACCOUNT_STATUS_LABEL" :key="k" :label="l" :value="k" />
      </el-select>
      <el-select v-model="source" placeholder="全部来源" clearable style="width:120px">
        <el-option v-for="(l, k) in ACCOUNT_SOURCE_LABEL" :key="k" :label="l" :value="k" />
      </el-select>
      <el-input v-model="kw" placeholder="编号 / 号主" clearable style="width:200px" />
      <span class="muted">共 {{ rows.length }} 个；自收成本合计 ¥{{ rows.reduce((s, a) => s + (a.source === 'buyin' ? a.costAmount : 0), 0) }}，累计收入 ¥{{ rows.reduce((s, a) => s + a.cumulativeIncome, 0) }}</span>
      <div style="flex:1" />
      <el-tag v-if="!editable" type="info">客服：只读查看</el-tag>
      <template v-if="editable">
        <el-button :loading="tplLoading" @click="downloadTpl">下载模板</el-button>
        <el-button @click="importDlg = true">批量导入</el-button>
        <el-button type="primary" @click="openNew">新增账号</el-button>
      </template>
    </div>
    <el-table :data="rows" border size="small">
      <el-table-column prop="accountNo" label="编号" width="90" />
      <el-table-column label="状态" width="96"><template #default="{ row }"><el-tag size="small" :type="statusTagType[row.status]">{{ ACCOUNT_STATUS_LABEL[row.status as AccountStatus] }}</el-tag></template></el-table-column>
      <el-table-column label="来源" width="80"><template #default="{ row }"><el-tag size="small" :type="row.source === 'buyin' ? 'warning' : 'info'">{{ ACCOUNT_SOURCE_LABEL[row.source as AccountSource] }}</el-tag></template></el-table-column>
      <el-table-column label="号主" width="90"><template #default="{ row }">{{ row.ownerName ?? (row.source === 'buyin' ? '自有' : row.ownerContact) }}</template></el-table-column>
      <el-table-column label="成本" width="66"><template #default="{ row }">{{ row.source === 'buyin' ? row.costAmount : '—' }}</template></el-table-column>
      <el-table-column label="累计收入" width="76" prop="cumulativeIncome" />
      <el-table-column label="回本进度" width="130"><template #default="{ row }">
        <el-progress v-if="row.paybackPercent != null" :percentage="Math.min(100, row.paybackPercent)" :format="() => row.paybackPercent + '%'" :status="row.paybackPercent >= 100 ? 'success' : undefined" />
        <span v-else class="muted">—</span></template></el-table-column>
      <el-table-column prop="channel" label="渠道" width="76" />
      <el-table-column prop="coinAmount" label="纯币M" width="70" />
      <el-table-column prop="totalAssets" label="总资产M" width="76" />
      <el-table-column label="比例" width="60"><template #default="{ row }">1:{{ row.coinRatio }}</template></el-table-column>
      <el-table-column label="租金/号主可得" width="110"><template #default="{ row }">{{ row.quote.coinRent }} / {{ row.quote.ownerSettlement }}</template></el-table-column>
      <el-table-column label="总金额" width="72"><template #default="{ row }">{{ row.quote.totalAmount }}</template></el-table-column>
      <el-table-column label="规则" width="70"><template #default="{ row }">
        <el-tooltip v-if="rule && row.quote.ruleVersion < rule.version" :content="`报价按计价规则 v${row.quote.ruleVersion} 生成，当前为 v${rule.version}；编辑保存后才按新规则重算`" placement="top">
          <el-tag size="small" type="warning" class="rule-old">v{{ row.quote.ruleVersion }}</el-tag></el-tooltip>
        <span v-else class="muted">v{{ row.quote.ruleVersion }}</span></template></el-table-column>
      <el-table-column label="皮肤" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ row.skins.join('、') || '—' }}</template></el-table-column>
      <el-table-column label="截图" width="56"><template #default="{ row }"><el-button v-if="row.attachments.length" link type="primary" @click="shots = row.attachments; shotDlg = true">{{ row.attachments.length }} 张</el-button><span v-else class="muted">—</span></template></el-table-column>
      <el-table-column label="操作" width="230" fixed="right"><template #default="{ row }">
        <el-button link type="primary" @click="openEdit(row)">{{ editable ? '编辑' : '查看' }}</el-button>
        <el-dropdown v-if="editable && transitions[row.status as AccountStatus].length" @command="(s: AccountStatus) => setStatus(row, s)" style="margin:0 10px">
          <el-button link type="warning">状态 ▾</el-button>
          <template #dropdown><el-dropdown-menu>
            <el-dropdown-item v-for="s in transitions[row.status as AccountStatus]" :key="s" :command="s">{{ actionLabel(row.status, s) }}</el-dropdown-item>
          </el-dropdown-menu></template>
        </el-dropdown>
        <el-button v-if="row.status === 'listed' && canOrder" link type="success" @click="$router.push(`/admin/orders?new=${row.id}`)">登记订单</el-button>
        <el-popconfirm v-if="editable && row.status !== 'rented' && row.status !== 'settling'" title="确认删除（逻辑删除）？" @confirm="del(row)">
          <template #reference><el-button link type="danger">删除</el-button></template></el-popconfirm>
      </template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dlg" :title="form.id ? `编辑账号 ${editingNo}` : '新增账号'" width="900px" top="4vh">
    <el-collapse v-if="!form.id && editable" style="margin-bottom:12px"><el-collapse-item title="粘贴前台算价信息（自动预填，人工确认后保存）">
      <el-input v-model="pasteText" type="textarea" :rows="5" placeholder="把前台「一键复制算价信息」的内容粘贴到这里" />
      <el-button size="small" style="margin-top:6px" @click="applyPaste">解析并预填</el-button>
    </el-collapse-item></el-collapse>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" size="small" :disabled="!editable">
      <el-row :gutter="8">
        <el-col :span="8"><el-form-item label="状态"><el-select v-model="form.status" :disabled="!!form.id">
          <el-option v-for="s in newStatuses" :key="s" :label="ACCOUNT_STATUS_LABEL[s]" :value="s" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="来源"><el-radio-group v-model="form.source"><el-radio value="consign">号主寄租</el-radio><el-radio value="buyin">自收</el-radio></el-radio-group></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="号主联系" prop="ownerContact"><el-input v-model="form.ownerContact" :disabled="form.source === 'buyin'" /></el-form-item></el-col>
        <el-col v-if="form.source === 'buyin'" :span="8"><el-form-item label="成本(元)"><el-input-number v-model="form.costAmount" :min="0" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="大区" prop="region"><el-select v-model="form.region"><el-option v-for="o in dicts.regions" :key="o" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="登录方式" prop="loginMethod"><el-select v-model="form.loginMethod"><el-option v-for="o in dicts.loginMethods" :key="o" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="上架渠道" prop="channel"><el-select v-model="form.channel"><el-option v-for="o in channels" :key="o" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="辅助时段"><el-input v-model="form.assistTime" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="纯币(M)" prop="coinAmount"><el-input-number v-model="form.coinAmount" :min="0" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="总资产(M)"><el-input-number v-model="form.totalAssets" :min="0" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="比例 1:" prop="coinRatio"><el-input-number v-model="form.coinRatio" :min="1" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="等级"><el-input-number v-model="form.level" :min="0" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="段位"><el-select v-model="form.rank"><el-option v-for="o in dicts.ranks" :key="o" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="绝密KD"><el-input-number v-model="form.secretKd" :min="0" :step="0.1" :precision="2" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="保险格数"><el-select v-model="form.safeBox"><el-option v-for="o in dicts.safeBoxes" :key="o" :label="o + ' 格'" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="体力"><el-select v-model="form.stamina"><el-option v-for="o in dicts.stamina" :key="o" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="负重"><el-select v-model="form.load"><el-option v-for="o in dicts.loads" :key="o" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="AWM"><el-input-number v-model="form.awmCount" :min="0" style="width:100px" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="6头"><el-input-number v-model="form.helmet6Count" :min="0" style="width:100px" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="6甲"><el-input-number v-model="form.armor6Count" :min="0" style="width:100px" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="体验卡"><el-input-number v-model="form.experienceCardCount" :min="0" style="width:100px" /></el-form-item></el-col>
        <el-col :span="24"><el-form-item label="皮肤"><el-select v-model="form.skins" multiple filterable style="width:100%"><el-option v-for="s in dicts.skins" :key="s.name" :label="`${s.name}（${s.category}）`" :value="s.name" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="周期" prop="cycle"><el-select v-model="form.cycle"><el-option v-for="o in cycles" :key="o" :value="o" /></el-select></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="押金(元)"><el-input-number v-model="form.deposit" :min="0" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="封禁记录"><el-switch v-model="form.banRecord" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="折扣"><el-radio-group v-model="form.discountMode"><el-radio value="system">系统推荐</el-radio><el-radio value="custom">自定义</el-radio></el-radio-group>
          <el-input-number v-if="form.discountMode === 'custom'" v-model="form.customDiscountPercent" :min="80" :max="100" style="width:100px;margin-left:8px" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="对外备注"><el-input v-model="form.remark" placeholder="大厅和详情可见，可被搜索" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="内部备注"><el-input v-model="form.internalRemark" placeholder="仅客服、运营、管理员可见" /></el-form-item></el-col>
      </el-row>
    </el-form>
    <div style="margin-top:8px" class="acc-shots">
      <div class="muted" style="margin-bottom:4px">资产截图（最多 5 张，单张 ≤1MB；导入的账号在这里补传）</div>
      <el-upload action="#" list-type="picture-card" :auto-upload="false" accept="image/png,image/jpeg,image/webp" :limit="5" v-model:file-list="shotFiles"
        :disabled="!editable" :on-exceed="() => ElMessage.warning('最多 5 张')" :on-preview="(f: any) => { shots = [f.att ?? { id: '', name: f.name, dataUrl: f.url, uploadedBy: '', at: '' }]; shotDlg = true }">
        <el-icon v-if="editable"><Plus /></el-icon>
      </el-upload>
    </div>
    <template #footer><el-button @click="dlg = false">{{ editable ? '取消' : '关闭' }}</el-button><span v-if="editable && editingNo && rule && editingRuleVersion != null && editingRuleVersion < rule.version" class="muted" style="margin-right:8px">当前报价按 v{{ editingRuleVersion }}，保存后按 v{{ rule.version }} 重算</span><el-button v-if="editable" type="primary" @click="save">保存（按当前规则 v{{ rule?.version }} 生成报价）</el-button></template>
  </el-dialog>
  <ImportDialog v-if="editable" v-model="importDlg" @imported="onImported" />
  <el-dialog v-model="shotDlg" title="资产截图" width="720px">
    <AttachmentGallery :attachments="shots" :width="200" :height="150" @expired="reloadShots" />
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { FormInstance } from 'element-plus'
import { ElMessage } from 'element-plus'
import { api } from '../../api'
import type { PricingRule } from '../../config/rules'
import { dicts } from '../../config/dictStore'
import { parsePricingText } from '../../domain/parsePricingText'
import { ACCOUNT_SOURCE_LABEL, ACCOUNT_STATUS_LABEL, type AccountAdminView as Account, type AccountInput, type AccountSource, type AccountStatus } from '../../domain/types'
import { can } from '../../domain/permissions'
import { fmtTime, run, statusTagType } from '../../utils'
import type { UploadUserFile } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import type { Attachment, NewAttachment } from '../../domain/types'
import ImportDialog from './ImportDialog.vue'
import AttachmentGallery from '../../components/AttachmentGallery.vue'
import { freshAttachments } from '../../api/attachments'
const editingRuleVersion = ref<number | null>(null)
/** 截图地址过期且无法单独续签时：重新拉库存列表（会带新签名），再刷新弹窗里的截图 */
async function reloadShots() {
  const ids = new Set(shots.value.map((x) => x.id))
  await load()
  const a = list.value.find((x) => x.attachments.some((y) => ids.has(y.id)))
  if (a) shots.value = a.attachments
}

const route = useRoute()
const list = ref<Account[]>([])
const status = ref<string>((route.query.status as string) || '')
const kw = ref((route.query.kw as string) || '')
const rows = computed(() => list.value.filter((a) => (!status.value || a.status === status.value) && (!source.value || a.source === source.value) &&
  (!kw.value || a.accountNo.toLowerCase().includes(kw.value.toLowerCase()) || a.ownerContact.includes(kw.value) || (a.ownerName ?? '').includes(kw.value))))
const user = api.currentUser()
const editable = can(user?.role, 'inventoryEdit')
const canOrder = can(user?.role, 'orders')
const source = ref<string>((route.query.source as string) || '')
const shotDlg = ref(false)
const shots = ref<Attachment[]>([])
const transitions: Record<AccountStatus, AccountStatus[]> = { draft: ['listed', 'off'], listed: ['off'], off: ['listed'], held: ['listed', 'off'], rented: [], settling: [] }
const actionLabel = (from: AccountStatus, to: AccountStatus) => to === 'listed' ? (from === 'off' ? '重新上架' : from === 'draft' ? '人工确认上架' : '入库后上架') : from === 'draft' ? '作废' : '下架'
const newStatuses: AccountStatus[] = ['draft', 'listed', 'off', 'held']
const rule = ref<PricingRule>()
const channels = computed(() => Object.keys(rule.value?.channelFeeRates ?? {}))
const cycles = computed(() => Object.keys(rule.value?.cycleValues ?? {}))

const blank = (): AccountInput => ({ status: 'draft', source: 'consign', costAmount: 0, ownerContact: '', region: 'QQ区', loginMethod: '扫码', channel: '普通区', assistTime: '全天',
  banRecord: false, totalAssets: 0, coinAmount: 0, secretKd: 1, level: 1, rank: '青铜', safeBox: 4, stamina: '1级', load: '1级', awmCount: 0, helmet6Count: 0,
  armor6Count: 0, experienceCardCount: 0, skins: [], cycle: '10M/天', coinRatio: 20, discountMode: 'system', customDiscountPercent: 95, deposit: 0, remark: '', internalRemark: '' })
const form = reactive<AccountInput>(blank())
const editingNo = ref('')
const dlg = ref(false)
const pasteText = ref('')
const formRef = ref<FormInstance>()
const req = (m: string) => [{ required: true, message: m, trigger: 'change' }]
const rules = { ownerContact: [{ validator: (_: any, v: string, cb: any) => (form.source === 'buyin' || v?.trim() ? cb() : cb(new Error('请填写号主联系方式'))), trigger: 'change' }], region: req('必填'), loginMethod: req('必填'), channel: req('必填'), cycle: req('必填'), coinRatio: req('必填'),
  coinAmount: [{ validator: (_: any, v: number, cb: any) => (v > 0 ? cb() : cb(new Error('纯币需大于 0'))), trigger: 'change' }] }

const shotFiles = ref<(UploadUserFile & { att?: Attachment })[]>([])
const toDataUrl = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(f) })
async function collectShots(): Promise<(Attachment | NewAttachment)[]> {
  const out: (Attachment | NewAttachment)[] = []
  for (const f of shotFiles.value) {
    if (f.att) { out.push(f.att); continue }
    if (!f.raw) continue
    if (f.raw.size > 1024 * 1024) throw new Error(`「${f.name}」超过 1MB`)
    out.push({ name: f.name, dataUrl: await toDataUrl(f.raw) })
  }
  return out
}
function openNew() { Object.keys(form).forEach((k) => delete (form as any)[k]); Object.assign(form, blank()); pasteText.value = ''; shotFiles.value = []; dlg.value = true }
async function openEdit(a: Account) {
  Object.keys(form).forEach((k) => delete (form as any)[k])
  const { accountNo, quote, createdAt, updatedAt, deleted, cumulativeIncome, paybackPercent, ownerName, ...rest } = JSON.parse(JSON.stringify(a))
  Object.assign(form, rest)
  editingRuleVersion.value = a.quote.ruleVersion
  shotFiles.value = (await freshAttachments(a.attachments)).map((x) => ({ name: x.name, url: x.dataUrl, uid: Date.now() + Math.random(), status: 'success', att: x }))
  editingNo.value = accountNo
  dlg.value = true
}
function applyPaste() {
  const p = parsePricingText(pasteText.value)
  if (!Object.keys(p).length) return ElMessage.warning('未识别到算价信息')
  Object.assign(form, p, { source: 'consign' })
  ElMessage.success(`已预填 ${Object.keys(p).length} 项，请核对后保存`)
}
async function save() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  let attachments: (Attachment | NewAttachment)[]
  try { attachments = await collectShots() } catch (e: any) { return ElMessage.error(e.message) }
  const input = { ...JSON.parse(JSON.stringify(form)), attachments }
  if (input.discountMode !== 'custom') delete input.customDiscountPercent
  if (input.source === 'buyin') { input.ownerContact = input.ownerContact || '自有'; delete input.ownerId } else input.costAmount = 0
  const r = await run(() => api.saveAccount(input), '已保存')
  if (r) { dlg.value = false; await load() }
}
async function setStatus(a: Account, s: AccountStatus) { if (await run(() => api.setAccountStatus(a.id, s), '状态已更新')) await load() }
async function del(a: Account) { await run(() => api.deleteAccount(a.id), '已删除'); await load() }
async function load() { list.value = await api.listAccounts() }
const importDlg = ref(false)
const tplLoading = ref(false)
async function downloadTpl() {
  tplLoading.value = true
  try { const { downloadTemplate } = await import('../../domain/importXlsx'); await downloadTemplate(await api.importContext()) }
  catch (e: any) { ElMessage.error(e?.message ?? String(e)) } finally { tplLoading.value = false }
}
async function onImported() { status.value = 'draft'; source.value = ''; kw.value = ''; await load() }
onMounted(async () => { rule.value = await api.getPricingRule(); await load() })
</script>
