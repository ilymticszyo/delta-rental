<template>
  <div v-if="s">
    <el-row :gutter="12">
      <el-col v-for="c in cards" :key="c.label" :span="6" style="margin-bottom:12px">
        <el-card shadow="hover" class="stat" @click="$router.push(c.to)">
          <div class="muted">{{ c.label }}</div>
          <div class="num" :style="{ color: c.color }">{{ c.value }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" header="最近操作">
      <el-table :data="logs" size="small" empty-text="暂无操作">
        <el-table-column label="时间" width="150"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
        <el-table-column prop="actor" label="操作人" width="90" />
        <el-table-column prop="action" label="动作" width="110" />
        <el-table-column prop="summary" label="摘要" />
      </el-table>
    </el-card>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../../api'
import type { AuditLog } from '../../api/types'
import type { DashboardStats } from '../../domain/types'
import { fmtTime } from '../../utils'
const s = ref<DashboardStats>()
const logs = ref<AuditLog[]>([])
const cards = computed(() => !s.value ? [] : [
  { label: '空闲可租账号', value: s.value.listed, to: '/admin/inventory?status=listed', color: '#16a34a' },
  { label: '租赁中', value: s.value.rented, to: '/admin/inventory?status=rented', color: '#d97706' },
  { label: '待结算', value: s.value.settling, to: '/admin/orders?status=settling', color: '#dc2626' },
  { label: '已回收持有', value: s.value.held, to: '/admin/inventory?status=held', color: '#2563eb' },
  { label: '今日新订单', value: s.value.todayOrders, to: '/admin/orders', color: '#111' },
  { label: '本周新订单', value: s.value.weekOrders, to: '/admin/orders', color: '#111' },
  { label: '待跟进回收单', value: s.value.pendingRecycles, to: '/admin/recycles?status=pending', color: '#7c3aed' },
  { label: '在押押金余额（元）', value: s.value.depositBalance, to: '/admin/orders', color: '#111' },
  { label: '本月租金营收（元）', value: s.value.revenueMonth, to: '/admin/orders', color: '#c9a24d' },
  { label: '累计租金营收（元）', value: s.value.revenueTotal, to: '/admin/orders', color: '#c9a24d' },
])
onMounted(async () => { s.value = await api.dashboard(); logs.value = (await api.auditLogs()).slice(0, 10) })
</script>
