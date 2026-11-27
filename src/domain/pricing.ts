import type { PricingRule } from '../config/rules'
import type { PricingInput, PricingResult } from './types'

const r = (n: number) => Math.round(n)

export class PricingError extends Error {}

export function validatePricingInput(input: PricingInput, rule: PricingRule): string[] {
  const errs: string[] = []
  if (!(input.coinAmount > 0)) errs.push('纯币需大于 0')
  if (!(input.coinRatio > 0)) errs.push('纯币比例需大于 0')
  if (!(input.channel in rule.channelFeeRates)) errs.push('请选择上架渠道')
  if (!(input.cycle in rule.cycleValues)) errs.push('请选择周期')
  if (input.deposit < 0) errs.push('押金不能为负')
  if (input.discountMode === 'custom') {
    const d = input.customDiscountPercent
    if (d == null || !Number.isInteger(d) || d < rule.customDiscountMin || d > rule.customDiscountMax)
      errs.push(`自定义折扣需为 ${rule.customDiscountMin}-${rule.customDiscountMax} 的整数`)
  }
  return errs
}

/** PRD 7.1 出租计价。金额每步四舍五入到元。 */
export function calcPricing(input: PricingInput, rule: PricingRule): PricingResult {
  const errs = validatePricingInput(input, rule)
  if (errs.length) throw new PricingError(errs.join('；'))

  let usedRatio = input.coinRatio
  let discountPercent = 100
  let tierHit: string | null = null
  if (input.discountMode === 'system') {
    const metric = rule.triggerMetric === 'totalAssets' ? input.totalAssets : input.coinAmount
    const tier = [...rule.discountTiers].sort((a, b) => b.threshold - a.threshold).find((t) => metric >= t.threshold)
    if (tier) {
      usedRatio = input.coinRatio + tier.ratioPlus
      discountPercent = tier.discount
      tierHit = `${tier.threshold}M 档：比例 +${tier.ratioPlus}，${tier.discount} 折`
    }
  } else {
    discountPercent = input.customDiscountPercent!
  }

  const originalCoinRent = r((input.coinAmount * 100) / usedRatio)
  const coinRent = r((originalCoinRent * discountPercent) / 100)
  const serviceFeeRate = rule.channelFeeRates[input.channel]
  const serviceFee = r((coinRent * serviceFeeRate) / 100)
  const ownerSettlement = coinRent - serviceFee
  const extraFee = rule.extraFee.mode === 'fixed' ? r(rule.extraFee.value) : r((coinRent * rule.extraFee.value) / 100)
  const renterRent = coinRent + extraFee
  const deposit = r(input.deposit)
  const cycleValue = rule.cycleValues[input.cycle]
  const rentalDays =
    rule.dayCalcMode === 'byCycleRate' ? Math.max(1, Math.floor(input.coinAmount / cycleValue)) : Math.max(1, cycleValue)

  return {
    ruleVersion: rule.version,
    usedRatio,
    tierHit,
    discountPercent,
    originalCoinRent,
    coinRent,
    serviceFeeRate,
    serviceFee,
    ownerSettlement,
    extraFee,
    renterRent,
    deposit,
    totalAmount: renterRent + deposit,
    rentalDays,
  }
}

export function pricingToText(input: PricingInput, res: PricingResult, extra: Record<string, string | number> = {}): string {
  const lines = [
    '【三角洲行动 出租算价】',
    ...Object.entries(extra).map(([k, v]) => `${k}：${v}`),
    `纯币：${input.coinAmount}M  总资产：${input.totalAssets}M`,
    `比例：1:${input.coinRatio}（实际 1:${res.usedRatio}）  渠道：${input.channel}  周期：${input.cycle}`,
    `原租金：${res.originalCoinRent} 元  折扣：${res.discountPercent}  折后租金：${res.coinRent} 元`,
    `服务费（${res.serviceFeeRate}%）：${res.serviceFee} 元  号主可得：${res.ownerSettlement} 元`,
    `附加服务费：${res.extraFee} 元  押金：${res.deposit} 元  总金额：${res.totalAmount} 元`,
    `出租天数：${res.rentalDays} 天  规则版本：v${res.ruleVersion}`,
  ]
  return lines.join('\n')
}
