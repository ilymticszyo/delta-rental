import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { templateAoa } from '../src/domain/importAccounts'
import { buildSeedDb } from '../src/domain/seedData'
import type { User, ValuationInput } from '../src/domain/types'
import { FORBIDDEN_OWNER_KEYS } from '../src/domain/visibility'
import { ApiError } from '../src/errors'
import { Engine, toPublicUser } from '../src/engine'

const NOW = Date.parse('2026-11-27T04:00:00Z')
const same = (stored: string, plain: string) => stored === plain
const asset = (over: Partial<ValuationInput> = {}): ValuationInput => ({
  contact: 'wx_s', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6,
  skins: ['威龙·赤焰', '蜂医·霓虹'], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0, ...over,
})

function setup() {
  const db = buildSeedDb(NOW)
  const eng = new Engine(() => NOW)
  const as = (username: string): User => toPublicUser(db.users.find((u) => u.username === username)!)
  return { db, eng, as }
}
function keysOf(obj: unknown, found: string[] = []): string[] {
  if (Array.isArray(obj)) obj.forEach((x) => keysOf(x, found))
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_OWNER_KEYS.includes(k)) found.push(k)
    keysOf(v, found)
  }
  return found
}
const pricingInput = { coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', discountMode: 'system' as const, cycle: '10M/天', deposit: 200 }

describe('登录', () => {
  it('密码正确返回用户且不含密码；错误密码与停用账号被拒绝', async () => {
    const { db, eng } = setup()
    const admin = db.users.find((u) => u.username === 'admin')!
    const user = await eng.login(admin, 'admin123', same)
    assert.equal(user.role, 'admin')
    assert.equal('password' in user, false)
    await assert.rejects(eng.login(admin, 'nope', same), (e: unknown) => e instanceof ApiError && e.message.includes('账号或密码错误'))
    await assert.rejects(eng.login(null, 'admin123', same), /账号或密码错误/)
    const cs = db.users.find((u) => u.username === 'cs')!
    cs.enabled = false
    await assert.rejects(eng.login(cs, 'cs123', same), /停用/)
  })
  it('未登录不能访问前台', () => {
    const { db, eng } = setup()
    assert.throws(() => eng.listListedAccounts(db, null), (e: unknown) => e instanceof ApiError && e.code === 401)
  })
})

describe('五档权限', () => {
  it('号主与成员不能进后台；客服只读库存；运营不能看日志和员工', async () => {
    const { db, eng, as } = setup()
    assert.throws(() => eng.listOrders(db, as('owner1')), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.throws(() => eng.listAccounts(db, as('demo')), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.throws(() => eng.ownerAccounts(db, as('demo')), (e: unknown) => e instanceof ApiError && e.code === 403)
    const accs = eng.listAccounts(db, as('cs'))
    assert.ok(accs[0].costAmount !== undefined)
    await assert.rejects(eng.saveAccount(db, as('cs'), accs[0]), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.throws(() => eng.savePricingRule(db, as('cs'), eng.getPricingRule(db, as('cs'))), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.ok(eng.listOrders(db, as('cs')).length > 0)
    assert.throws(() => eng.auditLogs(db, as('ops')), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.throws(() => eng.listUsers(db, as('ops')), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.throws(() => eng.importContext(db, as('cs')), (e: unknown) => e instanceof ApiError && e.code === 403)
    assert.ok(eng.report(db, as('ops'), NOW - 30 * 864e5, NOW, 'safeBox').accountCount > 0)
    assert.ok(eng.auditLogs(db, as('admin')).length >= 0)
    assert.throws(() => eng.setUserEnabled(db, as('admin'), 'admin', false), /最后一个管理员/)
    assert.throws(() => eng.setUserEnabled(db, as('admin'), 'nobody', false), (e: unknown) => e instanceof ApiError && e.code === 404)
  })
  it('成员大厅只见租客应付；号主大厅没有报价，算价只见到手', () => {
    const { db, eng, as } = setup()
    const [a] = eng.listListedAccounts(db, as('demo'))
    assert.ok((a.quote?.totalAmount ?? 0) > 0)
    assert.equal(a.quote?.serviceFee, undefined)
    assert.equal(a.quote?.ownerSettlement, undefined)
    assert.equal(a.ownerContact, undefined)
    assert.equal(a.costAmount, undefined)
    const ownerList = eng.listListedAccounts(db, as('owner1'))
    assert.ok(ownerList.every((x) => x.quote === null && x.ownerContact === undefined && x.deposit === undefined && x.coinRatio === undefined))
    const p = eng.calcPricing(db, as('owner1'), pricingInput)
    assert.deepEqual(Object.keys(p).sort(), ['ownerSettlement', 'ruleVersion'])
  })
  it('号主只看自己的账号，视图不含租客、租金与抽成', () => {
    const { db, eng, as } = setup()
    const mine = eng.ownerAccounts(db, as('owner1'))
    assert.ok(mine.length > 0)
    assert.deepEqual(keysOf(mine), [])
    const rented = mine.find((a) => a.ownerStatus === '出租中')
    assert.ok(rented?.expireAt)
    assert.doesNotMatch(JSON.stringify(mine), /wx_renter|wx_vip|ZD\d/)
    const others = eng.ownerAccounts(db, as('owner2'))
    assert.equal(others.some((a) => a.id === rented!.id), false)
    assert.throws(() => eng.ownerAccount(db, as('owner2'), rented!.id), /无权/)
    assert.equal(eng.getAccount(db, as('owner2'), rented!.id), undefined)
  })
  it('客服排班需要登录', () => {
    const { db, eng, as } = setup()
    assert.throws(() => eng.listCsAgents(db, null), (e: unknown) => e instanceof ApiError && e.code === 401)
    const morning = new Date(2026, 10, 27, 10, 0, 0)
    assert.equal(morning.getDay(), 5)
    const agent = eng.currentCsAgent(db, as('demo'), morning)
    assert.equal(agent?.name, '客服小鹿')
  })
})

describe('订单、押金与号主应付', () => {
  it('黑名单拦截并标记需要落库；慎租可登记', () => {
    const { db, eng, as } = setup()
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const preview = eng.previewOrder(db, as('cs'), acc.id, 'wx_black_ahu')
    assert.equal(preview.blocked, true)
    assert.throws(() => eng.createOrder(db, as('cs'), { accountId: acc.id, renterContact: 'wx_black_ahu', startAt: new Date(NOW).toISOString(), rentalDays: 3, deposit: 0, extraFee: 0, remark: '' }), (e: unknown) => {
      assert.ok(e instanceof ApiError)
      assert.equal(e.code, 409)
      assert.equal(e.errorCode, 'RENTER_BLACKLISTED')
      assert.equal(e.persist, true)
      return true
    })
    assert.equal(db.audit[0].action, '拦截黑名单')
    assert.equal(acc.status, 'listed')
  })
  it('登记、交号、改期、到期、还号、退押金、付号主、结单', () => {
    const { db, eng, as } = setup()
    const cs = as('cs')
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const startAt = new Date(NOW).toISOString()
    const preview = eng.previewOrder(db, cs, acc.id, 'wx_new')
    assert.equal(preview.blocked, false)
    assert.ok(preview.ownerPayable > 0)
    const order = eng.createOrder(db, cs, { accountId: acc.id, renterContact: 'wx_new', startAt, rentalDays: preview.rentalDays, deposit: 100, extraFee: preview.extraFee, remark: '' })
    assert.equal(order.coinRent, preview.coinRent)
    assert.equal(order.deposits[0].amount, 100)
    assert.equal(acc.status, 'rented')
    assert.equal(db.payables.find((p) => p.orderId === order.id && p.type === 'accrue')?.amount, order.ownerPayable)
    eng.markHandover(db, cs, order.id)
    assert.throws(() => eng.cancelOrder(db, cs, order.id), /不能取消/)
    eng.extendOrder(db, cs, order.id, order.rentalDays + 1, '续一天')
    eng.endOrder(db, cs, order.id)
    assert.equal(acc.status, 'settling')
    eng.markReturned(db, cs, order.id)
    eng.addDepositEntry(db, cs, order.id, { type: 'refund', amount: 100, reason: '完好' })
    eng.payOwner(db, cs, order.id, order.ownerPayable, '微信')
    const done = eng.completeOrder(db, cs, order.id, true)
    assert.equal(done.status, 'done')
    assert.equal(acc.status, 'listed')
    const listed = eng.listOrders(db, cs).find((o) => o.id === order.id)
    assert.equal(listed?.ownerPayableBalance, 0)
  })
  it('未交号取消会冲销应付并退押金', () => {
    const { db, eng, as } = setup()
    const cs = as('cs')
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const order = eng.createOrder(db, cs, { accountId: acc.id, renterContact: 'wx_new', startAt: new Date(NOW).toISOString(), rentalDays: 2, deposit: 50, extraFee: 0, remark: '' })
    eng.cancelOrder(db, cs, order.id, '租客反悔')
    assert.equal(order.status, 'cancelled')
    assert.equal(acc.status, 'listed')
    assert.ok(db.payables.some((p) => p.orderId === order.id && p.type === 'reverse'))
    assert.equal(order.deposits.some((d) => d.type === 'refund'), true)
  })
  it('登记订单使用账号报价当时的规则版本，不跟后来保存的规则', () => {
    const { db, eng, as } = setup()
    const ops = as('ops')
    const rented = db.accounts.find((a) => a.status === 'rented')!
    const oldRent = rented.quote.coinRent
    const ver = rented.quote.ruleVersion
    const order = db.orders.find((o) => o.accountId === rented.id && o.status === 'active')!
    const orderRent = order.coinRent
    const current = eng.getPricingRule(db, ops)
    const next = { ...current, discountTiers: [{ threshold: 0, ratioPlus: 0, discount: 50 }], triggerMetric: 'coinAmount' as const }
    const pv = eng.previewPricingRule(db, ops, next)
    eng.savePricingRule(db, ops, next, '全场五折', { baseVersion: pv.baseVersion, previewToken: pv.previewToken })
    assert.equal(rented.quote.coinRent, oldRent)
    assert.equal(rented.quote.ruleVersion, ver)
    assert.equal(order.coinRent, orderRent)
    const preview = eng.previewOrder(db, as('cs'), rented.id, 'wx_hist_rule')
    assert.equal(preview.ruleVersion, ver)
    assert.equal(preview.coinRent, oldRent)
  })
  it('Q8：租期只改到期日，不改租金；天数来自周期字典且不参与金额', () => {
    const { db, eng, as } = setup()
    const cs = as('cs')
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const quoteRent = acc.quote.coinRent
    const quoteDays = acc.quote.rentalDays
    const startAt = new Date(NOW).toISOString()
    const order = eng.createOrder(db, cs, { accountId: acc.id, renterContact: 'wx_q8', startAt, rentalDays: quoteDays + 9, deposit: 0, extraFee: 40, remark: '' })
    assert.equal(order.coinRent, quoteRent)
    assert.equal(order.rentalDays, quoteDays + 9)
    assert.equal(order.extraFee, 40)
    assert.equal(order.totalAmount, quoteRent + 40)
    assert.equal(order.ownerPayable, acc.source === 'consign' ? acc.quote.ownerSettlement : 0)
    assert.equal(order.endAt, new Date(new Date(startAt).getTime() + (quoteDays + 9) * 86400000).toISOString())
    const extended = eng.extendOrder(db, cs, order.id, 2, '只改期')
    assert.equal(extended.coinRent, quoteRent)
    assert.equal(extended.extraFee, 40)
    assert.equal(extended.totalAmount, quoteRent + 40)
    assert.equal(extended.rentalDays, 2)
    assert.equal(extended.ownerPayable, order.ownerPayable)
  })
  it('熟客登记免押金', () => {
    const { db, eng, as } = setup()
    const acc = db.accounts.find((a) => a.status === 'listed' && a.source === 'consign')!
    const preview = eng.previewOrder(db, as('cs'), acc.id, 'wx_vip_laoliu')
    assert.equal(preview.depositWaived, true)
    assert.equal(preview.deposit, 0)
    const order = eng.createOrder(db, as('cs'), { accountId: acc.id, renterContact: 'wx_vip_laoliu', startAt: new Date(NOW).toISOString(), rentalDays: 2, deposit: 200, extraFee: 0, remark: '' })
    assert.equal(order.deposit, 0)
    assert.equal(order.regularApplied, true)
  })
})

describe('规则版本与回收入库', () => {
  it('保存计价规则递增版本，旧快照仍可取回，试算不改当前版本', () => {
    const { db, eng, as } = setup()
    const ops = as('ops')
    const current = eng.getPricingRule(db, ops)
    assert.equal(current.version, 1)
    const next = { ...current, channelFeeRates: { ...current.channelFeeRates, 普通区: 8 } }
    const pv = eng.previewPricingRule(db, ops, next)
    const saved = eng.savePricingRule(db, ops, next, '费率调整', { baseVersion: pv.baseVersion, previewToken: pv.previewToken })
    assert.equal(saved.rule.version, 2)
    assert.equal(eng.pricingRuleVersion(db, ops, 1).channelFeeRates['普通区'], 5)
    assert.equal(eng.getPricingRule(db, ops).channelFeeRates['普通区'], 8)
    const hist = eng.ruleHistory(db, ops)
    assert.equal('rule' in hist.pricing[0], false)
    assert.equal(hist.pricing[0].version, 2)
    const trial = eng.trialPricing(db, ops, pricingInput, { ...current, version: 9, channelFeeRates: { ...current.channelFeeRates, 普通区: 1 } })
    assert.equal(trial.serviceFeeRate, 1)
    assert.equal(eng.getPricingRule(db, ops).version, 2)
    const quote = eng.calcPricing(db, as('demo'), pricingInput)
    assert.equal(quote.ruleVersion, 2)
  })
  it('估值按当前版本出数，已报价回收单成交入库为自收', () => {
    const { db, eng, as } = setup()
    const v = eng.calcValuation(db, as('demo'), asset())
    assert.equal(v.center, 368)
    assert.equal(v.ruleVersion, 1)
    const quoted = db.recycles.find((r) => r.status === 'quoted')!
    const acc = eng.recycleToInventory(db, as('ops'), quoted.id)
    assert.equal(acc.source, 'buyin')
    assert.equal(acc.status, 'held')
    assert.equal(acc.costAmount, quoted.staffPrice)
    assert.equal(quoted.status, 'deal')
    assert.throws(() => eng.updateRecycle(db, as('cs'), quoted.id, 'deal', '再成交'), /成交入库/)
  })
  it('号主提交上架为待确认，并按当前规则估算到手', async () => {
    const { db, eng, as } = setup()
    const est = eng.ownerEstimate(db, as('owner1'), asset({ contact: 'wx_owner_wang' }))
    assert.ok(est.takeHome > 0)
    assert.equal(est.ruleVersion, 1)
    const view = await eng.ownerSubmitListing(db, as('owner1'), { asset: asset({ contact: 'wx_owner_wang' }), assistTime: '全天', remark: '新号', attachments: [] })
    assert.equal(view.ownerStatus, '待确认')
    assert.equal(view.takeHome, est.takeHome)
    assert.throws(() => eng.ownerEstimate(db, as('admin'), asset()), (e: unknown) => e instanceof ApiError && e.code === 403)
  })
})

describe('导入', () => {
  it('合法行入库为待确认，重复编号跳过，客服被拒绝', () => {
    const { db, eng, as } = setup()
    const aoa = templateAoa()
    aoa.push([...aoa[1]])
    const r = eng.importAccounts(db, as('ops'), aoa, 'demo.xlsx')
    assert.deepEqual(r.imported, ['DF20001'])
    assert.equal(r.skipped.length, 1)
    assert.equal(r.operator, 'ops')
    const created = db.accounts.find((a) => a.accountNo === 'DF20001')
    assert.equal(created?.status, 'draft')
    assert.equal(created?.quote.ruleVersion, 1)
    assert.throws(() => eng.importAccounts(db, as('cs'), aoa, 'x.xlsx'), (e: unknown) => e instanceof ApiError && e.code === 403)
  })
})

describe('员工账号', () => {
  it('管理员新建号主登录并一对一绑定；重复用户名与重复绑定被拒绝；重置密码不写入日志明文', () => {
    const { db, eng, as } = setup()
    const admin = as('admin')
    const owner = db.owners.find((o) => !o.userId)!
    const created = eng.createStaff(db, admin, { username: 'NewOwner', displayName: '新号主', role: 'owner', passwordHash: 'hashed', ownerId: owner.id })
    assert.equal(created.ownerId, owner.id)
    assert.equal(created.enabled, true)
    assert.equal('password' in created, false)
    assert.equal(owner.userId, 'NewOwner')
    assert.throws(() => eng.createStaff(db, admin, { username: 'newowner', displayName: 'x', role: 'cs', passwordHash: 'h' }), (e: unknown) => e instanceof ApiError && e.errorCode === 'DUPLICATE')
    assert.throws(() => eng.createStaff(db, admin, { username: 'Other', displayName: 'x', role: 'owner', passwordHash: 'h', ownerId: owner.id }), (e: unknown) => e instanceof ApiError && e.errorCode === 'OWNER_ALREADY_BOUND')
    assert.throws(() => eng.createStaff(db, admin, { username: 'NoLink', displayName: 'x', role: 'owner', passwordHash: 'h' }), (e: unknown) => e instanceof ApiError && e.code === 422)
    const name = eng.resetPassword(db, admin, 'newowner', 'hashed-2')
    assert.equal(name, 'NewOwner')
    assert.equal(db.users.find((u) => u.username === 'NewOwner')?.password, 'hashed-2')
    assert.ok(db.audit.some((a) => a.action === '新建用户' && !a.summary.includes('hashed')))
    assert.ok(db.audit.some((a) => a.action === '重置密码' && a.summary === 'NewOwner'))
  })
})

describe('种子规模', () => {
  it('20 个账号、5 个号主，到期提醒命中种子里的临期单', () => {
    const { db, eng, as } = setup()
    assert.equal(eng.listAccounts(db, as('admin')).length, 20)
    assert.equal(eng.ownerProfiles(db, as('admin')).length, 5)
    const dash = eng.dashboard(db, as('admin'))
    assert.equal(dash.expiringOrders, 1)
    assert.ok(dash.listed > 0)
  })
})
