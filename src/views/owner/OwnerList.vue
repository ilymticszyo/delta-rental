<template>
  <div class="page">
    <el-row :gutter="16">
      <el-col :span="15">
        <el-card shadow="never">
          <template #header><span class="card-title">上架新账号</span></template>
          <el-form label-width="110px">
            <el-form-item label="复用回收估值">
              <el-select v-model="reuseId" clearable placeholder="选择你提交过的一条回收估值，资产自动带入" style="width:100%" @change="applyReuse">
                <el-option v-for="r in recycles" :key="r.id" :value="r.id"
                  :label="`${r.requestNo} · ${r.asset.region} · 纯币 ${r.asset.coinAmount}M · ${r.asset.safeBox}格 · 皮肤 ${r.asset.skins.length}`" />
              </el-select>
            </el-form-item>
          </el-form>
          <el-alert v-if="reuseId" type="success" :closable="false" style="margin-bottom:12px" title="已复用回收估值里的资产，不需要再填；如要修改，请清空复用后手动填写。" />
          <fieldset :disabled="!!reuseId" style="border:none;padding:0;margin:0">
            <AssetForm ref="formRef" :m="f" :show-contact="false" />
          </fieldset>
          <el-form label-width="110px">
            <el-form-item label="辅助上号时段"><el-input v-model="assistTime" placeholder="如 09:00-23:00 / 全天" /></el-form-item>
            <el-form-item label="资产截图">
              <el-upload action="#" list-type="picture-card" :auto-upload="false" accept="image/*" :limit="5" v-model:file-list="files" :on-exceed="() => ElMessage.warning('最多 5 张')">
                <span style="font-size:24px">+</span>
              </el-upload>
              <div class="muted">最多 5 张，每张 ≤ 1MB（演示版保存在本浏览器）</div>
            </el-form-item>
            <el-form-item label="备注"><el-input v-model="remark" type="textarea" :rows="2" /></el-form-item>
            <div class="row-gap">
              <el-button size="large" @click="estimate">估算到手</el-button>
              <el-button type="primary" size="large" :disabled="est == null" @click="submit">提交上架（待运营确认）</el-button>
            </div>
            <p class="muted">说明：提交后进入「待确认」，运营人工核对后才会上架出租；出租参数（比例、渠道、周期）由运营按规则确定，到手金额以确认后为准。</p>
          </el-form>
        </el-card>
      </el-col>
      <el-col :span="9">
        <el-card shadow="never" header="预计到手">
          <el-result v-if="done" icon="success" title="已提交上架" :sub-title="`编号 ${done.accountNo}，状态：${done.ownerStatus}`">
            <template #extra><el-button type="primary" @click="$router.push(`/owner/accounts/${done.id}`)">查看</el-button></template>
          </el-result>
          <el-empty v-else-if="est == null" description="填好资产后点「估算到手」" />
          <div v-else style="text-align:center;padding:16px 0">
            <div class="muted">每个租期预计到手</div>
            <div class="money" style="font-size:34px">¥{{ est.takeHome }}</div>
            <div class="muted">规则 v{{ est.ruleVersion }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, type UploadUserFile } from 'element-plus'
import { api } from '../../api'
import { blankAsset } from '../../domain/assetDefaults'
import type { OwnerAccountView, RecycleRequest } from '../../domain/types'
import { run } from '../../utils'
import AssetForm from '../../components/AssetForm.vue'

const route = useRoute()
const f = reactive(blankAsset())
const formRef = ref<{ validate: () => Promise<boolean> }>()
const recycles = ref<RecycleRequest[]>([])
const reuseId = ref<string>('')
const assistTime = ref('全天')
const remark = ref('')
const files = ref<UploadUserFile[]>([])
const est = ref<{ takeHome: number; ruleVersion: number } | null>(null)
const done = ref<OwnerAccountView | null>(null)
watch(f, () => (est.value = null))
function applyReuse() {
  const r = recycles.value.find((x) => x.id === reuseId.value)
  if (r) Object.assign(f, JSON.parse(JSON.stringify(r.asset)))
}
async function estimate() {
  if (!reuseId.value && !(await formRef.value?.validate())) return
  const r = await run(() => api.ownerEstimate({ ...f, skins: [...f.skins] }))
  if (r) est.value = r
}
const toDataUrl = (file: File) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(file) })
async function submit() {
  const attachments: { name: string; dataUrl: string }[] = []
  for (const x of files.value) {
    if (!x.raw) continue
    if (x.raw.size > 1024 * 1024) return ElMessage.error(`${x.name} 超过 1MB`)
    attachments.push({ name: x.name, dataUrl: await toDataUrl(x.raw) })
  }
  const r = await run(() => api.ownerSubmitListing({ asset: { ...f, skins: [...f.skins] }, fromRecycleId: reuseId.value || undefined, assistTime: assistTime.value, remark: remark.value, attachments }), '已提交，等待运营确认')
  if (r) done.value = r
}
onMounted(async () => {
  recycles.value = (await api.myRecycles()).filter((r) => r.status !== 'cancelled' && !r.sourceAccountId)
  if (route.query.reuse) { reuseId.value = route.query.reuse as string; applyReuse() }
})
</script>
