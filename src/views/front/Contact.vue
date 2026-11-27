<template>
  <div class="page">
    <el-row :gutter="16">
      <el-col :span="10">
        <el-card shadow="never">
          <template #header><span class="card-title">当前在班客服</span></template>
          <div v-if="agent" style="text-align:center">
            <QrCode ref="qr" :text="`微信:${agent.wechat}`" :size="220" />
            <h3 style="margin:8px 0 4px">{{ agent.name }}</h3>
            <div class="muted">微信：{{ agent.wechat }}{{ agent.isFallback ? '（当前无排班，显示备用客服）' : '' }}</div>
            <div class="row-gap" style="justify-content:center;margin-top:12px">
              <el-button @click="save">保存二维码</el-button>
              <el-button type="primary" @click="load">刷新</el-button>
            </div>
            <div class="muted" style="margin-top:8px">刷新时间：{{ fmtTime(checkedAt) }}</div>
          </div>
          <el-empty v-else description="当前暂无可用客服，请稍后再试" />
        </el-card>
      </el-col>
      <el-col :span="14">
        <el-card shadow="never" header="说明">
          <p>本站所有成交均在线下完成：扫码添加客服，发送账号编号（或回收单号），由客服确认价格、押金与交接方式。</p>
          <p>二维码按当前时间自动匹配排班客服，跨时段请点「刷新」。</p>
        </el-card>
        <el-card shadow="never" header="排班表" style="margin-top:12px">
          <el-table :data="rows" size="small">
            <el-table-column prop="name" label="客服" width="140" />
            <el-table-column prop="days" label="星期" />
            <el-table-column prop="time" label="时段" width="140" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import type { CsAgent } from '../../domain/types'
import QrCode from '../../components/QrCode.vue'
import { fmtTime } from '../../utils'
const agent = ref<CsAgent | null>(null)
const checkedAt = ref('')
const qr = ref<{ src: string }>()
const rows = ref<{ name: string; days: string; time: string }[]>([])
const W = '日一二三四五六'
async function load() { agent.value = await api.currentCsAgent(); checkedAt.value = new Date().toISOString() }
function save() {
  if (!qr.value?.src) return
  const a = document.createElement('a')
  a.href = qr.value.src
  a.download = `客服-${agent.value?.name}.png`
  a.click()
}
onMounted(async () => {
  await load()
  const agents = await api.listCsAgents()
  rows.value = agents.flatMap((a) => (a.isFallback ? [{ name: a.name, days: '无排班时', time: '—' }] : a.schedule.map((s) => ({ name: a.name, days: s.weekdays.map((d) => '周' + W[d]).join('、'), time: `${s.start}-${s.end}` }))))
})
</script>
