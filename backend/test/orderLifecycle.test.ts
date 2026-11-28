import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSeedDb } from '../src/domain/seedData'
import type { User } from '../src/domain/types'
import { ApiError } from '../src/errors'
import { Engine, toPublicUser } from '../src/engine'

const NOW = Date.parse('2026-11-27T04:00:00Z')
const DAY = 86400000

function setup(now = NOW) {
  const db = buildSeedDb(now)
  const eng = new Engine(() => now)
  const as = (username: string): User => toPublicUser(db.users.find((u) => u.username === username)!)
  return { db, eng, as }
}

describe('订单完成必须交号且还号', () => {
  it('待结算但未交号、未还号时不能完成，账号不会回到上架', () => {
    const { db, eng, as } = setup()
    const cs = as('cs')
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const order = eng.createOrder(db, cs, { accountId: acc.id, renterContact: 'wx_new', startAt: new Date(NOW).toISOString(), rentalDays: 2, deposit: 0, extraFee: 0, remark: '' })
    eng.endOrder(db, cs, order.id)
    assert.equal(acc.status, 'settling')
    assert.throws(() => eng.completeOrder(db, cs, order.id, true), (e: unknown) => {
      assert.ok(e instanceof ApiError)
      assert.equal(e.code, 409)
      assert.equal(e.errorCode, 'INVALID_TRANSITION')
      assert.match(e.message, /还号/)
      assert.match(e.message, /不能把账号放回上架/)
      return true
    })
    assert.equal(acc.status, 'settling')
    assert.throws(() => eng.markReturned(db, cs, order.id), /先登记交号/)
    eng.markHandover(db, cs, order.id)
    eng.markReturned(db, cs, order.id)
    const done = eng.completeOrder(db, cs, order.id, true, '测试结清')
    assert.equal(done.status, 'done')
    assert.equal(acc.status, 'listed')
  })
  it('已交号但未还号同样不能完成', () => {
    const { db, eng, as } = setup()
    const cs = as('cs')
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const order = eng.createOrder(db, cs, { accountId: acc.id, renterContact: 'wx_new', startAt: new Date(NOW).toISOString(), rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
    eng.markHandover(db, cs, order.id)
    eng.endOrder(db, cs, order.id)
    assert.throws(() => eng.completeOrder(db, cs, order.id, false), /还号/)
    assert.equal(acc.status, 'settling')
  })
})

describe('超期订单自动转入待结算', () => {
  it('过了结束时间后订单和账号变为待结算，不登记还号，也不上架', () => {
    const { db, eng, as } = setup()
    const cs = as('cs')
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const startAt = new Date(NOW).toISOString()
    const order = eng.createOrder(db, cs, { accountId: acc.id, renterContact: 'wx_late', startAt, rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
    assert.equal(eng.sweepExpiredOrders(db), 0)
    assert.equal(order.status, 'active')
    const later = new Engine(() => NOW + 2 * DAY)
    // 种子里还有一笔临近到期的租赁，拨快两天后会一起转入，所以只要求至少包含本单
    assert.ok(later.sweepExpiredOrders(db) >= 1)
    assert.equal(later.sweepExpiredOrders(db), 0)
    assert.equal(order.status, 'settling')
    assert.equal(order.returned, false)
    assert.equal(order.handedOver, false)
    assert.equal(acc.status, 'settling')
    assert.equal(order.events.at(-1)?.operator, 'system')
    assert.match(order.events.at(-1)?.note ?? '', /不会自动上架/)
    const view = later.listOrders(db, cs).find((o) => o.id === order.id)
    assert.equal(view?.status, 'settling')
    assert.equal(view?.reminder, 'overdue')
    assert.throws(() => later.completeOrder(db, cs, order.id, true), /不能把账号放回上架/)
    assert.equal(acc.status, 'settling')
    assert.equal(later.listListedAccounts(db, null).some((a) => a.id === acc.id), false)
  })
})
