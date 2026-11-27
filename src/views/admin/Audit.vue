<template>
  <el-card shadow="never" header="操作日志（账号状态、订单、押金、回收单、规则变更）">
    <el-table :data="logs" size="small" empty-text="暂无操作" max-height="680">
      <el-table-column label="时间" width="150"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
      <el-table-column prop="actor" label="操作人" width="90" />
      <el-table-column prop="action" label="动作" width="110" />
      <el-table-column prop="summary" label="摘要" />
    </el-table>
  </el-card>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import type { AuditLog } from '../../api/types'
import { fmtTime } from '../../utils'
const logs = ref<AuditLog[]>([])
onMounted(async () => { logs.value = await api.auditLogs() })
</script>
