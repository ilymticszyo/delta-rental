// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalApi } from '../src/api/local'
import { FORBIDDEN_OWNER_KEYS } from '../src/domain/visibility'
import { toPricingInput as toInput } from '../src/mock/seed'
import type { ValuationInput } from '../src/domain/types'

let api: LocalApi
const as = (u: string) => api.login(u, { owner1: 'owner123', owner2: 'owner123', demo: 'demo123', cs: 'cs123', ops: 'ops123', admin: 'admin123' }[u]!)
beforeEach(async () => {
  localStorage.clear()
  api = new LocalApi(localStorage)
  await as('admin')
})
const asset = (over: Partial<ValuationInput> = {}): ValuationInput => ({ contact: 'wx_s', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6, skins: [], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0, ...over })
const listedConsign = async () => (await api.listAccounts()).find((a) => a.status === 'listed' && a.source === 'consign')!
const saveWithPreview = async (rule: Awaited<ReturnType<LocalApi['getPricingRule']>>, summary = '') => {
  const pv = await api.previewPricingRule(rule)
  return api.savePricingRule(rule, summary, { baseVersion: pv.baseVersion, previewToken: pv.previewToken })
}
const order = (accountId: string, renterContact = 'wx_r', deposit = 0) => api.createOrder({ accountId, renterContact, startAt: new Date().toISOString(), rentalDays: 3, deposit, extraFee: 0, remark: '' })

/** 深度扫描对象里是否出现禁用字段 */
function forbiddenKeys(obj: unknown, found: string[] = []): string[] {
  if (Array.isArray(obj)) obj.forEach((x) => forbiddenKeys(x, found))
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (FORBIDDEN_OWNER_KEYS.includes(k)) found.push(k); forbiddenKeys(v, found) }
  return found
}

describe('基础与迁移', () => {
  it('初始 20 个演示账号；5 个号主；种子版本 2', async () => {
    expect((await api.listAccounts()).length).toBe(20)
    expect((await api.ownerProfiles()).length).toBe(5)
  })
  it('旧版 v0.1 数据（无 seedVersion）自动重置为新种子并清会话', async () => {
    localStorage.setItem('dr:v1:db', JSON.stringify({ seq: { account: 1 }, accounts: [{ id: 'x', source: 'manual' }] }))
    localStorage.setItem('dr:v1:session', JSON.stringify({ username: 'admin', role: 'admin' }))
    const fresh = new LocalApi(localStorage)
    expect(fresh.currentUser()).toBeNull()
    await fresh.login('admin', 'admin123')
    const accs = await fresh.listAccounts()
    expect(accs.length).toBe(20)
    expect(accs.every((a) => a.source === 'consign' || a.source === 'buyin')).toBe(true)
  })
  it('错误密码被拒绝；未登录不能访问；停用账号不能登录；不能停用最后一个管理员', async () => {
    await expect(api.login('admin', 'x')).rejects.toThrow('账号或密码错误')
    await expect(api.setUserEnabled('admin', false)).rejects.toThrow()
    await api.setUserEnabled('cs', false)
    await expect(api.login('cs', 'cs123')).rejects.toThrow('停用')
    await api.logout()
    await expect(api.listListedAccounts()).rejects.toThrow('未登录')
  })
})

describe('五档权限（第 10 章）', () => {
  it('号主 / 成员不能进后台接口；客服只能看库存不能改；客服不能改规则；运营不能看日志', async () => {
    await as('owner1')
    await expect(api.listOrders()).rejects.toThrow('403')
    await expect(api.listAccounts()).rejects.toThrow('403')
    await as('demo')
    await expect(api.listAccounts()).rejects.toThrow('403')
    await expect(api.ownerAccounts()).rejects.toThrow('403')
    await as('cs')
    const accs = await api.listAccounts()
    expect(accs[0].costAmount).toBeDefined()
    await expect(api.saveAccount({ ...accs[0] })).rejects.toThrow('403')
    await expect(api.savePricingRule(await api.getPricingRule())).rejects.toThrow('403')
    expect(await api.listOrders()).toBeTruthy()
    await as('ops')
    await expect(api.auditLogs()).rejects.toThrow('403')
    await expect(api.listUsers()).rejects.toThrow('403')
    expect(await api.report(Date.now() - 30 * 864e5, Date.now(), 'safeBox')).toBeTruthy()
  })
  it('成员大厅只见租客应付报价，不见号主、成本、服务费与号主可得', async () => {
    await as('demo')
    const [a] = await api.listListedAccounts()
    expect(a.quote?.totalAmount).toBeGreaterThan(0)
    expect(a.quote?.serviceFee).toBeUndefined()
    expect(a.quote?.ownerSettlement).toBeUndefined()
    expect(a.ownerContact).toBeUndefined()
    expect(a.costAmount).toBeUndefined()
  })
  it('号主在大厅看不到任何报价；算价只回显到手金额', async () => {
    await as('owner1')
    const list = await api.listListedAccounts()
    expect(list.every((a) => a.quote === null && a.ownerContact === undefined)).toBe(true)
    const p = await api.calcPricing({ coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', discountMode: 'system', cycle: '10M/天', deposit: 200 })
    expect(Object.keys(p).sort()).toEqual(['ownerSettlement', 'ruleVersion'])
  })
  it('号主只能看到自己的账号；视图不含租客信息、租金与抽成；越权按编号读取被拒', async () => {
    await as('owner1')
    const mine = await api.ownerAccounts()
    expect(mine.length).toBeGreaterThan(0)
    expect(forbiddenKeys(mine)).toEqual([])
    const rented = mine.find((a) => a.ownerStatus === '出租中')!
    expect(rented.expireAt).toBeTruthy()
    expect(JSON.stringify(mine)).not.toMatch(/wx_renter|wx_vip|ZD\d/)
    await as('owner2')
    const others = await api.ownerAccounts()
    expect(others.some((a) => a.id === rented.id)).toBe(false)
    await expect(api.ownerAccount(rented.id)).rejects.toThrow('无权')
    await expect(api.ownerRecycleDraft(rented.id)).rejects.toThrow('无权')
    // 前台详情也不能窥探非在架账号
    expect(await api.getAccount(rented.id)).toBeUndefined()
  })
  it('管理员可查看全部号主门户', async () => {
    const all = await api.ownerAccounts()
    expect(new Set(all.map((a) => a.ownerName)).size).toBeGreaterThan(1)
    expect(forbiddenKeys(all)).toEqual([])
  })
})

describe('号主门户（E1–E4）', () => {
  it('上架复用自己的回收估值，自动估到手，提交后为待确认 / 号主寄租，不自动上架', async () => {
    await as('owner1')
    const [rec] = await api.myRecycles()
    const est = await api.ownerEstimate(rec.asset)
    expect(est.takeHome).toBeGreaterThan(0)
    const v = await api.ownerSubmitListing({ asset: asset(), fromRecycleId: rec.id, assistTime: '全天', remark: '', attachments: [{ name: 's.png', dataUrl: 'data:image/png;base64,AAAA' }] })
    expect(v.ownerStatus).toBe('待确认')
    expect(v.coinAmount).toBe(rec.asset.coinAmount) // 复用了估值资产
    expect(v.takeHome).toBe(est.takeHome)
    expect(v.attachments.length).toBe(1)
    expect(forbiddenKeys(v)).toEqual([])
    await as('demo')
    expect((await api.listListedAccounts()).some((a) => a.id === v.id)).toBe(false)
    await as('admin')
    const inv = (await api.listAccounts()).find((a) => a.id === v.id)!
    expect(inv.status).toBe('draft')
    expect(inv.source).toBe('consign')
    expect(inv.ownerId).toBe('ow1')
  })
  it('不能复用别人的回收估值', async () => {
    await as('owner2')
    const someone = 'r1'
    await expect(api.ownerSubmitListing({ asset: asset(), fromRecycleId: someone, assistTime: '', remark: '', attachments: [] })).rejects.toThrow('自己')
  })
  it('号主从自己的账号转入回收：预填一致；成交后账号转为自收，号主只看到回收确认价', async () => {
    await as('owner1')
    const idle = (await api.ownerAccounts()).find((a) => a.ownerStatus === '空闲')!
    const draft = await api.ownerRecycleDraft(idle.id)
    expect(draft.coinAmount).toBe(idle.coinAmount)
    expect(draft.skins).toEqual(idle.skins)
    const req = await api.submitRecycle(draft, { sourceAccountId: idle.id })
    expect(req.sourceAccountId).toBe(idle.id)
    await as('owner2')
    await expect(api.submitRecycle(draft, { sourceAccountId: idle.id })).rejects.toThrow()
    await as('cs')
    await api.updateRecycle(req.id, 'following', '接单')
    await api.updateRecycle(req.id, 'quoted', '确认', 500)
    const acc = await api.recycleToInventory(req.id)
    expect(acc.id).toBe(idle.id)
    expect(acc.source).toBe('buyin')
    expect(acc.costAmount).toBe(500)
    await as('owner1')
    const after = await api.ownerAccount(idle.id)
    expect(after.ownerStatus).toBe('已回收')
    expect(after.recycle?.staffPrice).toBe(500)
    expect(after.takeHome).toBeNull()
  })
})

describe('订单、留痕与台账（A8 / C2 / C3）', () => {
  it('登记订单锁定账号，重复下单被拒，取消后恢复并冲销号主应付', async () => {
    const a = await listedConsign()
    const o = await order(a.id)
    expect(o.ownerPayable).toBe(a.quote.ownerSettlement)
    await expect(order(a.id)).rejects.toThrow()
    await expect(api.deleteAccount(a.id)).rejects.toThrow('不能删除')
    await api.cancelOrder(o.id)
    const p = (await api.listPayables()).filter((x) => x.orderId === o.id)
    expect(p.map((x) => x.type).sort()).toEqual(['accrue', 'reverse'])
    expect((await api.listAccounts()).find((x) => x.id === a.id)!.status).toBe('listed')
  })
  it('生命周期每步留痕；押金与号主应付都处理完才能完成', async () => {
    const a = await listedConsign()
    const o = await order(a.id, 'wx_r2', 200)
    await api.markHandover(o.id)
    await api.extendOrder(o.id, 5)
    await api.endOrder(o.id)
    await api.markReturned(o.id)
    await expect(api.completeOrder(o.id, true)).rejects.toThrow('押金余额')
    await api.addDepositEntry(o.id, { type: 'deduct', amount: 50, reason: 'AWM 消耗' })
    await api.addDepositEntry(o.id, { type: 'refund', amount: 150, reason: '退还' })
    await expect(api.completeOrder(o.id, true)).rejects.toThrow('号主应付')
    await expect(api.payOwner(o.id, o.ownerPayable + 1, '')).rejects.toThrow('超出')
    await api.payOwner(o.id, o.ownerPayable, '微信转账')
    const done = await api.completeOrder(o.id, true)
    expect(done.events.map((e) => e.step)).toEqual(['register', 'collect', 'handover', 'extend', 'expire', 'return', 'deduct', 'refund', 'payOwner', 'settle'])
    expect(done.endAt).toBe(new Date(new Date(o.startAt).getTime() + 5 * 864e5).toISOString())
    const prof = (await api.ownerProfiles()).find((x) => x.id === a.ownerId)!
    expect(prof.cumulativeSettlement).toBeGreaterThanOrEqual(o.ownerPayable)
    expect(prof.balance).toBe(prof.accrued - prof.cumulativeSettlement - 0 - (await api.listPayables({ ownerId: a.ownerId })).filter((x) => x.type === 'reverse').reduce((s, x) => s + x.amount, 0))
  })
  it('即将到期的订单被标记，看板计数一致', async () => {
    const orders = await api.listOrders()
    const expiring = orders.filter((o) => o.reminder)
    expect(expiring.length).toBeGreaterThanOrEqual(1)
    expect((await api.dashboard()).expiringOrders).toBe(expiring.length)
  })
})

describe('轻量客户管理（C12）', () => {
  it('黑名单联系方式被拦截并给出原因（大小写 / 空格不敏感）', async () => {
    const a = await listedConsign()
    const pv = await api.previewOrder(a.id, 'wx_black_ahu')
    expect(pv.blocked).toBe(true)
    expect(pv.profile?.tag).toBe('blacklist')
    await expect(order(a.id, '  WX_BLACK_AHU ')).rejects.toThrow('黑名单')
    expect((await api.listAccounts()).find((x) => x.id === a.id)!.status).toBe('listed')
  })
  it('慎租只提醒不拦截', async () => {
    const a = await listedConsign()
    const pv = await api.previewOrder(a.id, 'wx_care_xiaozhou')
    expect(pv.blocked).toBe(false)
    expect(pv.profile?.tag).toBe('caution')
    expect((await order(a.id, 'wx_care_xiaozhou')).status).toBe('active')
  })
  it('熟客自动带入折扣与免押金，与算价结果一致', async () => {
    const a = (await api.listAccounts()).find((x) => x.status === 'listed' && x.quote.discountPercent === 100 && x.deposit > 0)!
    const priced = await api.calcPricing({ coinAmount: a.coinAmount, totalAssets: a.totalAssets, coinRatio: a.coinRatio, channel: a.channel, discountMode: a.discountMode, customDiscountPercent: a.customDiscountPercent, cycle: a.cycle, deposit: a.deposit, renterContact: 'wx_vip_laoliu' })
    expect(priced.regularDiscountApplied).toBe(true)
    expect(priced.deposit).toBe(0)
    const o = await order(a.id, 'wx_vip_laoliu', 300)
    expect(o.regularApplied).toBe(true)
    expect(o.coinRent).toBe(priced.coinRent)
    expect(o.coinRent).toBeLessThan(a.quote.coinRent)
    expect(o.deposit).toBe(0)
  })
  it('打标签留痕；新建档案后即可拦截', async () => {
    await api.saveRenter({ contact: 'wx_new_bad', displayName: '新黑', tag: 'blacklist', note: '测试' })
    const a = await listedConsign()
    await expect(order(a.id, 'wx_new_bad')).rejects.toThrow('黑名单')
    expect((await api.auditLogs()).some((l) => l.action === '租客标签' && l.summary.includes('wx_new_bad'))).toBe(true)
    const renters = await api.renterProfiles()
    expect(renters.find((r) => r.contact === 'wx_vip_laoliu')!.rentalCount).toBeGreaterThan(0)
  })
})

describe('回收、回本与版本化估值依据（B3 / B4 / C1 / C5）', () => {
  it('回收成交入库：来源自收，成本 = 成交价；出租后回本进度 = 累计收入 / 成本', async () => {
    const r = await api.submitRecycle(asset({ contact: 'wx_pay' }))
    await expect(api.recycleToInventory(r.id)).rejects.toThrow()
    await api.updateRecycle(r.id, 'following', '接单')
    await api.updateRecycle(r.id, 'quoted', '确认报价', 400)
    const acc = await api.recycleToInventory(r.id)
    expect(acc.status).toBe('held')
    expect(acc.source).toBe('buyin')
    expect(acc.costAmount).toBe(400)
    expect(acc.paybackPercent).toBe(0)
    await api.setAccountStatus(acc.id, 'listed')
    const o = await order(acc.id)
    expect(o.ownerPayable).toBe(0) // 自收号无号主应付
    const after = (await api.listAccounts()).find((x) => x.id === acc.id)!
    expect(after.cumulativeIncome).toBe(o.coinRent + o.extraFee)
    expect(after.paybackPercent).toBe(Math.round(((o.coinRent + o.extraFee) / 400) * 1000) / 10)
  })
  it('改市场系数生成新版本；历史单保留当时系数快照；新估价走新系数', async () => {
    const before = (await api.listRecycles())[0]
    const rule = await api.getValuationRule()
    const saved = await api.saveValuationRule({ ...rule, marketCoefficient: 1.2 }, '市场上浮 20%')
    expect(saved.version).toBe(rule.version + 1)
    const hist = await api.ruleHistory()
    expect(hist.valuation[0]).toMatchObject({ version: saved.version, summary: '市场上浮 20%', savedBy: 'admin' })
    const after = (await api.listRecycles()).find((x) => x.id === before.id)!
    expect(after.result).toEqual(before.result)
    expect(after.result.marketCoefficient).toBe(1)
    const a1 = await api.calcValuation(asset())
    expect(a1.ruleVersion).toBe(saved.version)
    expect(a1.marketCoefficient).toBe(1.2)
    expect(a1.center).toBe(Math.round(400 * 0.8 * 1.2))
  })
  it('试算与正式计算一致', async () => {
    const rule = await api.getPricingRule()
    const input = { coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: '普通区', discountMode: 'system' as const, cycle: '10M/天', deposit: 0 }
    expect(await api.trialPricing(input, rule)).toEqual(await api.calcPricing(input))
  })
})

describe('经营报表（C11）', () => {
  it('出租率在 0-100 之间，分组合计与明细一致，自收号有回本周期', async () => {
    const t = Date.now() // 两次报表用同一时间窗（分别取 Date.now() 时，恰在 30 天边界的种子订单会落在不同窗口里，偶发失败）
    const rep = await api.report(t - 30 * 864e5, t, 'safeBox')
    expect(rep.utilization).toBeGreaterThan(0)
    expect(rep.utilization).toBeLessThanOrEqual(100)
    expect(rep.groups.reduce((s, g) => s + g.net, 0)).toBe(rep.net)
    expect(rep.accounts.reduce((s, a) => s + a.orders, 0)).toBe(rep.orderCount)
    expect(rep.payback.length).toBeGreaterThan(0)
    const byPrice = await api.report(t - 30 * 864e5, t, 'price')
    expect(byPrice.net).toBe(rep.net)
  })
})

describe('v0.3 契约对齐：按账号报价版本计价、订单详情、新建用户', () => {
  it('租赁中的账号改规则时被跳过：之后再出租仍按报价所记版本计价；订单记 ruleVersion', async () => {
    const a = await listedConsign()
    expect(a.quote.ruleVersion).toBe(1)
    const o1 = await order(a.id, 'wx_new_renter')
    const rule = await api.getPricingRule()
    const rates = Object.fromEntries(Object.entries(rule.channelFeeRates).map(([k, v]) => [k, Math.min(90, v + 30)]))
    await saveWithPreview({ ...rule, channelFeeRates: rates }, '服务费大涨')
    expect((await api.getPricingRule()).version).toBe(2)
    await api.cancelOrder(o1.id, '未交号')
    const back = (await api.listAccounts()).find((x) => x.id === a.id)!
    expect(back.status).toBe('listed')
    expect(back.quote.ruleVersion).toBe(1)
    const pv = await api.previewOrder(a.id, 'wx_new_renter2')
    expect(pv.ruleVersion).toBe(1)
    expect(pv.coinRent).toBe(a.quote.coinRent)
    expect(pv.ownerPayable).toBe(a.quote.ownerSettlement)
    const o = await order(a.id, 'wx_new_renter2')
    expect(o).toMatchObject({ ruleVersion: 1, coinRent: a.quote.coinRent, ownerPayable: a.quote.ownerSettlement })
    // 编辑保存后按当前规则重算
    const { id, accountNo, quote, createdAt, updatedAt, deleted, cumulativeIncome, paybackPercent, ownerName, ...rest } = (await api.listAccounts()).find((x) => x.status === 'listed' && x.source === 'consign' && x.id !== a.id)!
    const saved = await api.saveAccount({ ...rest, id })
    expect(saved.quote.ruleVersion).toBe(2)
    expect((await api.ruleHistory()).pricing.every((h) => !('rule' in h))).toBe(true) // 快照不外露
  })
  it('getOrder 返回订单视图；listPayables 可按订单过滤', async () => {
    const a = await listedConsign()
    const o = await order(a.id)
    const v = await api.getOrder(o.id)
    expect(v).toMatchObject({ id: o.id, reminder: null, ownerPayableBalance: o.ownerPayable })
    await expect(api.getOrder('nope')).rejects.toMatchObject({ code: 404 })
    const ps = await api.listPayables({ orderId: o.id })
    expect(ps.length).toBe(1)
    expect(ps[0]).toMatchObject({ orderId: o.id, type: 'accrue' })
  })
  it('管理员新建号主用户并一对一绑定号主档案；校验与冲突', async () => {
    const free = (await api.ownerProfiles()).find((o) => !o.userId)
    // 种子号主都已绑定 → 先通过寄租账号建一个新档案
    let ownerId = free?.id
    if (!ownerId) {
      const { id, accountNo, quote, createdAt, updatedAt, deleted, cumulativeIncome, paybackPercent, ownerName, ownerId: _o, ...rest } = await listedConsign()
      const acc = await api.saveAccount({ ...rest, ownerContact: 'wx_new_owner_zhao', status: 'draft' })
      ownerId = acc.ownerId!
    }
    await expect(api.createUser({ username: 'zhao', displayName: '赵老板', role: 'owner', password: 'short' })).rejects.toMatchObject({ code: 422, errorCode: 'VALIDATION_FAILED' })
    await expect(api.createUser({ username: 'x1', displayName: 'x', role: 'cs', password: 'longenough', ownerId })).rejects.toMatchObject({ code: 422 })
    await expect(api.createUser({ username: 'ADMIN', displayName: 'x', role: 'cs', password: 'longenough' })).rejects.toMatchObject({ code: 409, errorCode: 'DUPLICATE' })
    await expect(api.createUser({ username: 'wang2', displayName: 'x', role: 'owner', password: 'longenough', ownerId: 'ow1' })).rejects.toMatchObject({ code: 409, errorCode: 'OWNER_ALREADY_BOUND' })
    const u = await api.createUser({ username: 'zhao', displayName: '赵老板', role: 'owner', password: 'zhao12345', ownerId })
    expect(u).toMatchObject({ username: 'zhao', role: 'owner', ownerId, enabled: true })
    expect((await api.ownerProfiles()).find((o) => o.id === ownerId)?.userId).toBe('zhao')
    expect((await api.auditLogs())[0].action).toBe('新建用户')
    const me = await api.login('zhao', 'zhao12345')
    expect(me.ownerId).toBe(ownerId)
    expect((await api.ownerAccounts()).length).toBeGreaterThanOrEqual(1)
  })
})

describe('v0.4 改规则重算库存（预览 → 确认 → 原子重算）', () => {
  const bump = async () => {
    const rule = await api.getPricingRule()
    return { ...rule, channelFeeRates: Object.fromEntries(Object.entries(rule.channelFeeRates).map(([k, v]) => [k, Math.min(90, v + 10)])), extraFee: { mode: 'fixed' as const, value: 5 } }
  }
  it('预览不落库；未出租账号进 affected（新价 = 按候选规则算的报价），租赁中 / 待结算进 skipped', async () => {
    const a = await listedConsign()
    const o = await order(a.id, 'wx_rp_1')
    const before = localStorage.getItem('dr:v1:db')
    const rule = await bump()
    const pv = await api.previewPricingRule(rule)
    expect(localStorage.getItem('dr:v1:db')).toBe(before)
    expect(pv.baseVersion).toBe(1)
    expect(pv.nextVersion).toBe(2)
    expect(pv.previewToken).toMatch(/^pv1\.1\./)
    const accs = (await api.listAccounts()).filter((x) => !x.deleted)
    const inFlight = accs.filter((x) => x.status === 'rented' || x.status === 'settling')
    expect(pv.skipped.map((x) => x.accountId).sort()).toEqual(inFlight.map((x) => x.id).sort())
    expect(pv.skipped.find((x) => x.accountId === a.id)).toMatchObject({ reason: 'RENTED', ruleVersion: 1 })
    expect(pv.affected.length).toBe(accs.length - inFlight.length)
    expect(pv.affected.every((x) => !['rented', 'settling'].includes(x.status))).toBe(true)
    const it0 = pv.affected[0]
    const trial = await api.trialPricing({ ...toInput(accs.find((x) => x.id === it0.accountId)!) }, { ...rule, version: 2 })
    expect(it0.newPrice.renterRent).toBe(trial.renterRent)
    expect(it0.newPrice.ownerSettlement).toBe(trial.ownerSettlement)
    expect(it0.delta).toBe(it0.newPrice.renterRent - it0.oldPrice.renterRent)
    expect(pv.summary).toEqual({ affectedCount: pv.affected.length, changedCount: pv.affected.filter((x) => x.changed).length, skippedCount: pv.skipped.length, totalDelta: pv.affected.reduce((s, x) => s + x.delta, 0) })
    expect(pv.summary.changedCount).toBeGreaterThan(0)
    expect(pv.affected.every((x) => x.delta === 5 || x.changed)).toBe(true)
    expect((await api.getOrder(o.id)).coinRent).toBe(o.coinRent)
  })
  it('确认保存：原子重算 affected、报价版本 +1；租赁中账号与已登记订单不动；写操作日志；新订单走新报价', async () => {
    const a = await listedConsign()
    const o = await order(a.id, 'wx_rp_2')
    const ordersBefore = JSON.stringify((await api.listOrders()).map(({ reminder, ...x }: any) => x))
    const rule = await bump()
    const pv = await api.previewPricingRule(rule)
    const res = await api.savePricingRule(rule, '服务费 +10、附加费 5', { baseVersion: pv.baseVersion, previewToken: pv.previewToken })
    expect(res.rule.version).toBe(2)
    expect(res.repriced).toEqual(pv.summary)
    const accs = await api.listAccounts()
    for (const x of pv.affected) {
      const acc = accs.find((y) => y.id === x.accountId)!
      expect(acc.quote.ruleVersion).toBe(2)
      expect(acc.quote.renterRent).toBe(x.newPrice.renterRent)
    }
    expect(accs.find((y) => y.id === a.id)!.quote.ruleVersion).toBe(1)
    expect(JSON.stringify((await api.listOrders()).map(({ reminder, ...x }: any) => x))).toBe(ordersBefore)
    expect((await api.getOrder(o.id)).ruleVersion).toBe(1)
    const log = (await api.auditLogs())[0]
    expect(log.action).toBe('计价规则')
    expect(log.summary).toContain('保存为 v2')
    expect(log.summary).toContain(`重算 ${pv.summary.affectedCount} 个账号`)
    expect(log.summary).toContain(`租赁中 ${pv.skipped.filter((x) => x.reason === 'RENTED').length}`)
    const other = pv.affected.find((x) => x.status === 'listed' && x.changed)!
    const o2 = await order(other.accountId, 'wx_rp_3')
    expect(o2.ruleVersion).toBe(2)
    expect(o2.coinRent).toBe(other.newPrice.coinRent)
  })
  it('缺少预览 → 422；版本变了 → 409 RULE_CONFLICT VERSION_CHANGED；预览后库存 / 规则变了 → 409 PREVIEW_STALE；失败不落库', async () => {
    const rule = await bump()
    await expect(api.savePricingRule(rule, 'x')).rejects.toMatchObject({ code: 422 })
    const pv = await api.previewPricingRule(rule)
    // 规则内容变了
    await expect(api.savePricingRule({ ...rule, defaultDeposit: rule.defaultDeposit + 1 }, '', pv)).rejects.toMatchObject({ code: 409, errorCode: 'RULE_CONFLICT', details: { reason: 'PREVIEW_STALE' } })
    // 库存变了（下架一个账号）
    const a = await listedConsign()
    await api.setAccountStatus(a.id, 'off')
    const before = localStorage.getItem('dr:v1:db')
    await expect(api.savePricingRule(rule, '', pv)).rejects.toMatchObject({ code: 409, errorCode: 'RULE_CONFLICT', details: { reason: 'PREVIEW_STALE' } })
    expect(localStorage.getItem('dr:v1:db')).toBe(before)
    // 重新预览后可保存；拿旧预览再保存 → 版本已变
    const pv2 = await api.previewPricingRule(rule)
    await api.savePricingRule(rule, '', pv2)
    await expect(api.savePricingRule(rule, '', pv2)).rejects.toMatchObject({ code: 409, errorCode: 'RULE_CONFLICT', details: { reason: 'VERSION_CHANGED', currentVersion: 2 } })
  })
  it('新规则下算不出价的账号 → PRICING_ERROR 跳过并保留旧报价', async () => {
    const rule = await api.getPricingRule()
    const accs = await api.listAccounts()
    const usedCycle = accs.find((x) => x.status === 'listed')!.cycle
    const { [usedCycle]: _gone, ...cycles } = rule.cycleValues
    const cand = { ...rule, cycleValues: cycles, ownerDefaults: { ...rule.ownerDefaults, cycle: Object.keys(cycles)[0] } }
    const pv = await api.previewPricingRule(cand)
    const bad = pv.skipped.filter((x) => x.reason === 'PRICING_ERROR')
    expect(bad.length).toBe(accs.filter((x) => !x.deleted && x.cycle === usedCycle && !['rented', 'settling'].includes(x.status)).length)
    expect(bad[0].message).toBeTruthy()
    await api.savePricingRule(cand, '删周期', pv)
    const after = await api.listAccounts()
    for (const b of bad) expect(after.find((x) => x.id === b.accountId)!.quote.ruleVersion).toBe(b.ruleVersion)
  })
  it('只有运营 / 管理员能预览与保存', async () => {
    const rule = await api.getPricingRule()
    await as('cs')
    await expect(api.previewPricingRule(rule)).rejects.toThrow('403')
    await as('ops')
    expect((await api.previewPricingRule(rule)).baseVersion).toBe(1)
  })
})
