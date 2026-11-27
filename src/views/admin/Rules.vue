<template>
  <el-tabs v-model="tab" type="border-card">
    <el-tab-pane label="出租计价规则" name="pricing">
      <el-row v-if="pr" :gutter="16">
        <el-col :span="15">
          <el-form label-width="140px" size="small">
            <el-form-item label="当前版本"><el-tag>v{{ pr.version }}</el-tag><span class="muted" style="margin-left:8px">保存后版本 +1，算价页立即走新规则；未出租的库存账号自动按新规则重算报价，租赁中 / 待结算账号与已登记订单不变</span></el-form-item>
            <el-form-item label="渠道服务费率 %">
              <div v-for="(_, ch) in pr.channelFeeRates" :key="ch" class="row-gap" style="margin-right:16px">{{ ch }} <el-input-number v-model="pr.channelFeeRates[ch]" :min="0" :max="100" style="width:100px" /></div>
            </el-form-item>
            <el-form-item label="档位触发指标"><el-radio-group v-model="pr.triggerMetric"><el-radio value="coinAmount">纯币</el-radio><el-radio value="totalAssets">总资产</el-radio></el-radio-group></el-form-item>
            <el-form-item label="大额折扣档">
              <el-table :data="pr.discountTiers" size="small" style="width:480px">
                <el-table-column label="阈值(M) ≥"><template #default="{ row }"><el-input-number v-model="row.threshold" :min="0" style="width:100px" /></template></el-table-column>
                <el-table-column label="比例 +N"><template #default="{ row }"><el-input-number v-model="row.ratioPlus" :min="0" style="width:90px" /></template></el-table-column>
                <el-table-column label="折扣(%)"><template #default="{ row }"><el-input-number v-model="row.discount" :min="1" :max="100" style="width:90px" /></template></el-table-column>
                <el-table-column width="50"><template #default="{ $index }"><el-button link type="danger" @click="pr!.discountTiers.splice($index, 1)">删</el-button></template></el-table-column>
              </el-table>
              <el-button size="small" style="margin-top:6px" @click="pr.discountTiers.push({ threshold: 700, ratioPlus: 1, discount: 94 })">+ 添加档位</el-button>
            </el-form-item>
            <el-form-item label="自定义折扣范围"><el-input-number v-model="pr.customDiscountMin" :min="1" :max="100" /> – <el-input-number v-model="pr.customDiscountMax" :min="1" :max="100" /></el-form-item>
            <el-form-item label="出租天数计算">
              <el-radio-group v-model="pr.dayCalcMode"><el-radio value="byCycleRate">按周期速率</el-radio><el-radio value="fixedDays">固定租期</el-radio></el-radio-group>
            </el-form-item>
            <el-form-item label="周期取值"><div v-for="(_, c) in pr.cycleValues" :key="c" class="row-gap" style="margin-right:16px">{{ c }} <el-input-number v-model="pr.cycleValues[c]" :min="1" style="width:90px" /></div></el-form-item>
            <el-form-item label="附加服务费">
              <el-radio-group v-model="pr.extraFee.mode"><el-radio value="fixed">固定(元)</el-radio><el-radio value="percent">按租金(%)</el-radio></el-radio-group>
              <el-input-number v-model="pr.extraFee.value" :min="0" style="margin-left:10px" /><span class="muted" style="margin-left:8px">默认 0</span>
            </el-form-item>
            <el-form-item label="默认押金(元)"><el-input-number v-model="pr.defaultDeposit" :min="0" /></el-form-item>
            <el-divider content-position="left">熟客优惠（C4 / C12）</el-divider>
            <el-form-item label="熟客折扣 %"><el-input-number v-model="pr.regularDiscountPercent" :min="1" :max="100" /><span class="muted" style="margin-left:8px">100 = 不打折</span></el-form-item>
            <el-form-item label="与系统档叠加"><el-radio-group v-model="pr.regularMode"><el-radio value="best">取更优惠的一档</el-radio><el-radio value="multiply">在系统档上再乘</el-radio></el-radio-group></el-form-item>
            <el-form-item label="熟客免押金"><el-switch v-model="pr.regularWaiveDeposit" /></el-form-item>
            <el-divider content-position="left">号主上架默认出租参数 / 提醒</el-divider>
            <el-form-item label="默认比例 / 渠道 / 周期">
              <el-input-number v-model="pr.ownerDefaults.coinRatio" :min="1" style="width:110px" />
              <el-select v-model="pr.ownerDefaults.channel" style="width:110px;margin:0 6px"><el-option v-for="(_, c) in pr.channelFeeRates" :key="c" :value="c" /></el-select>
              <el-select v-model="pr.ownerDefaults.cycle" style="width:110px"><el-option v-for="(_, c) in pr.cycleValues" :key="c" :value="c" /></el-select>
            </el-form-item>
            <el-form-item label="到期提前提醒(小时)"><el-input-number v-model="pr.expiryRemindHours" :min="1" /></el-form-item>
            <el-form-item label="修改说明"><el-input v-model="prSummary" placeholder="写进版本记录，如：熟客折扣调到 93" /></el-form-item>
            <el-form-item><el-button type="primary" class="save-pricing" :loading="previewing" @click="savePr">保存计价规则（先预览受影响账号）</el-button><el-button @click="loadAll">放弃修改</el-button></el-form-item>
          </el-form>
        </el-col>
        <el-col :span="9">
          <el-card shadow="never" header="试算（使用编辑中的规则）">
            <el-form label-width="80px" size="small">
              <el-form-item label="纯币(M)"><el-input-number v-model="ps.coinAmount" :min="1" /></el-form-item>
              <el-form-item label="比例 1:"><el-input-number v-model="ps.coinRatio" :min="1" /></el-form-item>
              <el-form-item label="渠道"><el-select v-model="ps.channel"><el-option v-for="(_, c) in pr.channelFeeRates" :key="c" :value="c" /></el-select></el-form-item>
              <el-form-item label="押金"><el-input-number v-model="ps.deposit" :min="0" /></el-form-item>
              <el-form-item label="熟客"><el-switch v-model="ps.renterRegular" /></el-form-item>
              <el-button size="small" type="primary" @click="trialP">试算</el-button>
            </el-form>
            <el-descriptions v-if="pt" :column="1" border size="small" style="margin-top:8px">
              <el-descriptions-item label="折后租金">{{ pt.coinRent }}（{{ pt.discountPercent }}）</el-descriptions-item>
              <el-descriptions-item label="服务费">{{ pt.serviceFee }}</el-descriptions-item>
              <el-descriptions-item label="号主可得">{{ pt.ownerSettlement }}</el-descriptions-item>
              <el-descriptions-item label="押金 / 总额">{{ pt.deposit }} / {{ pt.totalAmount }}</el-descriptions-item>
              <el-descriptions-item label="天数">{{ pt.rentalDays }}</el-descriptions-item>
            </el-descriptions>
          </el-card>
          <el-card shadow="never" header="版本记录" style="margin-top:12px">
            <el-table :data="hist.pricing" size="small" max-height="260">
              <el-table-column label="版本" width="56"><template #default="{ row }">v{{ row.version }}</template></el-table-column>
              <el-table-column label="时间" width="130"><template #default="{ row }">{{ fmtTime(row.savedAt) }}</template></el-table-column>
              <el-table-column prop="savedBy" label="人" width="60" />
              <el-table-column prop="summary" label="说明" />
            </el-table>
          </el-card>
        </el-col>
      </el-row>
    </el-tab-pane>

    <el-tab-pane label="回收估值依据" name="valuation">
      <el-row v-if="vr" :gutter="16">
        <el-col :span="15">
          <el-form label-width="140px" size="small">
            <el-form-item label="当前版本"><el-tag>v{{ vr.version }}</el-tag><span class="muted" style="margin-left:8px">已提交的回收单保留当时快照（含系数）</span></el-form-item>
            <el-form-item label="整体市场系数"><el-input-number v-model="vr.marketCoefficient" :min="0.1" :max="3" :step="0.05" :precision="2" /><span class="muted" style="margin-left:8px">1.00 = 不调整；跟市场整体上浮 / 下调</span></el-form-item>
            <el-form-item label="回收比例 1:"><el-input-number v-model="vr.buyRatio" :min="1" /></el-form-item>
            <el-form-item label="回收折扣系数"><el-input-number v-model="vr.buyDiscount" :min="0" :max="1" :step="0.01" :precision="2" /></el-form-item>
            <el-form-item label="封禁系数"><el-input-number v-model="vr.banFactor" :min="0" :max="1" :step="0.05" :precision="2" />
              <el-checkbox v-model="vr.rejectIfBanned" style="margin-left:12px">有封禁则仅转人工</el-checkbox></el-form-item>
            <el-form-item label="区间浮动"><span>下浮</span><el-input-number v-model="vr.floatDown" :min="0" :max="1" :step="0.01" :precision="2" style="width:110px" />
              <span style="margin-left:8px">上浮</span><el-input-number v-model="vr.floatUp" :min="0" :max="1" :step="0.01" :precision="2" style="width:110px" /></el-form-item>
            <el-form-item label="资产系数：保险格">
              <div v-for="(_, k) in vr.safeBoxFactors" :key="k" class="row-gap" style="margin-right:12px">{{ k }}格 <el-input-number v-model="vr.safeBoxFactors[k]" :min="0" :step="0.05" :precision="2" style="width:100px" /></div>
            </el-form-item>
            <el-form-item label="皮肤类别单价(元)">
              <div v-for="(_, c) in vr.skinCategoryPrices" :key="c" class="row-gap" style="margin-right:12px">{{ c }} <el-input-number v-model="vr.skinCategoryPrices[c]" :min="0" style="width:100px" /></div>
            </el-form-item>
            <el-form-item label="其他加项单价(元)">
              <span>AWM</span><el-input-number v-model="vr.extraItemPrices.awm" :min="0" style="width:90px" />
              <span style="margin-left:6px">6头</span><el-input-number v-model="vr.extraItemPrices.helmet6" :min="0" style="width:90px" />
              <span style="margin-left:6px">6甲</span><el-input-number v-model="vr.extraItemPrices.armor6" :min="0" style="width:90px" />
              <span style="margin-left:6px">体验卡</span><el-input-number v-model="vr.extraItemPrices.experienceCard" :min="0" style="width:90px" />
            </el-form-item>
            <el-form-item label="近期成交参考价">
              <el-table :data="vr.dealReferences" size="small" style="width:100%">
                <el-table-column label="启用" width="54"><template #default="{ row }"><el-switch v-model="row.enabled" size="small" /></template></el-table-column>
                <el-table-column label="标题" min-width="150"><template #default="{ row }"><el-input v-model="row.title" size="small" /></template></el-table-column>
                <el-table-column label="纯币M" width="90"><template #default="{ row }"><el-input-number v-model="row.coinAmount" :min="0" size="small" :controls="false" style="width:70px" /></template></el-table-column>
                <el-table-column label="格" width="70"><template #default="{ row }"><el-input-number v-model="row.safeBox" :min="2" size="small" :controls="false" style="width:50px" /></template></el-table-column>
                <el-table-column label="成交价" width="90"><template #default="{ row }"><el-input-number v-model="row.dealPrice" :min="0" size="small" :controls="false" style="width:70px" /></template></el-table-column>
                <el-table-column label="日期" width="110"><template #default="{ row }"><el-input v-model="row.dealAt" size="small" /></template></el-table-column>
                <el-table-column width="44"><template #default="{ $index }"><el-button link type="danger" @click="vr!.dealReferences.splice($index, 1)">删</el-button></template></el-table-column>
              </el-table>
              <el-button size="small" style="margin-top:6px" @click="addRef">+ 添加参考成交</el-button>
              <div class="muted">参考价只展示给人工调价，不会改写中枢。</div>
            </el-form-item>
            <el-form-item label="修改说明"><el-input v-model="vrSummary" placeholder="写进版本记录，如：市场整体上浮 10%" /></el-form-item>
            <el-form-item><el-button type="primary" @click="saveVr">保存估值依据（生成新版本）</el-button><el-button @click="loadAll">放弃修改</el-button></el-form-item>
          </el-form>
        </el-col>
        <el-col :span="9">
          <el-card shadow="never" header="试算（使用编辑中的估值依据）">
            <el-form label-width="80px" size="small">
              <el-form-item label="纯币(M)"><el-input-number v-model="sample.coinAmount" :min="0" /></el-form-item>
              <el-form-item label="保险格"><el-select v-model="sample.safeBox"><el-option v-for="o in dicts.safeBoxes" :key="o" :value="o" /></el-select></el-form-item>
              <el-form-item label="皮肤"><el-select v-model="sample.skins" multiple style="width:100%"><el-option v-for="s in dicts.skins" :key="s.name" :label="s.name" :value="s.name" /></el-select></el-form-item>
              <el-form-item label="封禁"><el-switch v-model="sample.banRecord" /></el-form-item>
              <el-button size="small" type="primary" @click="trialV">试算</el-button>
            </el-form>
            <div v-if="vt" style="margin-top:8px">
              <div v-if="vt.rejected" class="money">有封禁，转人工</div>
              <template v-else><div class="money" style="font-size:22px">¥{{ vt.min }} – ¥{{ vt.max }}</div>
                <div class="muted">中枢 {{ vt.center }} · 市场系数 {{ vt.marketCoefficient }} · 保险格系数 {{ vt.safeBoxFactor }}</div></template>
              <div v-for="d in vt.references" :key="d.id" class="muted">参考：{{ d.title }} → ¥{{ d.dealPrice }}</div>
            </div>
          </el-card>
          <el-card shadow="never" header="版本记录" style="margin-top:12px">
            <el-table :data="hist.valuation" size="small" max-height="260">
              <el-table-column label="版本" width="56"><template #default="{ row }">v{{ row.version }}</template></el-table-column>
              <el-table-column label="时间" width="130"><template #default="{ row }">{{ fmtTime(row.savedAt) }}</template></el-table-column>
              <el-table-column prop="savedBy" label="人" width="60" />
              <el-table-column prop="summary" label="说明" />
            </el-table>
          </el-card>
        </el-col>
      </el-row>
    </el-tab-pane>
  </el-tabs>
  <el-dialog v-model="rpOpen" title="确认保存计价规则：按新规则重算库存" width="980px" class="reprice-dialog" :close-on-click-modal="false">
    <template v-if="rp">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:10px"
        :title="`v${rp.baseVersion} → v${rp.nextVersion}：重算 ${rp.summary.affectedCount} 个未出租账号（价格有变动 ${rp.summary.changedCount} 个），跳过 ${rp.summary.skippedCount} 个`"
        description="跳过的账号（租赁中 / 待结算 / 新规则下无法计价）保留原报价；所有已登记订单金额都不变。差额 = 新旧「租客应付」（折后租金 + 附加服务费，一个租期，不含押金）。" />
      <div class="row-gap" style="margin-bottom:6px">
        <span>租客应付合计差额：<b :class="deltaClass(rp.summary.totalDelta)" class="rp-total">{{ signed(rp.summary.totalDelta) }} 元/租期</b></span>
        <div style="flex:1" />
        <el-switch v-model="rpOnlyChanged" active-text="只看价格有变动的" />
      </div>
      <el-table :data="rpRows" size="small" max-height="340" class="rp-affected" empty-text="没有价格变动的账号">
        <el-table-column prop="accountNo" label="编号" width="90" />
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag size="small" :type="statusTagType[row.status]">{{ ACCOUNT_STATUS_LABEL[row.status as AccountStatus] }}</el-tag></template></el-table-column>
        <el-table-column label="规则" width="90"><template #default="{ row }">v{{ row.oldRuleVersion }} → v{{ rp!.nextVersion }}</template></el-table-column>
        <el-table-column label="折扣" width="90"><template #default="{ row }">{{ pair(row, 'discountPercent') }}</template></el-table-column>
        <el-table-column label="折后租金" width="110"><template #default="{ row }">{{ pair(row, 'coinRent') }}</template></el-table-column>
        <el-table-column label="租客应付" width="110"><template #default="{ row }">{{ pair(row, 'renterRent') }}</template></el-table-column>
        <el-table-column label="服务费" width="100"><template #default="{ row }">{{ pair(row, 'serviceFee') }}</template></el-table-column>
        <el-table-column label="号主可得" width="110"><template #default="{ row }">{{ pair(row, 'ownerSettlement') }}</template></el-table-column>
        <el-table-column label="天数" width="80"><template #default="{ row }">{{ pair(row, 'rentalDays') }}</template></el-table-column>
        <el-table-column label="差额"><template #default="{ row }"><b :class="deltaClass(row.delta)">{{ signed(row.delta) }}</b></template></el-table-column>
      </el-table>
      <template v-if="rp.skipped.length">
        <div style="margin:10px 0 6px">跳过（报价不变）：{{ rp.skipped.length }} 个</div>
        <el-table :data="rp.skipped" size="small" max-height="180" class="rp-skipped">
          <el-table-column prop="accountNo" label="编号" width="90" />
          <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag size="small" :type="statusTagType[row.status]">{{ ACCOUNT_STATUS_LABEL[row.status as AccountStatus] }}</el-tag></template></el-table-column>
          <el-table-column label="原因" width="140"><template #default="{ row }">{{ SKIP_LABEL[row.reason as RepriceSkipReason] ?? row.reason }}</template></el-table-column>
          <el-table-column label="保留报价" width="90"><template #default="{ row }">v{{ row.ruleVersion }}</template></el-table-column>
          <el-table-column prop="message" label="说明" />
        </el-table>
      </template>
    </template>
    <template #footer>
      <el-button @click="rpOpen = false">取消（不保存）</el-button>
      <el-button type="primary" class="rp-confirm" :loading="saving" @click="confirmSave">确认保存并重算 {{ rp?.summary.affectedCount ?? 0 }} 个账号</el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApiError } from '../../api/errors'
import type { PricingRulePreview, RepriceItem, RepricePrice, RepriceSkipReason } from '../../domain/reprice'
import { api } from '../../api'
import type { PricingRule, RuleVersionMeta, ValuationRule } from '../../config/rules'
import { dicts } from '../../config/dictStore'
import { ACCOUNT_STATUS_LABEL, type AccountStatus, type PricingResult, type ValuationResult } from '../../domain/types'
import { fmtTime, run, statusTagType } from '../../utils'
const tab = ref('pricing')
const pr = ref<PricingRule>()
const vr = ref<ValuationRule>()
const prSummary = ref('')
const vrSummary = ref('')
const hist = ref<{ pricing: RuleVersionMeta[]; valuation: RuleVersionMeta[] }>({ pricing: [], valuation: [] })
const ps = reactive({ coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: '普通区', discountMode: 'system' as const, cycle: '10M/天', deposit: 200, renterRegular: false })
const pt = ref<PricingResult>()
const sample = reactive({ contact: '试算', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 100, level: 30, rank: '黄金', safeBox: 6,
  skins: ['威龙·赤焰', '蜂医·霓虹'], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 })
const vt = ref<ValuationResult>()
async function loadAll() {
  pr.value = await api.getPricingRule(); vr.value = await api.getValuationRule(); hist.value = await api.ruleHistory()
  if (!Object.keys(pr.value.cycleValues).includes(ps.cycle)) ps.cycle = Object.keys(pr.value.cycleValues)[0]
}
const trialP = async () => { pt.value = await run(() => api.trialPricing({ ...ps }, pr.value!)) }
const trialV = async () => { vt.value = await run(() => api.trialValuation({ ...sample, totalAssets: sample.coinAmount, skins: [...sample.skins] }, vr.value!)) }
function addRef() {
  vr.value!.dealReferences.push({ id: `d${Date.now()}`, title: '新参考成交', assetSummary: '', coinAmount: 100, safeBox: 6, dealPrice: 300, dealAt: new Date().toISOString().slice(0, 10), enabled: true, sort: vr.value!.dealReferences.length + 1 })
}
// ---- 保存计价规则：先预览受影响账号 → 确认后带 baseVersion + previewToken 保存 ----
const SKIP_LABEL: Record<RepriceSkipReason, string> = { RENTED: '租赁中', SETTLING: '待结算', PRICING_ERROR: '新规则下无法计价' }
const rp = ref<PricingRulePreview>()
const rpOpen = ref(false)
const rpOnlyChanged = ref(true)
const previewing = ref(false)
const saving = ref(false)
const rpRows = computed(() => (rp.value?.affected ?? []).filter((x) => !rpOnlyChanged.value || x.changed))
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const deltaClass = (n: number) => (n > 0 ? 'delta-up' : n < 0 ? 'delta-down' : 'muted')
const pair = (row: RepriceItem, k: keyof RepricePrice) => (row.oldPrice[k] === row.newPrice[k] ? String(row.newPrice[k]) : `${row.oldPrice[k]} → ${row.newPrice[k]}`)
async function preview() {
  previewing.value = true
  try { rp.value = await api.previewPricingRule(pr.value!); rpOnlyChanged.value = rp.value.summary.changedCount > 0; rpOpen.value = true; return true }
  finally { previewing.value = false }
}
async function savePr() {
  try { await preview() } catch (e) {
    if (e instanceof ApiError && e.errorCode === 'NOT_SUPPORTED') {
      // 旧后端：没有预览也不重算，只能直接保存规则
      const ok = await ElMessageBox.confirm('后端暂未支持改价预览，保存后不会重算现有库存（只影响之后新建 / 编辑的账号）。仍要保存吗？', '后端暂未支持改价预览', { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '取消' }).catch(() => false)
      if (ok) await doSave()
      return
    }
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}
async function confirmSave() { await doSave({ baseVersion: rp.value!.baseVersion, previewToken: rp.value!.previewToken }) }
async function doSave(confirm?: { baseVersion: number; previewToken: string }) {
  saving.value = true
  try {
    const res = await api.savePricingRule(pr.value!, prSummary.value, confirm)
    rpOpen.value = false
    const s = res.repriced
    ElMessage.success(s ? `计价规则已保存为 v${res.rule.version}：重算 ${s.affectedCount} 个账号（变动 ${s.changedCount}），跳过 ${s.skippedCount} 个` : `计价规则已保存为 v${res.rule.version}（后端未重算现有库存）`)
    prSummary.value = ''
    await loadAll()
  } catch (e) {
    const reason = e instanceof ApiError ? (e.details?.reason as string | undefined) : undefined
    if (e instanceof ApiError && e.errorCode === 'RULE_CONFLICT' && reason === 'PREVIEW_STALE') {
      ElMessage.warning('预览之后库存有变化，已重新预览，请核对后再确认')
      await preview().catch((x) => ElMessage.error(x instanceof Error ? x.message : String(x)))
    } else if (e instanceof ApiError && (e.errorCode === 'RULE_CONFLICT' || e.errorCode === 'VERSION_CONFLICT')) {
      rpOpen.value = false
      await ElMessageBox.alert(`${e.message}。为避免覆盖别人的修改，请点「放弃修改」载入最新规则后重新调整。`, '规则已被他人修改', { type: 'warning' }).catch(() => {})
    } else ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally { saving.value = false }
}
async function saveVr() { const r = await run(() => api.saveValuationRule(vr.value!, vrSummary.value), '估值依据已保存为新版本'); if (r) { vrSummary.value = ''; await loadAll() } }
onMounted(loadAll)
</script>

<style scoped>
.delta-up { color: var(--el-color-danger) }
.delta-down { color: var(--el-color-success) }
</style>
