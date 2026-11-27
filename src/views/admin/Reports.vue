<template>
  <div>
    <el-card shadow="never" style="margin-bottom:12px">
      <div class="row-gap">
        <el-radio-group v-model="preset" size="small" @change="applyPreset">
          <el-radio-button value="7">近 7 天</el-radio-button><el-radio-button value="30">近 30 天</el-radio-button><el-radio-button value="90">近 90 天</el-radio-button>
        </el-radio-group>
        <div style="width:280px"><el-date-picker v-model="range" type="daterange" size="small" @change="load" /></div>
        <span class="muted">维度：</span>
        <el-radio-group v-model="dim" size="small" @change="load">
          <el-radio-button v-for="(l, k) in DIMENSION_LABEL" :key="k" :value="k">{{ l }}</el-radio-button>
        </el-radio-group>
      </div>
    </el-card>
    <template v-if="rep">
      <el-row :gutter="12" style="margin-bottom:12px">
        <el-col :span="6"><el-card shadow="never"><div class="muted">出租率</div><div class="big">{{ rep.utilization }}%</div><div class="muted">已租天数 / 在库天数</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="muted">单号日均收入（平台）</div><div class="big">¥{{ rep.dailyNetPerAccount }}</div><div class="muted">{{ rep.accountCount }} 个账号 · {{ rep.days }} 天</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="muted">租金流水</div><div class="big">¥{{ rep.gross }}</div><div class="muted">{{ rep.orderCount }} 笔订单</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="muted">平台收入（流水 − 号主应付）</div><div class="big" style="color:#c9a24d">¥{{ rep.net }}</div></el-card></el-col>
      </el-row>
      <el-card shadow="never" style="margin-bottom:12px">
        <template #header>哪类号最好租（按{{ DIMENSION_LABEL[dim] }}，按出租率排序）</template>
        <el-table :data="rep.groups" size="small" border>
          <el-table-column prop="key" :label="DIMENSION_LABEL[dim]" width="120" />
          <el-table-column prop="accounts" label="账号数" width="70" />
          <el-table-column prop="orders" label="订单" width="60" />
          <el-table-column label="出租率" min-width="180"><template #default="{ row }"><el-progress :percentage="Math.min(100, row.utilization)" :format="() => row.utilization + '%'" /></template></el-table-column>
          <el-table-column prop="rentedDays" label="已租天数" width="80" />
          <el-table-column prop="gross" label="流水" width="80" />
          <el-table-column prop="net" label="平台收入" width="80" />
        </el-table>
      </el-card>
      <el-row :gutter="12">
        <el-col :span="13">
          <el-card shadow="never" header="单号表现">
            <el-table :data="rep.accounts" size="small" max-height="420">
              <el-table-column label="账号" width="90"><template #default="{ row }"><el-button link type="primary" @click="$router.push(`/admin/inventory?kw=${row.accountNo}`)">{{ row.accountNo }}</el-button></template></el-table-column>
              <el-table-column label="来源" width="70"><template #default="{ row }">{{ ACCOUNT_SOURCE_LABEL[row.source as AccountSource] }}</template></el-table-column>
              <el-table-column label="订单" width="60"><template #default="{ row }"><el-button link @click="$router.push(`/admin/orders?kw=${row.accountNo}`)">{{ row.orders }}</el-button></template></el-table-column>
              <el-table-column label="出租率" width="70"><template #default="{ row }">{{ row.utilization }}%</template></el-table-column>
              <el-table-column prop="gross" label="流水" width="70" />
              <el-table-column prop="net" label="平台收入" width="76" />
              <el-table-column prop="dailyNet" label="日均" width="60" />
            </el-table>
          </el-card>
        </el-col>
        <el-col :span="11">
          <el-card shadow="never" header="自收号回本周期（全部历史）">
            <el-table :data="rep.payback" size="small" empty-text="暂无自收号">
              <el-table-column label="账号" width="90"><template #default="{ row }"><el-button link type="primary" @click="$router.push(`/admin/inventory?kw=${row.accountNo}`)">{{ row.accountNo }}</el-button></template></el-table-column>
              <el-table-column prop="cost" label="成本" width="64" />
              <el-table-column prop="income" label="累计收入" width="76" />
              <el-table-column label="回本" min-width="110"><template #default="{ row }"><el-progress :percentage="Math.min(100, row.percent)" :format="() => row.percent + '%'" :status="row.paidBack ? 'success' : undefined" /></template></el-table-column>
              <el-table-column label="预计回本" width="90"><template #default="{ row }">{{ row.paidBack ? '已回本' : row.estPaybackDays ? `约 ${row.estPaybackDays} 天` : '暂无收入' }}</template></el-table-column>
            </el-table>
            <p class="muted">预计回本天数 = 成本 ÷（累计收入 ÷ 持有天数）。</p>
          </el-card>
        </el-col>
      </el-row>
    </template>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import { DIMENSION_LABEL, type Report, type ReportDimension } from '../../domain/reports'
import { ACCOUNT_SOURCE_LABEL, type AccountSource } from '../../domain/types'
const DAY = 86400000
const preset = ref('30')
const range = ref<[Date, Date]>([new Date(Date.now() - 30 * DAY), new Date()])
const dim = ref<ReportDimension>('safeBox')
const rep = ref<Report>()
function applyPreset() { range.value = [new Date(Date.now() - Number(preset.value) * DAY), new Date()]; load() }
async function load() {
  if (!range.value) return
  const to = Math.min(Date.now(), new Date(range.value[1]).setHours(23, 59, 59, 999))
  rep.value = await api.report(new Date(range.value[0]).getTime(), to, dim.value)
}
onMounted(load)
</script>
<style scoped>.big { font-size: 26px; font-weight: 700; margin: 4px 0; }</style>
