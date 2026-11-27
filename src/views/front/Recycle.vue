<template>
  <div class="page">
    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header><span class="card-title">回收估值</span></template>
          <el-form ref="formRef" :model="f" :rules="rules" label-width="110px">
            <el-row><el-col :span="12"><el-form-item label="联系方式" prop="contact"><el-input v-model="f.contact" placeholder="微信 / QQ / 手机" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="大区" prop="region"><el-select v-model="f.region"><el-option v-for="o in dicts.regions" :key="o" :value="o" /></el-select></el-form-item></el-col></el-row>
            <el-row><el-col :span="12"><el-form-item label="上号方式" prop="loginMethod"><el-select v-model="f.loginMethod"><el-option v-for="o in dicts.loginMethods" :key="o" :value="o" /></el-select></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="段位"><el-select v-model="f.rank"><el-option v-for="o in dicts.ranks" :key="o" :value="o" /></el-select></el-form-item></el-col></el-row>
            <el-row><el-col :span="12"><el-form-item label="纯币(M)" prop="coinAmount"><el-input-number v-model="f.coinAmount" :min="0" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="总资产(M)" prop="totalAssets"><el-input-number v-model="f.totalAssets" :min="0" /></el-form-item></el-col></el-row>
            <el-row><el-col :span="12"><el-form-item label="等级"><el-input-number v-model="f.level" :min="1" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="保险格数"><el-select v-model="f.safeBox"><el-option v-for="o in dicts.safeBoxes" :key="o" :label="o + ' 格'" :value="o" /></el-select></el-form-item></el-col></el-row>
            <el-row><el-col :span="6"><el-form-item label="AWM" label-width="60px"><el-input-number v-model="f.awmCount" :min="0" style="width:120px" /></el-form-item></el-col>
              <el-col :span="6"><el-form-item label="6头" label-width="50px"><el-input-number v-model="f.helmet6Count" :min="0" style="width:120px" /></el-form-item></el-col>
              <el-col :span="6"><el-form-item label="6甲" label-width="50px"><el-input-number v-model="f.armor6Count" :min="0" style="width:120px" /></el-form-item></el-col>
              <el-col :span="6"><el-form-item label="体验卡" label-width="60px"><el-input-number v-model="f.experienceCardCount" :min="0" style="width:120px" /></el-form-item></el-col></el-row>
            <el-form-item label="皮肤"><el-select v-model="f.skins" multiple filterable style="width:100%"><el-option v-for="s in dicts.skins" :key="s.name" :label="`${s.name}（${s.category}）`" :value="s.name" /></el-select></el-form-item>
            <el-form-item label="封禁记录"><el-switch v-model="f.banRecord" active-text="有" inactive-text="无" /></el-form-item>
            <el-form-item label="备注"><el-input v-model="f.remark" type="textarea" :rows="2" /></el-form-item>
            <el-button type="primary" size="large" style="width:100%" @click="estimate">估价</el-button>
          </el-form>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never">
          <template #header><span class="card-title">估值结果</span></template>
          <el-result v-if="submitted" icon="success" title="已提交回收申请" :sub-title="`单号 ${submitted.requestNo}，当前状态：${RECYCLE_STATUS_LABEL[submitted.status]}。客服会尽快联系你。`">
            <template #extra><el-button @click="submitted = null; res = null">再估一个</el-button></template>
          </el-result>
          <el-empty v-else-if="!res" description="填写资产后点击「估价」" />
          <template v-else>
            <el-alert v-if="res.rejected" type="error" :closable="false" title="该账号有封禁记录，系统不出价，提交后由人工评估" />
            <div v-else style="text-align:center;margin:8px 0 14px">
              <div class="muted">参考区间（以客服确认为准）</div>
              <div class="money" style="font-size:30px">¥{{ res.min }} – ¥{{ res.max }}</div>
              <div class="muted">中枢 ¥{{ res.center }} · 规则 v{{ res.ruleVersion }}</div>
            </div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item v-for="l in res.lines" :key="l.label" :label="l.label">{{ l.value }} 元</el-descriptions-item>
              <el-descriptions-item label="封禁系数">× {{ res.banFactor }}</el-descriptions-item>
              <el-descriptions-item label="回收折扣">× {{ res.buyDiscount }}</el-descriptions-item>
            </el-descriptions>
            <p class="muted">价格仅供参考，以人工确认为准。</p>
            <el-button type="success" style="width:100%" @click="submit">确认提交回收申请</el-button>
          </template>
        </el-card>
        <el-card shadow="never" style="margin-top:12px" header="我的回收申请">
          <el-table :data="mine" size="small" empty-text="暂无">
            <el-table-column prop="requestNo" label="单号" width="90" />
            <el-table-column label="参考价"><template #default="{ row }">{{ row.result.rejected ? '人工评估' : `${row.result.min}-${row.result.max}` }}</template></el-table-column>
            <el-table-column label="客服报价" width="80"><template #default="{ row }">{{ row.staffPrice ?? '-' }}</template></el-table-column>
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
import type { FormInstance } from 'element-plus'
import { api } from '../../api'
import { dicts } from '../../config/rules'
import { RECYCLE_STATUS_LABEL, type RecycleRequest, type RecycleStatus, type ValuationResult } from '../../domain/types'
import { fmtTime, run, statusTagType } from '../../utils'

const f = reactive({ contact: '', region: '', loginMethod: '', coinAmount: 100, totalAssets: 150, level: 30, rank: '黄金', safeBox: 4,
  skins: [] as string[], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0, remark: '' })
const req = (m: string) => [{ required: true, message: m, trigger: 'change' }]
const rules = { contact: req('请填写联系方式'), region: req('请选择大区'), loginMethod: req('请选择上号方式'),
  totalAssets: [{ validator: (_: any, v: number, cb: any) => (v >= f.coinAmount ? cb() : cb(new Error('总资产不应小于纯币'))), trigger: 'change' }] }
const formRef = ref<FormInstance>()
const res = ref<ValuationResult | null>(null)
const submitted = ref<RecycleRequest | null>(null)
const mine = ref<RecycleRequest[]>([])
watch(f, () => (res.value = null))
async function estimate() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  const r = await run(() => api.calcValuation({ ...f, skins: [...f.skins] }))
  if (r) { res.value = r; submitted.value = null }
}
async function submit() {
  const r = await run(() => api.submitRecycle({ ...f, skins: [...f.skins] }), '提交成功')
  if (r) { submitted.value = r; mine.value = await api.myRecycles() }
}
onMounted(async () => { mine.value = await api.myRecycles() })
</script>
