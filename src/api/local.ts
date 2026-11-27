// localStorage 实现：模拟后端。算价 / 估值 / 状态流转 / 鉴权 / 字段裁剪全部在这一层执行。
import { dicts, type PricingRule, type ValuationRule } from '../config/rules'
import type { Dicts } from '../config/dictStore'
import { IMPORT_MAX_ROWS, parseImport, type ImportContext } from '../domain/importAccounts'
import { calcPricing } from '../domain/pricing'
import { can, type Cap } from '../domain/permissions'
import { buildReport, platformIncome, type ReportDimension } from '../domain/reports'
import { calcValuation, validateValuationInput } from '../domain/valuation'
import { lobbyAccountFor, pricingFor, toOwnerView } from '../domain/visibility'
import type {
  Account, AccountAdminView, AccountInput, Attachment, AccountStatus, DashboardStats, DepositEntry, OrderEvent, OrderInput, OrderStep, OwnerPayableEntry,
  OwnerProfile, PricingInput, RecycleRequest, RecycleStatus, RenterProfile, RenterTag, RentalOrder, StaffCreateInput, StaffUser, User, ValuationInput,
} from '../domain/types'
import { ACCOUNT_STATUS_LABEL, RECYCLE_STATUS_LABEL, RECYCLE_TRANSITIONS, RENTER_TAG_LABEL, ROLE_LABEL } from '../domain/types'
import { buildSeedDb, demoUsers, SEED_VERSION, toPricingInput, type Db, type DbUser } from '../mock/seed'
import type { Api, ApiFeatures, DemoAccount, ImportOutcome, OrderPreview, OrderView, OwnerListingInput, PricingOptions } from './types'

const DB_KEY = 'dr:v1:db'
const SESSION_KEY = 'dr:v1:session'
const DAY = 86400000

import { ApiError, type FieldError } from './errors'
export { ApiError }

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const nowIso = () => new Date().toISOString()
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * DAY).toISOString()
const norm = (c: string) => c.trim().toLowerCase()

/** 账号手工状态流转（订单相关流转由订单接口驱动） */
const MANUAL_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  draft: ['listed', 'off'], listed: ['off'], off: ['listed'], held: ['listed', 'off'], rented: [], settling: [],
}

export function depositBalance(o: RentalOrder): number {
  return o.deposits.reduce((s, e) => s + (e.type === 'collect' ? e.amount : -e.amount), 0)
}
export function payableBalance(entries: OwnerPayableEntry[]): number {
  return entries.reduce((s, e) => s + (e.type === 'accrue' ? e.amount : -e.amount), 0)
}

export class LocalApi implements Api {
  constructor(private storage: Storage = localStorage, private clock: () => number = () => Date.now()) {}

  // ---------- 存储 ----------
  private load(): Db {
    const raw = this.storage.getItem(DB_KEY)
    if (raw) {
      try {
        const db = JSON.parse(raw) as Db
        if (db.seedVersion === SEED_VERSION) return db
      } catch { /* 损坏则重建 */ }
      // 旧版本（v0.1 无 seedVersion）数据结构不兼容：整体重置为新种子，并清掉会话
      this.storage.removeItem(SESSION_KEY)
    }
    const db = buildSeedDb(this.clock())
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
    db.audit = db.audit.slice(0, 800)
  }
  private user(): User {
    const u = this.currentUser()
    if (!u) throw new ApiError('未登录', 401)
    return u
  }
  /** 已有截图保留（只认本账号原有的 id），新截图分配 id；最多 5 张、单张 ≤1MB */
  private bindAttachments(list: AccountInput['attachments'], prev: Attachment[], accountId: string): Attachment[] {
    if (!list) return prev
    if (list.length > 5) throw new ApiError('最多 5 张截图')
    const u = this.user(), t = nowIso()
    return list.map((x, i) => {
      if ('id' in x && x.id) { const old = prev.find((p) => p.id === x.id); if (!old) throw new ApiError('截图不存在'); return old }
      if (!/^data:image\//.test(x.dataUrl)) throw new ApiError('仅支持图片')
      if (x.dataUrl.length > 1.4 * 1024 * 1024) throw new ApiError('单张截图不超过 1MB')
      return { id: `f${accountId}-${Date.now() % 100000}-${i}`, name: x.name, dataUrl: x.dataUrl, uploadedBy: u.username, at: t }
    })
  }
  /** 自增账号序号，跳过已被导入占用的 DF 编号 */
  private bumpAccountSeq(db: Db) {
    const taken = new Set(db.accounts.map((a) => a.accountNo.toUpperCase()))
    do db.seq.account++; while (taken.has(`DF${db.seq.account}`))
  }
  /** 号主寄租：按联系方式关联 / 新建号主档案 */
  private linkOwner(db: Db, input: AccountInput) {
    if (input.source !== 'consign' || input.ownerId) return
    const c = norm(input.ownerContact)
    let owner = db.owners.find((o) => norm(o.contact) === c)
    if (!owner && c) { owner = { id: `ow${db.owners.length + 1}-${Date.now() % 10000}`, contact: input.ownerContact.trim(), displayName: input.ownerContact.trim() }; db.owners.push(owner) }
    input.ownerId = owner?.id
  }
  private importCtx(db: Db): ImportContext {
    return {
      regions: dicts.regions, loginMethods: dicts.loginMethods, channels: Object.keys(db.pricingRule.channelFeeRates), cycles: Object.keys(db.pricingRule.cycleValues),
      ranks: dicts.ranks, safeBoxes: dicts.safeBoxes, stamina: dicts.stamina, loads: dicts.loads, skins: dicts.skins.map((x) => x.name),
      existingNos: db.accounts.map((a) => a.accountNo),
    }
  }
  private need(cap: Cap): User {
    const u = this.user()
    if (!can(u.role, cap)) throw new ApiError('无权限（403）', 403)
    return u
  }

  // ---------- 认证 ----------
  async login(username: string, password: string): Promise<User> {
    const db = this.load()
    const u = db.users.find((x) => x.username === username.trim() && x.password === password)
    if (!u) throw new ApiError('账号或密码错误', 401)
    if (!u.enabled) throw new ApiError('该账号已停用', 403)
    this.storage.setItem(SESSION_KEY, JSON.stringify({ username: u.username }))
    return this.toUser(u)
  }
  private toUser(u: DbUser): User { return { username: u.username, displayName: u.displayName, role: u.role, ...(u.ownerId ? { ownerId: u.ownerId } : {}) } }
  async init() { /* mock：无需预取 */ }
  features(): ApiFeatures { return { mode: 'mock', demo: true } }
  async pricingOptions(): Promise<PricingOptions> {
    this.user()
    const r = this.load().pricingRule
    return { version: r.version, channels: Object.keys(r.channelFeeRates), cycles: Object.keys(r.cycleValues), customDiscountMin: r.customDiscountMin, customDiscountMax: r.customDiscountMax, defaultDeposit: r.defaultDeposit }
  }
  async logout() { this.storage.removeItem(SESSION_KEY) }
  currentUser(): User | null {
    const db = this.load() // 先加载（旧版本数据会在此重置并清会话）
    const raw = this.storage.getItem(SESSION_KEY)
    if (!raw) return null
    try {
      const { username } = JSON.parse(raw)
      const u = db.users.find((x) => x.username === username && x.enabled)
      return u ? this.toUser(u) : null
    } catch { return null }
  }
  demoAccounts(): DemoAccount[] {
    return demoUsers.map((u) => ({ username: u.username, password: u.password, role: u.role, displayName: u.displayName }))
  }

  // ---------- 内部工具 ----------
  private renterTag(db: Db, contact?: string): RenterTag | null {
    if (!contact?.trim()) return null
    return db.renters.find((r) => norm(r.contact) === norm(contact))?.tag ?? null
  }
  private renterProfile(db: Db, contact: string): RenterProfile | null {
    const key = norm(contact)
    if (!key) return null
    const base = db.renters.find((r) => norm(r.contact) === key)
    const os = db.orders.filter((o) => norm(o.renterContact) === key && o.status !== 'cancelled')
    if (!base && !os.length) return null
    return {
      contact: base?.contact ?? os[0].renterContact,
      displayName: base?.displayName ?? '',
      tag: base?.tag ?? null,
      note: base?.note ?? '',
      rentalCount: os.length,
      totalSpend: os.reduce((s, o) => s + o.coinRent + o.extraFee, 0),
      depositDeductCount: os.filter((o) => o.deposits.some((d) => d.type === 'deduct')).length,
      lastRentAt: os.map((o) => o.startAt).sort().pop() ?? null,
    }
  }
  private adminView(db: Db, a: Account): AccountAdminView {
    const income = db.orders.filter((o) => o.accountId === a.id && o.status !== 'cancelled').reduce((s, o) => s + platformIncome(o), 0)
    const owner = db.owners.find((o) => o.id === (a.ownerId ?? a.formerOwnerId))
    return { ...a, cumulativeIncome: income, paybackPercent: a.source === 'buyin' && a.costAmount > 0 ? Math.round((income / a.costAmount) * 1000) / 10 : null, ownerName: owner?.displayName }
  }
  private ownerScope(db: Db, u: User): Account[] {
    const mine = (a: Account) => !a.deleted && (a.ownerId === u.ownerId || a.formerOwnerId === u.ownerId)
    if (u.role === 'owner') {
      if (!u.ownerId) return []
      return db.accounts.filter(mine)
    }
    if (can(u.role, 'ownerPortalAll')) return db.accounts.filter((a) => !a.deleted && (a.ownerId || a.formerOwnerId))
    throw new ApiError('无权限（403）', 403)
  }
  private ownerViewOf(db: Db, a: Account, withOwnerName: boolean) {
    const active = db.orders.find((o) => o.accountId === a.id && (o.status === 'active' || o.status === 'settling'))
    const rec = db.recycles.filter((r) => r.sourceAccountId === a.id && r.status !== 'cancelled').sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]
    const name = withOwnerName ? db.owners.find((o) => o.id === (a.ownerId ?? a.formerOwnerId))?.displayName : undefined
    return toOwnerView(a, active, rec, name)
  }
  private findAccount(db: Db, id: string) {
    const a = db.accounts.find((x) => x.id === id && !x.deleted)
    if (!a) throw new ApiError('账号不存在', 404)
    return a
  }
  private findOrder(db: Db, id: string) {
    const o = db.orders.find((x) => x.id === id)
    if (!o) throw new ApiError('订单不存在', 404)
    return o
  }
  private event(o: RentalOrder, step: OrderStep, note: string, operator: string) {
    const e: OrderEvent = { step, note, at: nowIso(), operator }
    o.events.push(e)
  }
  private orderPayableBalance(db: Db, o: RentalOrder) { return payableBalance(db.payables.filter((p) => p.orderId === o.id)) }
  private addPayable(db: Db, a: Account, o: RentalOrder | undefined, type: OwnerPayableEntry['type'], amount: number, note: string, operator: string) {
    db.seq.entry++
    db.payables.push({ id: `p${db.seq.entry}`, ownerId: a.ownerId ?? a.formerOwnerId!, accountId: a.id, accountNo: a.accountNo, orderId: o?.id, orderNo: o?.orderNo, type, amount: Math.round(amount), note, at: nowIso(), operator })
  }

  // ---------- 前台 ----------
  async listListedAccounts() {
    const u = this.need('front')
    return this.load().accounts.filter((a) => a.status === 'listed' && !a.deleted).map((a) => lobbyAccountFor(u.role, clone(a)))
  }
  async getAccount(id: string) {
    const u = this.need('front')
    const a = this.load().accounts.find((x) => x.id === id && !x.deleted)
    if (!a) return undefined
    // 非员工只能看在架账号（防止按编号窥探他人号）
    if (!can(u.role, 'inventoryView') && a.status !== 'listed') return undefined
    return lobbyAccountFor(u.role, clone(a))
  }
  async calcPricing(input: PricingInput) {
    const u = this.need('front')
    const db = this.load()
    const regular = this.renterTag(db, input.renterContact) === 'regular'
    return pricingFor(u.role, calcPricing({ ...input, renterRegular: regular }, db.pricingRule))
  }
  async calcValuation(input: ValuationInput) {
    this.need('front')
    return calcValuation(input, this.load().valuationRule)
  }
  async submitRecycle(input: ValuationInput, opts: { sourceAccountId?: string } = {}) {
    const user = this.need('front')
    return this.tx((db) => {
      if (opts.sourceAccountId) {
        const a = this.findAccount(db, opts.sourceAccountId)
        if (user.role === 'owner' && a.ownerId !== user.ownerId) throw new ApiError('只能转入自己的账号', 403)
        if (user.role !== 'owner' && !can(user.role, 'recycles')) throw new ApiError('无权限（403）', 403)
        if (db.recycles.some((r) => r.sourceAccountId === a.id && ['submitted', 'following', 'quoted'].includes(r.status)))
          throw new ApiError('该账号已有进行中的回收申请')
      }
      const key = JSON.stringify({ ...input, remark: undefined })
      const dup = db.recycles.find(
        (r) => r.submitter === user.username && JSON.stringify({ ...r.asset, remark: undefined }) === key &&
          this.clock() - new Date(r.createdAt).getTime() < 10 * 60000 && r.status !== 'cancelled',
      )
      if (dup) throw new ApiError(`10 分钟内已提交过相同资产（单号 ${dup.requestNo}），请勿重复提交`, 409)
      const result = calcValuation(input, db.valuationRule)
      db.seq.recycle++
      const at = nowIso()
      const req: RecycleRequest = {
        id: `r${db.seq.recycle}`, requestNo: `HS${String(db.seq.recycle).padStart(5, '0')}`, submitter: user.username,
        ownerId: user.role === 'owner' ? user.ownerId : undefined, sourceAccountId: opts.sourceAccountId,
        contact: input.contact, asset: clone(input), result, status: 'submitted', createdAt: at,
        events: [{ at, operator: user.username, fromStatus: null, toStatus: 'submitted', note: opts.sourceAccountId ? '号主从账号转入回收' : '提交回收申请' }],
      }
      db.recycles.unshift(req)
      this.audit(db, '回收提交', `${req.requestNo} 参考价 ${result.min}-${result.max}${opts.sourceAccountId ? '（号主转入）' : ''}`)
      return req
    })
  }
  async myRecycles() {
    const user = this.need('front')
    return clone(this.load().recycles.filter((r) => r.submitter === user.username))
  }
  async currentCsAgent(now = new Date()) {
    const agents = this.load().csAgents
    const wd = now.getDay()
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const on = agents.find((a) => !a.isFallback && a.schedule.some((s) => s.weekdays.includes(wd) && hm >= s.start && hm < s.end))
    return clone(on ?? agents.find((a) => a.isFallback) ?? null)
  }
  async listCsAgents() { return clone(this.load().csAgents) }
  async getDicts(): Promise<Dicts> {
    this.need('front')
    const { regions, loginMethods, ranks, safeBoxes, stamina, loads, skins } = dicts
    return clone({ regions, loginMethods, ranks, safeBoxes, stamina, loads, skins })
  }
  /** mock 的截图是 data URL，不会过期：原样返回（仍按可见性检查） */
  async refreshAttachment(id: string): Promise<Attachment> {
    const u = this.need('front')
    const db = this.load()
    for (const a of db.accounts) {
      const x = a.attachments.find((y) => y.id === id)
      if (!x) continue
      const mine = u.role === 'owner' && !!u.ownerId && (a.ownerId === u.ownerId || a.formerOwnerId === u.ownerId)
      if (can(u.role, 'inventoryView') || can(u.role, 'ownerPortalAll') || mine) return clone(x)
    }
    throw new ApiError('截图不存在', 404, 'NOT_FOUND')
  }

  // ---------- 号主门户 ----------
  async ownerAccounts() {
    const u = this.user()
    const db = this.load()
    return this.ownerScope(db, u).map((a) => this.ownerViewOf(db, a, u.role !== 'owner'))
  }
  async ownerAccount(id: string) {
    const u = this.user()
    const db = this.load()
    const a = this.ownerScope(db, u).find((x) => x.id === id)
    if (!a) throw new ApiError('账号不存在或无权查看', 404)
    return this.ownerViewOf(db, a, u.role !== 'owner')
  }
  private ownerAccountInput(db: Db, ownerId: string, asset: ValuationInput, assistTime: string, remark: string): AccountInput {
    const d = db.pricingRule.ownerDefaults
    const owner = db.owners.find((o) => o.id === ownerId)
    return {
      status: 'draft', source: 'consign', ownerId, ownerContact: owner?.contact ?? asset.contact, costAmount: 0,
      region: asset.region, loginMethod: asset.loginMethod, channel: d.channel, assistTime: assistTime || '全天', banRecord: asset.banRecord,
      totalAssets: asset.totalAssets, coinAmount: asset.coinAmount, secretKd: 0, level: asset.level, rank: asset.rank, safeBox: asset.safeBox,
      stamina: '1级', load: '1级', awmCount: asset.awmCount, helmet6Count: asset.helmet6Count, armor6Count: asset.armor6Count,
      experienceCardCount: asset.experienceCardCount, skins: [...asset.skins], cycle: d.cycle, coinRatio: d.coinRatio, discountMode: 'system',
      deposit: db.pricingRule.defaultDeposit, remark,
    }
  }
  async ownerEstimate(asset: ValuationInput) {
    const u = this.need('ownerPortal')
    const db = this.load()
    const errs = validateValuationInput({ ...asset, contact: asset.contact || 'owner' })
    if (errs.length) throw new ApiError(errs.join('；'))
    if (!(asset.coinAmount > 0)) throw new ApiError('纯币需大于 0')
    const q = calcPricing(toPricingInput(this.ownerAccountInput(db, u.ownerId!, asset, '', '')), db.pricingRule)
    return { takeHome: q.ownerSettlement, ruleVersion: q.ruleVersion }
  }
  async ownerSubmitListing(input: OwnerListingInput) {
    const u = this.need('ownerPortal')
    return this.tx((db) => {
      let asset = input.asset
      if (input.fromRecycleId) {
        const r = db.recycles.find((x) => x.id === input.fromRecycleId)
        if (!r || r.submitter !== u.username) throw new ApiError('只能复用自己提交的回收估值', 403)
        asset = clone(r.asset)
      }
      const errs = validateValuationInput({ ...asset, contact: asset.contact || 'owner' })
      if (errs.length) throw new ApiError(errs.join('；'))
      if (!(asset.coinAmount > 0)) throw new ApiError('纯币需大于 0')
      if (input.attachments.length > 5) throw new ApiError('最多上传 5 张截图')
      if (input.attachments.some((x) => x.dataUrl.length > 1_400_000)) throw new ApiError('单张截图不能超过 1MB')
      const acc = this.ownerAccountInput(db, u.ownerId!, asset, input.assistTime, input.remark)
      this.bumpAccountSeq(db)
      const t = nowIso()
      const a: Account = {
        ...acc, id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote: calcPricing(toPricingInput(acc), db.pricingRule),
        attachments: input.attachments.map((x, i) => ({ ...x, id: `f${db.seq.account}-${i}`, uploadedBy: u.username, at: t })), createdAt: t, updatedAt: t,
      }
      db.accounts.unshift(a)
      this.audit(db, '号主上架', `${a.accountNo}（待确认）${input.fromRecycleId ? '复用回收估值' : ''}`)
      return this.ownerViewOf(db, a, false)
    })
  }
  async ownerRecycleDraft(accountId: string) {
    const u = this.user()
    const db = this.load()
    const a = this.ownerScope(db, u).find((x) => x.id === accountId)
    if (!a) throw new ApiError('账号不存在或无权查看', 404)
    const owner = db.owners.find((o) => o.id === a.ownerId)
    const v: ValuationInput = {
      contact: owner?.contact ?? '', region: a.region, loginMethod: a.loginMethod, coinAmount: a.coinAmount, totalAssets: a.totalAssets, level: a.level,
      rank: a.rank, safeBox: a.safeBox, skins: [...a.skins], banRecord: a.banRecord, awmCount: a.awmCount, helmet6Count: a.helmet6Count,
      armor6Count: a.armor6Count, experienceCardCount: a.experienceCardCount, remark: `由账号 ${a.accountNo} 转入`,
    }
    return v
  }

  // ---------- 库存 ----------
  async listAccounts() {
    this.need('inventoryView')
    const db = this.load()
    return db.accounts.filter((a) => !a.deleted).map((a) => this.adminView(db, clone(a)))
  }
  async saveAccount(input: AccountInput) {
    this.need('inventoryEdit')
    return this.tx((db) => {
      const quote = calcPricing(toPricingInput(input), db.pricingRule)
      const t = nowIso()
      this.linkOwner(db, input)
      if (input.id) {
        const a = this.findAccount(db, input.id)
        if (input.status !== a.status) throw new ApiError('状态请用状态操作按钮修改')
        Object.assign(a, input, { quote, updatedAt: t, attachments: this.bindAttachments(input.attachments, a.attachments, a.id) })
        this.audit(db, '编辑账号', `${a.accountNo}`)
        return this.adminView(db, a)
      }
      if (!['draft', 'listed', 'off', 'held'].includes(input.status)) throw new ApiError('新增账号状态只能为草稿 / 空闲可租 / 已下架 / 已回收持有')
      this.bumpAccountSeq(db)
      const a: Account = { ...input, attachments: this.bindAttachments(input.attachments, [], `a${db.seq.account}`), id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote, createdAt: t, updatedAt: t }
      db.accounts.unshift(a)
      this.audit(db, '新增账号', `${a.accountNo}（${ACCOUNT_STATUS_LABEL[a.status]}）`)
      return this.adminView(db, a)
    })
  }
  // ---------- 批量导入（仅运营 / 管理员） ----------
  async importContext() {
    this.need('inventoryEdit')
    return this.importCtx(this.load())
  }
  async importAccounts(aoa: unknown[][], fileName: string): Promise<ImportOutcome> {
    const user = this.need('inventoryEdit')
    if (!Array.isArray(aoa)) throw new ApiError('导入数据格式错误')
    if (aoa.length - 1 > IMPORT_MAX_ROWS) throw new ApiError(`单次最多导入 ${IMPORT_MAX_ROWS} 行`)
    return this.tx((db) => {
      // 服务端以当前库存重新校验，不信任前端预览结果
      const parsed = parseImport(aoa, this.importCtx(db))
      if (parsed.headerErrors.length) throw new ApiError(parsed.headerErrors.join('；'))
      const t = nowIso()
      const imported: string[] = []
      for (const row of parsed.rows) {
        if (!row.input) continue
        const { accountNo, ...input } = row.input
        this.linkOwner(db, input)
        this.bumpAccountSeq(db)
        const a: Account = { ...input, status: 'draft', attachments: [], id: `a${db.seq.account}`, accountNo, quote: calcPricing(toPricingInput(input), db.pricingRule), createdAt: t, updatedAt: t }
        db.accounts.unshift(a)
        imported.push(accountNo)
      }
      const skipped = parsed.rows.filter((r) => r.errors.length).map((r) => ({ rowNo: r.rowNo, accountNo: r.accountNo, errors: r.errors }))
      this.audit(db, '批量导入', `${fileName}：导入 ${imported.length} 条（待确认）${imported.length ? '：' + imported.slice(0, 20).join('、') + (imported.length > 20 ? ' 等' : '') : ''}；跳过 ${skipped.length} 条${skipped.length ? '（第 ' + skipped.map((x) => x.rowNo).join('、') + ' 行）' : ''}`)
      return { imported, skipped, operator: user.username }
    })
  }
  async deleteAccount(id: string) {
    this.need('inventoryEdit')
    this.tx((db) => {
      const a = this.findAccount(db, id)
      if (a.status === 'rented' || a.status === 'settling') throw new ApiError('租赁中 / 待结算的账号不能删除')
      a.deleted = true
      this.audit(db, '删除账号', a.accountNo)
    })
  }
  async setAccountStatus(id: string, status: AccountStatus) {
    this.need('inventoryEdit')
    return this.tx((db) => {
      const a = this.findAccount(db, id)
      if (!MANUAL_TRANSITIONS[a.status].includes(status))
        throw new ApiError(`不能从「${ACCOUNT_STATUS_LABEL[a.status]}」改为「${ACCOUNT_STATUS_LABEL[status]}」`)
      this.audit(db, '账号状态', `${a.accountNo}：${ACCOUNT_STATUS_LABEL[a.status]} → ${ACCOUNT_STATUS_LABEL[status]}`)
      a.status = status
      a.updatedAt = nowIso()
      return this.adminView(db, a)
    })
  }

  // ---------- 订单 ----------
  private reminderOf(db: Db, o: RentalOrder): OrderView['reminder'] {
    if (o.status !== 'active') return null
    const left = new Date(o.endAt).getTime() - this.clock()
    if (left < 0) return 'overdue'
    if (left <= db.pricingRule.expiryRemindHours * 3600000) return 'expiring'
    return null
  }
  async listOrders(): Promise<OrderView[]> {
    this.need('orders')
    const db = this.load()
    return clone(db.orders).map((o) => this.orderView(db, o))
  }
  async getOrder(id: string): Promise<OrderView> {
    this.need('orders')
    const db = this.load()
    const o = db.orders.find((x) => x.id === id)
    if (!o) throw new ApiError('订单不存在', 404, 'NOT_FOUND')
    return this.orderView(db, clone(o))
  }
  private orderView(db: Db, o: RentalOrder): OrderView { return { ...o, reminder: this.reminderOf(db, o), ownerPayableBalance: this.orderPayableBalance(db, o) } }
  /** 账号报价快照所记版本的计价规则；改规则不影响已上架账号的价格（缺快照时退回当前规则） */
  private pricingRuleAt(db: Db, version: number | undefined): PricingRule {
    if (version === undefined || version === db.pricingRule.version) return db.pricingRule
    return db.pricingHistory.find((h) => h.version === version)?.rule ?? db.pricingRule
  }
  private orderQuote(db: Db, a: Account, renterContact: string) {
    const tag = this.renterTag(db, renterContact)
    const q = calcPricing(toPricingInput(a, tag === 'regular'), this.pricingRuleAt(db, a.quote?.ruleVersion))
    return { tag, q }
  }
  async previewOrder(accountId: string, renterContact: string): Promise<OrderPreview> {
    this.need('orders')
    const db = this.load()
    const a = this.findAccount(db, accountId)
    const { tag, q } = this.orderQuote(db, a, renterContact)
    return {
      profile: this.renterProfile(db, renterContact), blocked: tag === 'blacklist', coinRent: q.coinRent, extraFee: q.extraFee, deposit: q.deposit,
      ownerPayable: a.source === 'consign' ? q.ownerSettlement : 0, rentalDays: q.rentalDays, regularApplied: q.regularDiscountApplied, depositWaived: q.depositWaived,
      ruleVersion: q.ruleVersion,
    }
  }
  async createOrder(input: OrderInput) {
    const user = this.need('orders')
    return this.tx((db) => {
      const a = this.findAccount(db, input.accountId)
      if (a.status !== 'listed') throw new ApiError(`账号 ${a.accountNo} 当前为「${ACCOUNT_STATUS_LABEL[a.status]}」，不能登记订单`, 409)
      if (db.orders.some((o) => o.accountId === a.id && (o.status === 'active' || o.status === 'settling')))
        throw new ApiError('该账号已有进行中的订单', 409)
      if (!input.renterContact.trim()) throw new ApiError('请填写租客联系方式')
      const { tag, q } = this.orderQuote(db, a, input.renterContact)
      if (tag === 'blacklist') {
        const r = db.renters.find((x) => norm(x.contact) === norm(input.renterContact))
        this.audit(db, '拦截黑名单', `${input.renterContact.trim()} 尝试租 ${a.accountNo}`)
        this.save(db)
        throw new ApiError(`该租客在黑名单中，禁止登记${r?.note ? `（${r.note}）` : ''}`, 409, 'RENTER_BLACKLISTED')
      }
      if (!(input.rentalDays >= 1)) throw new ApiError('租期至少 1 天')
      if (input.deposit < 0 || input.extraFee < 0) throw new ApiError('金额不能为负')
      const regular = tag === 'regular'
      const rule = this.pricingRuleAt(db, a.quote?.ruleVersion)
      const deposit = regular && rule.regularWaiveDeposit ? 0 : Math.round(input.deposit)
      const extraFee = Math.round(input.extraFee)
      db.seq.order++
      const at = nowIso()
      const o: RentalOrder = {
        id: `o${db.seq.order}`, orderNo: `ZD${String(db.seq.order).padStart(5, '0')}`, accountId: a.id, accountNo: a.accountNo,
        renterContact: input.renterContact.trim(), startAt: input.startAt, endAt: addDays(input.startAt, input.rentalDays),
        rentalDays: input.rentalDays, coinRent: q.coinRent, extraFee, deposit, totalAmount: q.coinRent + extraFee + deposit,
        ownerPayable: a.source === 'consign' ? q.ownerSettlement : 0, ruleVersion: q.ruleVersion, regularApplied: regular, handedOver: false, returned: false,
        status: 'active', remark: input.remark, deposits: [], events: [], createdBy: user.username, createdAt: at,
      }
      this.event(o, 'register', `登记 ${o.rentalDays} 天，租金 ${o.coinRent}${regular ? '（熟客优惠）' : ''}${tag === 'caution' ? '【慎租】' : ''}`, user.username)
      if (deposit > 0) {
        o.deposits.push({ type: 'collect', amount: deposit, reason: '收取押金', at, operator: user.username })
        this.event(o, 'collect', `收押金 ${deposit}`, user.username)
      } else if (regular && rule.regularWaiveDeposit) this.event(o, 'collect', '熟客免押金', user.username)
      db.orders.unshift(o)
      if (o.ownerPayable) this.addPayable(db, a, o, 'accrue', o.ownerPayable, '订单登记计提', user.username)
      a.status = 'rented'
      a.updatedAt = at
      this.audit(db, '登记订单', `${o.orderNo} 账号 ${a.accountNo} ${o.rentalDays} 天 总额 ${o.totalAmount}${regular ? ' 熟客' : ''}`)
      return o
    })
  }
  private orderOp(id: string, fn: (db: Db, o: RentalOrder, user: User) => void, action: string) {
    const user = this.need('orders')
    return this.tx((db) => {
      const o = this.findOrder(db, id)
      fn(db, o, user)
      this.audit(db, action, o.orderNo)
      return o
    })
  }
  async markHandover(id: string, note = '') {
    return this.orderOp(id, (_db, o, u) => {
      if (o.status !== 'active' || o.handedOver) throw new ApiError('当前不能登记交号')
      o.handedOver = true
      this.event(o, 'handover', note || '已交号', u.username)
    }, '订单交号')
  }
  async extendOrder(id: string, rentalDays: number, note = '') {
    return this.orderOp(id, (_db, o, u) => {
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以改租期')
      if (!(rentalDays >= 1)) throw new ApiError('租期至少 1 天')
      const before = o.rentalDays
      o.rentalDays = rentalDays
      o.endAt = addDays(o.startAt, rentalDays)
      this.event(o, 'extend', `租期 ${before} → ${rentalDays} 天${note ? '，' + note : ''}`, u.username)
    }, '改租期')
  }
  async endOrder(id: string, note = '') {
    return this.orderOp(id, (db, o, u) => {
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以结束')
      o.status = 'settling'
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = 'settling'
      this.event(o, 'expire', note || '到期 / 提前结束', u.username)
    }, '订单到期')
  }
  async markReturned(id: string, note = '') {
    return this.orderOp(id, (_db, o, u) => {
      if (o.status !== 'settling' || o.returned) throw new ApiError('到期后才能登记还号')
      o.returned = true
      this.event(o, 'return', note || '已还号', u.username)
    }, '订单还号')
  }
  async addDepositEntry(id: string, entry: Omit<DepositEntry, 'at' | 'operator'>) {
    return this.orderOp(id, (_db, o, u) => {
      if (o.status === 'done' || o.status === 'cancelled') throw new ApiError('订单已关闭')
      if (!(entry.amount > 0)) throw new ApiError('金额需大于 0')
      if (entry.type !== 'collect' && entry.amount > depositBalance(o)) throw new ApiError('超出押金余额')
      const amount = Math.round(entry.amount)
      o.deposits.push({ ...entry, amount, at: nowIso(), operator: u.username })
      const step: OrderStep = entry.type === 'refund' ? 'refund' : entry.type === 'deduct' ? 'deduct' : 'collect'
      this.event(o, step, `${{ collect: '收押金', deduct: '扣押金', refund: '退押金' }[entry.type]} ${amount}${entry.reason ? '（' + entry.reason + '）' : ''}`, u.username)
    }, '押金流水')
  }
  async payOwner(orderId: string, amount: number, note: string) {
    return this.orderOp(orderId, (db, o, u) => {
      if (o.status === 'cancelled') throw new ApiError('订单已取消')
      if (!(amount > 0)) throw new ApiError('金额需大于 0')
      if (amount > this.orderPayableBalance(db, o)) throw new ApiError('超出本单号主应付余额')
      const a = db.accounts.find((x) => x.id === o.accountId)!
      this.addPayable(db, a, o, 'pay', amount, note || '付号主款', u.username)
      this.event(o, 'payOwner', `付号主 ${Math.round(amount)}${note ? '（' + note + '）' : ''}`, u.username)
    }, '付号主款')
  }
  async completeOrder(id: string, relist: boolean, note = '') {
    return this.orderOp(id, (db, o, u) => {
      if (o.status !== 'settling') throw new ApiError('只有待结算的订单可以完成')
      if (depositBalance(o) !== 0 && !note.trim()) throw new ApiError('押金余额不为 0，请先处理或填写不退还原因')
      if (this.orderPayableBalance(db, o) !== 0 && !note.trim()) throw new ApiError('号主应付未结清，请先付款或填写说明（如月结）')
      o.status = 'done'
      if (note) o.remark = [o.remark, `结算：${note}`].filter(Boolean).join('；')
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = relist ? 'listed' : 'off'
      this.event(o, 'settle', `结算完成，账号${relist ? '再上架' : '下架'}${note ? '；' + note : ''}`, u.username)
    }, '订单完成')
  }
  async cancelOrder(id: string, note = '') {
    return this.orderOp(id, (db, o, u) => {
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以取消')
      if (o.handedOver) throw new ApiError('已交号的订单不能取消，请走到期结算')
      o.status = 'cancelled'
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = 'listed'
      const bal = this.orderPayableBalance(db, o)
      if (a && bal > 0) this.addPayable(db, a, o, 'reverse', bal, '订单取消冲销', u.username)
      const dep = depositBalance(o)
      if (dep > 0) { o.deposits.push({ type: 'refund', amount: dep, reason: '取消退还', at: nowIso(), operator: u.username }); this.event(o, 'refund', `退押金 ${dep}`, u.username) }
      this.event(o, 'cancel', note || '取消订单', u.username)
    }, '取消订单')
  }
  async listPayables(filter: { ownerId?: string; orderId?: string } = {}) {
    this.need('orders')
    const { ownerId, orderId } = filter
    return clone(this.load().payables.filter((p) => (!ownerId || p.ownerId === ownerId) && (!orderId || p.orderId === orderId))).sort((a, b) => b.at.localeCompare(a.at))
  }

  // ---------- 客户档案 ----------
  async renterProfiles() {
    this.need('profiles')
    const db = this.load()
    const keys = new Map<string, string>()
    for (const r of db.renters) keys.set(norm(r.contact), r.contact)
    for (const o of db.orders) if (!keys.has(norm(o.renterContact))) keys.set(norm(o.renterContact), o.renterContact)
    return [...keys.values()].map((c) => this.renterProfile(db, c)!).filter(Boolean).sort((a, b) => b.rentalCount - a.rentalCount)
  }
  async lookupRenter(contact: string) {
    this.need('profiles')
    return this.renterProfile(this.load(), contact)
  }
  async saveRenter(input: { contact: string; displayName: string; tag: RenterTag | null; note: string }) {
    this.need('profiles')
    return this.tx((db) => {
      const contact = input.contact.trim()
      if (!contact) throw new ApiError('请填写联系方式')
      let r = db.renters.find((x) => norm(x.contact) === norm(contact))
      const before = r?.tag ?? null
      if (!r) { r = { contact, displayName: '', tag: null, note: '' }; db.renters.push(r) }
      Object.assign(r, { displayName: input.displayName, tag: input.tag, note: input.note })
      const lab = (t: RenterTag | null) => (t ? RENTER_TAG_LABEL[t] : '无')
      this.audit(db, '租客标签', `${contact}：${lab(before)} → ${lab(input.tag)}`)
      return this.renterProfile(db, contact)!
    })
  }
  async ownerProfiles(): Promise<OwnerProfile[]> {
    this.need('profiles')
    const db = this.load()
    return db.owners.map((o) => {
      const es = db.payables.filter((p) => p.ownerId === o.id)
      return {
        id: o.id, contact: o.contact, displayName: o.displayName, userId: o.userId,
        consignedCount: db.accounts.filter((a) => !a.deleted && a.ownerId === o.id).length,
        cumulativeSettlement: es.filter((e) => e.type === 'pay').reduce((s, e) => s + e.amount, 0),
        accrued: es.filter((e) => e.type === 'accrue').reduce((s, e) => s + e.amount, 0),
        balance: payableBalance(es),
      }
    })
  }

  // ---------- 回收 ----------
  async listRecycles() {
    this.need('recycles')
    return clone(this.load().recycles)
  }
  async updateRecycle(id: string, toStatus: RecycleStatus, note: string, staffPrice?: number) {
    const user = this.need('recycles')
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
    const user = this.need('recycles')
    return this.tx((db) => {
      const r = db.recycles.find((x) => x.id === id)
      if (!r) throw new ApiError('回收单不存在', 404)
      if (r.status !== 'quoted') throw new ApiError('只有「已报价」的单可以成交入库（需人工确认报价）')
      const t = nowIso()
      let a: Account
      if (r.sourceAccountId) {
        // 号主转回收：原账号转为自收
        a = this.findAccount(db, r.sourceAccountId)
        if (a.status === 'rented' || a.status === 'settling') throw new ApiError('该账号仍在租赁 / 待结算中，结算后再成交')
        Object.assign(a, { formerOwnerId: a.ownerId, ownerId: undefined, source: 'buyin', costAmount: r.staffPrice ?? 0, status: 'held', ownerContact: '自有', updatedAt: t,
          remark: [a.remark, `号主转回收 ${r.requestNo}，成交价 ${r.staffPrice} 元`].filter(Boolean).join('；') })
      } else {
        const s = r.asset
        const input: AccountInput = {
          status: 'held', source: 'buyin', ownerContact: '自有', costAmount: r.staffPrice ?? 0, region: s.region, loginMethod: s.loginMethod, channel: '普通区',
          assistTime: '全天', banRecord: s.banRecord, totalAssets: s.totalAssets, coinAmount: Math.max(s.coinAmount, 1), secretKd: 0, level: s.level,
          rank: s.rank, safeBox: s.safeBox, stamina: '1级', load: '1级', awmCount: s.awmCount, helmet6Count: s.helmet6Count,
          armor6Count: s.armor6Count, experienceCardCount: s.experienceCardCount, skins: [...s.skins],
          cycle: db.pricingRule.ownerDefaults.cycle, coinRatio: db.pricingRule.ownerDefaults.coinRatio,
          discountMode: 'system', deposit: db.pricingRule.defaultDeposit, remark: `回收入库，来源 ${r.requestNo}，成交价 ${r.staffPrice} 元`,
        }
        this.bumpAccountSeq(db)
        a = { ...input, attachments: [], id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote: calcPricing(toPricingInput(input), db.pricingRule), createdAt: t, updatedAt: t }
        db.accounts.unshift(a)
      }
      r.events.push({ at: t, operator: user.username, fromStatus: r.status, toStatus: 'deal', price: r.staffPrice, note: `成交入库 → ${a.accountNo}（自收，成本 ${r.staffPrice}）` })
      r.status = 'deal'
      r.relatedAccountId = a.id
      this.audit(db, '回收入库', `${r.requestNo} → ${a.accountNo} 成本 ${r.staffPrice}`)
      return this.adminView(db, a)
    })
  }

  // ---------- 规则 ----------
  async getPricingRule() { this.need('inventoryView'); return clone(this.load().pricingRule) }
  async savePricingRule(rule: PricingRule, summary = '') {
    const u = this.need('rulesEdit')
    return this.tx((db) => {
      db.pricingRule = { ...clone(rule), version: db.pricingRule.version + 1 }
      db.pricingHistory.unshift({ version: db.pricingRule.version, savedAt: nowIso(), savedBy: u.username, summary: summary || '修改计价规则', rule: clone(db.pricingRule) })
      this.audit(db, '计价规则', `保存为 v${db.pricingRule.version} ${summary}`)
      return db.pricingRule
    })
  }
  async getValuationRule() { this.need('rulesEdit'); return clone(this.load().valuationRule) }
  async saveValuationRule(rule: ValuationRule, summary = '') {
    const u = this.need('rulesEdit')
    return this.tx((db) => {
      db.valuationRule = { ...clone(rule), version: db.valuationRule.version + 1 }
      db.valuationHistory.unshift({ version: db.valuationRule.version, savedAt: nowIso(), savedBy: u.username, summary: summary || `市场系数 ${db.valuationRule.marketCoefficient}`, rule: clone(db.valuationRule) })
      this.audit(db, '估值依据', `保存为 v${db.valuationRule.version} ${summary}`)
      return db.valuationRule
    })
  }
  async ruleHistory() {
    this.need('rulesEdit')
    const db = this.load()
    return { pricing: db.pricingHistory.map(({ rule, ...m }) => clone(m)), valuation: db.valuationHistory.map(({ rule, ...m }) => clone(m)) }
  }
  async trialPricing(input: PricingInput, rule: PricingRule) { this.need('rulesEdit'); return calcPricing(input, rule) }
  async trialValuation(input: ValuationInput, rule: ValuationRule) { this.need('rulesEdit'); return calcValuation(input, rule) }

  // ---------- 报表、看板、员工 ----------
  async report(fromMs: number, toMs: number, dimension: ReportDimension) {
    this.need('reports')
    const db = this.load()
    return buildReport(db.accounts, db.orders, fromMs, toMs, dimension, this.clock())
  }
  async dashboard(now = new Date(this.clock())): Promise<DashboardStats> {
    this.need('dashboard')
    const db = this.load()
    const acc = db.accounts.filter((a) => !a.deleted)
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startWeek = startToday - ((now.getDay() + 6) % 7) * DAY
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
      expiringOrders: db.orders.filter((o) => this.reminderOf(db, o)).length,
      ownerPayableBalance: payableBalance(db.payables),
      revenueTotal: rev(valid),
      revenueMonth: rev(valid.filter((o) => ts(o) >= startMonth)),
    }
  }
  async listUsers(): Promise<StaffUser[]> {
    this.need('staff')
    return this.load().users.map((u) => ({ ...this.toUser(u), enabled: u.enabled }))
  }
  async createUser(input: StaffCreateInput): Promise<StaffUser> {
    this.need('staff')
    const username = String(input.username ?? '').trim()
    const displayName = String(input.displayName ?? '').trim()
    const fields: FieldError[] = []
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) fields.push({ field: 'username', message: '登录名为 3–32 位字母、数字或 _ . -' })
    if (!displayName) fields.push({ field: 'displayName', message: '请填写名称' })
    if (!(input.role in ROLE_LABEL)) fields.push({ field: 'role', message: '角色无效' })
    if (String(input.password ?? '').length < 8) fields.push({ field: 'password', message: '初始密码至少 8 位' })
    if (input.role === 'owner' && !input.ownerId) fields.push({ field: 'ownerId', message: '号主用户需绑定号主档案' })
    if (input.role !== 'owner' && input.ownerId) fields.push({ field: 'ownerId', message: '只有号主用户可以绑定号主档案' })
    return this.tx((db) => {
      const owner = input.ownerId ? db.owners.find((o) => o.id === input.ownerId) : undefined
      if (input.ownerId && !owner) fields.push({ field: 'ownerId', message: '号主档案不存在' })
      if (fields.length) throw new ApiError(fields.map((f) => f.message).join('；'), 422, 'VALIDATION_FAILED', fields)
      if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new ApiError(`登录名 ${username} 已存在`, 409, 'DUPLICATE', [{ field: 'username', message: '已存在' }])
      if (owner && (owner.userId || db.users.some((u) => u.ownerId === owner.id)))
        throw new ApiError(`号主档案「${owner.displayName}」已绑定登录 ${owner.userId ?? ''}`.trim(), 409, 'OWNER_ALREADY_BOUND', [{ field: 'ownerId', message: '已绑定其他用户' }])
      const u: DbUser = { username, password: input.password, displayName, role: input.role, enabled: true, ...(owner ? { ownerId: owner.id } : {}) }
      db.users.push(u)
      if (owner) owner.userId = username
      this.audit(db, '新建用户', `${username}（${ROLE_LABEL[input.role]}）${owner ? ` 绑定号主 ${owner.displayName}` : ''}`)
      return { ...this.toUser(u), enabled: true }
    })
  }
  /** 契约提议的 POST /staff/{username}/password（不在 Api 接口里：前端暂无入口，仅供假后端） */
  async resetUserPassword(username: string, password: string) {
    this.need('staff')
    if (String(password ?? '').length < 8) throw new ApiError('密码至少 8 位', 422, 'VALIDATION_FAILED', [{ field: 'password', message: '至少 8 位' }])
    this.tx((db) => {
      const u = db.users.find((x) => x.username === username)
      if (!u) throw new ApiError('用户不存在', 404, 'NOT_FOUND')
      u.password = password
      this.audit(db, '重置密码', username)
    })
  }
  async setUserEnabled(username: string, enabled: boolean) {
    const me = this.need('staff')
    return this.tx((db) => {
      const u = db.users.find((x) => x.username === username)
      if (!u) throw new ApiError('用户不存在', 404)
      if (!enabled && u.role === 'admin' && db.users.filter((x) => x.role === 'admin' && x.enabled).length <= 1) throw new ApiError('不能停用最后一个管理员')
      if (!enabled && u.username === me.username) throw new ApiError('不能停用自己')
      u.enabled = enabled
      this.audit(db, '员工启停', `${username} ${enabled ? '启用' : '停用'}`)
      return { ...this.toUser(u), enabled: u.enabled }
    })
  }
  async auditLogs() {
    this.need('audit')
    return clone(this.load().audit)
  }
  async resetDemo() {
    this.storage.removeItem(DB_KEY)
    this.load()
  }
}
