<template>
  <div class="page">
    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header><span class="card-title">出租精准算价</span></template>
          <el-form ref="formRef" :model="f" :rules="rules" label-width="110px" size="default">
            <el-divider content-position="left">联系与上号</el-divider>
            <el-row><el-col :span="12"><el-form-item label="号主联系方式" prop="ownerContact"><el-input v-model="f.ownerContact" placeholder="微信 / QQ / 手机" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="大区" prop="region"><el-select v-model="f.region"><el-option v-for="o in dicts.regions" :key="o" :value="o" /></el-select></el-form-item></el-col></el-row>
            <el-row><el-col :span="12"><el-form-item label="上号方式" prop="loginMethod"><el-select v-model="f.loginMethod"><el-option v-for="o in dicts.loginMethods" :key="o" :value="o" /></el-select></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="辅助上号时段" prop="assistTime"><el-input v-model="f.assistTime" placeholder="如 09:00-23:00 / 全天" /></el-form-item></el-col></el-row>
            <el-divider content-position="left">资产</el-divider>
            <el-row><el-col :span="12"><el-form-item label="纯币(M)" prop="coinAmount"><el-input-number v-model="f.coinAmount" :min="0" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="总资产(M)" prop="totalAssets"><el-input-number v-model="f.totalAssets" :min="0" /></el-form-item></el-col></el-row>
            <el-row><el-col :span="8"><el-form-item label="保险格数"><el-select v-model="f.safeBox"><el-option v-for="o in dicts.safeBoxes" :key="o" :label="o + ' 格'" :value="o" /></el-select></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="AWM"><el-input-number v-model="f.awmCount" :min="0" style="width:110px" /></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="6头 / 6甲"><el-input-number v-model="f.helmet6Count" :min="0" style="width:90px" /> <el-input-number v-model="f.armor6Count" :min="0" style="width:90px" /></el-form-item></el-col></el-row>
            <el-form-item label="皮肤"><el-select v-model="f.skins" multiple filterable style="width:100%"><el-option v-for="s in dicts.skins" :key="s.name" :label="`${s.name}（${s.category}）`" :value="s.name" /></el-select></el-form-item>
            <el-divider content-position="left">出租参数</el-divider>
            <el-row><el-col :span="12"><el-form-item label="纯币比例 1:" prop="coinRatio"><el-input-number v-model="f.coinRatio" :min="1" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="上架渠道" prop="channel"><el-select v-model="f.channel"><el-option v-for="o in channels" :key="o" :value="o" /></el-select></el-form-item></el-col></el-row>
            <el-row><el-col :span="12"><el-form-item label="周期" prop="cycle"><el-select v-model="f.cycle"><el-option v-for="o in cycles" :key="o" :value="o" /></el-select></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="押金(元)"><el-input-number v-model="f.deposit" :min="0" /></el-form-item></el-col></el-row>
            <el-form-item label="折扣">
              <el-radio-group v-model="f.discountMode"><el-radio value="system">系统推荐</el-radio><el-radio value="custom">自定义</el-radio></el-radio-group>
              <el-input-number v-if="f.discountMode === 'custom'" v-model="f.customDiscountPercent" :min="rule?.customDiscountMin" :max="rule?.customDiscountMax" style="margin-left:12px" />
            </el-form-item>
            <el-button type="primary" size="large" @click="calc" style="width:100%">立即精准计算</el-button>
            <p class="muted">说明：算价结果按当前后台规则计算，仅作号主报价与录入参考；成交在线下完成，最终以客服确认为准。</p>
          </el-form>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never" style="position:sticky;top:12px">
          <template #header><span class="card-title">计算结果</span></template>
          <el-empty v-if="!res" description="填写左侧表单后点击「立即精准计算」" />
          <template v-else>
            <el-descriptions :column="1" border>
              <el-descriptions-item label="号主可得"><span class="money" style="font-size:20px">¥{{ res.ownerSettlement }}</span></el-descriptions-item>
              <el-descriptions-item label="原租金">{{ res.originalCoinRent }} 元（实际比例 1:{{ res.usedRatio }}）</el-descriptions-item>
              <el-descriptions-item label="折后租金">{{ res.coinRent }} 元（{{ res.discountPercent }}{{ res.tierHit ? '，' + res.tierHit : '' }}）</el-descriptions-item>
              <el-descriptions-item label="服务费">{{ res.serviceFee }} 元（{{ res.serviceFeeRate }}%）</el-descriptions-item>
              <el-descriptions-item label="附加服务费">{{ res.extraFee }} 元</el-descriptions-item>
              <el-descriptions-item label="押金">{{ res.deposit }} 元</el-descriptions-item>
              <el-descriptions-item label="租客总金额">{{ res.totalAmount }} 元</el-descriptions-item>
              <el-descriptions-item label="出租天数">{{ res.rentalDays }} 天</el-descriptions-item>
              <el-descriptions-item label="规则版本">v{{ res.ruleVersion }}</el-descriptions-item>
            </el-descriptions>
            <pre class="copy">{{ text }}</pre>
            <el-button type="primary" @click="copy(text)">一键复制算价信息</el-button>
            <span class="muted" style="margin-left:8px">可粘贴到后台「账号库存 → 新增」</span>
          </template>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { FormInstance } from 'element-plus'
import { api } from '../../api'
import { dicts, type PricingRule } from '../../config/rules'
import { pricingToText } from '../../domain/pricing'
import type { PricingResult } from '../../domain/types'
import { copy, run } from '../../utils'

const rule = ref<PricingRule>()
const channels = computed(() => Object.keys(rule.value?.channelFeeRates ?? {}))
const cycles = computed(() => Object.keys(rule.value?.cycleValues ?? {}))
const f = reactive({
  ownerContact: '', region: '', loginMethod: '', assistTime: '全天', coinAmount: 100, totalAssets: 150, safeBox: 6, awmCount: 0,
  helmet6Count: 0, armor6Count: 0, skins: [] as string[], coinRatio: 20, channel: '普通区', cycle: '10M/天', deposit: 0,
  discountMode: 'system' as 'system' | 'custom', customDiscountPercent: 95,
})
const req = (m: string) => [{ required: true, message: m, trigger: 'change' }]
const rules = { ownerContact: req('请填写号主联系方式'), region: req('请选择大区'), loginMethod: req('请选择上号方式'), assistTime: req('请填写辅助上号时段'),
  coinAmount: [{ validator: (_: any, v: number, cb: any) => (v > 0 ? cb() : cb(new Error('纯币需大于 0'))), trigger: 'change' }],
  coinRatio: req('请填写比例'), channel: req('请选择渠道'), cycle: req('请选择周期') }
const formRef = ref<FormInstance>()
const res = ref<PricingResult | null>(null)
watch(f, () => (res.value = null)) // 改表单后需重新计算
const text = computed(() => (res.value ? pricingToText(f, res.value, {
  号主联系方式: f.ownerContact, 大区: f.region, 上号方式: f.loginMethod, 辅助时段: f.assistTime, 保险格: `${f.safeBox}格`,
  'AWM/6头/6甲': `${f.awmCount}/${f.helmet6Count}/${f.armor6Count}`, 皮肤: f.skins.join('、') || '无' }) : ''))
async function calc() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  const r = await run(() => api.calcPricing({ ...f }))
  if (r) res.value = r
}
onMounted(async () => { rule.value = await api.getPricingRule() })
</script>
