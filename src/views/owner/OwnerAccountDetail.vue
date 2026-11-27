<template>
  <div class="page" v-if="a">
    <el-page-header @back="$router.push('/owner/accounts')" :content="`我的账号 · ${a.accountNo}`" style="margin-bottom:12px" />
    <el-row :gutter="16">
      <el-col :span="9">
        <el-card shadow="never" header="状态与到手">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="状态"><el-tag :type="ownerStatusType[a.ownerStatus]">{{ a.ownerStatus }}</el-tag></el-descriptions-item>
            <el-descriptions-item label="到期时间">{{ a.expireAt ? fmtTime(a.expireAt) : '—' }}</el-descriptions-item>
            <el-descriptions-item v-if="a.takeHome != null" label="寄租到手"><span class="money" style="font-size:20px">¥{{ a.takeHome }}</span> / 每个租期</el-descriptions-item>
            <el-descriptions-item v-if="a.recycle" label="回收">
              {{ a.recycle.requestNo }} · {{ RECYCLE_STATUS_LABEL[a.recycle.status] }}<br />
              <span v-if="a.recycle.staffPrice">确认价 <b class="money">¥{{ a.recycle.staffPrice }}</b></span>
              <span v-else-if="a.recycle.rejected">人工评估中</span>
              <span v-else>参考价 ¥{{ a.recycle.min }} – ¥{{ a.recycle.max }}</span>
            </el-descriptions-item>
            <el-descriptions-item v-if="a.ownerName" label="号主">{{ a.ownerName }}</el-descriptions-item>
          </el-descriptions>
          <p class="muted">租客信息、租金与平台抽成不对号主展示。如有疑问请线下联系客服。</p>
          <el-button v-if="canTransfer" type="warning" style="width:100%" @click="$router.push(`/recycle?fromAccount=${a.id}`)">转入回收估值</el-button>
          <p v-else-if="isOwner" class="muted">{{ transferHint }}</p>
        </el-card>
      </el-col>
      <el-col :span="15">
        <el-card shadow="never" header="资产">
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="大区">{{ a.region }}</el-descriptions-item>
            <el-descriptions-item label="上号方式">{{ a.loginMethod }}</el-descriptions-item>
            <el-descriptions-item label="辅助时段">{{ a.assistTime }}</el-descriptions-item>
            <el-descriptions-item label="纯币">{{ a.coinAmount }} M</el-descriptions-item>
            <el-descriptions-item label="总资产">{{ a.totalAssets }} M</el-descriptions-item>
            <el-descriptions-item label="保险格">{{ a.safeBox }} 格</el-descriptions-item>
            <el-descriptions-item label="等级 / 段位">{{ a.level }} / {{ a.rank }}</el-descriptions-item>
            <el-descriptions-item label="AWM / 6头 / 6甲">{{ a.awmCount }} / {{ a.helmet6Count }} / {{ a.armor6Count }}</el-descriptions-item>
            <el-descriptions-item label="封禁记录">{{ a.banRecord ? '有' : '无' }}</el-descriptions-item>
            <el-descriptions-item label="皮肤" :span="3">{{ a.skins.join('、') || '无' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
        <el-card shadow="never" header="资产截图" style="margin-top:12px">
          <el-image v-for="x in a.attachments" :key="x.id" :src="x.dataUrl" :preview-src-list="a.attachments.map((y) => y.dataUrl)" fit="cover"
            style="width:120px;height:90px;margin:0 8px 8px 0;border-radius:6px" />
          <span v-if="!a.attachments.length" class="muted">未上传截图</span>
        </el-card>
      </el-col>
    </el-row>
  </div>
  <el-result v-else-if="err" icon="error" :title="err"><template #extra><el-button @click="$router.push('/owner/accounts')">返回我的账号</el-button></template></el-result>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api'
import { RECYCLE_STATUS_LABEL, type OwnerAccountView } from '../../domain/types'
import { fmtTime } from '../../utils'
import { ownerStatusType } from './ownerUi'
const route = useRoute()
const isOwner = api.currentUser()?.role === 'owner'
const a = ref<OwnerAccountView>()
const err = ref('')
const openRecycle = computed(() => !!a.value?.recycle && ['submitted', 'following', 'quoted'].includes(a.value.recycle.status))
const canTransfer = computed(() => isOwner && a.value && a.value.ownerStatus !== '已回收' && !openRecycle.value)
const transferHint = computed(() => (openRecycle.value ? '该账号已有进行中的回收申请' : a.value?.ownerStatus === '已回收' ? '该账号已回收' : ''))
onMounted(async () => { try { a.value = await api.ownerAccount(route.params.id as string) } catch (e: any) { err.value = e.message } })
</script>
