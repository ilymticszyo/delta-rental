<template>
  <el-card shadow="never">
    <template #header>号主档案（寄租号数、累计结算、应付余额）</template>
    <el-table :data="list" border size="small">
      <el-table-column prop="displayName" label="号主" width="100" />
      <el-table-column prop="contact" label="联系方式" width="150" />
      <el-table-column label="门户账号" width="90"><template #default="{ row }">{{ row.userId ?? '—' }}</template></el-table-column>
      <el-table-column prop="consignedCount" label="寄租号数" width="80" />
      <el-table-column label="累计应付" width="90"><template #default="{ row }">¥{{ row.accrued }}</template></el-table-column>
      <el-table-column label="累计结算（已付）" width="120"><template #default="{ row }">¥{{ row.cumulativeSettlement }}</template></el-table-column>
      <el-table-column label="应付余额" width="100"><template #default="{ row }"><b :style="{ color: row.balance ? '#b45309' : '' }">¥{{ row.balance }}</b></template></el-table-column>
      <el-table-column label="操作"><template #default="{ row }">
        <el-button link type="primary" @click="$router.push(`/admin/payables?owner=${row.id}`)">对账</el-button>
        <el-button link @click="$router.push(`/admin/inventory?kw=${row.displayName}`)">名下账号</el-button></template></el-table-column>
    </el-table>
  </el-card>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import type { OwnerProfile } from '../../domain/types'
const list = ref<OwnerProfile[]>([])
onMounted(async () => { list.value = await api.ownerProfiles() })
</script>
