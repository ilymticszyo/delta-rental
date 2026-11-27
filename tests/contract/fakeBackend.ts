// 契约参考假后端：按 docs/openapi.yaml 的路径与语义，把 HTTP 请求转给 LocalApi（mock 实现）处理。
// 用途：① 契约测试（tests/contract）② 本地以 http 模式跑完整前端（npm run fake-api）。
// 不是生产后端：状态码粒度沿用 mock（多数业务错误为 400），真实后端须按契约用 409 / 422。
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { LocalApi } from '../../src/api/local'
import { ApiError } from '../../src/api/errors'
import type { Attachment, NewAttachment } from '../../src/domain/types'

class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}

export interface FakeRequest { method: string; path: string; query: URLSearchParams; body: any; form?: FormData; token: string | null }
export interface FakeResponse { status: number; body?: unknown; headers?: Record<string, string> }
type Handler = (api: LocalApi, r: FakeRequest, p: Record<string, string>) => Promise<unknown>
interface Route { method: string; template: string; operationId: string; re: RegExp; keys: string[]; handler: Handler; status?: number; auth?: boolean }

const SESSION_KEY = 'dr:v1:session'

export function createFakeBackend(opts: { demo?: boolean } = {}) {
  const storage = new MemStorage()
  const api = new LocalApi(storage as unknown as Storage)
  const tokens = new Map<string, string>() // token → username
  const uploads = new Map<string, { name: string; dataUrl: string; owner: string }>()
  const hits: { operationId: string; method: string; path: string }[] = []
  const demo = opts.demo ?? true

  const page = <T,>(all: T[], q: URLSearchParams) => {
    const p = Math.max(1, Number(q.get('page') ?? 1)), size = Math.min(200, Math.max(1, Number(q.get('pageSize') ?? 50)))
    return { items: all.slice((p - 1) * size, p * size), total: all.length, page: p, pageSize: size }
  }
  /** 输出前把 mock 的 dataUrl 换成契约里的 url */
  const out = (v: any): any => {
    if (Array.isArray(v)) return v.map(out)
    if (v && typeof v === 'object') {
      const o: any = {}
      for (const [k, x] of Object.entries(v)) {
        if (k === 'attachments' && Array.isArray(x)) o.attachments = x.map((a: any) => { const { dataUrl, ...rest } = a; return { ...rest, url: `/api/uploads/${a.id}/content` } })
        else o[k] = out(x)
      }
      return o
    }
    return v
  }
  /** attachmentIds → mock 能理解的截图列表（已有 id 原样；新上传 → data URL） */
  const bindIds = (ids: string[] | undefined, user: string): (Attachment | NewAttachment)[] | undefined => ids?.map((id) => {
    const u = uploads.get(id)
    if (!u) return { id } as Attachment
    if (u.owner !== user) throw new ApiError('截图不存在', 422, 'VALIDATION_FAILED')
    return { name: u.name, dataUrl: u.dataUrl }
  })

  const routes: Route[] = []
  const add = (method: string, template: string, operationId: string, handler: Handler, extra: Partial<Route> = {}) => {
    const keys: string[] = []
    const re = new RegExp('^' + template.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$')
    routes.push({ method, template, operationId, re, keys, handler, ...extra })
  }
  const user = () => api.currentUser()!.username

  add('GET', '/meta', 'getMeta', async () => ({ version: 'fake-0.1', demo, ...(demo ? { demoAccounts: api.demoAccounts() } : {}), serverTime: new Date().toISOString() }), { auth: false })
  add('POST', '/auth/login', 'login', async (a, r) => {
    const u = await a.login(r.body.username, r.body.password)
    const token = randomBytes(24).toString('hex')
    tokens.set(token, u.username)
    return { token, expiresAt: new Date(Date.now() + 12 * 3600e3).toISOString(), user: u }
  }, { auth: false })
  add('POST', '/auth/logout', 'logout', async (_a, r) => { tokens.delete(r.token!); return undefined }, { status: 204 })
  add('GET', '/auth/me', 'me', async (a) => ({ user: a.currentUser() }))

  add('GET', '/lobby/accounts', 'listLobbyAccounts', async (a, r) => page(await a.listListedAccounts(), r.query))
  add('GET', '/lobby/accounts/{id}', 'getLobbyAccount', async (a, _r, p) => { const x = await a.getAccount(p.id); if (!x) throw new ApiError('账号不存在', 404, 'NOT_FOUND'); return x })
  add('GET', '/pricing/options', 'getPricingOptions', (a) => a.pricingOptions())
  add('POST', '/pricing/quote', 'quotePricing', (a, r) => a.calcPricing(r.body))
  add('POST', '/valuation/quote', 'quoteValuation', (a, r) => a.calcValuation(r.body))
  add('GET', '/cs-agents', 'listCsAgents', (a) => a.listCsAgents())
  add('GET', '/cs-agents/current', 'currentCsAgent', async (a) => ({ agent: await a.currentCsAgent() }))

  add('POST', '/recycles', 'submitRecycle', (a, r) => a.submitRecycle(r.body.asset, { sourceAccountId: r.body.sourceAccountId }), { status: 201 })
  add('GET', '/recycles', 'listRecycles', async (a, r) => page(await a.listRecycles(), r.query))
  add('GET', '/recycles/mine', 'myRecycles', async (a, r) => page(await a.myRecycles(), r.query))
  add('POST', '/recycles/{id}/transitions', 'transitionRecycle', (a, r, p) => a.updateRecycle(p.id, r.body.toStatus, r.body.note ?? '', r.body.staffPrice))
  add('POST', '/recycles/{id}/to-inventory', 'recycleToInventory', (a, _r, p) => a.recycleToInventory(p.id))

  add('GET', '/owner/accounts', 'ownerAccounts', async (a, r) => page(await a.ownerAccounts(), r.query))
  add('GET', '/owner/accounts/{id}', 'ownerAccount', (a, _r, p) => a.ownerAccount(p.id))
  add('GET', '/owner/accounts/{id}/recycle-draft', 'ownerRecycleDraft', (a, _r, p) => a.ownerRecycleDraft(p.id))
  add('POST', '/owner/estimate', 'ownerEstimate', (a, r) => a.ownerEstimate(r.body))
  add('POST', '/owner/listings', 'ownerSubmitListing', (a, r) => {
    const { attachmentIds, ...rest } = r.body
    return a.ownerSubmitListing({ ...rest, attachments: (bindIds(attachmentIds, user()) ?? []) as NewAttachment[] })
  }, { status: 201 })

  add('GET', '/accounts', 'listAccounts', async (a, r) => page(await a.listAccounts(), r.query))
  add('POST', '/accounts', 'createAccount', (a, r) => { const { attachmentIds, ...rest } = r.body; return a.saveAccount({ ...rest, attachments: bindIds(attachmentIds, user()) }) }, { status: 201 })
  add('PUT', '/accounts/{id}', 'updateAccount', (a, r, p) => { const { attachmentIds, ...rest } = r.body; return a.saveAccount({ ...rest, id: p.id, attachments: bindIds(attachmentIds, user()) }) })
  add('DELETE', '/accounts/{id}', 'deleteAccount', async (a, _r, p) => { await a.deleteAccount(p.id) }, { status: 204 })
  add('POST', '/accounts/{id}/status', 'setAccountStatus', (a, r, p) => a.setAccountStatus(p.id, r.body.status))
  add('GET', '/accounts/import/context', 'importContext', (a) => a.importContext())
  add('POST', '/accounts/import', 'importAccounts', (a, r) => a.importAccounts(r.body.rows, r.body.fileName))

  add('POST', '/uploads', 'upload', async (a, r) => {
    const u = a.currentUser()!
    if (!['owner', 'ops', 'admin'].includes(u.role)) throw new ApiError('无权限（403）', 403)
    const f = r.form?.get('file') as File | null
    if (!f || typeof f === 'string') throw new ApiError('缺少文件', 422, 'VALIDATION_FAILED')
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) throw new ApiError('仅支持 png / jpeg / webp', 415, 'UNSUPPORTED_MEDIA_TYPE')
    if (f.size > 1024 * 1024) throw new ApiError('单张截图不超过 1MB', 413, 'PAYLOAD_TOO_LARGE')
    const id = 'up_' + randomBytes(6).toString('hex')
    const dataUrl = `data:${f.type};base64,${Buffer.from(await f.arrayBuffer()).toString('base64')}`
    uploads.set(id, { name: f.name, dataUrl, owner: u.username })
    return { id, name: f.name, url: `/api/uploads/${id}/content`, mime: f.type, size: f.size, uploadedBy: u.username, at: new Date().toISOString() }
  }, { status: 201 })

  add('GET', '/orders', 'listOrders', async (a, r) => page(await a.listOrders(), r.query))
  add('POST', '/orders', 'createOrder', (a, r) => a.createOrder(r.body), { status: 201 })
  add('POST', '/orders/preview', 'previewOrder', (a, r) => a.previewOrder(r.body.accountId, r.body.renterContact))
  add('GET', '/orders/{id}', 'getOrder', async (a, _r, p) => { const o = (await a.listOrders()).find((x) => x.id === p.id); if (!o) throw new ApiError('订单不存在', 404); return o })
  add('POST', '/orders/{id}/handover', 'orderHandover', (a, r, p) => a.markHandover(p.id, r.body?.note))
  add('POST', '/orders/{id}/extend', 'orderExtend', (a, r, p) => a.extendOrder(p.id, r.body.rentalDays, r.body.note))
  add('POST', '/orders/{id}/end', 'orderEnd', (a, r, p) => a.endOrder(p.id, r.body?.note))
  add('POST', '/orders/{id}/return', 'orderReturn', (a, r, p) => a.markReturned(p.id, r.body?.note))
  add('POST', '/orders/{id}/deposits', 'addDepositEntry', (a, r, p) => a.addDepositEntry(p.id, r.body))
  add('POST', '/orders/{id}/owner-payments', 'payOwner', (a, r, p) => a.payOwner(p.id, r.body.amount, r.body.note ?? ''))
  add('POST', '/orders/{id}/complete', 'orderComplete', (a, r, p) => a.completeOrder(p.id, r.body.relist, r.body.note))
  add('POST', '/orders/{id}/cancel', 'orderCancel', (a, r, p) => a.cancelOrder(p.id, r.body?.note))
  add('GET', '/payables', 'listPayables', async (a, r) => page(await a.listPayables(r.query.get('ownerId') ?? undefined), r.query))

  add('GET', '/renters', 'listRenters', async (a, r) => page(await a.renterProfiles(), r.query))
  add('POST', '/renters', 'saveRenter', (a, r) => a.saveRenter(r.body))
  add('GET', '/renters/lookup', 'lookupRenter', async (a, r) => ({ profile: await a.lookupRenter(r.query.get('contact') ?? '') }))
  add('GET', '/owners', 'listOwners', async (a, r) => page(await a.ownerProfiles(), r.query))

  add('GET', '/rules/pricing', 'getPricingRule', (a) => a.getPricingRule())
  add('PUT', '/rules/pricing', 'savePricingRule', (a, r) => a.savePricingRule(r.body.rule, r.body.summary))
  add('GET', '/rules/valuation', 'getValuationRule', (a) => a.getValuationRule())
  add('PUT', '/rules/valuation', 'saveValuationRule', (a, r) => a.saveValuationRule(r.body.rule, r.body.summary))
  add('GET', '/rules/versions', 'ruleVersions', (a) => a.ruleHistory())
  add('POST', '/rules/pricing/trial', 'trialPricing', (a, r) => a.trialPricing(r.body.input, r.body.rule))
  add('POST', '/rules/valuation/trial', 'trialValuation', (a, r) => a.trialValuation(r.body.input, r.body.rule))

  add('GET', '/reports', 'report', (a, r) => a.report(Date.parse(r.query.get('from')!), Date.parse(r.query.get('to')!), r.query.get('dimension') as any))
  add('GET', '/dashboard', 'dashboard', (a) => a.dashboard())
  add('GET', '/staff', 'listStaff', (a) => a.listUsers())
  add('PATCH', '/staff/{username}', 'setStaffEnabled', (a, r, p) => a.setUserEnabled(p.username, r.body.enabled))
  add('GET', '/audit-logs', 'listAuditLogs', async (a, r) => page(await a.auditLogs(), r.query))
  add('POST', '/demo/reset', 'resetDemo', async (a) => {
    if (!demo) throw new ApiError('Not Found', 404, 'NOT_FOUND')
    const me = a.currentUser()!.username
    await a.resetDemo()
    tokens.clear()
    void me
  }, { status: 204 })

  const errCode = (s: number) => ({ 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 422: 'VALIDATION_FAILED' } as Record<number, string>)[s] ?? 'INTERNAL'

  async function handle(r: FakeRequest): Promise<FakeResponse> {
    const route = routes.find((x) => x.method === r.method && x.re.test(r.path))
    if (!route) return { status: 404, body: { error: { code: 'NOT_FOUND', message: `未定义的接口 ${r.method} ${r.path}` } } }
    const m = route.re.exec(r.path)!
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    hits.push({ operationId: route.operationId, method: r.method, path: r.path })
    // 每次请求按令牌切换 mock 会话；无令牌 / 失效令牌 = 未登录
    const username = r.token ? tokens.get(r.token) : undefined
    if (username) storage.setItem(SESSION_KEY, JSON.stringify({ username }))
    else storage.removeItem(SESSION_KEY)
    if (route.auth !== false && (!username || !api.currentUser())) {
      if (r.token) tokens.delete(r.token)
      return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录' } } }
    }
    try {
      const data = await route.handler(api, r, params)
      return route.status === 204 ? { status: 204 } : { status: route.status ?? 200, body: out(data) }
    } catch (e) {
      if (e instanceof ApiError) {
        const status = e.code === 401 && route.operationId === 'login' ? 401 : e.code
        const code = route.operationId === 'login' && status === 401 ? 'INVALID_CREDENTIALS' : route.operationId === 'login' && status === 403 ? 'USER_DISABLED' : (e.errorCode ?? errCode(status))
        return { status, body: { error: { code, message: e.message, fields: e.fields } } }
      }
      return { status: 500, body: { error: { code: 'INTERNAL', message: String((e as Error)?.message ?? e) } } }
    }
  }

  return { api, storage, routes, hits, handle, tokens }
}

export type FakeBackend = ReturnType<typeof createFakeBackend>

/** 起一个真实 HTTP 服务（/api 前缀）。override 可按请求返回脚本化响应（用于错误映射测试） */
export function startFakeServer(fake: FakeBackend, port = 0, override?: (r: FakeRequest) => FakeResponse | undefined | Promise<FakeResponse | undefined>) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const ct = String(req.headers['content-type'] ?? '')
    let body: any, form: FormData | undefined
    if (ct.startsWith('multipart/form-data')) form = await new Request('http://x', { method: 'POST', headers: { 'content-type': ct }, body: raw }).formData()
    else if (raw.length) { try { body = JSON.parse(raw.toString('utf8')) } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'JSON 格式错误' } })) } }
    const auth = String(req.headers.authorization ?? '')
    const r: FakeRequest = { method: req.method ?? 'GET', path: url.pathname.replace(/^\/api/, ''), query: url.searchParams, body, form, token: auth.startsWith('Bearer ') ? auth.slice(7) : null }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end() }
    const out = (await override?.(r)) ?? (await fake.handle(r))
    const headers: Record<string, string> = { 'X-Request-Id': randomBytes(4).toString('hex'), ...(out.headers ?? {}) }
    if (out.status === 204 || out.body === undefined) { res.writeHead(out.status, headers); return res.end() }
    if (typeof out.body === 'string') { res.writeHead(out.status, { 'Content-Type': 'text/html', ...headers }); return res.end(out.body) }
    res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
    res.end(JSON.stringify(out.body))
  })
  return new Promise<{ server: http.Server; port: number; close: () => Promise<void> }>((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const p = (server.address() as any).port
      ok({ server, port: p, close: () => new Promise((d) => server.close(() => d())) })
    })
  })
}
