import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSeedDb } from '../src/domain/seedData'
import type { PricingRule } from '../src/domain/rules'
import type { RentalOrder, User } from '../src/domain/types'
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

function quoteSnap(db: ReturnType<typeof buildSeedDb>) {
  return db.accounts.map((a) => [a.id, a.quote.coinRent, a.quote.ruleVersion, a.quote.totalAmount, a.updatedAt, a.status])
}

describe('未租账号重算', () => {
  it('只重算未租且没有进行中订单的账号，租金是整数元', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const rented = db.accounts.filter((a) => a.status === 'rented')
    assert.ok(rented.length >= 1)
    const rentedBefore = rented.map((a) => ({ id: a.id, coinRent: a.quote.coinRent, ruleVersion: a.quote.ruleVersion, total: a.quote.totalAmount }))
    const orderBefore = db.orders.filter((o) => o.status === 'active').map((o) => ({ id: o.id, coinRent: o.coinRent, accountId: o.accountId }))
    assert.ok(orderBefore.length >= 1)

    const listedBusy = db.accounts.find((a) => a.status === 'listed')!
    const donor = db.orders.find((o) => o.status === 'active')!
    db.orders.push({ ...JSON.parse(JSON.stringify(donor)) as RentalOrder, id: 'o-busy', orderNo: 'ZDBUSY', accountId: listedBusy.id, status: 'active' })
    const busyBefore = listedBusy.quote.coinRent

    const settling = db.accounts.find((a) => a.status === 'off')!
    settling.status = 'settling'
    const settlingBefore = settling.quote.coinRent

    const gone = db.accounts.find((a) => a.status === 'draft')!
    gone.deleted = true
    const goneBefore = gone.quote.coinRent

    const held = db.accounts.find((a) => a.status === 'held' && a.id !== gone.id)!
    const rule = cheaper(db.pricingRule)
    const preview = eng.previewPricingReprice(db, admin, rule)
    const ids = new Set(preview.accounts.map((a) => a.id))

    assert.equal(preview.baseVersion, db.pricingRule.version)
    assert.equal(preview.fingerprint.length, 64)
    assert.equal(preview.count, preview.accounts.length)
    assert.equal(ids.has(listedBusy.id), false)
    assert.equal(ids.has(settling.id), false)
    assert.equal(ids.has(gone.id), false)
    for (const a of rented) assert.equal(ids.has(a.id), false)
    assert.equal(ids.has(held.id), true)
    assert.ok(preview.accounts.some((a) => a.delta !== 0))
    for (const row of preview.accounts) {
      assert.equal(Number.isInteger(row.oldPrice), true)
      assert.equal(Number.isInteger(row.newPrice), true)
      assert.equal(row.delta, row.newPrice - row.oldPrice)
      assert.ok(row.accountNo)
    }
    const again = eng.previewPricingReprice(db, admin, rule)
    assert.equal(again.fingerprint, preview.fingerprint)
    assert.equal(db.pricingRule.version, 1)

    const applied = eng.applyPricingReprice(db, admin, {
      rule, summary: '半价', confirm: true, baseVersion: preview.baseVersion, fingerprint: preview.fingerprint,
    })
    assert.equal(applied.fromVersion, 1)
    assert.equal(applied.toVersion, 2)
    assert.equal(applied.repriced, preview.count)
    assert.equal(applied.rule.version, 2)
    assert.equal(db.pricingHistory[0].version, 2)

    for (const row of preview.accounts) {
      const a = db.accounts.find((x) => x.id === row.id)!
      assert.equal(a.quote.coinRent, row.newPrice)
      assert.equal(a.quote.ruleVersion, 2)
      assert.equal(Number.isInteger(a.quote.coinRent), true)
    }
    for (const before of rentedBefore) {
      const a = db.accounts.find((x) => x.id === before.id)!
      assert.equal(a.quote.coinRent, before.coinRent)
      assert.equal(a.quote.ruleVersion, before.ruleVersion)
      assert.equal(a.quote.totalAmount, before.total)
    }
    for (const before of orderBefore) {
      const o = db.orders.find((x) => x.id === before.id)!
      assert.equal(o.coinRent, before.coinRent)
      assert.equal(o.accountId, before.accountId)
    }
    assert.equal(listedBusy.quote.coinRent, busyBefore)
    assert.equal(settling.quote.coinRent, settlingBefore)
    assert.equal(gone.quote.coinRent, goneBefore)
    assert.equal(listedBusy.quote.ruleVersion, 1)

    const log = db.audit[0]
    assert.equal(log.action, '计价规则')
    assert.match(log.summary, /v1 → v2/)
    assert.match(log.summary, new RegExp(`重算未租账号 ${preview.count} 个`))
    assert.match(log.summary, /租金变化 \d+ 个/)
    assert.match(log.summary, /半价/)

    const rentedId = rented[0].id
    const pv = eng.previewOrder(db, admin, rentedId, 'wx_renter_a')
    assert.equal(pv.coinRent, rentedBefore[0].coinRent)
  })

  it('直接保存规则不改库存报价', () => {
    const { db, eng, as } = setup()
    const before = quoteSnap(db)
    const saved = eng.savePricingRule(db, as('admin'), JSON.parse(JSON.stringify(db.pricingRule)), '只升版本')
    assert.equal(saved.version, 2)
    assert.deepEqual(quoteSnap(db), before)
  })

  it('客服不能预览或确认；未确认不落库', () => {
    const { db, eng, as } = setup()
    const rule = cheaper(db.pricingRule)
    const before = quoteSnap(db)
    assert.throws(() => eng.previewPricingReprice(db, as('cs'), rule), (e: unknown) => e instanceof ApiError && e.code === 403)
    const preview = eng.previewPricingReprice(db, as('ops'), rule)
    assert.throws(() => eng.applyPricingReprice(db, as('cs'), {
      rule, confirm: true, baseVersion: preview.baseVersion, fingerprint: preview.fingerprint,
    }), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.throws(() => eng.applyPricingReprice(db, as('admin'), {
      rule, confirm: false, baseVersion: preview.baseVersion, fingerprint: preview.fingerprint,
    }), (e: unknown) => e instanceof ApiError && e.code === 422 && e.errorCode === 'VALIDATION_FAILED')
    assert.equal(db.pricingRule.version, 1)
    assert.deepEqual(quoteSnap(db), before)
  })

  it('预览过期或规则正文变了返回 409 STALE_PREVIEW，报价不变', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const rule = cheaper(db.pricingRule)
    const preview = eng.previewPricingReprice(db, admin, rule)
    const before = quoteSnap(db)
    const listed = db.accounts.find((a) => preview.accounts.some((row) => row.id === a.id))!
    listed.updatedAt = '2000-01-01T00:00:00.000Z'
    assert.throws(() => eng.applyPricingReprice(db, admin, {
      rule, confirm: true, baseVersion: preview.baseVersion, fingerprint: preview.fingerprint,
    }), (e: unknown) => e instanceof ApiError && e.code === 409 && e.errorCode === 'STALE_PREVIEW')
    listed.updatedAt = before.find((row) => row[0] === listed.id)![4] as string

    const other = cheaper(db.pricingRule)
    other.defaultDeposit = rule.defaultDeposit + 10
    assert.throws(() => eng.applyPricingReprice(db, admin, {
      rule: other, confirm: true, baseVersion: preview.baseVersion, fingerprint: preview.fingerprint,
    }), (e: unknown) => e instanceof ApiError && e.code === 409 && e.errorCode === 'STALE_PREVIEW')
    assert.throws(() => eng.applyPricingReprice(db, admin, {
      rule, confirm: true, baseVersion: preview.baseVersion + 1, fingerprint: preview.fingerprint,
    }), (e: unknown) => e instanceof ApiError && e.code === 409 && e.errorCode === 'STALE_PREVIEW')
    assert.equal(db.pricingRule.version, 1)
    assert.deepEqual(quoteSnap(db), before)
  })

  it('算价失败或写日志失败时回滚，规则版本和报价都不变', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const before = quoteSnap(db)
    const history = db.pricingHistory.length
    const broken = JSON.parse(JSON.stringify(db.pricingRule)) as PricingRule
    delete broken.channelFeeRates['普通区']
    assert.throws(() => eng.previewPricingReprice(db, admin, broken), (e: unknown) => e instanceof ApiError && e.code === 422 && e.errorCode === 'VALIDATION_FAILED')
    assert.equal(db.pricingRule.version, 1)
    assert.deepEqual(quoteSnap(db), before)

    const rule = cheaper(db.pricingRule)
    const preview = eng.previewPricingReprice(db, admin, rule)
    const boom: typeof db.audit = []
    boom.unshift = () => { throw new Error('disk full') }
    db.audit = boom
    assert.throws(() => eng.applyPricingReprice(db, admin, {
      rule, summary: '会失败', confirm: true, baseVersion: preview.baseVersion, fingerprint: preview.fingerprint,
    }), (e: unknown) => e instanceof Error && e.message === 'disk full')
    assert.equal(db.pricingRule.version, 1)
    assert.equal(db.pricingHistory.length, history)
    assert.equal(db.pricingHistory[0].version, 1)
    assert.deepEqual(quoteSnap(db), before)
  })
})
