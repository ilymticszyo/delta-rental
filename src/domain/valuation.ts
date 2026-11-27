import type { ValuationRule } from '../config/rules'
import { skinCategory } from '../config/rules'
import type { DealReference, ValuationInput, ValuationResult, ValuationLine } from './types'

const r = (n: number) => Math.round(n)

export function validateValuationInput(input: ValuationInput): string[] {
  const errs: string[] = []
  if (!input.contact?.trim()) errs.push('请填写联系方式')
  if (!input.region) errs.push('请选择大区')
  if (!input.loginMethod) errs.push('请选择上号方式')
  if (!(input.coinAmount >= 0)) errs.push('纯币不能为负')
  if (!(input.totalAssets >= input.coinAmount)) errs.push('总资产不应小于纯币')
  return errs
}

export function skinUnitPrice(name: string, rule: ValuationRule): number {
  if (name in rule.skinPrices) return rule.skinPrices[name]
  return rule.skinCategoryPrices[skinCategory(name)] ?? 0
}

/** 近期同类成交：启用项中，同保险格优先，再按纯币接近程度取前 n 条 */
export function pickReferences(input: Pick<ValuationInput, 'coinAmount' | 'safeBox'>, refs: DealReference[], n = 3): DealReference[] {
  return refs
    .filter((d) => d.enabled)
    .map((d) => ({ d, score: (d.safeBox === input.safeBox ? 0 : 1000) + Math.abs(d.coinAmount - input.coinAmount) }))
    .sort((a, b) => a.score - b.score || a.d.sort - b.d.sort)
    .slice(0, n)
    .map((x) => ({ ...x.d }))
}

/** PRD 7.2 回收估值（v1.2：资产系数 + 整体市场系数 + 参考成交价） */
export function calcValuation(input: ValuationInput, rule: ValuationRule): ValuationResult {
  const errs = validateValuationInput(input)
  if (errs.length) throw new Error(errs.join('；'))
  const coinValue = (input.coinAmount * 100) / rule.buyRatio
  const skinValue = input.skins.reduce((s, k) => s + skinUnitPrice(k, rule), 0)
  const p = rule.extraItemPrices
  const extraValue =
    input.awmCount * p.awm +
    input.helmet6Count * p.helmet6 +
    input.armor6Count * p.armor6 +
    input.experienceCardCount * p.experienceCard +
    (rule.rankPrices[input.rank] ?? 0)
  const banFactor = input.banRecord ? rule.banFactor : 1
  const safeBoxFactor = rule.safeBoxFactors?.[String(input.safeBox)] ?? 1
  const marketCoefficient = rule.marketCoefficient ?? 1
  const rejected = input.banRecord && rule.rejectIfBanned
  const centerRaw = rejected ? 0 : (coinValue + skinValue + extraValue) * banFactor * safeBoxFactor * rule.buyDiscount * marketCoefficient
  const lines: ValuationLine[] = [
    { label: `纯币折算（${input.coinAmount}M ÷ 比例 1:${rule.buyRatio}）`, value: r(coinValue) },
    { label: `皮肤加价（${input.skins.length} 枚）`, value: r(skinValue) },
    { label: '其他加项（段位 / AWM / 6头 / 6甲 / 体验卡）', value: r(extraValue) },
  ]
  return {
    ruleVersion: rule.version,
    rejected,
    coinValue: r(coinValue),
    skinValue: r(skinValue),
    extraValue: r(extraValue),
    banFactor,
    safeBoxFactor,
    buyDiscount: rule.buyDiscount,
    marketCoefficient,
    references: pickReferences(input, rule.dealReferences ?? []),
    center: r(centerRaw),
    min: r(centerRaw * (1 - rule.floatDown)),
    max: r(centerRaw * (1 + rule.floatUp)),
    lines,
  }
}
