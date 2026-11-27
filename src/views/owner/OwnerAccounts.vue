<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="row-gap" style="justify-content:space-between">
          <span class="card-title">{{ isOwner ? '我的账号' : '号主门户（管理员查看全部）' }}</span>
          <el-button v-if="isOwner" type="primary" @click="$router.push('/owner/list')">上架新账号</el-button>
        </div>
      </template>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="这里只展示账号状态、到期时间与到手金额。租客信息、租金与平台抽成不对号主展示；有问题请线下联系客服。" />
      <el-row :gutter="12" style="margin-bottom:12px">
        <el-col :span="6"><el-card shadow="never"><div class="muted">账号数</div><div class="stat-num">{{ list.length }}</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="muted">空闲</div><div class="stat-num" style="color:#16a34a">{{ count('空闲') }}</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="muted">出租中</div><div class="stat-num" style="color:#d97706">{{ count('出租中') }}</div></el-card></el-col>
        <el-col :span="6"><el-card shadow="never"><div class="muted">待确认</div><div class="stat-num">{{ count('待确认') }}</div></el-card></el-col>
      </el-row>
      <el-table :data="list" border size="small" empty-text="还没有账号，点右上角「上架新账号」" @row-click="(r: OwnerAccountView) => $router.push(`/owner/accounts/${r.id}`)">
        <el-table-column prop="accountNo" label="编号" width="100" />
        <el-table-column v-if="!isOwner" prop="ownerName" label="号主" width="90" />
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag size="small" :type="ownerStatusType[row.ownerStatus as OwnerStatus]">{{ row.ownerStatus }}</el-tag></template></el-table-column>
        <el-table-column label="到期时间" width="150"><template #default="{ row }">{{ row.expireAt ? fmtTime(row.expireAt) : '—' }}</template></el-table-column>
        <el-table-column label="到手金额" width="170"><template #default="{ row }">
          <template v-if="row.ownerStatus === '已回收'">回收确认价 <b class="money">¥{{ row.recycle?.staffPrice ?? '-' }}</b></template>
          <template v-else><b class="money">¥{{ row.takeHome }}</b> / 租期</template>
        </template></el-table-column>
        <el-table-column label="回收" width="150"><template #default="{ row }">
          <span v-if="row.recycle">{{ RECYCLE_STATUS_LABEL[row.recycle.status as RecycleStatus] }} · {{ row.recycle.staffPrice ? '确认价 ' + row.recycle.staffPrice : row.recycle.rejected ? '人工评估' : `参考 ${row.recycle.min}-${row.recycle.max}` }}</span>
          <span v-else class="muted">—</span></template></el-table-column>
        <el-table-column label="资产" min-width="220"><template #default="{ row }">{{ row.region }} · 纯币 {{ row.coinAmount }}M · {{ row.safeBox }}格 · {{ row.rank }} · 皮肤 {{ row.skins.length }}</template></el-table-column>
        <el-table-column label="截图" width="60"><template #default="{ row }">{{ row.attachments.length }}</template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click.stop="$router.push(`/owner/accounts/${row.id}`)">详情</el-button></template></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import { RECYCLE_STATUS_LABEL, type OwnerAccountView, type OwnerStatus, type RecycleStatus } from '../../domain/types'
import { fmtTime } from '../../utils'
import { ownerStatusType } from './ownerUi'
const isOwner = api.currentUser()?.role === 'owner'
const list = ref<OwnerAccountView[]>([])
const count = (s: OwnerStatus) => list.value.filter((a) => a.ownerStatus === s).length
onMounted(async () => { list.value = await api.ownerAccounts() })
</script>
<style scoped>.stat-num { font-size: 24px; font-weight: 700; }</style>
