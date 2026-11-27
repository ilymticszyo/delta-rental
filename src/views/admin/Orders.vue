<template>
  <el-card shadow="never">
    <div class="row-gap" style="margin-bottom:12px">
      <el-select v-model="status" placeholder="全部状态" clearable style="width:160px">
        <el-option label="即将到期 / 超期" value="expiring" />
        <el-option v-for="(l, k) in ORDER_STATUS_LABEL" :key="k" :label="l" :value="k" />
      </el-select>
      <el-input v-model="kw" placeholder="订单号 / 账号编号 / 租客" clearable style="width:240px" />
      <el-alert v-if="expiringCount" type="warning" :closable="false" show-icon style="width:auto;padding:4px 10px" :title="`${expiringCount} 笔订单即将到期或已超期`" />
      <div style="flex:1" />
      <el-button type="primary" @click="openNew()">登记出租订单</el-button>
    </div>
    <el-table :data="rows" border size="small" :row-class-name="({ row }: any) => (row.reminder ? 'remind-row' : '')">
      <el-table-column prop="orderNo" label="订单号" width="86" />
      <el-table-column prop="accountNo" label="账号" width="86" />
      <el-table-column label="租客" width="140"><template #default="{ row }">{{ row.renterContact }} <el-tag v-if="row.regularApplied" size="small" type="success">熟客</el-tag></template></el-table-column>
      <el-table-column label="租期" width="210"><template #default="{ row }">{{ fmtTime(row.startAt) }} 起 {{ row.rentalDays }} 天<br />
        <span :style="{ color: row.reminder ? '#dc2626' : '#888', fontSize: '12px' }">至 {{ fmtTime(row.endAt) }}
          <el-tag v-if="row.reminder" size="small" :type="row.reminder === 'overdue' ? 'danger' : 'warning'">{{ row.reminder === 'overdue' ? '已超期' : '即将到期' }}</el-tag></span></template></el-table-column>
      <el-table-column prop="coinRent" label="租金" width="64" />
      <el-table-column prop="deposit" label="押金" width="60" />
      <el-table-column label="押金余额" width="72"><template #default="{ row }">{{ depositBalance(row) }}</template></el-table-column>
      <el-table-column label="号主应付 / 未付" width="104"><template #default="{ row }">{{ row.ownerPayable }} / <b :style="{ color: row.ownerPayableBalance ? '#b45309' : '' }">{{ row.ownerPayableBalance }}</b></template></el-table-column>
      <el-table-column prop="totalAmount" label="总金额" width="66" />
      <el-table-column label="交号 / 还号" width="84"><template #default="{ row }">{{ row.handedOver ? '✓' : '—' }} / {{ row.returned ? '✓' : '—' }}</template></el-table-column>
      <el-table-column label="状态" width="76"><template #default="{ row }"><el-tag size="small" :type="statusTagType[row.status]">{{ ORDER_STATUS_LABEL[row.status as OrderStatus] }}</el-tag></template></el-table-column>
      <el-table-column prop="remark" label="备注" min-width="90" show-overflow-tooltip />
      <el-table-column label="操作" width="80" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="open(row)">详情 / 处理</el-button></template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dlgNew" title="登记出租订单" width="600px">
    <el-form label-width="100px">
      <el-form-item label="账号" required>
        <el-select v-model="nf.accountId" filterable placeholder="选择空闲可租账号" style="width:100%" @change="refreshPreview">
          <el-option v-for="a in listed" :key="a.id" :label="`${a.accountNo} · ${a.coinAmount}M · 租金 ${a.quote.coinRent} 元`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="租客联系方式" required><el-input v-model="nf.renterContact" placeholder="微信号，如 wx_vip_laoliu / wx_black_ahu" @input="debouncedPreview" @blur="refreshPreview" /></el-form-item>
      <el-form-item v-if="pv?.profile" label="租客档案">
        <el-alert :type="pv.blocked ? 'error' : pv.profile.tag === 'caution' ? 'warning' : pv.profile.tag === 'regular' ? 'success' : 'info'" :closable="false" show-icon
          :title="`${pv.profile.tag ? '【' + RENTER_TAG_LABEL[pv.profile.tag] + '】' : ''}${pv.profile.displayName || pv.profile.contact} · 租过 ${pv.profile.rentalCount} 次 · 消费 ¥${pv.profile.totalSpend} · 扣过押金 ${pv.profile.depositDeductCount} 次`"
          :description="pv.blocked ? `黑名单，禁止登记。${pv.profile.note}` : pv.profile.tag === 'regular' ? `熟客：${pv.regularApplied ? '已自动带入熟客折扣' : '系统档已更优惠'}${pv.depositWaived ? '，免押金' : ''}。${pv.profile.note}` : pv.profile.note" />
      </el-form-item>
      <el-form-item v-else-if="pv && nf.renterContact.trim()" label="租客档案"><span class="muted">新租客，无档案</span></el-form-item>
      <el-form-item label="开始时间"><el-date-picker v-model="nf.startAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" /></el-form-item>
      <el-form-item label="租期(天)"><el-input-number v-model="nf.rentalDays" :min="1" /></el-form-item>
      <el-form-item label="押金(元)"><el-input-number v-model="nf.deposit" :min="0" :disabled="pv?.depositWaived" /><span class="muted" style="margin-left:8px">{{ pv?.depositWaived ? '熟客免押金' : '可为 0' }}</span></el-form-item>
      <el-form-item label="附加服务费"><el-input-number v-model="nf.extraFee" :min="0" /><span class="muted" style="margin-left:8px">默认 0</span></el-form-item>
      <el-form-item label="备注"><el-input v-model="nf.remark" /></el-form-item>
      <el-form-item label="应收合计"><span class="money">¥{{ (pv?.coinRent ?? 0) + nf.extraFee + (pv?.depositWaived ? 0 : nf.deposit) }}</span>
        <span class="muted" style="margin-left:8px">租金 {{ pv?.coinRent ?? '-' }}{{ pv?.regularApplied ? '（熟客价）' : '' }} · 号主应付 {{ pv?.ownerPayable ?? '-' }}</span></el-form-item>
      <el-form-item v-if="pv && pv.ruleVersion != null" label="计价规则"><span class="muted">v{{ pv.ruleVersion }}<template v-if="curRuleVersion && pv.ruleVersion < curRuleVersion">（按账号上架时的规则计价；当前规则 v{{ curRuleVersion }}）</template></span></el-form-item>
    </el-form>
    <template #footer><el-button @click="dlgNew = false">取消</el-button><el-button type="primary" :disabled="pv?.blocked" :loading="creating" @click="create">登记并锁定账号</el-button></template>
  </el-dialog>

  <el-drawer v-model="drawer" :title="`订单 ${cur?.orderNo}`" size="640px">
    <template v-if="cur">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="状态"><el-tag size="small" :type="statusTagType[cur.status]">{{ ORDER_STATUS_LABEL[cur.status] }}</el-tag>
          <el-tag v-if="cur.reminder" size="small" type="danger" style="margin-left:4px">{{ cur.reminder === 'overdue' ? '已超期' : '即将到期' }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="账号">{{ cur.accountNo }}</el-descriptions-item>
        <el-descriptions-item label="租客">{{ cur.renterContact }}{{ cur.regularApplied ? '（熟客）' : '' }}</el-descriptions-item>
        <el-descriptions-item label="租期">{{ cur.rentalDays }} 天，至 {{ fmtTime(cur.endAt) }}</el-descriptions-item>
        <el-descriptions-item label="租金 / 附加费">{{ cur.coinRent }} / {{ cur.extraFee }}</el-descriptions-item>
        <el-descriptions-item label="总金额">{{ cur.totalAmount }}</el-descriptions-item>
        <el-descriptions-item label="押金余额">{{ depositBalance(cur) }}（收 {{ cur.deposit }}）</el-descriptions-item>
        <el-descriptions-item label="号主应付 / 未付">{{ cur.ownerPayable }} / {{ cur.ownerPayableBalance }}</el-descriptions-item>
        <el-descriptions-item label="计价规则">{{ cur.ruleVersion != null ? `v${cur.ruleVersion}` : '—' }}</el-descriptions-item>
        <el-descriptions-item label="登记">{{ cur.createdBy }} · {{ fmtTime(cur.createdAt) }}</el-descriptions-item>
      </el-descriptions>

      <div class="row-gap" style="margin:12px 0">
        <template v-if="cur.status === 'active'">
          <el-button v-if="!cur.handedOver" size="small" @click="act(() => api.markHandover(cur!.id), '已登记交号')">登记交号</el-button>
          <el-input-number v-model="extendDays" :min="1" size="small" style="width:100px" /><el-button size="small" @click="act(() => api.extendOrder(cur!.id, extendDays), '租期已修改')">改租期</el-button>
          <el-popconfirm title="确认到期 / 提前结束？账号将进入待结算" @confirm="act(() => api.endOrder(cur!.id), '已转待结算')"><template #reference><el-button size="small" type="warning">到期结束</el-button></template></el-popconfirm>
          <el-popconfirm v-if="!cur.handedOver" title="未交号前取消？账号恢复空闲，号主应付冲销" @confirm="act(() => api.cancelOrder(cur!.id), '已取消')"><template #reference><el-button size="small" type="danger">取消</el-button></template></el-popconfirm>
        </template>
        <template v-if="cur.status === 'settling'">
          <el-button v-if="!cur.returned" size="small" @click="act(() => api.markReturned(cur!.id), '已登记还号')">登记还号</el-button>
          <el-button size="small" type="success" @click="dlgDone = true">完成结算</el-button>
        </template>
      </div>

      <h4>押金台账（余额 = 收取 − 扣除 − 退还）</h4>
      <el-table :data="cur.deposits" size="small" empty-text="未收押金">
        <el-table-column label="时间" width="130"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
        <el-table-column label="类型" width="60"><template #default="{ row }">{{ depLabel[row.type as 'collect'] }}</template></el-table-column>
        <el-table-column prop="amount" label="金额" width="60" />
        <el-table-column prop="reason" label="原因 / 凭证" />
        <el-table-column prop="operator" label="操作人" width="70" />
      </el-table>
      <div v-if="cur.status === 'active' || cur.status === 'settling'" class="row-gap" style="margin-top:8px">
        <el-select v-model="dep.type" size="small" style="width:90px"><el-option v-for="(l, k) in depLabel" :key="k" :label="l" :value="k" /></el-select>
        <el-input-number v-model="dep.amount" :min="1" size="small" />
        <el-input v-model="dep.reason" size="small" placeholder="原因，如 AWM 消耗 2 把" style="width:180px" />
        <el-button size="small" type="primary" @click="addDep">记一笔</el-button>
      </div>

      <h4>号主应付</h4>
      <el-table :data="payables" size="small" :empty-text="cur.ownerPayable ? '无' : '自收号，无号主应付'">
        <el-table-column label="时间" width="130"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
        <el-table-column label="类型" width="60"><template #default="{ row }">{{ payLabel[row.type as 'pay'] }}</template></el-table-column>
        <el-table-column prop="amount" label="金额" width="70" />
        <el-table-column prop="note" label="说明" />
      </el-table>
      <div v-if="cur.ownerPayableBalance > 0 && cur.status !== 'cancelled'" class="row-gap" style="margin-top:8px">
        <el-input-number v-model="pay.amount" :min="1" :max="cur.ownerPayableBalance" size="small" />
        <el-input v-model="pay.note" size="small" placeholder="如 微信转账" style="width:180px" />
        <el-button size="small" type="primary" :loading="paying" @click="payOwner">登记付号主款</el-button>
      </div>

      <h4>生命周期留痕</h4>
      <el-timeline>
        <el-timeline-item v-for="(e, i) in cur.events" :key="i" :timestamp="`${fmtTime(e.at)} · ${e.operator}`">
          <b>{{ ORDER_STEP_LABEL[e.step] }}</b> {{ e.note }}</el-timeline-item>
      </el-timeline>
    </template>
  </el-drawer>

  <el-dialog v-model="dlgDone" :title="`完成结算 · ${cur?.orderNo}`" width="480px">
    <template v-if="cur">
      <p>押金余额：<b>{{ depositBalance(cur) }}</b> 元；号主未付：<b>{{ cur.ownerPayableBalance }}</b> 元。不为 0 时需填写说明（如不退原因、号主月结）。</p>
      <el-form label-width="90px">
        <el-form-item label="账号去向"><el-radio-group v-model="relist"><el-radio :value="true">结算再上架</el-radio><el-radio :value="false">结算后下架</el-radio></el-radio-group></el-form-item>
        <el-form-item label="结算说明"><el-input v-model="doneNote" type="textarea" /></el-form-item>
      </el-form>
    </template>
    <template #footer><el-button @click="dlgDone = false">取消</el-button><el-button type="primary" @click="complete">确认完成</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, depositBalance, type OrderPreview, type OrderView } from '../../api'
import { ORDER_STATUS_LABEL, ORDER_STEP_LABEL, RENTER_TAG_LABEL, type AccountAdminView, type OrderStatus, type OwnerPayableEntry } from '../../domain/types'
import { fmtTime, run, statusTagType } from '../../utils'
import { createSubmitKey } from '../../api/idempotency'

const route = useRoute()
const list = ref<OrderView[]>([])
const listed = ref<AccountAdminView[]>([])
const status = ref((route.query.status as string) || '')
const kw = ref((route.query.kw as string) || '')
const expiringCount = computed(() => list.value.filter((o) => o.reminder).length)
const rows = computed(() => list.value.filter((o) => (!status.value || (status.value === 'expiring' ? !!o.reminder : o.status === status.value)) &&
  (!kw.value || [o.orderNo, o.accountNo, o.renterContact].some((x) => x.toLowerCase().includes(kw.value.toLowerCase())))))
const depLabel = { collect: '收取', deduct: '扣除', refund: '退还' }
const payLabel = { accrue: '应付', pay: '已付', reverse: '冲销' }

const dlgNew = ref(false)
const nf = reactive({ accountId: '', renterContact: '', startAt: '', rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
const pv = ref<OrderPreview | null>(null)
let timer: any
const debouncedPreview = () => { clearTimeout(timer); timer = setTimeout(refreshPreview, 300) }
async function refreshPreview() {
  if (!nf.accountId) { pv.value = null; return }
  const first = pv.value == null
  pv.value = await api.previewOrder(nf.accountId, nf.renterContact)
  const a = listed.value.find((x) => x.id === nf.accountId)
  if (first && a) { nf.rentalDays = pv.value.rentalDays; nf.deposit = a.deposit; nf.extraFee = pv.value.extraFee }
  if (pv.value.depositWaived) nf.deposit = 0
}
// 每张“登记订单”表单一个 Idempotency-Key：超时 / 断网后再点、或双击，都只登记一次
const createKey = createSubmitKey()
const creating = ref(false)
const curRuleVersion = ref<number | null>(null)
async function openNew(accountId = '') {
  createKey.reset()
  listed.value = (await api.listAccounts()).filter((a) => a.status === 'listed')
  api.pricingOptions().then((p) => { curRuleVersion.value = p.version }).catch(() => {})
  Object.assign(nf, { accountId, renterContact: '', startAt: new Date().toISOString(), rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
  pv.value = null
  await refreshPreview()
  dlgNew.value = true
}
async function create() {
  if (!nf.accountId) return ElMessage.warning('请选择账号')
  const input = { ...nf, startAt: new Date(nf.startAt || Date.now()).toISOString() }
  creating.value = true
  const r = await run(() => createKey.submit(input, (idempotencyKey) => api.createOrder(input, { idempotencyKey })), '登记成功，账号已锁定为租赁中')
  creating.value = false
  if (r) { dlgNew.value = false; await load() }
}

const drawer = ref(false)
const cur = ref<OrderView>()
const payables = ref<OwnerPayableEntry[]>([])
const extendDays = ref(1)
const dep = reactive({ type: 'deduct' as 'collect' | 'deduct' | 'refund', amount: 1, reason: '' })
const pay = reactive({ amount: 1, note: '' })
/** 详情抽屉：用 GET /orders/{id} 取最新数据（列表可能是旧的），号主应付流水按订单过滤 */
async function open(o: Pick<OrderView, 'id'>) {
  const [fresh, ps] = await Promise.all([api.getOrder(o.id), api.listPayables({ orderId: o.id })])
  const mine = ps.filter((p) => p.orderId === o.id) // orderId 过滤是提议参数，后端忽略时这里兜底
  if (cur.value?.id !== fresh.id) payKey.reset()
  cur.value = fresh
  extendDays.value = fresh.rentalDays
  Object.assign(dep, { type: fresh.deposits.length ? 'deduct' : 'collect', amount: Math.max(1, depositBalance(fresh)), reason: '' })
  Object.assign(pay, { amount: Math.max(1, fresh.ownerPayableBalance), note: '' })
  payables.value = mine
  const i = list.value.findIndex((x) => x.id === fresh.id)
  if (i >= 0) list.value[i] = fresh
  drawer.value = true
}
async function reloadCur() { const id = cur.value?.id; if (id) await open({ id }); void load() }
async function act(fn: () => Promise<unknown>, msg: string) { if (await run(fn, msg)) await reloadCur() }
const addDep = () => act(() => api.addDepositEntry(cur.value!.id, { ...dep }), '已记录')
// 付号主款同样带 Idempotency-Key：同一笔（同订单、同金额、同说明）重试不会付两次
const payKey = createSubmitKey()
const paying = ref(false)
async function payOwner() {
  const body = { orderId: cur.value!.id, amount: pay.amount, note: pay.note }
  paying.value = true
  try { await act(() => payKey.submit(body, (idempotencyKey) => api.payOwner(body.orderId, body.amount, body.note, { idempotencyKey })), '已登记付款') }
  finally { paying.value = false }
}
const dlgDone = ref(false)
const relist = ref(true)
const doneNote = ref('')
async function complete() {
  if (await run(() => api.completeOrder(cur.value!.id, relist.value, doneNote.value), '订单已完成')) { dlgDone.value = false; doneNote.value = ''; await reloadCur() }
}
async function load() { list.value = await api.listOrders() }
onMounted(async () => {
  await load()
  if (route.query.new) openNew(route.query.new as string)
  if (route.query.open) await run(() => open({ id: String(route.query.open) }))
})
</script>
<style>.remind-row td { background: #fff7ed !important; }</style>
