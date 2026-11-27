<template>
  <el-card shadow="never">
    <div class="row-gap" style="margin-bottom:12px">
      <el-input v-model="kw" placeholder="按操作人 / 动作 / 对象筛选" clearable style="width:260px" />
      <span class="muted">账号状态、订单生命周期、押金与号主应付、回收单、规则变更、档案标签</span>
    </div>
    <el-table :data="rows" size="small" empty-text="暂无操作" max-height="680">
      <el-table-column label="时间" width="150"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
      <el-table-column prop="actor" label="操作人" width="90" />
      <el-table-column prop="action" label="动作" width="110" />
      <el-table-column prop="summary" label="摘要" />
    </el-table>
  </el-card>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../../api'
import type { AuditLog } from '../../api/types'
import { fmtTime } from '../../utils'
const logs = ref<AuditLog[]>([])
const kw = ref('')
const rows = computed(() => logs.value.filter((l) => !kw.value || [l.actor, l.action, l.summary].some((x) => x.includes(kw.value))))
onMounted(async () => { logs.value = await api.auditLogs() })
</script>
