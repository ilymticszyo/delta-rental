<template>
  <el-card shadow="never">
    <template #header>员工与角色（固定五档；演示版不支持新建，可启停）</template>
    <el-table :data="list" border size="small">
      <el-table-column prop="username" label="账号" width="100" />
      <el-table-column prop="displayName" label="名称" width="160" />
      <el-table-column label="角色" width="100"><template #default="{ row }"><el-tag size="small">{{ ROLE_LABEL[row.role as Role] }}</el-tag></template></el-table-column>
      <el-table-column label="能力" min-width="300"><template #default="{ row }"><span class="muted">{{ ROLE_CAPS[row.role as Role].map((c) => CAP_LABEL[c]).join('、') }}</span></template></el-table-column>
      <el-table-column label="启用" width="80"><template #default="{ row }"><el-switch :model-value="row.enabled" @change="(v: any) => toggle(row, v)" /></template></el-table-column>
    </el-table>
  </el-card>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import { ROLE_CAPS, type Cap } from '../../domain/permissions'
import { ROLE_LABEL, type Role, type StaffUser } from '../../domain/types'
import { run } from '../../utils'
const CAP_LABEL: Record<Cap, string> = {
  front: '前台', ownerPortal: '号主门户（本人）', ownerPortalAll: '号主门户（全部）', seeRent: '大厅报价', seeCommission: '租客信息 / 抽成', adminArea: '进后台',
  dashboard: '看板', orders: '订单与台账', recycles: '回收跟进', inventoryView: '库存查看', inventoryEdit: '库存编辑', rulesEdit: '规则与估值依据',
  profiles: '客户档案', reports: '报表', csView: '客服排班', staff: '员工', audit: '操作日志',
}
const list = ref<StaffUser[]>([])
async function toggle(u: StaffUser, v: boolean) { if (await run(() => api.setUserEnabled(u.username, v), v ? '已启用' : '已停用')) list.value = await api.listUsers() }
onMounted(async () => { list.value = await api.listUsers() })
</script>
