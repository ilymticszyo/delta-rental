<template>
  <el-card shadow="never">
    <div class="row-gap" style="margin-bottom:12px">
      <el-select v-model="status" placeholder="全部状态" clearable style="width:140px">
        <el-option v-for="(l, k) in ORDER_STATUS_LABEL" :key="k" :label="l" :value="k" />
      </el-select>
      <el-input v-model="kw" placeholder="订单号 / 账号编号 / 租客" clearable style="width:240px" />
      <div style="flex:1" />
      <el-button type="primary" @click="openNew()">登记出租订单</el-button>
    </div>
    <el-table :data="rows" border size="small">
      <el-table-column prop="orderNo" label="订单号" width="90" />
      <el-table-column prop="accountNo" label="账号" width="90" />
      <el-table-column prop="renterContact" label="租客" width="120" />
      <el-table-column label="租期" width="230"><template #default="{ row }">{{ fmtTime(row.startAt) }} 起 {{ row.rentalDays }} 天<br /><span class="muted">至 {{ fmtTime(row.endAt) }}</span></template></el-table-column>
      <el-table-column prop="coinRent" label="租金" width="70" />
      <el-table-column prop="extraFee" label="附加费" width="64" />
      <el-table-column prop="deposit" label="押金" width="64" />
      <el-table-column label="押金余额" width="76"><template #default="{ row }">{{ depositBalance(row) }}</template></el-table-column>
      <el-table-column prop="totalAmount" label="总金额" width="72" />
      <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag size="small" :type="statusTagType[row.status]">{{ ORDER_STATUS_LABEL[row.status as OrderStatus] }}</el-tag></template></el-table-column>
      <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
      <el-table-column label="操作" width="230" fixed="right"><template #default="{ row }">
        <el-button link type="primary" @click="openDeposit(row)">押金流水</el-button>
        <template v-if="row.status === 'active'">
          <el-popconfirm title="确认到期 / 提前结束？账号将进入待结算" @confirm="act(() => api.endOrder(row.id), '已转待结算')"><template #reference><el-button link type="warning">到期结束</el-button></template></el-popconfirm>
          <el-popconfirm title="确认取消订单？账号恢复空闲可租" @confirm="act(() => api.cancelOrder(row.id), '已取消')"><template #reference><el-button link type="danger">取消</el-button></template></el-popconfirm>
        </template>
        <el-button v-if="row.status === 'settling'" link type="success" @click="openComplete(row)">完成结算</el-button>
      </template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dlgNew" title="登记出租订单" width="560px">
    <el-form label-width="100px">
      <el-form-item label="账号" required>
        <el-select v-model="nf.accountId" filterable placeholder="选择空闲可租账号" style="width:100%" @change="onPick">
          <el-option v-for="a in listed" :key="a.id" :label="`${a.accountNo} · ${a.coinAmount}M · 租金 ${a.quote.coinRent} 元`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="租客联系方式" required><el-input v-model="nf.renterContact" /></el-form-item>
      <el-form-item label="开始时间"><el-date-picker v-model="nf.startAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" /></el-form-item>
      <el-form-item label="租期(天)"><el-input-number v-model="nf.rentalDays" :min="1" /></el-form-item>
      <el-form-item label="押金(元)"><el-input-number v-model="nf.deposit" :min="0" /><span class="muted" style="margin-left:8px">可为 0</span></el-form-item>
      <el-form-item label="附加服务费"><el-input-number v-model="nf.extraFee" :min="0" /><span class="muted" style="margin-left:8px">默认 0</span></el-form-item>
      <el-form-item label="备注"><el-input v-model="nf.remark" /></el-form-item>
      <el-form-item label="应收合计"><span class="money">¥{{ (picked?.quote.coinRent ?? 0) + nf.extraFee + nf.deposit }}</span></el-form-item>
    </el-form>
    <template #footer><el-button @click="dlgNew = false">取消</el-button><el-button type="primary" @click="create">登记并锁定账号</el-button></template>
  </el-dialog>

  <el-dialog v-model="dlgDep" :title="`押金流水 · ${cur?.orderNo}`" width="640px">
    <template v-if="cur">
      <div style="margin-bottom:8px">押金余额：<b class="money">¥{{ depositBalance(cur) }}</b>（余额 = 收取 − 扣除 − 退还）</div>
      <el-table :data="cur.deposits" size="small" empty-text="暂无流水">
        <el-table-column label="时间" width="140"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
        <el-table-column label="类型" width="70"><template #default="{ row }">{{ depLabel[row.type as 'collect'] }}</template></el-table-column>
        <el-table-column prop="amount" label="金额" width="70" />
        <el-table-column prop="reason" label="原因 / 凭证" />
        <el-table-column prop="operator" label="操作人" width="80" />
      </el-table>
      <div v-if="cur.status === 'active' || cur.status === 'settling'" class="row-gap" style="margin-top:12px">
        <el-select v-model="dep.type" style="width:100px"><el-option v-for="(l, k) in depLabel" :key="k" :label="l" :value="k" /></el-select>
        <el-input-number v-model="dep.amount" :min="1" />
        <el-input v-model="dep.reason" placeholder="原因，如 AWM 消耗 2 把" style="width:200px" />
        <el-button type="primary" @click="addDep">添加</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="dlgDone" :title="`完成结算 · ${cur?.orderNo}`" width="480px">
    <template v-if="cur">
      <p>押金余额：<b>{{ depositBalance(cur) }}</b> 元。余额不为 0 时需填写不退还原因。</p>
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
import { api, depositBalance } from '../../api'
import { ORDER_STATUS_LABEL, type Account, type OrderStatus, type RentalOrder } from '../../domain/types'
import { fmtTime, run, statusTagType } from '../../utils'

const route = useRoute()
const list = ref<RentalOrder[]>([])
const listed = ref<Account[]>([])
const status = ref((route.query.status as string) || '')
const kw = ref('')
const rows = computed(() => list.value.filter((o) => (!status.value || o.status === status.value) &&
  (!kw.value || [o.orderNo, o.accountNo, o.renterContact].some((x) => x.toLowerCase().includes(kw.value.toLowerCase())))))
const depLabel = { collect: '收取', deduct: '扣除', refund: '退还' }

const dlgNew = ref(false)
const nf = reactive({ accountId: '', renterContact: '', startAt: '', rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
const picked = computed(() => listed.value.find((a) => a.id === nf.accountId))
function onPick() { if (picked.value) { nf.rentalDays = picked.value.quote.rentalDays; nf.deposit = picked.value.quote.deposit; nf.extraFee = picked.value.quote.extraFee } }
async function openNew(accountId = '') {
  listed.value = (await api.listAccounts()).filter((a) => a.status === 'listed')
  Object.assign(nf, { accountId, renterContact: '', startAt: new Date().toISOString(), rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
  onPick()
  dlgNew.value = true
}
async function create() {
  if (!nf.accountId) return ElMessage.warning('请选择账号')
  const r = await run(() => api.createOrder({ ...nf, startAt: new Date(nf.startAt || Date.now()).toISOString() }), '登记成功，账号已锁定为租赁中')
  if (r) { dlgNew.value = false; await load() }
}

const cur = ref<RentalOrder>()
const dlgDep = ref(false)
const dep = reactive({ type: 'deduct' as 'collect' | 'deduct' | 'refund', amount: 1, reason: '' })
function openDeposit(o: RentalOrder) { cur.value = o; Object.assign(dep, { type: o.deposits.length ? 'deduct' : 'collect', amount: 1, reason: '' }); dlgDep.value = true }
async function addDep() {
  const r = await run(() => api.addDepositEntry(cur.value!.id, { ...dep }), '已记录')
  if (r) { cur.value = r; await load() }
}
const dlgDone = ref(false)
const relist = ref(true)
const doneNote = ref('')
function openComplete(o: RentalOrder) { cur.value = o; relist.value = true; doneNote.value = ''; dlgDone.value = true }
async function complete() {
  if (await run(() => api.completeOrder(cur.value!.id, relist.value, doneNote.value), '订单已完成')) { dlgDone.value = false; await load() }
}
async function act(fn: () => Promise<unknown>, msg: string) { await run(fn, msg); await load() }
async function load() { list.value = await api.listOrders() }
onMounted(async () => { await load(); if (route.query.new) openNew(route.query.new as string) })
</script>
