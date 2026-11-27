<template>
  <el-card shadow="never">
    <div class="row-gap" style="margin-bottom:12px">
      <el-select v-model="ownerId" placeholder="全部号主" clearable style="width:160px">
        <el-option v-for="o in owners" :key="o.id" :label="o.displayName" :value="o.id" />
      </el-select>
      <el-select v-model="type" placeholder="全部类型" clearable style="width:110px"><el-option v-for="(l, k) in typeLabel" :key="k" :label="l" :value="k" /></el-select>
      <span>应付 <b>¥{{ sum('accrue') }}</b> − 已付 <b>¥{{ sum('pay') }}</b> − 冲销 <b>¥{{ sum('reverse') }}</b> = 余额 <b class="money">¥{{ sum('accrue') - sum('pay') - sum('reverse') }}</b></span>
    </div>
    <el-table :data="rows" border size="small">
      <el-table-column label="时间" width="140"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
      <el-table-column label="号主" width="90"><template #default="{ row }">{{ ownerName(row.ownerId) }}</template></el-table-column>
      <el-table-column prop="accountNo" label="账号" width="90" />
      <el-table-column label="订单" width="90"><template #default="{ row }"><el-button v-if="row.orderId" link type="primary" @click="$router.push(`/admin/orders?open=${row.orderId}`)">{{ row.orderNo }}</el-button></template></el-table-column>
      <el-table-column label="类型" width="70"><template #default="{ row }"><el-tag size="small" :type="row.type === 'accrue' ? 'warning' : row.type === 'pay' ? 'success' : 'info'">{{ typeLabel[row.type as 'pay'] }}</el-tag></template></el-table-column>
      <el-table-column prop="amount" label="金额" width="80" />
      <el-table-column prop="note" label="说明" />
      <el-table-column prop="operator" label="操作人" width="80" />
    </el-table>
    <p class="muted">付款请在「出租订单 → 详情」中按单登记，保证每笔应付都能对到订单。</p>
  </el-card>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api'
import type { OwnerPayableEntry, OwnerProfile } from '../../domain/types'
import { fmtTime } from '../../utils'
const route = useRoute()
const list = ref<OwnerPayableEntry[]>([])
const owners = ref<OwnerProfile[]>([])
const ownerId = ref((route.query.owner as string) || '')
const type = ref('')
const typeLabel = { accrue: '应付', pay: '已付', reverse: '冲销' }
const rows = computed(() => list.value.filter((p) => (!ownerId.value || p.ownerId === ownerId.value) && (!type.value || p.type === type.value)))
const sum = (t: OwnerPayableEntry['type']) => list.value.filter((p) => (!ownerId.value || p.ownerId === ownerId.value) && p.type === t).reduce((s, p) => s + p.amount, 0)
const ownerName = (id: string) => owners.value.find((o) => o.id === id)?.displayName ?? id
onMounted(async () => { list.value = await api.listPayables(); owners.value = await api.ownerProfiles() })
</script>
