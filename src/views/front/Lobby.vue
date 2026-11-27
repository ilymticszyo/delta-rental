<template>
  <div class="page">
    <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px"
      title="公告：本站为内部流通工具，成交线下完成。AWM / 6头 / 6甲按实际使用从押金扣除。" />
    <el-alert v-if="!showPrice" type="info" :closable="false" show-icon style="margin-bottom:12px" title="号主视图：大厅不展示租金与报价。你自己的账号状态与到手金额请看「我的账号」。" />
    <el-card shadow="never">
      <div class="row-gap" style="margin-bottom:10px">
        <el-input v-model="f.keyword" placeholder="搜索编号 / 皮肤名" clearable style="width:220px" />
        <el-select v-model="f.region" placeholder="大区" clearable style="width:110px"><el-option v-for="o in dicts.regions" :key="o" :value="o" /></el-select>
        <el-select v-model="f.loginMethod" placeholder="登录方式" clearable style="width:110px"><el-option v-for="o in dicts.loginMethods" :key="o" :value="o" /></el-select>
        <el-select v-model="f.channel" placeholder="上架渠道" clearable style="width:120px"><el-option v-for="o in dicts.channels" :key="o" :value="o" /></el-select>
        <el-select v-model="f.safeBox" placeholder="保险格" clearable style="width:100px"><el-option v-for="o in dicts.safeBoxes" :key="o" :label="o + ' 格'" :value="o" /></el-select>
        <el-select v-model="f.rank" placeholder="段位" clearable style="width:100px"><el-option v-for="o in dicts.ranks" :key="o" :value="o" /></el-select>
        <el-select v-model="f.ban" placeholder="封禁记录" clearable style="width:110px">
          <el-option label="无封禁" value="no" /><el-option label="有封禁" value="yes" />
        </el-select>
        <el-select v-model="f.skins" multiple collapse-tags placeholder="皮肤（同时拥有）" clearable style="width:220px">
          <el-option v-for="s in dicts.skins" :key="s.name" :label="`${s.name}（${s.category}）`" :value="s.name" />
        </el-select>
        <el-button link type="primary" @click="adv = !adv">{{ adv ? '收起' : '更多筛选' }}</el-button>
      </div>
      <div v-if="adv" class="row-gap" style="margin-bottom:10px">
        <span class="muted">纯币(M)</span><el-input-number v-model="f.coinMin" :min="0" controls-position="right" style="width:110px" />–<el-input-number v-model="f.coinMax" :min="0" controls-position="right" style="width:110px" />
        <span class="muted">总金额(元)</span><el-input-number v-model="f.priceMin" :min="0" controls-position="right" style="width:110px" />–<el-input-number v-model="f.priceMax" :min="0" controls-position="right" style="width:110px" />
        <span class="muted">AWM≥</span><el-input-number v-model="f.awm" :min="0" controls-position="right" style="width:90px" />
        <span class="muted">6头≥</span><el-input-number v-model="f.h6" :min="0" controls-position="right" style="width:90px" />
        <span class="muted">6甲≥</span><el-input-number v-model="f.a6" :min="0" controls-position="right" style="width:90px" />
        <span class="muted">KD≥</span><el-input-number v-model="f.kd" :min="0" :step="0.1" controls-position="right" style="width:90px" />
        <el-checkbox v-model="f.expCard">有九格体验卡</el-checkbox>
      </div>
      <div class="row-gap">
        <span class="muted">快捷：</span>
        <el-check-tag v-for="q in quickFilters" :key="q.key" :checked="f.quick === q.key" @change="f.quick = f.quick === q.key ? '' : q.key">{{ q.label }}</el-check-tag>
        <el-divider direction="vertical" />
        <span class="muted">排序：</span>
        <el-select v-model="sortKey" style="width:120px">
          <el-option v-for="(l, k) in sortLabels" :key="k" :label="l" :value="k" />
        </el-select>
        <el-radio-group v-model="sortDir" size="small"><el-radio-button value="desc">降序</el-radio-button><el-radio-button value="asc">升序</el-radio-button></el-radio-group>
        <div style="flex:1" />
        <el-button @click="reset">清空筛选</el-button>
        <el-radio-group v-model="view" size="small"><el-radio-button value="table">表格</el-radio-button><el-radio-button value="card">卡片</el-radio-button></el-radio-group>
      </div>
    </el-card>

    <div style="margin:12px 0" class="muted">共 {{ filtered.length }} 个空闲可租账号</div>
    <el-empty v-if="!filtered.length" description="没有符合条件的账号"><el-button type="primary" @click="reset">清空筛选</el-button></el-empty>

    <el-table v-else-if="view === 'table'" :data="paged" border stripe size="small" style="width:100%" @row-dblclick="(r: Account) => go(r)">
      <el-table-column label="编号" width="110" fixed>
        <template #default="{ row }"><b>{{ row.accountNo }}</b> <el-button link type="primary" size="small" @click="copy(row.accountNo)">复制</el-button></template>
      </el-table-column>
      <el-table-column label="状态" width="86"><template #default><el-tag type="success" size="small">空闲可租</el-tag></template></el-table-column>
      <el-table-column prop="coinAmount" label="纯币(M)" width="76" />
      <el-table-column prop="level" label="等级" width="56" />
      <el-table-column label="保险" width="56"><template #default="{ row }">{{ row.safeBox }}格</template></el-table-column>
      <el-table-column label="皮肤" min-width="160"><template #default="{ row }">
        <el-tag v-for="s in row.skins.slice(0, 2)" :key="s" size="small" style="margin:1px">{{ s }}</el-tag>
        <span v-if="row.skins.length > 2" class="muted"> +{{ row.skins.length - 2 }}</span>
        <span v-if="!row.skins.length" class="muted">无</span></template></el-table-column>
      <el-table-column prop="secretKd" label="绝密KD" width="70" />
      <el-table-column label="比例" width="64"><template #default="{ row }">1:{{ row.coinRatio }}</template></el-table-column>
      <el-table-column v-if="showPrice" label="纯币租金" width="80"><template #default="{ row }">{{ row.quote?.coinRent }}</template></el-table-column>
      <el-table-column v-if="showPrice" label="附加费" width="64"><template #default="{ row }">{{ row.quote?.extraFee }}</template></el-table-column>
      <el-table-column v-if="showPrice" label="押金" width="60"><template #default="{ row }">{{ row.quote?.deposit }}</template></el-table-column>
      <el-table-column v-if="showPrice" label="总金额" width="76"><template #default="{ row }"><span class="money">¥{{ row.quote?.totalAmount }}</span></template></el-table-column>
      <el-table-column label="租期" width="60"><template #default="{ row }">{{ row.quote?.rentalDays }}天</template></el-table-column>
      <el-table-column prop="loginMethod" label="登录" width="60" />
      <el-table-column prop="assistTime" label="辅助时间" width="100" />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column v-if="showPrice" label="折扣" width="60"><template #default="{ row }">{{ (row.quote?.discountPercent ?? 100) < 100 ? row.quote?.discountPercent + '折' : '-' }}</template></el-table-column>
      <el-table-column prop="remark" label="备注" min-width="110" show-overflow-tooltip />
      <el-table-column label="操作" width="150" fixed="right"><template #default="{ row }">
        <el-button link type="primary" @click="go(row)">详情</el-button>
        <el-button link type="warning" @click="contact(row)">联系客服下单</el-button></template></el-table-column>
    </el-table>

    <el-row v-else :gutter="12">
      <el-col v-for="a in paged" :key="a.id" :span="6" style="margin-bottom:12px">
        <el-card shadow="hover" body-style="padding:14px">
          <div class="row-gap" style="justify-content:space-between"><b>{{ a.accountNo }}</b><el-tag type="success" size="small">空闲可租</el-tag></div>
          <div style="margin:8px 0">纯币 <b>{{ a.coinAmount }}M</b> · {{ a.safeBox }}格 · {{ a.rank }} · KD {{ a.secretKd }}</div>
          <div class="muted">{{ a.region }} / {{ a.loginMethod }} / {{ a.channel }} · AWM {{ a.awmCount }} · 6头 {{ a.helmet6Count }} · 6甲 {{ a.armor6Count }}</div>
          <div style="margin:6px 0;min-height:24px"><el-tag v-for="s in a.skins.slice(0, 3)" :key="s" size="small" style="margin:1px">{{ s }}</el-tag></div>
          <div class="row-gap" style="justify-content:space-between">
            <span v-if="showPrice" class="money" style="font-size:18px">¥{{ a.quote?.totalAmount }}</span><span v-if="showPrice" class="muted">{{ a.quote?.rentalDays }} 天 · 押金 {{ a.quote?.deposit }}</span><span v-else class="muted">报价仅内部可见</span></div>
          <div class="row-gap" style="margin-top:8px">
            <el-button size="small" @click="copy(a.accountNo)">复制编号</el-button>
            <el-button size="small" @click="go(a)">详情</el-button>
            <el-button size="small" type="warning" @click="contact(a)">联系客服</el-button></div>
        </el-card>
      </el-col>
    </el-row>

    <el-pagination v-if="filtered.length" style="margin-top:12px;justify-content:flex-end" layout="total, sizes, prev, pager, next"
      :total="filtered.length" v-model:current-page="pageNo" v-model:page-size="pageSize" :page-sizes="[10, 20, 50]" />
    <ContactDialog v-model="dlg" :account-no="dlgNo" />
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../../api'
import { dicts, quickFilters } from '../../config/rules'
import type { LobbyAccount as Account } from '../../domain/types'
import { copy } from '../../utils'
import ContactDialog from '../../components/ContactDialog.vue'

const router = useRouter()
const showPrice = api.currentUser()?.role !== 'owner'
const list = ref<Account[]>([])
const adv = ref(false)
const empty = () => ({ keyword: '', region: '', loginMethod: '', channel: '', safeBox: undefined as number | undefined, rank: '', ban: '', skins: [] as string[],
  coinMin: undefined as number | undefined, coinMax: undefined as number | undefined, priceMin: undefined as number | undefined, priceMax: undefined as number | undefined,
  awm: undefined as number | undefined, h6: undefined as number | undefined, a6: undefined as number | undefined, kd: undefined as number | undefined, expCard: false, quick: '' })
const f = reactive(empty())
const reset = () => Object.assign(f, empty())

const sortLabels = { coin: '哈夫币（纯币）', price: '价格', ratio: '比例', awm: 'AWM', h6: '六头', a6: '六甲', newest: '最新上架' }
const sortGetters: Record<string, (a: Account) => number | string> = {
  coin: (a) => a.coinAmount, price: (a) => a.quote?.totalAmount ?? 0, ratio: (a) => a.coinRatio, awm: (a) => a.awmCount,
  h6: (a) => a.helmet6Count, a6: (a) => a.armor6Count, newest: (a) => a.createdAt,
}
const pref = JSON.parse(localStorage.getItem('dr:v1:lobbyPref') || '{}')
const sortKey = ref<string>(pref.sortKey ?? 'coin')
const sortDir = ref<'asc' | 'desc'>(pref.sortDir ?? 'desc')
const view = ref<'table' | 'card'>(pref.view ?? 'table')
watch([sortKey, sortDir, view], () => localStorage.setItem('dr:v1:lobbyPref', JSON.stringify({ sortKey: sortKey.value, sortDir: sortDir.value, view: view.value })))

const pageNo = ref(1)
const pageSize = ref(20)
watch(f, () => (pageNo.value = 1))

const filtered = computed(() => {
  const kw = f.keyword.trim().toLowerCase()
  const out = list.value.filter((a) => {
    if (kw && !a.accountNo.toLowerCase().includes(kw) && !a.skins.some((s) => s.toLowerCase().includes(kw))) return false
    if (f.region && a.region !== f.region) return false
    if (f.loginMethod && a.loginMethod !== f.loginMethod && a.loginMethod !== '均可') return false
    if (f.channel && a.channel !== f.channel) return false
    if (f.safeBox && a.safeBox !== f.safeBox) return false
    if (f.rank && a.rank !== f.rank) return false
    if (f.ban === 'no' && a.banRecord) return false
    if (f.ban === 'yes' && !a.banRecord) return false
    if (f.skins.length && !f.skins.every((s) => a.skins.includes(s))) return false
    if (f.coinMin != null && a.coinAmount < f.coinMin) return false
    if (f.coinMax != null && a.coinAmount > f.coinMax) return false
    if (f.priceMin != null && (a.quote?.totalAmount ?? 0) < f.priceMin) return false
    if (f.priceMax != null && (a.quote?.totalAmount ?? 0) > f.priceMax) return false
    if (f.awm != null && a.awmCount < f.awm) return false
    if (f.h6 != null && a.helmet6Count < f.h6) return false
    if (f.a6 != null && a.armor6Count < f.a6) return false
    if (f.kd != null && a.secretKd < f.kd) return false
    if (f.expCard && !a.experienceCardCount) return false
    if (f.quick === 'discount' && (a.quote?.discountPercent ?? 100) >= 100) return false
    if (f.quick === 'small' && (a.quote?.totalAmount ?? Infinity) > 300) return false
    if (f.quick === 'box9' && a.safeBox !== 9) return false
    if (f.quick === 'box6' && a.safeBox !== 6) return false
    if (f.quick === 'box4' && a.safeBox !== 4) return false
    return true
  })
  const g = sortGetters[sortKey.value]
  const dir = sortDir.value === 'asc' ? 1 : -1
  return out.sort((x, y) => (g(x) > g(y) ? dir : g(x) < g(y) ? -dir : 0))
})
const paged = computed(() => filtered.value.slice((pageNo.value - 1) * pageSize.value, pageNo.value * pageSize.value))

const dlg = ref(false)
const dlgNo = ref('')
async function contact(a: Account) {
  const fresh = await api.getAccount(a.id)
  if (!fresh || fresh.status !== 'listed') { ElMessage.warning('该账号已不可租，请重新选择'); list.value = await api.listListedAccounts(); return }
  dlgNo.value = a.accountNo
  dlg.value = true
}
const go = (a: Account) => router.push(`/accounts/${a.id}`)
onMounted(async () => { list.value = await api.listListedAccounts() })
</script>
