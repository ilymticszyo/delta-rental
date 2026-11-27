import { describe, it, expect } from 'vitest'
import { calcValuation } from '../src/domain/valuation'
import { defaultValuationRule } from '../src/config/rules'
import type { ValuationInput } from '../src/domain/types'

const base: ValuationInput = {
  contact: 'wx_test', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6,
  skins: ['威龙·赤焰', '蜂医·霓虹'], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0,
}

describe('回收估值（PRD 7.2）', () => {
  it('复现 PRD 示例：368，区间 350-386', () => {
    const r = calcValuation(base, defaultValuationRule)
    expect(r.coinValue).toBe(400)
    expect(r.skinValue).toBe(60)
    expect(r.center).toBe(368)
    expect(r.min).toBe(350)
    expect(r.max).toBe(386)
  })
  it('封禁系数 0.8', () => {
    const r = calcValuation({ ...base, banRecord: true }, defaultValuationRule)
    expect(r.center).toBe(Math.round(460 * 0.8 * 0.8))
  })
  it('有封禁且仅转人工时不出价', () => {
    const r = calcValuation({ ...base, banRecord: true }, { ...defaultValuationRule, rejectIfBanned: true })
    expect(r.rejected).toBe(true)
    expect(r.center).toBe(0)
  })
  it('单皮肤价覆盖类别价，其他加项计入', () => {
    const rule = { ...defaultValuationRule, skinPrices: { '威龙·赤焰': 100 }, extraItemPrices: { awm: 2, helmet6: 0, armor6: 0, experienceCard: 10 } }
    const r = calcValuation({ ...base, awmCount: 5, experienceCardCount: 1 }, rule)
    expect(r.skinValue).toBe(130)
    expect(r.extraValue).toBe(20)
  })
  it('必填校验', () => {
    expect(() => calcValuation({ ...base, contact: ' ' }, defaultValuationRule)).toThrow(/联系方式/)
  })
})
