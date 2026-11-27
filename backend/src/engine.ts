// 业务规则与 src/api/local.ts 对齐：状态机、字段裁剪、计价估值、台账都在这里执行。
import { dicts, type PricingRule, type ValuationRule } from './domain/rules'
import { IMPORT_MAX_ROWS, parseImport, type ImportContext } from './domain/importAccounts'
import { calcPricing, PricingError } from './domain/pricing'
import { can, type Cap } from './domain/permissions'
import { buildReport, platformIncome, type ReportDimension } from './domain/reports'
import { calcValuation, validateValuationInput } from './domain/valuation'
import { lobbyAccountFor, pricingFor, toOwnerView } from './domain/visibility'
import type {
  Account, AccountAdminView, AccountInput, AccountStatus, Attachment, DashboardStats, DepositEntry, OrderEvent, OrderInput, OrderStep,
  OwnerPayableEntry, PricingInput, RecycleRequest, RecycleStatus, RentalOrder, RenterTag, User, ValuationInput,
} from './domain/types'
import { ACCOUNT_STATUS_LABEL, RECYCLE_STATUS_LABEL, RECYCLE_TRANSITIONS, RENTER_TAG_LABEL } from './domain/types'
import { toPricingInput, type Db, type DbUser } from './domain/seedData'
import { ApiError } from './errors'
import type { DiskAttachmentStore } from './uploads'

const DAY = 86400000

const MANUAL_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  draft: ['listed', 'off'], listed: ['off'], off: ['listed'], held: ['listed', 'off'], rented: [], settling: [],
}

export const DEPOSIT_STEP: Record<DepositEntry['type'], OrderStep> = { collect: 'collect', deduct: 'deduct', refund: 'refund' }
export const DEPOSIT_LABEL: Record<DepositEntry['type'], string> = { collect: '收押金', deduct: '扣押金', refund: '退押金' }

export function depositBalance(o: RentalOrder): number {
  return o.deposits.reduce((s, e) => s + (e.type === 'collect' ? e.amount : -e.amount), 0)
}
export function payableBalance(entries: OwnerPayableEntry[]): number {
  return entries.reduce((s, e) => s + (e.type === 'accrue' ? e.amount : -e.amount), 0)
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const norm = (c: string) => c.trim().toLowerCase()
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * DAY).toISOString()

function pricing(input: PricingInput, rule: PricingRule) {
  try { return calcPricing(input, rule) }
  catch (e) { throw new ApiError(e instanceof PricingError || e instanceof Error ? e.message : '计价失败') }
}
function valuation(input: ValuationInput, rule: ValuationRule) {
  try { return calcValuation(input, rule) }
  catch (e) { throw new ApiError(e instanceof Error ? e.message : '估值失败') }
}

const UPLOAD_URL = /^\/api\/uploads\/[a-f0-9]{32}$/

async function persistShots(
  list: { name: string; dataUrl: string; id?: string; uploadedBy?: string; at?: string }[],
  store: DiskAttachmentStore | undefined,
  user: string,
  at: string,
): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const x of list) {
    if (typeof x.dataUrl !== 'string' || !x.dataUrl) throw new ApiError('截图内容为空')
    let dataUrl = x.dataUrl
    if (dataUrl.startsWith('data:')) {
      if (!store) throw new ApiError('未配置上传存储', 500)
      if (dataUrl.length > 1_400_000) throw new ApiError('单张截图不能超过 1MB')
      const saved = await store.saveDataUrl(dataUrl, x.name || 'image', x.uploadedBy || user)
      dataUrl = saved.url
    } else if (!UPLOAD_URL.test(dataUrl)) {
      throw new ApiError('截图地址无效')
    }
    out.push({ id: x.id || `f-${dataUrl.slice(-8)}`, name: x.name || 'image', dataUrl, uploadedBy: x.uploadedBy || user, at: x.at || at })
  }
  return out
}

export function toPublicUser(u: Pick<DbUser, 'username' | 'displayName' | 'role' | 'ownerId'>): User {
  return { username: u.username, displayName: u.displayName, role: u.role, ...(u.ownerId ? { ownerId: u.ownerId } : {}) }
}

export class Engine {
  constructor(private clock: () => number = () => Date.now()) {}

  private nowIso() { return new Date(this.clock()).toISOString() }

  async login(row: DbUser | null, password: string, verify: (hash: string, plain: string) => Promise<boolean> | boolean): Promise<User> {
    const ok = row ? await verify(row.password, password) : false
    if (!row || !ok) throw new ApiError('账号或密码错误', 401)
    if (!row.enabled) throw new ApiError('该账号已停用', 403)
    return toPublicUser(row)
  }

  private need(user: User | null, cap: Cap): User {
    if (!user) throw new ApiError('未登录', 401)
    if (!can(user.role, cap)) throw new ApiError('无权限（403）', 403)
    return user
  }
  private actor(user: User | null): User {
    if (!user) throw new ApiError('未登录', 401)
    return user
  }
  private audit(db: Db, user: User | null, action: string, summary: string) {
    db.audit.unshift({ at: this.nowIso(), actor: user?.username ?? 'system', action, summary })
    db.audit = db.audit.slice(0, 800)
  }
  private bumpAccountSeq(db: Db) {
    const taken = new Set(db.accounts.map((a) => a.accountNo.toUpperCase()))
    do db.seq.account++
    while (taken.has(`DF${db.seq.account}`))
  }
  private linkOwner(db: Db, input: AccountInput) {
    if (input.source !== 'consign' || input.ownerId) return
    const c = norm(input.ownerContact)
    let owner = db.owners.find((o) => norm(o.contact) === c)
    if (!owner && c) {
      owner = { id: `ow${db.owners.length + 1}-${this.clock() % 10000}`, contact: input.ownerContact.trim(), displayName: input.ownerContact.trim() }
      db.owners.push(owner)
    }
    input.ownerId = owner?.id
  }
  private importCtx(db: Db): ImportContext {
    return {
      regions: dicts.regions, loginMethods: dicts.loginMethods, channels: Object.keys(db.pricingRule.channelFeeRates), cycles: Object.keys(db.pricingRule.cycleValues),
      ranks: dicts.ranks, safeBoxes: dicts.safeBoxes, stamina: dicts.stamina, loads: dicts.loads, skins: dicts.skins.map((x) => x.name),
      existingNos: db.accounts.map((a) => a.accountNo),
    }
  }
  private renterTag(db: Db, contact?: string): RenterTag | null {
    if (!contact?.trim()) return null
    return db.renters.find((r) => norm(r.contact) === norm(contact))?.tag ?? null
  }
  private renterProfile(db: Db, contact: string) {
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
    const e: OrderEvent = { step, note, at: this.nowIso(), operator }
    o.events.push(e)
  }
  private orderPayableBalance(db: Db, o: RentalOrder) { return payableBalance(db.payables.filter((p) => p.orderId === o.id)) }
  private addPayable(db: Db, a: Account, o: RentalOrder | undefined, type: OwnerPayableEntry['type'], amount: number, note: string, operator: string) {
    db.seq.entry++
    db.payables.push({
      id: `p${db.seq.entry}`, ownerId: a.ownerId ?? a.formerOwnerId!, accountId: a.id, accountNo: a.accountNo,
      orderId: o?.id, orderNo: o?.orderNo, type, amount: Math.round(amount), note, at: this.nowIso(), operator,
    })
  }
  private reminderOf(db: Db, o: RentalOrder): 'expiring' | 'overdue' | null {
    if (o.status !== 'active') return null
    const left = new Date(o.endAt).getTime() - this.clock()
    if (left < 0) return 'overdue'
    if (left <= db.pricingRule.expiryRemindHours * 3600000) return 'expiring'
    return null
  }
  private orderQuote(db: Db, a: Account, renterContact: string) {
    const tag = this.renterTag(db, renterContact)
    const q = pricing(toPricingInput(a, tag === 'regular'), db.pricingRule)
    return { tag, q }
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

  // ---------- 前台 ----------
  listListedAccounts(db: Db, user: User | null) {
    const u = this.need(user, 'front')
    return db.accounts.filter((a) => a.status === 'listed' && !a.deleted).map((a) => lobbyAccountFor(u.role, clone(a)))
  }
  getAccount(db: Db, user: User | null, id: string) {
    const u = this.need(user, 'front')
    const a = db.accounts.find((x) => x.id === id && !x.deleted)
    if (!a) return undefined
    if (!can(u.role, 'inventoryView') && a.status !== 'listed') return undefined
    return lobbyAccountFor(u.role, clone(a))
  }
  calcPricing(db: Db, user: User | null, input: PricingInput) {
    const u = this.need(user, 'front')
    const regular = this.renterTag(db, input.renterContact) === 'regular'
    return pricingFor(u.role, pricing({ ...input, renterRegular: regular }, db.pricingRule))
  }
  calcValuation(db: Db, user: User | null, input: ValuationInput) {
    this.need(user, 'front')
    return valuation(input, db.valuationRule)
  }
  submitRecycle(db: Db, user: User | null, input: ValuationInput, opts: { sourceAccountId?: string } = {}) {
    const actor = this.need(user, 'front')
    if (opts.sourceAccountId) {
      const a = this.findAccount(db, opts.sourceAccountId)
      if (actor.role === 'owner' && a.ownerId !== actor.ownerId) throw new ApiError('只能转入自己的账号', 403)
      if (actor.role !== 'owner' && !can(actor.role, 'recycles')) throw new ApiError('无权限（403）', 403)
      if (db.recycles.some((r) => r.sourceAccountId === a.id && ['submitted', 'following', 'quoted'].includes(r.status)))
        throw new ApiError('该账号已有进行中的回收申请')
    }
    const key = JSON.stringify({ ...input, remark: undefined })
    const dup = db.recycles.find(
      (r) => r.submitter === actor.username && JSON.stringify({ ...r.asset, remark: undefined }) === key &&
        this.clock() - new Date(r.createdAt).getTime() < 10 * 60000 && r.status !== 'cancelled',
    )
    if (dup) throw new ApiError(`10 分钟内已提交过相同资产（单号 ${dup.requestNo}），请勿重复提交`, 409)
    const result = valuation(input, db.valuationRule)
    db.seq.recycle++
    const at = this.nowIso()
    const req: RecycleRequest = {
      id: `r${db.seq.recycle}`, requestNo: `HS${String(db.seq.recycle).padStart(5, '0')}`, submitter: actor.username,
      ownerId: actor.role === 'owner' ? actor.ownerId : undefined, sourceAccountId: opts.sourceAccountId,
      contact: input.contact, asset: clone(input), result, status: 'submitted', createdAt: at,
      events: [{ at, operator: actor.username, fromStatus: null, toStatus: 'submitted', note: opts.sourceAccountId ? '号主从账号转入回收' : '提交回收申请' }],
    }
    db.recycles.unshift(req)
    this.audit(db, actor, '回收提交', `${req.requestNo} 参考价 ${result.min}-${result.max}${opts.sourceAccountId ? '（号主转入）' : ''}`)
    return req
  }
  myRecycles(db: Db, user: User | null) {
    const actor = this.need(user, 'front')
    return clone(db.recycles.filter((r) => r.submitter === actor.username))
  }
  currentCsAgent(db: Db, user: User | null, now = new Date(this.clock())) {
    this.need(user, 'front')
    const wd = now.getDay()
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const on = db.csAgents.find((a) => !a.isFallback && a.schedule.some((s) => s.weekdays.includes(wd) && hm >= s.start && hm < s.end))
    return clone(on ?? db.csAgents.find((a) => a.isFallback) ?? null)
  }
  listCsAgents(db: Db, user: User | null) {
    this.need(user, 'front')
    return clone(db.csAgents)
  }

  // ---------- 号主门户 ----------
  ownerAccounts(db: Db, user: User | null) {
    const u = this.actor(user)
    return this.ownerScope(db, u).map((a) => this.ownerViewOf(db, a, u.role !== 'owner'))
  }
  ownerAccount(db: Db, user: User | null, id: string) {
    const u = this.actor(user)
    const a = this.ownerScope(db, u).find((x) => x.id === id)
    if (!a) throw new ApiError('账号不存在或无权查看', 404)
    return this.ownerViewOf(db, a, u.role !== 'owner')
  }
  ownerEstimate(db: Db, user: User | null, asset: ValuationInput) {
    const u = this.need(user, 'ownerPortal')
    const errs = validateValuationInput({ ...asset, contact: asset.contact || 'owner' })
    if (errs.length) throw new ApiError(errs.join('；'))
    if (!(asset.coinAmount > 0)) throw new ApiError('纯币需大于 0')
    const q = pricing(toPricingInput(this.ownerAccountInput(db, u.ownerId!, asset, '', '')), db.pricingRule)
    return { takeHome: q.ownerSettlement, ruleVersion: q.ruleVersion }
  }
  async ownerSubmitListing(db: Db, user: User | null, input: { asset: ValuationInput; assistTime: string; remark: string; attachments: { name: string; dataUrl: string }[]; fromRecycleId?: string }, store?: DiskAttachmentStore) {
    const u = this.need(user, 'ownerPortal')
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
    const acc = this.ownerAccountInput(db, u.ownerId!, asset, input.assistTime, input.remark)
    this.bumpAccountSeq(db)
    const t = this.nowIso()
    const shots = await persistShots(input.attachments.map((x, i) => ({ ...x, id: `f${db.seq.account}-${i}` })), store, u.username, t)
    const a: Account = { ...acc, id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote: pricing(toPricingInput(acc), db.pricingRule), attachments: shots, createdAt: t, updatedAt: t }
    db.accounts.unshift(a)
    this.audit(db, u, '号主上架', `${a.accountNo}（待确认）${input.fromRecycleId ? '复用回收估值' : ''}`)
    return this.ownerViewOf(db, a, false)
  }
  ownerRecycleDraft(db: Db, user: User | null, accountId: string) {
    const u = this.actor(user)
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
  listAccounts(db: Db, user: User | null) {
    this.need(user, 'inventoryView')
    return db.accounts.filter((a) => !a.deleted).map((a) => this.adminView(db, clone(a)))
  }
  async saveAccount(db: Db, user: User | null, input: AccountInput, store?: DiskAttachmentStore) {
    const actor = this.need(user, 'inventoryEdit')
    const quote = pricing(toPricingInput(input), db.pricingRule)
    const t = this.nowIso()
    this.linkOwner(db, input)
    const shots = input.attachments ? await persistShots(input.attachments, store, actor.username, t) : undefined
    if (input.id) {
      const a = this.findAccount(db, input.id)
      if (input.status !== a.status) throw new ApiError('状态请用状态操作按钮修改')
      Object.assign(a, input, { quote, updatedAt: t, attachments: shots ?? a.attachments })
      this.audit(db, actor, '编辑账号', `${a.accountNo}`)
      return this.adminView(db, a)
    }
    if (!['draft', 'listed', 'off', 'held'].includes(input.status)) throw new ApiError('新增账号状态只能为草稿 / 空闲可租 / 已下架 / 已回收持有')
    this.bumpAccountSeq(db)
    const a: Account = { ...input, attachments: shots ?? [], id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote, createdAt: t, updatedAt: t }
    db.accounts.unshift(a)
    this.audit(db, actor, '新增账号', `${a.accountNo}（${ACCOUNT_STATUS_LABEL[a.status]}）`)
    return this.adminView(db, a)
  }
  importContext(db: Db, user: User | null) {
    this.need(user, 'inventoryEdit')
    return this.importCtx(db)
  }
  importAccounts(db: Db, user: User | null, aoa: unknown[][], fileName: string) {
    const actor = this.need(user, 'inventoryEdit')
    if (!Array.isArray(aoa)) throw new ApiError('导入数据格式错误')
    if (aoa.length - 1 > IMPORT_MAX_ROWS) throw new ApiError(`单次最多导入 ${IMPORT_MAX_ROWS} 行`)
    const parsed = parseImport(aoa, this.importCtx(db))
    if (parsed.headerErrors.length) throw new ApiError(parsed.headerErrors.join('；'))
    const t = this.nowIso()
    const imported: string[] = []
    for (const row of parsed.rows) {
      if (!row.input) continue
      const { accountNo, ...input } = row.input
      this.linkOwner(db, input)
      this.bumpAccountSeq(db)
      const a: Account = { ...input, status: 'draft', attachments: [], id: `a${db.seq.account}`, accountNo, quote: pricing(toPricingInput(input), db.pricingRule), createdAt: t, updatedAt: t }
      db.accounts.unshift(a)
      imported.push(accountNo)
    }
    const skipped = parsed.rows.filter((r) => r.errors.length).map((r) => ({ rowNo: r.rowNo, accountNo: r.accountNo, errors: r.errors }))
    this.audit(db, actor, '批量导入', `${fileName}：导入 ${imported.length} 条（待确认）${imported.length ? '：' + imported.slice(0, 20).join('、') + (imported.length > 20 ? ' 等' : '') : ''}；跳过 ${skipped.length} 条${skipped.length ? '（第 ' + skipped.map((x) => x.rowNo).join('、') + ' 行）' : ''}`)
    return { imported, skipped, operator: actor.username }
  }
  deleteAccount(db: Db, user: User | null, id: string) {
    const actor = this.need(user, 'inventoryEdit')
    const a = this.findAccount(db, id)
    if (a.status === 'rented' || a.status === 'settling') throw new ApiError('租赁中 / 待结算的账号不能删除')
    a.deleted = true
    this.audit(db, actor, '删除账号', a.accountNo)
  }
  setAccountStatus(db: Db, user: User | null, id: string, status: AccountStatus) {
    const actor = this.need(user, 'inventoryEdit')
    const a = this.findAccount(db, id)
    if (!MANUAL_TRANSITIONS[a.status].includes(status))
      throw new ApiError(`不能从「${ACCOUNT_STATUS_LABEL[a.status]}」改为「${ACCOUNT_STATUS_LABEL[status]}」`)
    this.audit(db, actor, '账号状态', `${a.accountNo}：${ACCOUNT_STATUS_LABEL[a.status]} → ${ACCOUNT_STATUS_LABEL[status]}`)
    a.status = status
    a.updatedAt = this.nowIso()
    return this.adminView(db, a)
  }

  // ---------- 订单 ----------
  listOrders(db: Db, user: User | null) {
    this.need(user, 'orders')
    return clone(db.orders).map((o) => ({ ...o, reminder: this.reminderOf(db, o), ownerPayableBalance: this.orderPayableBalance(db, o) }))
  }
  previewOrder(db: Db, user: User | null, accountId: string, renterContact: string) {
    this.need(user, 'orders')
    const a = this.findAccount(db, accountId)
    const { tag, q } = this.orderQuote(db, a, renterContact)
    return {
      profile: this.renterProfile(db, renterContact), blocked: tag === 'blacklist', coinRent: q.coinRent, extraFee: q.extraFee, deposit: q.deposit,
      ownerPayable: a.source === 'consign' ? q.ownerSettlement : 0, rentalDays: q.rentalDays, regularApplied: q.regularDiscountApplied, depositWaived: q.depositWaived,
    }
  }
  createOrder(db: Db, user: User | null, input: OrderInput) {
    const actor = this.need(user, 'orders')
    const a = this.findAccount(db, input.accountId)
    if (a.status !== 'listed') throw new ApiError(`账号 ${a.accountNo} 当前为「${ACCOUNT_STATUS_LABEL[a.status]}」，不能登记订单`, 409)
    if (db.orders.some((o) => o.accountId === a.id && (o.status === 'active' || o.status === 'settling')))
      throw new ApiError('该账号已有进行中的订单', 409)
    if (!input.renterContact.trim()) throw new ApiError('请填写租客联系方式')
    const { tag, q } = this.orderQuote(db, a, input.renterContact)
    if (tag === 'blacklist') {
      const r = db.renters.find((x) => norm(x.contact) === norm(input.renterContact))
      this.audit(db, actor, '拦截黑名单', `${input.renterContact.trim()} 尝试租 ${a.accountNo}`)
      throw new ApiError(`该租客在黑名单中，禁止登记${r?.note ? `（${r.note}）` : ''}`, 403, true)
    }
    if (!(input.rentalDays >= 1)) throw new ApiError('租期至少 1 天')
    if (input.deposit < 0 || input.extraFee < 0) throw new ApiError('金额不能为负')
    const regular = tag === 'regular'
    const deposit = regular && db.pricingRule.regularWaiveDeposit ? 0 : Math.round(input.deposit)
    const extraFee = Math.round(input.extraFee)
    db.seq.order++
    const at = this.nowIso()
    const o: RentalOrder = {
      id: `o${db.seq.order}`, orderNo: `ZD${String(db.seq.order).padStart(5, '0')}`, accountId: a.id, accountNo: a.accountNo,
      renterContact: input.renterContact.trim(), startAt: input.startAt, endAt: addDays(input.startAt, input.rentalDays),
      rentalDays: input.rentalDays, coinRent: q.coinRent, extraFee, deposit, totalAmount: q.coinRent + extraFee + deposit,
      ownerPayable: a.source === 'consign' ? q.ownerSettlement : 0, regularApplied: regular, handedOver: false, returned: false,
      status: 'active', remark: input.remark, deposits: [], events: [], createdBy: actor.username, createdAt: at,
    }
    this.event(o, 'register', `登记 ${o.rentalDays} 天，租金 ${o.coinRent}${regular ? '（熟客优惠）' : ''}${tag === 'caution' ? '【慎租】' : ''}`, actor.username)
    if (deposit > 0) {
      o.deposits.push({ type: 'collect', amount: deposit, reason: '收取押金', at, operator: actor.username })
      this.event(o, 'collect', `收押金 ${deposit}`, actor.username)
    } else if (regular && db.pricingRule.regularWaiveDeposit) this.event(o, 'collect', '熟客免押金', actor.username)
    db.orders.unshift(o)
    if (o.ownerPayable) this.addPayable(db, a, o, 'accrue', o.ownerPayable, '订单登记计提', actor.username)
    a.status = 'rented'
    a.updatedAt = at
    this.audit(db, actor, '登记订单', `${o.orderNo} 账号 ${a.accountNo} ${o.rentalDays} 天 总额 ${o.totalAmount}${regular ? ' 熟客' : ''}`)
    return o
  }
  private orderOp(db: Db, user: User | null, id: string, fn: (o: RentalOrder, actor: User) => void, action: string) {
    const actor = this.need(user, 'orders')
    const o = this.findOrder(db, id)
    fn(o, actor)
    this.audit(db, actor, action, o.orderNo)
    return o
  }
  markHandover(db: Db, user: User | null, id: string, note = '') {
    return this.orderOp(db, user, id, (o, u) => {
      if (o.status !== 'active' || o.handedOver) throw new ApiError('当前不能登记交号')
      o.handedOver = true
      this.event(o, 'handover', note || '已交号', u.username)
    }, '订单交号')
  }
  extendOrder(db: Db, user: User | null, id: string, rentalDays: number, note = '') {
    return this.orderOp(db, user, id, (o, u) => {
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以改租期')
      if (!(rentalDays >= 1)) throw new ApiError('租期至少 1 天')
      const before = o.rentalDays
      o.rentalDays = rentalDays
      o.endAt = addDays(o.startAt, rentalDays)
      this.event(o, 'extend', `租期 ${before} → ${rentalDays} 天${note ? '，' + note : ''}`, u.username)
    }, '改租期')
  }
  endOrder(db: Db, user: User | null, id: string, note = '') {
    return this.orderOp(db, user, id, (o, u) => {
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以结束')
      o.status = 'settling'
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = 'settling'
      this.event(o, 'expire', note || '到期 / 提前结束', u.username)
    }, '订单到期')
  }
  markReturned(db: Db, user: User | null, id: string, note = '') {
    return this.orderOp(db, user, id, (o, u) => {
      if (o.status !== 'settling' || o.returned) throw new ApiError('到期后才能登记还号')
      o.returned = true
      this.event(o, 'return', note || '已还号', u.username)
    }, '订单还号')
  }
  addDepositEntry(db: Db, user: User | null, id: string, entry: Omit<DepositEntry, 'at' | 'operator'>) {
    return this.orderOp(db, user, id, (o, u) => {
      if (o.status === 'done' || o.status === 'cancelled') throw new ApiError('订单已关闭')
      if (!(entry.amount > 0)) throw new ApiError('金额需大于 0')
      if (entry.type !== 'collect' && entry.amount > depositBalance(o)) throw new ApiError('超出押金余额')
      const amount = Math.round(entry.amount)
      o.deposits.push({ ...entry, amount, at: this.nowIso(), operator: u.username })
      this.event(o, DEPOSIT_STEP[entry.type], `${DEPOSIT_LABEL[entry.type]} ${amount}${entry.reason ? '（' + entry.reason + '）' : ''}`, u.username)
    }, '押金流水')
  }
  payOwner(db: Db, user: User | null, orderId: string, amount: number, note: string) {
    return this.orderOp(db, user, orderId, (o, u) => {
      if (o.status === 'cancelled') throw new ApiError('订单已取消')
      if (!(amount > 0)) throw new ApiError('金额需大于 0')
      if (amount > this.orderPayableBalance(db, o)) throw new ApiError('超出本单号主应付余额')
      const a = db.accounts.find((x) => x.id === o.accountId)!
      this.addPayable(db, a, o, 'pay', amount, note || '付号主款', u.username)
      this.event(o, 'payOwner', `付号主 ${Math.round(amount)}${note ? '（' + note + '）' : ''}`, u.username)
    }, '付号主款')
  }
  completeOrder(db: Db, user: User | null, id: string, relist: boolean, note = '') {
    return this.orderOp(db, user, id, (o, u) => {
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
  cancelOrder(db: Db, user: User | null, id: string, note = '') {
    return this.orderOp(db, user, id, (o, u) => {
      if (o.status !== 'active') throw new ApiError('只有租赁中的订单可以取消')
      if (o.handedOver) throw new ApiError('已交号的订单不能取消，请走到期结算')
      o.status = 'cancelled'
      const a = db.accounts.find((x) => x.id === o.accountId)
      if (a) a.status = 'listed'
      const bal = this.orderPayableBalance(db, o)
      if (a && bal > 0) this.addPayable(db, a, o, 'reverse', bal, '订单取消冲销', u.username)
      const dep = depositBalance(o)
      if (dep > 0) {
        o.deposits.push({ type: 'refund', amount: dep, reason: '取消退还', at: this.nowIso(), operator: u.username })
        this.event(o, 'refund', `退押金 ${dep}`, u.username)
      }
      this.event(o, 'cancel', note || '取消订单', u.username)
    }, '取消订单')
  }
  listPayables(db: Db, user: User | null, ownerId?: string) {
    this.need(user, 'orders')
    return clone(db.payables.filter((p) => !ownerId || p.ownerId === ownerId)).sort((a, b) => b.at.localeCompare(a.at))
  }

  // ---------- 客户档案 ----------
  renterProfiles(db: Db, user: User | null) {
    this.need(user, 'profiles')
    const keys = new Map<string, string>()
    for (const r of db.renters) keys.set(norm(r.contact), r.contact)
    for (const o of db.orders) if (!keys.has(norm(o.renterContact))) keys.set(norm(o.renterContact), o.renterContact)
    return [...keys.values()].map((c) => this.renterProfile(db, c)!).filter(Boolean).sort((a, b) => b.rentalCount - a.rentalCount)
  }
  lookupRenter(db: Db, user: User | null, contact: string) {
    this.need(user, 'profiles')
    return this.renterProfile(db, contact)
  }
  saveRenter(db: Db, user: User | null, input: { contact: string; displayName: string; tag: RenterTag | null; note: string }) {
    const actor = this.need(user, 'profiles')
    const contact = input.contact.trim()
    if (!contact) throw new ApiError('请填写联系方式')
    let r = db.renters.find((x) => norm(x.contact) === norm(contact))
    const before = r?.tag ?? null
    if (!r) { r = { contact, displayName: '', tag: null, note: '' }; db.renters.push(r) }
    Object.assign(r, { displayName: input.displayName, tag: input.tag, note: input.note })
    const lab = (t: RenterTag | null) => (t ? RENTER_TAG_LABEL[t] : '无')
    this.audit(db, actor, '租客标签', `${contact}：${lab(before)} → ${lab(input.tag)}`)
    return this.renterProfile(db, contact)!
  }
  ownerProfiles(db: Db, user: User | null) {
    this.need(user, 'profiles')
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
  listRecycles(db: Db, user: User | null) {
    this.need(user, 'recycles')
    return clone(db.recycles)
  }
  updateRecycle(db: Db, user: User | null, id: string, toStatus: RecycleStatus, note: string, staffPrice?: number) {
    const actor = this.need(user, 'recycles')
    const r = db.recycles.find((x) => x.id === id)
    if (!r) throw new ApiError('回收单不存在', 404)
    if (toStatus !== r.status && !RECYCLE_TRANSITIONS[r.status].includes(toStatus))
      throw new ApiError(`不能从「${RECYCLE_STATUS_LABEL[r.status]}」到「${RECYCLE_STATUS_LABEL[toStatus]}」`)
    if (toStatus === 'quoted' && !(staffPrice! > 0)) throw new ApiError('报价需大于 0')
    if (toStatus === 'deal') throw new ApiError('请使用「成交入库」')
    r.events.push({ at: this.nowIso(), operator: actor.username, fromStatus: r.status, toStatus, price: staffPrice, note })
    if (staffPrice != null && toStatus === 'quoted') r.staffPrice = Math.round(staffPrice)
    r.status = toStatus
    this.audit(db, actor, '回收跟进', `${r.requestNo} → ${RECYCLE_STATUS_LABEL[toStatus]} ${note}`)
    return r
  }
  recycleToInventory(db: Db, user: User | null, id: string) {
    const actor = this.need(user, 'recycles')
    const r = db.recycles.find((x) => x.id === id)
    if (!r) throw new ApiError('回收单不存在', 404)
    if (r.status !== 'quoted') throw new ApiError('只有「已报价」的单可以成交入库（需人工确认报价）')
    const t = this.nowIso()
    let a: Account
    if (r.sourceAccountId) {
      a = this.findAccount(db, r.sourceAccountId)
      if (a.status === 'rented' || a.status === 'settling') throw new ApiError('该账号仍在租赁 / 待结算中，结算后再成交')
      Object.assign(a, {
        formerOwnerId: a.ownerId, ownerId: undefined, source: 'buyin', costAmount: r.staffPrice ?? 0, status: 'held', ownerContact: '自有', updatedAt: t,
        remark: [a.remark, `号主转回收 ${r.requestNo}，成交价 ${r.staffPrice} 元`].filter(Boolean).join('；'),
      })
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
      a = { ...input, attachments: [], id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote: pricing(toPricingInput(input), db.pricingRule), createdAt: t, updatedAt: t }
      db.accounts.unshift(a)
    }
    r.events.push({ at: t, operator: actor.username, fromStatus: r.status, toStatus: 'deal', price: r.staffPrice, note: `成交入库 → ${a.accountNo}（自收，成本 ${r.staffPrice}）` })
    r.status = 'deal'
    r.relatedAccountId = a.id
    this.audit(db, actor, '回收入库', `${r.requestNo} → ${a.accountNo} 成本 ${r.staffPrice}`)
    return this.adminView(db, a)
  }

  // ---------- 规则（版本化：计算写入 ruleVersion，历史保留快照） ----------
  getPricingRule(db: Db, user: User | null) {
    this.actor(user)
    return clone(db.pricingRule)
  }
  savePricingRule(db: Db, user: User | null, rule: PricingRule, summary = '') {
    const u = this.need(user, 'rulesEdit')
    db.pricingRule = { ...clone(rule), version: db.pricingRule.version + 1 }
    db.pricingHistory.unshift({ version: db.pricingRule.version, savedAt: this.nowIso(), savedBy: u.username, summary: summary || '修改计价规则', rule: clone(db.pricingRule) })
    this.audit(db, u, '计价规则', `保存为 v${db.pricingRule.version} ${summary}`)
    return db.pricingRule
  }
  getValuationRule(db: Db, user: User | null) {
    this.need(user, 'rulesEdit')
    return clone(db.valuationRule)
  }
  saveValuationRule(db: Db, user: User | null, rule: ValuationRule, summary = '') {
    const u = this.need(user, 'rulesEdit')
    db.valuationRule = { ...clone(rule), version: db.valuationRule.version + 1 }
    db.valuationHistory.unshift({ version: db.valuationRule.version, savedAt: this.nowIso(), savedBy: u.username, summary: summary || `市场系数 ${db.valuationRule.marketCoefficient}`, rule: clone(db.valuationRule) })
    this.audit(db, u, '估值依据', `保存为 v${db.valuationRule.version} ${summary}`)
    return db.valuationRule
  }
  ruleHistory(db: Db, user: User | null) {
    this.need(user, 'rulesEdit')
    return {
      pricing: db.pricingHistory.map(({ rule, ...m }) => clone(m)),
      valuation: db.valuationHistory.map(({ rule, ...m }) => clone(m)),
    }
  }
  pricingRuleVersion(db: Db, user: User | null, version: number) {
    this.need(user, 'rulesEdit')
    const h = db.pricingHistory.find((x) => x.version === version)
    if (!h?.rule) throw new ApiError('未找到该版本的计价规则快照', 404)
    return clone(h.rule)
  }
  valuationRuleVersion(db: Db, user: User | null, version: number) {
    this.need(user, 'rulesEdit')
    const h = db.valuationHistory.find((x) => x.version === version)
    if (!h?.rule) throw new ApiError('未找到该版本的估值规则快照', 404)
    return clone(h.rule)
  }
  trialPricing(db: Db, user: User | null, input: PricingInput, rule: PricingRule) {
    this.need(user, 'rulesEdit')
    return pricing(input, rule)
  }
  trialValuation(db: Db, user: User | null, input: ValuationInput, rule: ValuationRule) {
    this.need(user, 'rulesEdit')
    return valuation(input, rule)
  }

  // ---------- 报表、看板、员工、日志 ----------
  report(db: Db, user: User | null, fromMs: number, toMs: number, dimension: ReportDimension) {
    this.need(user, 'reports')
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) throw new ApiError('报表时间范围无效')
    if (!['safeBox', 'rank', 'price', 'channel'].includes(dimension)) throw new ApiError('报表维度无效')
    return buildReport(db.accounts, db.orders, fromMs, toMs, dimension, this.clock())
  }
  dashboard(db: Db, user: User | null, now = new Date(this.clock())): DashboardStats {
    this.need(user, 'dashboard')
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
  listUsers(db: Db, user: User | null) {
    this.need(user, 'staff')
    return db.users.map((u) => ({ ...toPublicUser(u), enabled: u.enabled }))
  }
  setUserEnabled(db: Db, user: User | null, username: string, enabled: boolean) {
    const me = this.need(user, 'staff')
    const u = db.users.find((x) => x.username === username)
    if (!u) throw new ApiError('用户不存在', 404)
    if (!enabled && u.role === 'admin' && db.users.filter((x) => x.role === 'admin' && x.enabled).length <= 1) throw new ApiError('不能停用最后一个管理员')
    if (!enabled && u.username === me.username) throw new ApiError('不能停用自己')
    u.enabled = enabled
    this.audit(db, me, '员工启停', `${username} ${enabled ? '启用' : '停用'}`)
    return { ...toPublicUser(u), enabled: u.enabled }
  }
  auditLogs(db: Db, user: User | null) {
    this.need(user, 'audit')
    return clone(db.audit)
  }
}
