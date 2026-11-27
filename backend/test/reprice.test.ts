import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSeedDb } from '../src/domain/seedData'
import type { PricingRule } from '../src/domain/rules'
import type { User } from '../src/domain/types'
import { ApiError } from '../src/errors'
import { Engine, toPublicUser } from '../src/engine'

const NOW = Date.parse('2026-11-27T04:00:00Z')

function setup() {
  const db = buildSeedDb(NOW)
  const eng = new Engine(() => NOW)
  const as = (username: string): User => toPublicUser(db.users.find((u) => u.username === username)!)
  return { db, eng, as }
}

function cheaper(rule: PricingRule): PricingRule {
  const next = JSON.parse(JSON.stringify(rule)) as PricingRule
  next.discountTiers = [{ threshold: 0, ratioPlus: 0, discount: 50 }]
  return next
}

function snap(db: ReturnType<typeof buildSeedDb>) {
  return db.accounts.map((a) => [a.id, a.quote.coinRent, a.quote.renterRent, a.quote.ruleVersion, a.updatedAt])
}

describe('未租账号重算', () => {
  it('重算 draft/listed/off/held，跳过租赁中、待结算和算不出价的账号', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const rented = db.accounts.filter((a) => a.status === 'rented')
    const rentedBefore = rented.map((a) => ({ id: a.id, coinRent: a.quote.coinRent, ruleVersion: a.quote.ruleVersion }))
    const ordersBefore = db.orders.filter((o) => o.status === 'active').map((o) => ({ id: o.id, coinRent: o.coinRent, total: o.totalAmount }))
    const settling = db.accounts.find((a) => a.status === 'off')!
    settling.status = 'settling'
    const gone = db.accounts.find((a) => a.status === 'draft')!
    gone.deleted = true
    const held = db.accounts.find((a) => a.status === 'held')!
    const rule = cheaper(db.pricingRule)
    const preview = eng.previewPricingRule(db, admin, rule)
    const affected = new Set(preview.affected.map((a) => a.accountId))
    assert.equal(preview.baseVersion, 1)
    assert.equal(preview.nextVersion, 2)
    assert.match(preview.previewToken, /^pv1\.1\.[0-9a-f]{64}$/)
    assert.equal(preview.summary.affectedCount, preview.affected.length)
    assert.equal(preview.summary.skippedCount, preview.skipped.length)
    assert.equal(affected.has(held.id), true)
    assert.equal(affected.has(settling.id), false)
    assert.equal(affected.has(gone.id), false)
    for (const a of rented) assert.equal(affected.has(a.id), false)
    assert.ok(preview.skipped.some((s) => s.reason === 'RENTED' && s.accountId === rented[0].id))
    assert.ok(preview.skipped.some((s) => s.reason === 'SETTLING' && s.accountId === settling.id))
    for (const row of preview.affected) {
      assert.equal(Number.isInteger(row.oldPrice.coinRent), true)
      assert.equal(Number.isInteger(row.newPrice.renterRent), true)
      assert.equal(row.delta, row.newPrice.renterRent - row.oldPrice.renterRent)
    }
    assert.equal(eng.previewPricingRule(db, admin, rule).previewToken, preview.previewToken)
    assert.equal(db.pricingRule.version, 1)

    const applied = eng.savePricingRule(db, admin, rule, '半价', { baseVersion: preview.baseVersion, previewToken: preview.previewToken })
    assert.equal(applied.rule.version, 2)
    assert.equal(applied.repriced.affectedCount, preview.summary.affectedCount)
    assert.equal(db.pricingHistory[0].version, 2)
    for (const row of preview.affected) {
      const a = db.accounts.find((x) => x.id === row.accountId)!
      assert.equal(a.quote.renterRent, row.newPrice.renterRent)
      assert.equal(a.quote.ruleVersion, 2)
    }
    for (const before of rentedBefore) {
      const a = db.accounts.find((x) => x.id === before.id)!
      assert.equal(a.quote.coinRent, before.coinRent)
      assert.equal(a.quote.ruleVersion, before.ruleVersion)
    }
    assert.equal(settling.quote.ruleVersion, 1)
    for (const before of ordersBefore) {
      const o = db.orders.find((x) => x.id === before.id)!
      assert.equal(o.coinRent, before.coinRent)
      assert.equal(o.totalAmount, before.total)
    }
    assert.match(db.audit[0].summary, /v2/)
    assert.match(db.audit[0].summary, /半价/)
    const pv = eng.previewOrder(db, admin, rented[0].id, 'wx_renter_a')
    assert.equal(pv.coinRent, rentedBefore[0].coinRent)
  })

  it('新规则算不出价时跳过该账号，其余照常重算', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const broken = JSON.parse(JSON.stringify(db.pricingRule)) as PricingRule
    delete broken.channelFeeRates['普通区']
    const plain = db.accounts.find((a) => !a.deleted && a.status === 'listed' && a.channel === '普通区')!
    const before = plain.quote.coinRent
    const preview = eng.previewPricingRule(db, admin, broken)
    const skip = preview.skipped.find((s) => s.accountId === plain.id)
    assert.equal(skip?.reason, 'PRICING_ERROR')
    assert.ok(skip?.message)
    const applied = eng.savePricingRule(db, admin, broken, '去掉普通区', { baseVersion: preview.baseVersion, previewToken: preview.previewToken })
    assert.equal(applied.rule.version, 2)
    assert.equal(plain.quote.coinRent, before)
    assert.equal(plain.quote.ruleVersion, 1)
  })

  it('缺预览、过期预览和版本变化都不落库', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const rule = cheaper(db.pricingRule)
    const before = snap(db)
    const preview = eng.previewPricingRule(db, admin, rule)
    assert.throws(() => eng.previewPricingRule(db, as('cs'), rule), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.throws(() => eng.savePricingRule(db, admin, rule, 'x'), (e: unknown) => e instanceof ApiError && e.code === 422 && e.errorCode === 'VALIDATION_FAILED')
    const listed = db.accounts.find((a) => preview.affected.some((row) => row.accountId === a.id))!
    listed.updatedAt = '2000-01-01T00:00:00.000Z'
    assert.throws(() => eng.savePricingRule(db, admin, rule, 'x', { baseVersion: preview.baseVersion, previewToken: preview.previewToken }), (e: unknown) => {
      return e instanceof ApiError && e.code === 409 && e.errorCode === 'RULE_CONFLICT' && e.details?.reason === 'PREVIEW_STALE'
    })
    listed.updatedAt = before.find((row) => row[0] === listed.id)![4] as string
    const other = cheaper(db.pricingRule)
    other.defaultDeposit = rule.defaultDeposit + 10
    assert.throws(() => eng.savePricingRule(db, admin, other, 'x', { baseVersion: preview.baseVersion, previewToken: preview.previewToken }), (e: unknown) => {
      return e instanceof ApiError && e.errorCode === 'RULE_CONFLICT' && e.details?.reason === 'PREVIEW_STALE'
    })
    assert.throws(() => eng.savePricingRule(db, admin, rule, 'x', { baseVersion: preview.baseVersion + 1, previewToken: preview.previewToken }), (e: unknown) => {
      return e instanceof ApiError && e.errorCode === 'RULE_CONFLICT' && e.details?.reason === 'VERSION_CHANGED'
    })
    assert.equal(db.pricingRule.version, 1)
    assert.deepEqual(snap(db), before)
  })

  it('写日志失败时回滚规则版本和报价', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const rule = cheaper(db.pricingRule)
    const preview = eng.previewPricingRule(db, admin, rule)
    const before = snap(db)
    const history = db.pricingHistory.length
    const boom: typeof db.audit = []
    boom.unshift = () => { throw new Error('disk full') }
    db.audit = boom
    assert.throws(() => eng.savePricingRule(db, admin, rule, '会失败', { baseVersion: preview.baseVersion, previewToken: preview.previewToken }), (e: unknown) => e instanceof Error && e.message === 'disk full')
    assert.equal(db.pricingRule.version, 1)
    assert.equal(db.pricingHistory.length, history)
    assert.deepEqual(snap(db), before)
  })
})
