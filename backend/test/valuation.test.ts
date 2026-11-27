import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultValuationRule } from '../src/domain/rules'
import { calcValuation, pickReferences } from '../src/domain/valuation'
import type { ValuationInput } from '../src/domain/types'

const base: ValuationInput = {
  contact: 'wx_test', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6,
  skins: ['威龙·赤焰', '蜂医·霓虹'], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0,
}

describe('回收估值（PRD 7.2）', () => {
  it('复现 PRD 示例：368，区间 350-386', () => {
    const r = calcValuation(base, defaultValuationRule)
    assert.equal(r.coinValue, 400)
    assert.equal(r.skinValue, 60)
    assert.equal(r.center, 368)
    assert.equal(r.min, 350)
    assert.equal(r.max, 386)
    assert.equal(r.ruleVersion, 1)
  })
  it('封禁系数 0.8', () => {
    const r = calcValuation({ ...base, banRecord: true }, defaultValuationRule)
    assert.equal(r.center, Math.round(460 * 0.8 * 0.8))
  })
  it('有封禁且仅转人工时不出价', () => {
    const r = calcValuation({ ...base, banRecord: true }, { ...defaultValuationRule, rejectIfBanned: true })
    assert.equal(r.rejected, true)
    assert.equal(r.center, 0)
  })
  it('市场系数与保险格系数参与中枢，参考成交价不改写中枢', () => {
    const r = calcValuation(base, { ...defaultValuationRule, marketCoefficient: 1.1, safeBoxFactors: { ...defaultValuationRule.safeBoxFactors, '6': 1.05 } })
    assert.equal(r.center, Math.round(460 * 0.8 * 1.05 * 1.1))
    const refs = defaultValuationRule.dealReferences.map((d) => ({ ...d, dealPrice: 99999 }))
    const shown = calcValuation(base, { ...defaultValuationRule, dealReferences: refs })
    assert.equal(shown.center, 368)
    assert.equal(shown.references.length, 3)
    assert.equal(shown.references[0].safeBox, 6)
  })
  it('停用的参考价不展示', () => {
    const refs = defaultValuationRule.dealReferences.map((d) => ({ ...d, enabled: d.id === 'd3' }))
    assert.deepEqual(pickReferences({ coinAmount: 100, safeBox: 6 }, refs).map((d) => d.id), ['d3'])
  })
})
