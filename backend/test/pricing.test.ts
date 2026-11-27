import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultPricingRule } from '../src/domain/rules'
import { calcPricing, PricingError } from '../src/domain/pricing'
import type { PricingInput } from '../src/domain/types'

const base: PricingInput = { coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', discountMode: 'system', cycle: '10M/天', deposit: 200 }

describe('出租计价（PRD 7.1）', () => {
  it('复现 PRD 示例：命中 300M 档，比例 +1，98 折', () => {
    const rule = { ...defaultPricingRule, triggerMetric: 'totalAssets' as const }
    const r = calcPricing(base, rule)
    assert.equal(r.usedRatio, 21)
    assert.equal(r.originalCoinRent, 476)
    assert.equal(r.coinRent, 466)
    assert.equal(r.serviceFee, 23)
    assert.equal(r.ownerSettlement, 443)
    assert.equal(r.extraFee, 0)
    assert.equal(r.totalAmount, 666)
    assert.equal(r.rentalDays, 10)
  })
  it('未触发档位不打折', () => {
    const r = calcPricing(base, defaultPricingRule)
    assert.equal(r.discountPercent, 100)
    assert.equal(r.originalCoinRent, 500)
    assert.equal(r.coinRent, 500)
    assert.equal(r.tierHit, null)
  })
  it('取最高命中档', () => {
    const r = calcPricing({ ...base, coinAmount: 650 }, defaultPricingRule)
    assert.equal(r.discountPercent, 95)
    assert.equal(r.usedRatio, 21)
  })
  it('自定义折扣与平台专区费率', () => {
    const r = calcPricing({ ...base, discountMode: 'custom', customDiscountPercent: 90, channel: '平台专区' }, defaultPricingRule)
    assert.equal(r.coinRent, 450)
    assert.equal(r.serviceFee, 45)
    assert.equal(r.ownerSettlement, 405)
  })
  it('自定义折扣越界报错', () => {
    assert.throws(() => calcPricing({ ...base, discountMode: 'custom', customDiscountPercent: 70 }, defaultPricingRule), PricingError)
  })
  it('熟客 best：未命中档位时用熟客折扣并免押金', () => {
    const r = calcPricing({ ...base, renterRegular: true }, defaultPricingRule)
    assert.equal(r.discountPercent, 95)
    assert.equal(r.coinRent, 475)
    assert.equal(r.regularDiscountApplied, true)
    assert.equal(r.deposit, 0)
    assert.equal(r.depositWaived, true)
  })
  it('熟客 best：系统档已更优惠时不再叠加', () => {
    const r = calcPricing({ ...base, coinAmount: 650, renterRegular: true }, defaultPricingRule)
    assert.equal(r.discountPercent, 95)
    assert.equal(r.regularDiscountApplied, false)
  })
  it('Q8：周期只决定天数，不改变租金；固定天数模式同样不折算租金', () => {
    const slow = calcPricing(base, defaultPricingRule)
    const fast = calcPricing({ ...base, cycle: '5M/天' }, defaultPricingRule)
    assert.equal(slow.coinRent, fast.coinRent)
    assert.equal(slow.originalCoinRent, 500)
    assert.equal(slow.rentalDays, 10)
    assert.equal(fast.rentalDays, 20)
    assert.equal(slow.ownerSettlement, slow.coinRent - slow.serviceFee)
    assert.equal(slow.renterRent, slow.coinRent + slow.extraFee)
    assert.equal(slow.totalAmount, slow.renterRent + slow.deposit)
    const fixed = calcPricing(base, { ...defaultPricingRule, dayCalcMode: 'fixedDays', cycleValues: { ...defaultPricingRule.cycleValues, '10M/天': 3 } })
    assert.equal(fixed.coinRent, slow.coinRent)
    assert.equal(fixed.rentalDays, 3)
    const tiny = calcPricing({ ...base, coinAmount: 3 }, defaultPricingRule)
    assert.equal(tiny.rentalDays, 1)
    assert.equal(tiny.originalCoinRent, Math.round((3 * 100) / 20))
  })
  it('熟客 multiply：在系统档基础上再乘', () => {
    const rule = { ...defaultPricingRule, triggerMetric: 'totalAssets' as const, regularMode: 'multiply' as const }
    const r = calcPricing({ ...base, renterRegular: true }, rule)
    assert.equal(r.coinRent, 443)
  })
})
