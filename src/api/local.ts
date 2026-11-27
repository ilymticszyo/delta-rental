// localStorage 实现：模拟后端。算价 / 估值 / 状态流转全部在这一层执行，页面不自行结算。
import { defaultPricingRule, defaultValuationRule, type PricingRule, type ValuationRule } from '../config/rules'
import { calcPricing } from '../domain/pricing'
import { calcValuation } from '../domain/valuation'
import type {
  Account, AccountInput, AccountStatus, CsAgent, DashboardStats, DepositEntry, OrderInput, PricingInput,
  RecycleRequest, RecycleStatus, RentalOrder, User, ValuationInput,
} from '../domain/types'
import { ACCOUNT_STATUS_LABEL, RECYCLE_TRANSITIONS, RECYCLE_STATUS_LABEL } from '../domain/types'
import { demoCsAgents, demoUsers, seedAccounts } from '../mock/seed'
import type { Api, AuditLog } from './types'

const DB_KEY = 'dr:v1:db'
const SESSION_KEY = 'dr:v1:session'

interface Db {
  seq: { account: number; order: number; recycle: number }
  accounts: Account[]
  orders: RentalOrder[]
  recycles: RecycleRequest[]
  pricingRule: PricingRule
  valuationRule: ValuationRule
  csAgents: CsAgent[]
  audit: AuditLog[]
}

export class ApiError extends Error {
  constructor(message: string, public code = 400) { super(message) }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const nowIso = () => new Date().toISOString()
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86400000).toISOString()

/** 账号手工状态流转（订单相关流转由订单接口驱动） */
const MANUAL_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  draft: ['listed', 'off'],
  listed: ['off'],
  off: ['listed'],
  held: ['listed', 'off'],
  rented: [],
  settling: [],
}

function toPricingInput(a: AccountInput): PricingInput {
  return {
    coinAmount: a.coinAmount, totalAssets: a.totalAssets, coinRatio: a.coinRatio, channel: a.channel,
    discountMode: a.discountMode, customDiscountPercent: a.customDiscountPercent, cycle: a.cycle, deposit: a.deposit,
  }
}

export class LocalApi implements Api {
  constructor(private storage: Storage = localStorage) {}

  // ---------- 存储 ----------
  private load(): Db {
    const raw = this.storage.getItem(DB_KEY)
    if (raw) return JSON.parse(raw)
    const db = this.seed()
    this.save(db)
    return db
  }
  private save(db: Db) { this.storage.setItem(DB_KEY, JSON.stringify(db)) }
  private tx<T>(fn: (db: Db) => T): T {
    const db = this.load()
    const out = fn(db)
    this.save(db)
    return clone(out)
  }
  private audit(db: Db, action: string, summary: string) {
    db.audit.unshift({ at: nowIso(), actor: this.currentUser()?.username ?? 'system', action, summary })
    db.audit = db.audit.slice(0, 500)
  }
  private requireAdmin() {
    const u = this.currentUser()
    if (!u) throw new ApiError('未登录', 401)
    if (u.role === 'member') throw new ApiError('无权限', 403)
    return u
  }
  private requireLogin() {
    const u = this.currentUser()
    if (!u) throw new ApiError('未登录', 401)
    return u
  }

  private seed(): Db {
    const db: Db = {
      seq: { account: 10000, order: 0, recycle: 0 },
      accounts: [], orders: [], recycles: [],
      pricingRule: clone(defaultPricingRule), valuationRule: clone(defaultValuationRule),
      csAgents: clone(demoCsAgents), audit: [],
    }
    const base = Date.now() - 20 * 86400000
    seedAccounts().forEach((input, i) => {
      const t = new Date(base + i * 3600000 * 20).toISOString()
      db.seq.account++
      db.accounts.push({ ...input, id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote: calcPricing(toPricingInput(input), db.pricingRule), createdAt: t, updatedAt: t })
    })
    // 为「租赁中」的账号建进行中订单，另造几笔已完成订单作营收
    const mkOrder = (acc: Account, startAt: string, status: RentalOrder['status']) => {
      db.seq.order++
      const q = acc.quote
      const o: RentalOrder = {
        id: `o${db.seq.order}`, orderNo: `ZD${String(db.seq.order).padStart(5, '0')}`, accountId: acc.id, accountNo: acc.accountNo,
        renterContact: `wx_renter${db.seq.order}`, startAt, endAt: addDays(startAt, q.rentalDays), rentalDays: q.rentalDays,
        coinRent: q.coinRent, extraFee: q.extraFee, deposit: q.deposit, totalAmount: q.totalAmount, status, remark: '演示数据',
        deposits: q.deposit ? [{ type: 'collect', amount: q.deposit, reason: '收取押金', at: startAt, operator: 'admin' }] : [],
        createdBy: 'admin', createdAt: startAt,
      }
      if (status === 'done' && q.deposit) o.deposits.push({ type: 'refund', amount: q.deposit, reason: '到期退还', at: o.endAt, operator: 'admin' })
      db.orders.push(o)
    }
    db.accounts.filter((a) => a.status === 'rented').forEach((a, i) => mkOrder(a, new Date(Date.now() - (i + 1) * 86400000).toISOString(), 'active'))
    db.accounts.filter((a) => a.status === 'listed').slice(0, 4).forEach((a, i) => mkOrder(a, new Date(base + i * 2 * 86400000).toISOString(), 'done'))
    // 回收申请示例
    const samples: [ValuationInput, RecycleStatus][] = [
      [{ contact: 'wx_seller01', region: 'QQ区', loginMethod: '扫码', coinAmount: 120, totalAssets: 200, level: 45, rank: '钻石', safeBox: 6, skins: ['威龙·赤焰', '龙牙战刀'], banRecord: false, awmCount: 5, helmet6Count: 3, armor6Count: 2, experienceCardCount: 0, remark: '想尽快出' }, 'submitted'],
      [{ contact: 'wx_seller02', region: 'VX区', loginMethod: '账密', coinAmount: 300, totalAssets: 520, level: 60, rank: '黑鹰', safeBox: 9, skins: ['金色AWM', '典藏·雷霆', '蜂医·霓虹'], banRecord: false, awmCount: 12, helmet6Count: 8, armor6Count: 6, experienceCardCount: 1 }, 'following'],
      [{ contact: 'wx_seller03', region: 'QQ区', loginMethod: '均可', coinAmount: 80, totalAssets: 110, level: 30, rank: '黄金', safeBox: 4, skins: [], banRecord: true, awmCount: 0, helmet6Count: 1, armor6Count: 0, experienceCardCount: 0 }, 'quoted'],
    ]
    samples.forEach(([asset, status], i) => {
      db.seq.recycle++
      const result = calcValuation(asset, db.valuationRule)
      const at = new Date(Date.now() - (3 - i) * 3600000 * 5).toISOString()
      const req: RecycleRequest = {
        id: `r${db.seq.recycle}`, requestNo: `HS${String(db.seq.recycle).padStart(5, '0')}`, submitter: 'demo', contact: asset.contact,
        asset, result, status: 'submitted', createdAt: at,
        events: [{ at, operator: 'demo', fromStatus: null, toStatus: 'submitted', note: '提交回收申请' }],
      }
      if (status !== 'submitted') req.events.push({ at, operator: 'admin', fromStatus: 'submitted', toStatus: 'following', note: '已加微信沟通' })
      if (status === 'quoted') { req.staffPrice = result.min; req.events.push({ at, operator: 'admin', fromStatus: 'following', toStatus: 'quoted', price: result.min, note: '有封禁记录，按下限报价' }) }
      req.status = status
      db.recycles.push(req)
    })
    return db
  }

  // ---------- 认证 ----------
  async login(username: string, password: string): Promise<User> {
    const u = demoUsers.find((x) => x.username === username.trim() && x.password === password)
    if (!u) throw new ApiError('账号或密码错误', 401)
    const user: User = { username: u.username, displayName: u.displayName, role: u.role }
    this.storage.setItem(SESSION_KEY, JSON.stringify(user))
    return user
  }
  async logout() { this.storage.removeItem(SESSION_KEY) }
  currentUser(): User | null {
    const raw = this.storage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  }

  // ---------- 前台 ----------
  async listListedAccounts() {
    this.requireLogin()
    return clone(this.load().accounts.filter((a) => a.status === 'listed' && !a.deleted))
  }
  async getAccount(id: string) {
    this.requireLogin()
    const a = this.load().accounts.find((x) => x.id === id && !x.deleted)
    return a ? clone(a) : undefined
  }
  async calcPricing(input: PricingInput) {
    this.requireLogin()
    return calcPricing(input, this.load().pricingRule)
  }
  async calcValuation(input: ValuationInput) {
    this.requireLogin()
    return calcValuation(input, this.load().valuationRule)
  }
  async submitRecycle(input: ValuationInput) {
    const user = this.requireLogin()
    return this.tx((db) => {
      const key = JSON.stringify({ ...input, remark: undefined })
      const dup = db.recycles.find(
        (r) => r.submitter === user.username && JSON.stringify({ ...r.asset, remark: undefined }) === key &&
          Date.now() - new Date(r.createdAt).getTime() < 10 * 60000 && r.status !== 'cancelled',
      )
      if (dup) throw new ApiError(`10 分钟内已提交过相同资产（单号 ${dup.requestNo}），请勿重复提交`, 409)
      const result = calcValuation(input, db.valuationRule)
      db.seq.recycle++
      const at = nowIso()
      const req: RecycleRequest = {
        id: `r${db.seq.recycle}`, requestNo: `HS${String(db.seq.recycle).padStart(5, '0')}`, submitter: user.username,
        contact: input.contact, asset: clone(input), result, status: 'submitted', createdAt: at,
        events: [{ at, operator: user.username, fromStatus: null, toStatus: 'submitted', note: '提交回收申请' }],
      }
      db.recycles.unshift(req)
      this.audit(db, '回收提交', `${req.requestNo} 参考价 ${result.min}-${result.max}`)
      return req
    })
  }
  async myRecycles() {
    const user = this.requireLogin()
    return clone(this.load().recycles.filter((r) => r.submitter === user.username))
  }
  async currentCsAgent(now = new Date()) {
    const agents = this.load().csAgents
    const wd = now.getDay()
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const on = agents.find((a) => !a.isFallback && a.schedule.some((s) => s.weekdays.includes(wd) && hm >= s.start && hm < s.end))
    return clone(on ?? agents.find((a) => a.isFallback) ?? null)
  }

  // ---------- 库存 ----------
  async listAccounts() {
    this.requireAdmin()
    return clone(this.load().accounts.filter((a) => !a.deleted))
  }
  async saveAccount(input: AccountInput) {
    this.requireAdmin()
    return this.tx((db) => {
      const quote = calcPricing(toPricingInput(input), db.pricingRule)
      const t = nowIso()
      if (input.id) {
        const a = db.accounts.find((x) => x.id === input.id && !x.deleted)
        if (!a) throw new ApiError('账号不存在', 404)
        if (input.status !== a.status) throw new ApiError('状态请用状态操作按钮修改')
        Object.assign(a, input, { quote, updatedAt: t })
        this.audit(db, '编辑账号', `${a.accountNo}`)
        return a
      }
      if (!['draft', 'listed', 'off', 'held'].includes(input.status)) throw new ApiError('新增账号状态只能为草稿 / 空闲可租 / 已下架 / 已回收持有')
      db.seq.account++
      const a: Account = { ...input, id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote, createdAt: t, updatedAt: t }
      db.accounts.unshift(a)
      this.audit(db, '新增账号', `${a.accountNo}（${ACCOUNT_STATUS_LABEL[a.status]}）`)
      return a
    })
  }
  async deleteAccount(id: string) {
    this.requireAdmin()
    this.tx((db) => {
      const a = db.accounts.find((x) => x.id === id && !x.deleted)
      if (!a) throw new ApiError('账号不存在', 404)
      if (a.status === 'rented' || a.status === 'settling') throw new ApiError('租赁中 / 待结算的账号不能删除')
      a.deleted = true
      this.audit(db, '删除账号', a.accountNo)
    })
  }
  async setAccountStatus(id: string, status: AccountStatus) {
    this.requireAdmin()
    return this.tx((db) => {
      const a = db.accounts.find((x) => x.id === id && !x.deleted)
      if (!a) throw new ApiError('账号不存在', 404)
      if (!MANUAL_TRANSITIONS[a.status].includes(status))
        throw new ApiError(`不能从「${ACCOUNT_STATUS_LABEL[a.status]}」改为「${ACCOUNT_STATUS_LABEL[status]}」`)
      this.audit(db, '账号状态', `${a.accountNo}：${ACCOUNT_STATUS_LABEL[a.status]} → ${ACCOUNT_STATUS_LABEL[status]}`)
      a.status = status
      a.updatedAt = nowIso()
      return a
    })
  }

  // ---------- 订单 ----------
  async listOrders() {
    this.requireAdmin()
    return clone(this.load().orders)
  }
  async createOrder(input: OrderInput) {
    const user = this.requireAdmin()
    return this.tx((db) => {
      const a = db.accounts.find((x) => x.id === input.accountId && !x.deleted)
      if (!a) throw new ApiError('账号不存在', 404)
      if (a.status !== 'listed') throw new ApiError(`账号 ${a.accountNo} 当前为「${ACCOUNT_STATUS_LABEL[a.status]}」，不能登记订单`, 409)
      if (db.orders.some((o) => o.accountId === a.id && (o.status === 'active' || o.status === 'settling')))
        throw new ApiError('该账号已有进行中的订单', 409)
      if (!input.renterContact.trim()) throw new ApiError('请填写租客联系方式')
      if (!(input.rentalDays >= 1)) throw new ApiError('租期至少 1 天')
      if (input.deposit < 0 || input.extraFee < 0) throw new ApiError('金额不能为负')
      db.seq.order++
      const coinRent = a.quote.coinRent
      const o: RentalOrder = {
        id: `o${db.seq.order}`, orderNo: `ZD${String(db.seq.order).padStart(5, '0')}`, accountId: a.id, accountNo: a.accountNo,
        renterContact: input.renterContact.trim(), startAt: input.startAt, endAt: addDays(input.startAt, input.rentalDays),
        rentalDays: input.rentalDays, coinRent, extraFee: Math.round(input.extraFee), deposit: Math.round(input.deposit),
        totalAmount: coinRent + Math.round(input.extraFee) + Math.round(input.deposit), status: 'active', remark: input.remark,
        deposits: input.deposit > 0 ? [{ type: 'collect', amount: Math.round(input.deposit), reason: '收取押金', at: nowIso(), operator: user.username }] : [],
        createdBy: user.username, createdAt: nowIso(),
      }
      db.orders.unshift(o)
      a.status = 'rented'
      a.updatedAt = nowIso()
      this.audit(db, '登记订单', `${o.orderNo} 账号 ${a.accountNo} ${o.rentalDays} 天 总额 ${o.totalAmount}`)
      return o
    })
  }
  private findOrder(db: Db, id: string) {
    const o = db.orders.find((x) => x.id === id)
    if (!o) throw new ApiError('订单不存在', 404)
    return o
  }
  async endOrder(id: string) {
    this.requireAdmin()
    return this.tx((db) => {
      const o = this.findOrder(db, id)
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以结束')
      o.status = 'settling'
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = 'settling'
      this.audit(db, '订单到期', o.orderNo)
      return o
    })
  }
  async addDepositEntry(id: string, entry: Omit<DepositEntry, 'at' | 'operator'>) {
    const user = this.requireAdmin()
    return this.tx((db) => {
      const o = this.findOrder(db, id)
      if (o.status === 'done' || o.status === 'cancelled') throw new ApiError('订单已关闭')
      if (!(entry.amount > 0)) throw new ApiError('金额需大于 0')
      if (entry.type !== 'collect' && entry.amount > depositBalance(o)) throw new ApiError('超出押金余额')
      o.deposits.push({ ...entry, amount: Math.round(entry.amount), at: nowIso(), operator: user.username })
      this.audit(db, '押金流水', `${o.orderNo} ${entry.type} ${entry.amount}`)
      return o
    })
  }
  async completeOrder(id: string, relist: boolean, note = '') {
    this.requireAdmin()
    return this.tx((db) => {
      const o = this.findOrder(db, id)
      if (o.status !== 'settling') throw new ApiError('只有待结算的订单可以完成')
      if (depositBalance(o) !== 0 && !note.trim()) throw new ApiError('押金余额不为 0，请先处理或填写不退还原因')
      o.status = 'done'
      if (note) o.remark = [o.remark, `结算：${note}`].filter(Boolean).join('；')
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = relist ? 'listed' : 'off'
      this.audit(db, '订单完成', `${o.orderNo}，账号${relist ? '再上架' : '下架'}`)
      return o
    })
  }
  async cancelOrder(id: string) {
    this.requireAdmin()
    return this.tx((db) => {
      const o = this.findOrder(db, id)
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以取消')
      o.status = 'cancelled'
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = 'listed'
      this.audit(db, '取消订单', o.orderNo)
      return o
    })
  }

  // ---------- 回收 ----------
  async listRecycles() {
    this.requireAdmin()
    return clone(this.load().recycles)
  }
  async updateRecycle(id: string, toStatus: RecycleStatus, note: string, staffPrice?: number) {
    const user = this.requireAdmin()
    return this.tx((db) => {
      const r = db.recycles.find((x) => x.id === id)
      if (!r) throw new ApiError('回收单不存在', 404)
      if (toStatus !== r.status && !RECYCLE_TRANSITIONS[r.status].includes(toStatus))
        throw new ApiError(`不能从「${RECYCLE_STATUS_LABEL[r.status]}」到「${RECYCLE_STATUS_LABEL[toStatus]}」`)
      if (toStatus === 'quoted' && !(staffPrice! > 0)) throw new ApiError('报价需大于 0')
      if (toStatus === 'deal') throw new ApiError('请使用「成交入库」')
      r.events.push({ at: nowIso(), operator: user.username, fromStatus: r.status, toStatus, price: staffPrice, note })
      if (staffPrice != null && toStatus === 'quoted') r.staffPrice = Math.round(staffPrice)
      r.status = toStatus
      this.audit(db, '回收跟进', `${r.requestNo} → ${RECYCLE_STATUS_LABEL[toStatus]} ${note}`)
      return r
    })
  }
  async recycleToInventory(id: string) {
    const user = this.requireAdmin()
    return this.tx((db) => {
      const r = db.recycles.find((x) => x.id === id)
      if (!r) throw new ApiError('回收单不存在', 404)
      if (r.status !== 'quoted') throw new ApiError('只有「已报价」的单可以成交入库（需人工确认报价）')
      const s = r.asset
      const input: AccountInput = {
        status: 'held', source: 'recycle', ownerContact: s.contact, region: s.region, loginMethod: s.loginMethod, channel: '普通区',
        assistTime: '全天', banRecord: s.banRecord, totalAssets: s.totalAssets, coinAmount: s.coinAmount, secretKd: 0, level: s.level,
        rank: s.rank, safeBox: s.safeBox, stamina: '1级', load: '1级', awmCount: s.awmCount, helmet6Count: s.helmet6Count,
        armor6Count: s.armor6Count, experienceCardCount: s.experienceCardCount, skins: [...s.skins],
        cycle: Object.keys(db.pricingRule.cycleValues)[1] ?? Object.keys(db.pricingRule.cycleValues)[0], coinRatio: 20,
        discountMode: 'system', deposit: db.pricingRule.defaultDeposit, remark: `回收入库，来源 ${r.requestNo}，成交价 ${r.staffPrice} 元`,
      }
      db.seq.account++
      const t = nowIso()
      const coin = Math.max(input.coinAmount, 1)
      const a: Account = { ...input, coinAmount: coin, id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote: calcPricing(toPricingInput({ ...input, coinAmount: coin }), db.pricingRule), createdAt: t, updatedAt: t }
      db.accounts.unshift(a)
      r.events.push({ at: t, operator: user.username, fromStatus: r.status, toStatus: 'deal', price: r.staffPrice, note: `成交入库 → ${a.accountNo}` })
      r.status = 'deal'
      r.relatedAccountId = a.id
      this.audit(db, '回收入库', `${r.requestNo} → ${a.accountNo}`)
      return a
    })
  }

  // ---------- 规则 ----------
  async getPricingRule() { return clone(this.load().pricingRule) }
  async savePricingRule(rule: PricingRule) {
    this.requireAdmin()
    return this.tx((db) => {
      db.pricingRule = { ...clone(rule), version: db.pricingRule.version + 1 }
      this.audit(db, '计价规则', `保存为 v${db.pricingRule.version}`)
      return db.pricingRule
    })
  }
  async getValuationRule() { return clone(this.load().valuationRule) }
  async saveValuationRule(rule: ValuationRule) {
    this.requireAdmin()
    return this.tx((db) => {
      db.valuationRule = { ...clone(rule), version: db.valuationRule.version + 1 }
      this.audit(db, '估值规则', `保存为 v${db.valuationRule.version}`)
      return db.valuationRule
    })
  }
  async listCsAgents() { return clone(this.load().csAgents) }

  // ---------- 看板 ----------
  async dashboard(now = new Date()): Promise<DashboardStats> {
    this.requireAdmin()
    const db = this.load()
    const acc = db.accounts.filter((a) => !a.deleted)
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startWeek = startToday - ((now.getDay() + 6) % 7) * 86400000
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const valid = db.orders.filter((o) => o.status !== 'cancelled')
    const ts = (o: RentalOrder) => new Date(o.createdAt).getTime()
    const rev = (os: RentalOrder[]) => os.reduce((s, o) => s + o.coinRent + o.extraFee, 0)
    return {
      listed: acc.filter((a) => a.status === 'listed').length,
      rented: acc.filter((a) => a.status === 'rented').length,
      settling: acc.filter((a) => a.status === 'settling').length,
      held: acc.filter((a) => a.status === 'held').length,
      todayOrders: valid.filter((o) => ts(o) >= startToday).length,
      weekOrders: valid.filter((o) => ts(o) >= startWeek).length,
      pendingRecycles: db.recycles.filter((r) => ['submitted', 'following', 'quoted'].includes(r.status)).length,
      depositBalance: db.orders.filter((o) => o.status === 'active' || o.status === 'settling').reduce((s, o) => s + depositBalance(o), 0),
      revenueTotal: rev(valid),
      revenueMonth: rev(valid.filter((o) => ts(o) >= startMonth)),
    }
  }
  async auditLogs() {
    this.requireAdmin()
    return clone(this.load().audit)
  }
  async resetDemo() {
    this.storage.removeItem(DB_KEY)
    this.load()
  }
}

export function depositBalance(o: RentalOrder): number {
  return o.deposits.reduce((s, e) => s + (e.type === 'collect' ? e.amount : -e.amount), 0)
}
