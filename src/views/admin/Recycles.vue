<template>
  <el-card shadow="never">
    <div class="row-gap" style="margin-bottom:12px">
      <el-select v-model="status" placeholder="全部状态" clearable style="width:150px">
        <el-option label="待跟进（全部未结束）" value="pending" />
        <el-option v-for="(l, k) in RECYCLE_STATUS_LABEL" :key="k" :label="l" :value="k" />
      </el-select>
      <div style="width:300px"><el-date-picker v-model="range" type="daterange" start-placeholder="提交开始" end-placeholder="提交结束" /></div>
    </div>
    <el-table :data="rows" border size="small" @row-click="open">
      <el-table-column prop="requestNo" label="单号" width="90" />
      <el-table-column label="提交时间" width="140"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
      <el-table-column prop="submitter" label="提交人" width="80" />
      <el-table-column prop="contact" label="联系方式" width="120" />
      <el-table-column label="资产" min-width="200"><template #default="{ row }">{{ row.asset.region }} · 纯币 {{ row.asset.coinAmount }}M / 总 {{ row.asset.totalAssets }}M · {{ row.asset.safeBox }}格 · 皮肤 {{ row.asset.skins.length }}{{ row.asset.banRecord ? ' · 有封禁' : '' }}</template></el-table-column>
      <el-table-column label="系统参考" width="110"><template #default="{ row }">{{ row.result.rejected ? '转人工' : `${row.result.min}-${row.result.max}` }}</template></el-table-column>
      <el-table-column label="人工报价" width="80"><template #default="{ row }">{{ row.staffPrice ?? '-' }}</template></el-table-column>
      <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag size="small" :type="statusTagType[row.status]">{{ RECYCLE_STATUS_LABEL[row.status as RecycleStatus] }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="80"><template #default="{ row }"><el-button link type="primary" @click.stop="open(row)">跟进</el-button></template></el-table-column>
    </el-table>
  </el-card>

  <el-drawer v-model="drawer" :title="`回收单 ${cur?.requestNo}`" size="560px">
    <template v-if="cur">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="状态"><el-tag size="small" :type="statusTagType[cur.status]">{{ RECYCLE_STATUS_LABEL[cur.status] }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="联系方式">{{ cur.contact }}</el-descriptions-item>
        <el-descriptions-item label="大区 / 上号">{{ cur.asset.region }} / {{ cur.asset.loginMethod }}</el-descriptions-item>
        <el-descriptions-item label="纯币 / 总资产">{{ cur.asset.coinAmount }}M / {{ cur.asset.totalAssets }}M</el-descriptions-item>
        <el-descriptions-item label="等级 / 段位">{{ cur.asset.level }} / {{ cur.asset.rank }}</el-descriptions-item>
        <el-descriptions-item label="保险格">{{ cur.asset.safeBox }} 格</el-descriptions-item>
        <el-descriptions-item label="AWM/6头/6甲">{{ cur.asset.awmCount }}/{{ cur.asset.helmet6Count }}/{{ cur.asset.armor6Count }}</el-descriptions-item>
        <el-descriptions-item label="封禁">{{ cur.asset.banRecord ? '有' : '无' }}</el-descriptions-item>
        <el-descriptions-item label="皮肤" :span="2">{{ cur.asset.skins.join('、') || '无' }}</el-descriptions-item>
        <el-descriptions-item label="系统估值" :span="2">{{ cur.result.rejected ? '有封禁，转人工' : `中枢 ${cur.result.center}，区间 ${cur.result.min}-${cur.result.max}` }}（规则 v{{ cur.result.ruleVersion }} 快照）</el-descriptions-item>
        <el-descriptions-item label="人工报价" :span="2">{{ cur.staffPrice ?? '未报价' }}</el-descriptions-item>
        <el-descriptions-item v-if="cur.relatedAccountId" label="入库账号" :span="2">{{ cur.relatedAccountId.replace('a', 'DF') }}</el-descriptions-item>
      </el-descriptions>

      <h4>跟进记录</h4>
      <el-timeline>
        <el-timeline-item v-for="(e, i) in cur.events" :key="i" :timestamp="`${fmtTime(e.at)} · ${e.operator}`">
          {{ e.fromStatus ? RECYCLE_STATUS_LABEL[e.fromStatus] + ' → ' : '' }}{{ RECYCLE_STATUS_LABEL[e.toStatus] }}{{ e.price ? `（报价 ${e.price}）` : '' }} {{ e.note }}
        </el-timeline-item>
      </el-timeline>

      <template v-if="nexts.length || cur.status === 'quoted'">
        <h4>推进</h4>
        <el-form label-width="80px" size="small">
          <el-form-item label="下一状态"><el-select v-model="act.to">
            <el-option v-for="s in nexts" :key="s" :label="s === cur.status ? '改报价（保持已报价）' : RECYCLE_STATUS_LABEL[s]" :value="s" /></el-select></el-form-item>
          <el-form-item v-if="act.to === 'quoted'" label="报价(元)"><el-input-number v-model="act.price" :min="1" /></el-form-item>
          <el-form-item label="跟进备注"><el-input v-model="act.note" type="textarea" /></el-form-item>
          <el-form-item><el-button type="primary" :disabled="!act.to" @click="advance">保存跟进</el-button>
            <el-popconfirm v-if="cur.status === 'quoted'" :title="`按报价 ${cur.staffPrice} 元成交，并新建库存账号（已回收持有）？`" width="260" @confirm="toInventory">
              <template #reference><el-button type="success">成交入库</el-button></template></el-popconfirm></el-form-item>
        </el-form>
      </template>
    </template>
  </el-drawer>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../../api'
import { RECYCLE_STATUS_LABEL, RECYCLE_TRANSITIONS, type RecycleRequest, type RecycleStatus } from '../../domain/types'
import { fmtTime, run, statusTagType } from '../../utils'

const route = useRoute()
const list = ref<RecycleRequest[]>([])
const status = ref((route.query.status as string) || '')
const range = ref<[Date, Date] | null>(null)
const rows = computed(() => [...list.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((r) => {
  if (status.value === 'pending' && !['submitted', 'following', 'quoted'].includes(r.status)) return false
  if (status.value && status.value !== 'pending' && r.status !== status.value) return false
  if (range.value) {
    const t = new Date(r.createdAt).getTime()
    if (t < range.value[0].getTime() || t > range.value[1].getTime() + 86400000) return false
  }
  return true
}))
const drawer = ref(false)
const cur = ref<RecycleRequest>()
const nexts = computed(() => (cur.value ? RECYCLE_TRANSITIONS[cur.value.status].filter((s) => s !== 'deal') : []))
const act = reactive({ to: '' as RecycleStatus | '', price: 0, note: '' })
function open(r: RecycleRequest) {
  cur.value = r
  Object.assign(act, { to: nexts.value[0] ?? '', price: r.staffPrice ?? (r.result.rejected ? 0 : r.result.center), note: '' })
  drawer.value = true
}
async function refresh() {
  list.value = await api.listRecycles()
  if (cur.value) { const id = cur.value.id; cur.value = list.value.find((x) => x.id === id); if (cur.value) open(cur.value) }
}
async function advance() {
  if (!act.to) return
  if (await run(() => api.updateRecycle(cur.value!.id, act.to as RecycleStatus, act.note, act.to === 'quoted' ? act.price : undefined), '已保存')) await refresh()
}
async function toInventory() {
  const a = await run(() => api.recycleToInventory(cur.value!.id))
  if (a) { ElMessage.success(`已入库为 ${a.accountNo}（已回收持有），可在账号库存上架`); await refresh() }
}
onMounted(async () => { list.value = await api.listRecycles() })
</script>
