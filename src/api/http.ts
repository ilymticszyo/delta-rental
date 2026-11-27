// HTTP 实现：按 docs/api-contract.md / docs/openapi.yaml 调用同域 /api 后端。
// 服务端是权限、字段裁剪、算价 / 估值、导入校验、状态流转的唯一权威；这里只做传输与映射。
import type { PricingRule, RuleVersionMeta, ValuationRule } from '../config/rules'
import type { ImportContext } from '../domain/importAccounts'
import type { Report, ReportDimension } from '../domain/reports'
import type {
  AccountAdminView, AccountInput, AccountStatus, Attachment, CsAgent, DashboardStats, DepositEntry, LobbyAccount, NewAttachment, OrderInput,
  OwnerAccountView, OwnerPayableEntry, OwnerProfile, PricingInput, PricingResult, RecycleRequest, RecycleStatus, RenterProfile, RenterTag,
  RentalOrder, StaffCreateInput, StaffUser, User, ValuationInput, ValuationResult,
} from '../domain/types'
import { applyDicts, skinCategoryOf, type Dicts } from '../config/dictStore'
import { isRetryable } from './idempotency'
import { ApiError, type FieldError } from './errors'
import type { Api, ApiFeatures, AuditLog, DemoAccount, ImportOutcome, OrderPreview, OrderView, OwnerListingInput, PayableFilter, PricingOptions, PricingRuleConfirm, PricingRuleSaveResult, SubmitOptions } from './types'
import type { PricingRulePreview } from '../domain/reprice'

export interface TokenStore { get(): string | null; set(token: string | null): void }
/** 默认 token 存 localStorage（见契约「鉴权」一节的取舍说明） */
export function storageTokenStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = globalThis.localStorage, key = 'dr:http:token'): TokenStore {
  return {
    get: () => storage.getItem(key),
    set: (t) => (t ? storage.setItem(key, t) : storage.removeItem(key)),
  }
}
export function memoryTokenStore(initial: string | null = null): TokenStore {
  let t = initial
  return { get: () => t, set: (v) => { t = v } }
}

export interface HttpApiOptions {
  baseUrl?: string // 默认 '/api'（相对，同域）
  fetch?: typeof fetch
  tokenStore?: TokenStore
  /** 会话失效（非登录接口返回 401）时调用；默认跳转到登录页 */
  onUnauthorized?: () => void
  timeoutMs?: number
  pageSize?: number // 拉全量列表时每页条数（≤ 契约上限 200）
  /** 带 Idempotency-Key 的写请求遇到网络错误 / 超时 / 5xx 时，用同一个键自动重试的间隔（默认 0.5s、1.5s） */
  retryDelaysMs?: number[]
}

interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
interface Meta { version: string; demo: boolean; demoAccounts?: DemoAccount[] }
type Query = Record<string, string | number | boolean | undefined | null>
type ServerAttachment = Omit<Attachment, 'dataUrl'> & { url: string }

const STATUS_MESSAGE: Record<number, string> = {
  400: '请求有误', 401: '登录已失效，请重新登录', 403: '无权限（403）', 404: '数据不存在', 409: '数据状态已变化，请刷新后重试',
  413: '文件过大', 415: '不支持的文件类型', 422: '数据校验未通过', 429: '操作太频繁，请稍后再试', 500: '服务器开小差了，请稍后再试', 502: '服务暂不可用', 503: '服务暂不可用',
}

/** 提议接口未实现：404 / 405 / 501 */
export const isNotSupported = (e: unknown) => e instanceof ApiError && [404, 405, 501].includes(e.code)
function notSupported(e: unknown, message: string) {
  return isNotSupported(e) ? new ApiError(message, (e as ApiError).code, 'NOT_SUPPORTED', [], (e as ApiError).requestId) : e
}

export function defaultUnauthorized() {
  if (typeof window === 'undefined') return
  const cur = window.location.hash.replace(/^#/, '') || '/'
  if (/^\/(admin\/)?login/.test(cur)) return
  const target = cur.startsWith('/admin') ? '/admin/login' : '/login'
  window.location.hash = `#${target}?redirect=${encodeURIComponent(cur)}&expired=1`
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) throw new ApiError('截图数据格式错误', 400, 'BAD_ATTACHMENT')
  const mime = m[1] || 'application/octet-stream'
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: mime })
  const bin = atob(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export class HttpApi implements Api {
  private base: string
  private fetchFn: typeof fetch
  private tokens: TokenStore
  private onUnauthorized: () => void
  private timeoutMs: number
  private pageSize: number
  private retryDelays: number[]
  private user: User | null = null
  private meta: Meta = { version: '', demo: false }

  constructor(opts: HttpApiOptions = {}) {
    this.base = (opts.baseUrl ?? '/api').replace(/\/$/, '')
    this.fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
    this.tokens = opts.tokenStore ?? storageTokenStore()
    this.onUnauthorized = opts.onUnauthorized ?? defaultUnauthorized
    this.timeoutMs = opts.timeoutMs ?? 20000
    this.pageSize = Math.min(opts.pageSize ?? 200, 200)
    this.retryDelays = opts.retryDelaysMs ?? [500, 1500]
  }

  // ---------- 传输 ----------
  private url(path: string, query?: Query) {
    const qs = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    return `${this.base}${path}${qs ? '?' + qs : ''}`
  }
  private async request<T>(method: string, path: string, o: { query?: Query; body?: unknown; form?: FormData; auth?: 'session' | 'login' | 'probe'; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(o.headers ?? {}) }
    const token = this.tokens.get()
    if (token) headers.Authorization = `Bearer ${token}`
    let body: BodyInit | undefined
    if (o.form) body = o.form
    else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body) }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : undefined
    let res: Response
    try {
      res = await this.fetchFn(this.url(path, o.query), { method, headers, body, signal: ctrl?.signal, credentials: 'same-origin' })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new ApiError('请求超时，请稍后重试', 0, 'TIMEOUT')
      throw new ApiError('网络错误，请检查网络后重试', 0, 'NETWORK_ERROR')
    } finally { if (timer) clearTimeout(timer) }

    const requestId = res.headers.get('X-Request-Id') ?? undefined
    if (res.status === 204) return undefined as T
    const ct = res.headers.get('Content-Type') ?? ''
    const data: any = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '')
    if (res.ok) return data as T

    const err = data && typeof data === 'object' ? data.error : null
    const fields: FieldError[] = Array.isArray(err?.fields) ? err.fields : []
    let message: string = err?.message || STATUS_MESSAGE[res.status] || `请求失败（${res.status}）`
    if (fields.length && !err?.message) message = fields.map((f) => f.message).join('；')
    const details = err?.details && typeof err.details === 'object' ? err.details : undefined
    const apiErr = new ApiError(message, res.status, err?.code ?? `HTTP_${res.status}`, fields, err?.requestId ?? requestId, details)
    if (res.status === 401 && (o.auth ?? 'session') === 'session') {
      this.tokens.set(null)
      this.user = null
      this.onUnauthorized()
    }
    throw apiErr
  }
  private get<T>(path: string, query?: Query) { return this.request<T>('GET', path, { query }) }
  private post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, { body: body ?? {} }) }
  private put<T>(path: string, body: unknown) { return this.request<T>('PUT', path, { body }) }
  private patch<T>(path: string, body: unknown) { return this.request<T>('PATCH', path, { body }) }
  /** 契约里列表接口均分页；当前页面在前端筛选，因此拉全量（每页 200，最多 50 页） */
  private async all<T>(path: string, query: Query = {}): Promise<T[]> {
    const out: T[] = []
    for (let page = 1; page <= 50; page++) {
      const p = await this.get<Page<T>>(path, { ...query, page, pageSize: this.pageSize })
      out.push(...p.items)
      if (!p.items.length || out.length >= p.total) break
    }
    return out
  }
  private id(v: string) { return encodeURIComponent(v) }
  /**
   * 带 Idempotency-Key 的 POST：结果不确定（网络 / 超时 / 5xx / 处理中）时用**同一个键**自动重试，
   * 服务端对同键同体重放首次响应，所以不会重复登记订单 / 入库 / 付款。没有键时就是普通 POST。
   */
  private async keyedPost<T>(path: string, body: unknown, opts?: SubmitOptions): Promise<T> {
    const key = opts?.idempotencyKey
    if (!key) return this.post<T>(path, body)
    for (let attempt = 0; ; attempt++) {
      try { return await this.request<T>('POST', path, { body, headers: { 'Idempotency-Key': key } }) }
      catch (e) {
        if (attempt >= this.retryDelays.length || !isRetryable(e) || (e instanceof ApiError && e.code === 429)) throw e
        await new Promise((ok) => setTimeout(ok, this.retryDelays[attempt]))
      }
    }
  }

  // ---------- 映射 ----------
  private att = (a: ServerAttachment | Attachment): Attachment => ({ ...(a as any), dataUrl: (a as ServerAttachment).url ?? (a as Attachment).dataUrl })
  private withAtt = <T extends { attachments?: unknown[] }>(x: T): T => (x && Array.isArray(x.attachments) ? { ...x, attachments: (x.attachments as ServerAttachment[]).map(this.att) } : x)
  /** 新截图先走 POST /uploads 换 id；已有截图直接用 id；返回顺序即展示顺序 */
  private async uploadAll(list: (Attachment | NewAttachment)[] | undefined): Promise<string[] | undefined> {
    if (!list) return undefined
    const ids: string[] = []
    for (const x of list) {
      if ('id' in x && x.id) { ids.push(x.id); continue }
      const form = new FormData()
      form.append('file', dataUrlToBlob(x.dataUrl), x.name)
      const up = await this.request<ServerAttachment>('POST', '/uploads', { form })
      ids.push(up.id)
    }
    return ids
  }

  // ---------- 启动 / 认证 ----------
  async init() {
    this.meta = await this.request<Meta>('GET', '/meta', { auth: 'probe' }).catch(() => ({ version: '', demo: false }))
    if (!this.tokens.get()) { this.user = null; return }
    try { this.user = (await this.request<{ user: User }>('GET', '/auth/me', { auth: 'probe' })).user }
    catch (e) { if (e instanceof ApiError && e.code === 401) { this.tokens.set(null); this.user = null } else throw e }
    if (this.user) await this.loadDicts()
  }
  /**
   * 字典与渠道 / 周期从服务端读（只读配置）。GET /dicts 是提议接口：后端没有时，ops / admin 退回
   * GET /accounts/import/context（皮肤只有名称，分类沿用内置字典），其他角色只更新渠道 / 周期。失败不阻塞登录。
   */
  private async loadDicts() {
    try {
      const p = await this.pricingOptions()
      let d: Partial<Dicts> | null = null
      try { d = await this.getDicts() }
      catch (e) {
        if (!isNotSupported(e)) throw e
        if (this.user && (this.user.role === 'ops' || this.user.role === 'admin')) {
          const ctx = await this.importContext()
          const { regions, loginMethods, ranks, safeBoxes, stamina, loads } = ctx
          d = { regions, loginMethods, ranks, safeBoxes, stamina, loads, skins: ctx.skins.map((name) => ({ name, category: skinCategoryOf(name) })) }
        }
      }
      applyDicts({ ...(d ?? {}), channels: p.channels, cycles: p.cycles }, d ? 'server' : 'bundled')
    } catch (e) { console.warn('[api] 读取字典失败，使用内置字典', e) }
  }
  features(): ApiFeatures { return { mode: 'http', demo: !!this.meta.demo, serverVersion: this.meta.version || undefined } }
  async login(username: string, password: string) {
    const r = await this.request<{ token: string; expiresAt: string; user: User }>('POST', '/auth/login', { body: { username, password }, auth: 'login' })
    this.tokens.set(r.token)
    this.user = r.user
    await this.loadDicts()
    return r.user
  }
  async logout() {
    try { if (this.tokens.get()) await this.request<void>('POST', '/auth/logout', { body: {}, auth: 'probe' }) } catch { /* 忽略：本地照样清除 */ }
    this.tokens.set(null)
    this.user = null
  }
  currentUser() { return this.user }
  demoAccounts(): DemoAccount[] { return this.meta.demo ? (this.meta.demoAccounts ?? []) : [] }

  // ---------- 前台 ----------
  async listListedAccounts() { return (await this.all<LobbyAccount>('/lobby/accounts')).map(this.withAtt) }
  async getAccount(id: string) {
    try { return this.withAtt(await this.get<LobbyAccount>(`/lobby/accounts/${this.id(id)}`)) }
    catch (e) { if (e instanceof ApiError && e.code === 404) return undefined; throw e }
  }
  pricingOptions() { return this.get<PricingOptions>('/pricing/options') }
  calcPricing(input: PricingInput) { return this.post<Partial<PricingResult>>('/pricing/quote', input) }
  calcValuation(input: ValuationInput) { return this.post<ValuationResult>('/valuation/quote', input) }
  submitRecycle(input: ValuationInput, opts?: { sourceAccountId?: string }) { return this.post<RecycleRequest>('/recycles', { asset: input, sourceAccountId: opts?.sourceAccountId }) }
  myRecycles() { return this.all<RecycleRequest>('/recycles/mine') }
  async currentCsAgent(_now?: Date) { return (await this.get<{ agent: CsAgent | null }>('/cs-agents/current')).agent }
  listCsAgents() { return this.get<CsAgent[]>('/cs-agents') }
  getDicts() { return this.get<Dicts>('/dicts') }
  async refreshAttachment(id: string) { return this.att(await this.get<ServerAttachment>(`/uploads/${this.id(id)}`)) }

  // ---------- 号主门户 ----------
  async ownerAccounts() { return (await this.all<OwnerAccountView>('/owner/accounts')).map(this.withAtt) }
  async ownerAccount(id: string) { return this.withAtt(await this.get<OwnerAccountView>(`/owner/accounts/${this.id(id)}`)) }
  ownerEstimate(asset: ValuationInput) { return this.post<{ takeHome: number; ruleVersion: number }>('/owner/estimate', asset) }
  async ownerSubmitListing(input: OwnerListingInput) {
    const attachmentIds = await this.uploadAll(input.attachments)
    const { attachments, ...rest } = input
    return this.withAtt(await this.post<OwnerAccountView>('/owner/listings', { ...rest, attachmentIds }))
  }
  ownerRecycleDraft(accountId: string) { return this.get<ValuationInput>(`/owner/accounts/${this.id(accountId)}/recycle-draft`) }

  // ---------- 库存 ----------
  async listAccounts() { return (await this.all<AccountAdminView>('/accounts')).map(this.withAtt) }
  async saveAccount(input: AccountInput) {
    const attachmentIds = await this.uploadAll(input.attachments)
    const { id, attachments, ...rest } = input
    const body = { ...rest, ...(attachmentIds ? { attachmentIds } : {}) }
    return this.withAtt(id ? await this.put<AccountAdminView>(`/accounts/${this.id(id)}`, body) : await this.post<AccountAdminView>('/accounts', body))
  }
  importContext() { return this.get<ImportContext>('/accounts/import/context') }
  importAccounts(aoa: unknown[][], fileName: string, opts?: SubmitOptions) { return this.keyedPost<ImportOutcome>('/accounts/import', { fileName, rows: aoa, dryRun: false }, opts) }
  async deleteAccount(id: string) { await this.request<void>('DELETE', `/accounts/${this.id(id)}`) }
  async setAccountStatus(id: string, status: AccountStatus) { return this.withAtt(await this.post<AccountAdminView>(`/accounts/${this.id(id)}/status`, { status })) }

  // ---------- 订单与台账 ----------
  listOrders() { return this.all<OrderView>('/orders') }
  getOrder(id: string) { return this.get<OrderView>(`/orders/${this.id(id)}`) }
  previewOrder(accountId: string, renterContact: string) { return this.post<OrderPreview>('/orders/preview', { accountId, renterContact }) }
  createOrder(input: OrderInput, opts?: SubmitOptions) { return this.keyedPost<RentalOrder>('/orders', input, opts) }
  markHandover(id: string, note = '') { return this.post<RentalOrder>(`/orders/${this.id(id)}/handover`, { note }) }
  extendOrder(id: string, rentalDays: number, note = '') { return this.post<RentalOrder>(`/orders/${this.id(id)}/extend`, { rentalDays, note }) }
  endOrder(id: string, note = '') { return this.post<RentalOrder>(`/orders/${this.id(id)}/end`, { note }) }
  markReturned(id: string, note = '') { return this.post<RentalOrder>(`/orders/${this.id(id)}/return`, { note }) }
  addDepositEntry(id: string, entry: Omit<DepositEntry, 'at' | 'operator'>) { return this.post<RentalOrder>(`/orders/${this.id(id)}/deposits`, entry) }
  payOwner(orderId: string, amount: number, note: string, opts?: SubmitOptions) { return this.keyedPost<RentalOrder>(`/orders/${this.id(orderId)}/owner-payments`, { amount, note }, opts) }
  completeOrder(id: string, relist: boolean, note = '') { return this.post<RentalOrder>(`/orders/${this.id(id)}/complete`, { relist, note }) }
  cancelOrder(id: string, note = '') { return this.post<RentalOrder>(`/orders/${this.id(id)}/cancel`, { note }) }
  listPayables(filter: PayableFilter = {}) { return this.all<OwnerPayableEntry>('/payables', { ownerId: filter.ownerId, orderId: filter.orderId }) }

  // ---------- 客户档案 ----------
  renterProfiles() { return this.all<RenterProfile>('/renters') }
  async lookupRenter(contact: string) { return (await this.get<{ profile: RenterProfile | null }>('/renters/lookup', { contact })).profile }
  saveRenter(input: { contact: string; displayName: string; tag: RenterTag | null; note: string }) { return this.post<RenterProfile>('/renters', input) }
  ownerProfiles() { return this.all<OwnerProfile>('/owners') }

  // ---------- 回收 ----------
  listRecycles() { return this.all<RecycleRequest>('/recycles') }
  updateRecycle(id: string, toStatus: RecycleStatus, note: string, staffPrice?: number) { return this.post<RecycleRequest>(`/recycles/${this.id(id)}/transitions`, { toStatus, note, staffPrice }) }
  async recycleToInventory(id: string) { return this.withAtt(await this.post<AccountAdminView>(`/recycles/${this.id(id)}/to-inventory`)) }

  // ---------- 规则 ----------
  getPricingRule() { return this.get<PricingRule>('/rules/pricing') }
  previewPricingRule(rule: PricingRule) {
    return this.post<PricingRulePreview>('/rules/pricing/preview', { rule }).catch((e) => { throw notSupported(e, '后端暂未支持改价预览（POST /api/rules/pricing/preview 未实现）') })
  }
  async savePricingRule(rule: PricingRule, summary = '', confirm?: PricingRuleConfirm): Promise<PricingRuleSaveResult> {
    const res = await this.put<PricingRuleSaveResult | PricingRule>('/rules/pricing', { rule, summary, ...(confirm ? { baseVersion: confirm.baseVersion, previewToken: confirm.previewToken } : {}) })
    // 旧后端直接回 PricingRule（不重算库存）：repriced = null
    return res && 'channelFeeRates' in res ? { rule: res as PricingRule, repriced: null } : (res as PricingRuleSaveResult)
  }
  getValuationRule() { return this.get<ValuationRule>('/rules/valuation') }
  saveValuationRule(rule: ValuationRule, summary = '') { return this.put<ValuationRule>('/rules/valuation', { rule, summary }) }
  ruleHistory() { return this.get<{ pricing: RuleVersionMeta[]; valuation: RuleVersionMeta[] }>('/rules/versions') }
  trialPricing(input: PricingInput, rule: PricingRule) { return this.post<PricingResult>('/rules/pricing/trial', { input, rule }) }
  trialValuation(input: ValuationInput, rule: ValuationRule) { return this.post<ValuationResult>('/rules/valuation/trial', { input, rule }) }

  // ---------- 报表 / 看板 / 员工 / 日志 ----------
  report(fromMs: number, toMs: number, dimension: ReportDimension) {
    return this.get<Report>('/reports', { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), dimension })
  }
  dashboard(_now?: Date) { return this.get<DashboardStats>('/dashboard') }
  listUsers() { return this.get<StaffUser[]>('/staff') }
  /** POST /staff 是契约里的提议操作（x-status: proposed）：后端没实现时（404 / 405 / 501）给出明确提示 */
  async createUser(input: StaffCreateInput) {
    try { return await this.post<StaffUser>('/staff', input) }
    catch (e) { throw notSupported(e, '后端暂未支持新建用户（POST /api/staff 未实现），请联系后端开通或先在服务器上创建') }
  }
  setUserEnabled(username: string, enabled: boolean) { return this.patch<StaffUser>(`/staff/${this.id(username)}`, { enabled }) }
  auditLogs() { return this.all<AuditLog>('/audit-logs') }
  async resetDemo() { await this.post<void>('/demo/reset') }
}
