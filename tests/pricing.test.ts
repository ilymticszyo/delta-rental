import { describe, it, expect } from 'vitest'
import { calcPricing, PricingError } from '../src/domain/pricing'
import { defaultPricingRule } from '../src/config/rules'
import type { PricingInput } from '../src/domain/types'

const base: PricingInput = { coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', discountMode: 'system', cycle: '10M/天', deposit: 200 }

describe('出租计价（PRD 7.1）', () => {
  it('复现 PRD 示例：命中 300M 档，比例 +1，98 折', () => {
    const rule = { ...defaultPricingRule, triggerMetric: 'totalAssets' as const }
    const r = calcPricing(base, rule)
    expect(r.usedRatio).toBe(21)
    expect(r.originalCoinRent).toBe(476)
    expect(r.coinRent).toBe(466)
    expect(r.serviceFee).toBe(23)
    expect(r.ownerSettlement).toBe(443)
    expect(r.extraFee).toBe(0)
    expect(r.totalAmount).toBe(666)
    expect(r.rentalDays).toBe(10)
  })
  it('未触发档位不打折', () => {
    const r = calcPricing(base, defaultPricingRule)
    expect(r.discountPercent).toBe(100)
    expect(r.originalCoinRent).toBe(500)
    expect(r.coinRent).toBe(500)
    expect(r.tierHit).toBeNull()
  })
  it('取最高命中档', () => {
    const r = calcPricing({ ...base, coinAmount: 650 }, defaultPricingRule)
    expect(r.discountPercent).toBe(95)
    expect(r.usedRatio).toBe(21)
  })
  it('自定义折扣与平台专区费率', () => {
    const r = calcPricing({ ...base, discountMode: 'custom', customDiscountPercent: 90, channel: '平台专区' }, defaultPricingRule)
    expect(r.coinRent).toBe(450)
    expect(r.serviceFee).toBe(45)
    expect(r.ownerSettlement).toBe(405)
  })
  it('自定义折扣越界报错', () => {
    expect(() => calcPricing({ ...base, discountMode: 'custom', customDiscountPercent: 70 }, defaultPricingRule)).toThrow(PricingError)
  })
  it('押金可为 0，附加费默认 0', () => {
    const r = calcPricing({ ...base, deposit: 0 }, defaultPricingRule)
    expect(r.totalAmount).toBe(r.coinRent)
  })
  it('附加费按比例、固定天数模式', () => {
    const rule = { ...defaultPricingRule, extraFee: { mode: 'percent' as const, value: 10 }, dayCalcMode: 'fixedDays' as const }
    const r = calcPricing(base, rule)
    expect(r.extraFee).toBe(50)
    expect(r.rentalDays).toBe(10)
  })
  it('天数至少 1 天', () => {
    expect(calcPricing({ ...base, coinAmount: 3 }, defaultPricingRule).rentalDays).toBe(1)
  })
  it('相同入参结果一致', () => {
    expect(calcPricing(base, defaultPricingRule)).toEqual(calcPricing(base, defaultPricingRule))
  })
})

import { pricingToText } from '../src/domain/pricing'
import { parsePricingText } from '../src/domain/parsePricingText'
describe('算价文本可被后台解析', () => {
  it('往返', () => {
    const res = calcPricing(base, defaultPricingRule)
    const text = pricingToText(base, res, { 号主联系方式: 'wx_abc', 大区: 'QQ区', 上号方式: '扫码', 辅助时段: '全天', 保险格: '6格', 'AWM/6头/6甲': '1/2/3', 皮肤: '威龙·赤焰、龙牙战刀' })
    const p = parsePricingText(text)
    expect(p).toMatchObject({ ownerContact: 'wx_abc', region: 'QQ区', coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', cycle: '10M/天', safeBox: 6, deposit: 200, awmCount: 1, helmet6Count: 2, armor6Count: 3, skins: ['威龙·赤焰', '龙牙战刀'] })
  })
})
