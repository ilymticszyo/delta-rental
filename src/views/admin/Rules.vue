<template>
  <el-tabs v-model="tab" type="border-card">
    <el-tab-pane label="出租计价规则" name="pricing">
      <el-form v-if="pr" label-width="140px" size="small" style="max-width:860px">
        <el-form-item label="当前版本"><el-tag>v{{ pr.version }}</el-tag><span class="muted" style="margin-left:8px">保存后版本 +1，算价页立即走新规则；已入库账号报价在下次编辑保存时更新</span></el-form-item>
        <el-form-item label="渠道服务费率 %">
          <div v-for="(_, ch) in pr.channelFeeRates" :key="ch" class="row-gap" style="margin-right:16px">{{ ch }} <el-input-number v-model="pr.channelFeeRates[ch]" :min="0" :max="100" style="width:100px" /></div>
        </el-form-item>
        <el-form-item label="档位触发指标"><el-radio-group v-model="pr.triggerMetric"><el-radio value="coinAmount">纯币</el-radio><el-radio value="totalAssets">总资产</el-radio></el-radio-group></el-form-item>
        <el-form-item label="大额折扣档">
          <el-table :data="pr.discountTiers" size="small" style="width:520px">
            <el-table-column label="阈值(M) ≥"><template #default="{ row }"><el-input-number v-model="row.threshold" :min="0" style="width:110px" /></template></el-table-column>
            <el-table-column label="比例 +N"><template #default="{ row }"><el-input-number v-model="row.ratioPlus" :min="0" style="width:100px" /></template></el-table-column>
            <el-table-column label="折扣(%)"><template #default="{ row }"><el-input-number v-model="row.discount" :min="1" :max="100" style="width:100px" /></template></el-table-column>
            <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" @click="pr!.discountTiers.splice($index, 1)">删</el-button></template></el-table-column>
          </el-table>
          <el-button size="small" style="margin-top:6px" @click="pr.discountTiers.push({ threshold: 700, ratioPlus: 1, discount: 94 })">+ 添加档位</el-button>
        </el-form-item>
        <el-form-item label="自定义折扣范围"><el-input-number v-model="pr.customDiscountMin" :min="1" :max="100" /> – <el-input-number v-model="pr.customDiscountMax" :min="1" :max="100" /></el-form-item>
        <el-form-item label="出租天数计算">
          <el-radio-group v-model="pr.dayCalcMode"><el-radio value="byCycleRate">按周期速率（天数 = 纯币 ÷ M/天，向下取整，至少 1）</el-radio><el-radio value="fixedDays">固定租期（周期值即天数）</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="周期取值">
          <div v-for="(_, c) in pr.cycleValues" :key="c" class="row-gap" style="margin-right:16px">{{ c }} <el-input-number v-model="pr.cycleValues[c]" :min="1" style="width:90px" /></div>
        </el-form-item>
        <el-form-item label="附加服务费">
          <el-radio-group v-model="pr.extraFee.mode"><el-radio value="fixed">固定金额(元)</el-radio><el-radio value="percent">按租金比例(%)</el-radio></el-radio-group>
          <el-input-number v-model="pr.extraFee.value" :min="0" style="margin-left:10px" /><span class="muted" style="margin-left:8px">默认 0</span>
        </el-form-item>
        <el-form-item label="默认押金(元)"><el-input-number v-model="pr.defaultDeposit" :min="0" /><span class="muted" style="margin-left:8px">可为 0</span></el-form-item>
        <el-form-item><el-button type="primary" @click="savePr">保存计价规则</el-button><el-button @click="loadAll">放弃修改</el-button></el-form-item>
      </el-form>
    </el-tab-pane>

    <el-tab-pane label="回收估值规则" name="valuation">
      <el-row v-if="vr" :gutter="16">
        <el-col :span="14">
          <el-form label-width="140px" size="small">
            <el-form-item label="当前版本"><el-tag>v{{ vr.version }}</el-tag><span class="muted" style="margin-left:8px">已提交的回收单保留当时快照</span></el-form-item>
            <el-form-item label="回收比例 1:"><el-input-number v-model="vr.buyRatio" :min="1" /></el-form-item>
            <el-form-item label="回收折扣系数"><el-input-number v-model="vr.buyDiscount" :min="0" :max="1" :step="0.01" :precision="2" /></el-form-item>
            <el-form-item label="封禁系数"><el-input-number v-model="vr.banFactor" :min="0" :max="1" :step="0.05" :precision="2" />
              <el-checkbox v-model="vr.rejectIfBanned" style="margin-left:12px">有封禁则不出价，仅转人工</el-checkbox></el-form-item>
            <el-form-item label="区间浮动"><span>下浮</span><el-input-number v-model="vr.floatDown" :min="0" :max="1" :step="0.01" :precision="2" style="width:110px" />
              <span style="margin-left:8px">上浮</span><el-input-number v-model="vr.floatUp" :min="0" :max="1" :step="0.01" :precision="2" style="width:110px" /></el-form-item>
            <el-form-item label="皮肤类别单价(元)">
              <div v-for="(_, c) in vr.skinCategoryPrices" :key="c" class="row-gap" style="margin-right:12px">{{ c }} <el-input-number v-model="vr.skinCategoryPrices[c]" :min="0" style="width:100px" /></div>
            </el-form-item>
            <el-form-item label="其他加项单价(元)">
              <span>AWM</span><el-input-number v-model="vr.extraItemPrices.awm" :min="0" style="width:90px" />
              <span style="margin-left:6px">6头</span><el-input-number v-model="vr.extraItemPrices.helmet6" :min="0" style="width:90px" />
              <span style="margin-left:6px">6甲</span><el-input-number v-model="vr.extraItemPrices.armor6" :min="0" style="width:90px" />
              <span style="margin-left:6px">体验卡</span><el-input-number v-model="vr.extraItemPrices.experienceCard" :min="0" style="width:90px" />
            </el-form-item>
            <el-form-item><el-button type="primary" @click="saveVr">保存估值规则</el-button><el-button @click="loadAll">放弃修改</el-button></el-form-item>
          </el-form>
        </el-col>
        <el-col :span="10">
          <el-card shadow="never" header="试算（使用当前编辑中的规则）">
            <el-form label-width="80px" size="small">
              <el-form-item label="纯币(M)"><el-input-number v-model="sample.coinAmount" :min="0" /></el-form-item>
              <el-form-item label="皮肤"><el-select v-model="sample.skins" multiple style="width:100%"><el-option v-for="s in dicts.skins" :key="s.name" :label="s.name" :value="s.name" /></el-select></el-form-item>
              <el-form-item label="封禁"><el-switch v-model="sample.banRecord" /></el-form-item>
            </el-form>
            <div v-if="trial" style="text-align:center">
              <div v-if="trial.rejected" class="money">有封禁，转人工</div>
              <template v-else><div class="money" style="font-size:22px">¥{{ trial.min }} – ¥{{ trial.max }}</div><div class="muted">中枢 {{ trial.center }}</div></template>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </el-tab-pane>
  </el-tabs>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '../../api'
import { dicts, type PricingRule, type ValuationRule } from '../../config/rules'
import { calcValuation } from '../../domain/valuation'
import { run } from '../../utils'
const tab = ref('pricing')
const pr = ref<PricingRule>()
const vr = ref<ValuationRule>()
const sample = reactive({ contact: '试算', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 100, level: 30, rank: '黄金', safeBox: 4,
  skins: ['威龙·赤焰', '蜂医·霓虹'], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 })
const trial = computed(() => { try { return vr.value ? calcValuation({ ...sample, totalAssets: sample.coinAmount }, vr.value) : null } catch { return null } })
async function loadAll() { pr.value = await api.getPricingRule(); vr.value = await api.getValuationRule() }
async function savePr() { const r = await run(() => api.savePricingRule(pr.value!), '计价规则已保存'); if (r) pr.value = r }
async function saveVr() { const r = await run(() => api.saveValuationRule(vr.value!), '估值规则已保存'); if (r) vr.value = r }
onMounted(loadAll)
</script>
