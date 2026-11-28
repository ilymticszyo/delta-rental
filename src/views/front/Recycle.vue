<template>
  <div class="page">
    <el-alert v-if="sourceAccountNo" type="info" show-icon :closable="false" style="margin-bottom:12px"
      :title="`正在把你的账号 ${sourceAccountNo} 转入回收估值：资产已自动带入，确认后提交即可。`" />
    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header><span class="card-title">回收估值</span></template>
          <AssetForm ref="formRef" :m="f">
            <el-form-item label="备注"><el-input v-model="f.remark" type="textarea" :rows="2" /></el-form-item>
            <el-button type="primary" size="large" style="width:100%" @click="estimate">估价</el-button>
          </AssetForm>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never">
          <template #header><span class="card-title">估值结果</span></template>
          <el-result v-if="submitted" icon="success" title="已提交回收申请" :sub-title="`单号 ${submitted.requestNo}，当前状态：${RECYCLE_STATUS_LABEL[submitted.status]}。客服会尽快联系你。`">
            <template #extra><el-button @click="submitted = null; res = null">再估一个</el-button>
              <el-button v-if="frontLogin && isOwner" type="primary" @click="$router.push('/owner/accounts')">回到我的账号</el-button></template>
          </el-result>
          <el-empty v-else-if="!res" description="填写资产后点击「估价」" />
          <template v-else>
            <el-alert v-if="res.rejected" type="error" :closable="false" title="该账号有封禁记录，系统不出价，提交后由人工评估" />
            <div v-else style="text-align:center;margin:8px 0 14px">
              <div class="muted">参考区间（以客服确认为准）</div>
              <div class="money" style="font-size:30px">¥{{ res.min }} – ¥{{ res.max }}</div>
              <div class="muted">中枢 ¥{{ res.center }} · 估值依据 v{{ res.ruleVersion }}</div>
            </div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item v-for="l in res.lines" :key="l.label" :label="l.label">{{ l.value }} 元</el-descriptions-item>
              <el-descriptions-item label="封禁系数">× {{ res.banFactor }}</el-descriptions-item>
              <el-descriptions-item label="保险格系数">× {{ res.safeBoxFactor }}</el-descriptions-item>
              <el-descriptions-item label="回收折扣">× {{ res.buyDiscount }}</el-descriptions-item>
              <el-descriptions-item label="整体市场系数">× {{ res.marketCoefficient }}</el-descriptions-item>
            </el-descriptions>
            <div v-if="res.references.length" style="margin-top:10px">
              <div class="muted" style="margin-bottom:4px">近期同类成交参考（只供人工调价，不改变上面的区间）</div>
              <el-table :data="res.references" size="small">
                <el-table-column prop="title" label="成交" min-width="150" />
                <el-table-column prop="assetSummary" label="概况" min-width="110" />
                <el-table-column label="成交价" width="70"><template #default="{ row }">¥{{ row.dealPrice }}</template></el-table-column>
                <el-table-column prop="dealAt" label="日期" width="90" />
              </el-table>
            </div>
            <p class="muted">价格仅供参考，以人工确认为准。</p>
            <el-button v-if="canSubmit" type="success" style="width:100%" @click="submit">确认提交回收申请</el-button>
            <el-alert v-else type="info" :closable="false" show-icon style="margin-top:8px" title="提交回收请联系客服，可到「客服中心」扫码咨询。" />
          </template>
        </el-card>
        <el-card v-if="canSubmit" shadow="never" style="margin-top:12px" header="我的回收申请">
          <el-table :data="mine" size="small" empty-text="暂无">
            <el-table-column prop="requestNo" label="单号" width="90" />
            <el-table-column label="参考价"><template #default="{ row }">{{ row.result.rejected ? '人工评估' : `${row.result.min}-${row.result.max}` }}</template></el-table-column>
            <el-table-column label="确认价" width="70"><template #default="{ row }">{{ row.staffPrice ?? '-' }}</template></el-table-column>
            <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag size="small" :type="statusTagType[row.status]">{{ RECYCLE_STATUS_LABEL[row.status as RecycleStatus] }}</el-tag></template></el-table-column>
            <el-table-column label="提交时间" width="130"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api'
import { blankAsset } from '../../domain/assetDefaults'
import { RECYCLE_STATUS_LABEL, type RecycleRequest, type RecycleStatus, type ValuationResult } from '../../domain/types'
import { fmtTime, run, statusTagType } from '../../utils'
import AssetForm from '../../components/AssetForm.vue'
import { ENABLE_FRONT_LOGIN } from '../../config/frontLogin'

const route = useRoute()
const user = api.currentUser()
const isOwner = user?.role === 'owner'
const canSubmit = !!user
const frontLogin = ENABLE_FRONT_LOGIN
const f = reactive(blankAsset())
const formRef = ref<{ validate: () => Promise<boolean> }>()
const res = ref<ValuationResult | null>(null)
const submitted = ref<RecycleRequest | null>(null)
const mine = ref<RecycleRequest[]>([])
const sourceAccountId = ref<string>()
const sourceAccountNo = ref('')
watch(f, () => (res.value = null))
async function estimate() {
  if (!(await formRef.value?.validate())) return
  const r = await run(() => api.calcValuation({ ...f, skins: [...f.skins] }))
  if (r) { res.value = r; submitted.value = null }
}
async function submit() {
  const r = await run(() => api.submitRecycle({ ...f, skins: [...f.skins] }, { sourceAccountId: sourceAccountId.value }), '提交成功')
  if (r) { submitted.value = r; mine.value = await api.myRecycles() }
}
onMounted(async () => {
  if (!user) return
  const from = route.query.fromAccount as string | undefined
  if (from) {
    const draft = await run(() => api.ownerRecycleDraft(from))
    const view = await run(() => api.ownerAccount(from))
    if (draft && view) { Object.assign(f, draft); sourceAccountId.value = from; sourceAccountNo.value = view.accountNo; setTimeout(() => (res.value = null)) }
  }
  mine.value = await api.myRecycles()
})
</script>
