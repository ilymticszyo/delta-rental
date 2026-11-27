// 契约测试：HttpApi（src/api/http.ts）经真实 HTTP 调用后端，逐个请求 / 响应按 docs/openapi.yaml 校验。
//
// 两种模式：
//   默认                         起一个内存假后端（tests/contract/fakeBackend.ts，LocalApi 之上的契约参考实现）
//   CONTRACT_BASE_URL=http://…   不起假后端，直接打该地址（真实后端或单独进程的 npm run fake-api）
//                                 可选：CONTRACT_ADMIN_USER / CONTRACT_ADMIN_PASSWORD（默认 admin / admin123）
//                                       CONTRACT_ALLOW_RESET=1 允许调用 /demo/reset（会清空演示数据，默认不调）
//
// 校验在客户端做（包装传给 HttpApi 的 fetch），所以两种模式完全相同：
// ① 每个请求打到契约里声明的方法 + 路径，查询参数已声明，请求体符合 schema；② 响应状态码已声明、响应体符合 schema；
// ③ 契约里每个操作都被客户端用到（x-client-unused 与 x-status: proposed 除外）；④ 错误 / 401 / 超时 / 网络错误 / 幂等重试的映射。
// 测试数据（账号、租客、号主、导入编号）都经 API 现建，带本次运行的唯一后缀，不依赖种子；
// 依赖演示账号或提议接口的用例在远端缺失时跳过并写明原因。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import SwaggerParser from '@apidevtools/swagger-parser'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { HttpApi, memoryTokenStore, type HttpApiOptions } from '../../src/api/http'
import { ApiError } from '../../src/api/errors'
import { depositBalance } from '../../src/api/local'
import { newIdempotencyKey } from '../../src/api/idempotency'
import { FORBIDDEN_OWNER_KEYS } from '../../src/domain/visibility'
import { templateAoa, type ImportContext } from '../../src/domain/importAccounts'
import type { AccountInput, Role } from '../../src/domain/types'
import type { PricingOptions } from '../../src/api/types'
import { createFakeBackend, startFakeServer } from './fakeBackend'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const REMOTE = (process.env.CONTRACT_BASE_URL ?? '').trim().replace(/\/+$/, '')
const ADMIN = { user: process.env.CONTRACT_ADMIN_USER || 'admin', pass: process.env.CONTRACT_ADMIN_PASSWORD || 'admin123' }
/** 演示种子的账号密码；远端没有这些账号时，用（提议的）POST /staff 现建，不支持则跳过 */
const DEMO_LOGIN: Record<string, [string, string]> = { owner: ['owner1', 'owner123'], member: ['demo', 'demo123'], cs: ['cs', 'cs123'], ops: ['ops', 'ops123'] }
const RUN = Date.now().toString(36).toUpperCase().slice(-6) + Math.floor(Math.random() * 36 * 36).toString(36).toUpperCase().padStart(2, '0')
let seq = 0
const uniq = (p: string) => `${p}${RUN}${(++seq).toString(36).toUpperCase()}`

// ---------- OpenAPI → JSON Schema（3.0 的 nullable / 布尔 exclusiveMinimum 转换） ----------
function toJsonSchema(s: any): any {
  if (Array.isArray(s)) return s.map(toJsonSchema)
  if (!s || typeof s !== 'object') return s
  const o: any = {}
  for (const [k, v] of Object.entries(s)) if (!k.startsWith('x-') && k !== 'example' && k !== 'nullable') o[k] = toJsonSchema(v)
  if (s.exclusiveMinimum === true) { o.exclusiveMinimum = s.minimum; delete o.minimum }
  return s.nullable ? { anyOf: [o, { type: 'null' }] } : o
}
interface Op { method: string; path: string; operationId: string; op: any; re: RegExp }
const ops: Op[] = []
let errorSchema: any
const ajv = new Ajv({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addFormat('binary', true)
const validators = new Map<string, any>()
function validate(key: string, schema: any, data: unknown): string | null {
  if (!schema) return null
  let v = validators.get(key)
  if (!v) { v = ajv.compile(toJsonSchema(schema)); validators.set(key, v) }
  return v(data) ? null : ajv.errorsText(v.errors, { dataVar: key })
}

// ---------- 客户端校验层：包装 fetch ----------
interface Req { method: string; path: string; query: URLSearchParams; headers: Headers; body: any; form?: FormData; signal?: AbortSignal | null }
type Script = (r: Req, next: () => Promise<Response>) => Response | undefined | Promise<Response | undefined>
const violations: string[] = []
const notes: string[] = [] // 远端不满足“建议”项时的提示（不算失败）
const skipped: string[] = []
const seen = new Set<string>()
const trace: { operationId: string; status: number; headers: Headers; req: Req }[] = []
const scriptedResponses = new WeakSet<Response>()
let scripted: Script | undefined
let base = ''
let mode: 'fake' | 'remote' = REMOTE ? 'remote' : 'fake'
const fake = REMOTE ? null : createFakeBackend({ demo: true })
let srv: Awaited<ReturnType<typeof startFakeServer>> | undefined

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  const r = new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } })
  scriptedResponses.add(r)
  return r
}
const opOf = (method: string, path: string) => ops.find((o) => o.method === method && o.re.test(path))

const vfetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const path = url.pathname.replace(/^.*?\/api(?=\/)/, '')
  const method = String(init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  let body: any, form: FormData | undefined
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) form = init.body
  else if (typeof init.body === 'string') body = JSON.parse(init.body)
  const req: Req = { method, path, query: url.searchParams, headers, body, form, signal: init.signal }
  const op = opOf(method, path)
  if (!op) violations.push(`契约未定义：${method} ${path}`)
  else {
    seen.add(op.operationId)
    const declared = new Set((op.op.parameters ?? []).filter((p: any) => p.in === 'query').map((p: any) => p.name))
    for (const k of url.searchParams.keys()) if (!declared.has(k)) violations.push(`${op.operationId}: 未声明的查询参数 ${k}`)
    for (const p of (op.op.parameters ?? []).filter((p: any) => p.in === 'query' && p.required)) if (!url.searchParams.has(p.name)) violations.push(`${op.operationId}: 缺少必填查询参数 ${p.name}`)
    if (headers.has('Idempotency-Key') && !(op.op.parameters ?? []).some((p: any) => p.in === 'header' && p.name === 'Idempotency-Key')) violations.push(`${op.operationId}: 契约未声明 Idempotency-Key`)
    const rb = op.op.requestBody?.content
    if (rb?.['application/json'] && body !== undefined) { const e = validate(`${op.operationId}.req`, rb['application/json'].schema, body); if (e) violations.push(`${op.operationId} 请求体：${e}`) }
    if (rb?.['application/json'] && op.op.requestBody.required && body === undefined) violations.push(`${op.operationId}: 缺少请求体`)
    if (rb?.['multipart/form-data'] && !form) violations.push(`${op.operationId}: 应为 multipart/form-data`)
  }
  const next = () => fetch(input, init)
  const res = (await scripted?.(req, next)) ?? (await next())
  if (op && !scriptedResponses.has(res)) {
    trace.push({ operationId: op.operationId, status: res.status, headers: res.headers, req })
    // 全局 security（Bearer）：需要登录的操作都可能 401（令牌失效 / 被吊销），统一用 ErrorResponse 校验
    const secured = !(Array.isArray(op.op.security) && op.op.security.length === 0)
    // 提议操作（x-status: proposed）后端可能还没实现：404 / 405 / 501 不算违约（客户端会降级）
    const notImplemented = isProposed(op) && [404, 405, 501].includes(res.status)
    const spec = op.op.responses[String(res.status)] ?? (res.status === 401 && secured ? { content: { 'application/json': { schema: errorSchema } } } : notImplemented ? { content: { 'application/json': { schema: errorSchema } } } : undefined)
    const text = await res.clone().text()
    if (!spec) violations.push(`${op.operationId}: 契约未声明状态码 ${res.status}（${text.slice(0, 160)}）`)
    else {
      const schema = spec.content?.['application/json']?.schema
      if (schema) {
        let data: unknown
        try { data = JSON.parse(text) } catch { violations.push(`${op.operationId} ${res.status}: 响应不是 JSON：${text.slice(0, 80)}`) }
        const e = data === undefined ? null : validate(`${op.operationId}.${res.status}`, schema, data)
        if (e) violations.push(`${op.operationId} 响应 ${res.status}：${e}`)
      } else if (res.status !== 204 && text) violations.push(`${op.operationId}: 契约没有响应体但返回了内容`)
    }
  }
  return res
}

const client = (o: Partial<HttpApiOptions> = {}) => {
  const onUnauthorized = vi.fn()
  const api = new HttpApi({ baseUrl: base, tokenStore: memoryTokenStore(), onUnauthorized, fetch: vfetch, retryDelaysMs: [0, 0], ...o })
  return { api, onUnauthorized }
}
async function login(user: string, pass: string, o: Partial<HttpApiOptions> = {}) {
  const c = client(o); await c.api.init(); await c.api.login(user, pass); return c
}
const asAdmin = (o: Partial<HttpApiOptions> = {}) => login(ADMIN.user, ADMIN.pass, o)

/** 每个角色一个可登录的账号：先试演示种子；远端没有时用 POST /staff 现建（提议接口，不支持则返回 null 并写原因） */
const provisioned = new Map<string, [string, string] | null>()
let skipReason = ''
async function loginAs(role: Exclude<Role, 'admin'>, o: Partial<HttpApiOptions> = {}) {
  if (!provisioned.has(role)) {
    const [u, p] = DEMO_LOGIN[role]
    const probe = client()
    const ok = await probe.api.login(u, p).then(() => true, (e) => { if (e instanceof ApiError && (e.code === 401 || e.code === 403)) return false; throw e })
    if (ok) provisioned.set(role, [u, p])
    else {
      const { api: admin } = await asAdmin()
      const username = uniq(`ct_${role}_`).toLowerCase().slice(0, 32)
      const password = `Ct-${RUN}-pass`
      let ownerId: string | undefined
      if (role === 'owner') ownerId = (await createAccounts(admin, 1, { status: 'draft' }))[0].ownerId
      try { await admin.createUser({ username, displayName: `契约测试 ${role}`, role, password, ownerId }); provisioned.set(role, [username, password]) }
      catch (e) {
        if (e instanceof ApiError && e.errorCode === 'NOT_SUPPORTED') { provisioned.set(role, null); skipReason = `远端没有演示账号 ${u}，且不支持 POST /staff（提议接口）现建 ${role} 用户` }
        else throw e
      }
    }
  }
  const cred = provisioned.get(role)
  return cred ? login(cred[0], cred[1], o) : null
}
function skipWith(ctx: { skip: (note?: string) => void }, reason: string) { skipped.push(reason); console.warn(`[contract] 跳过：${reason}`); ctx.skip(reason) }

/** 经 API 现建测试账号（寄租、空闲可租，号主按唯一联系方式自动建档） */
let dicts: { ctx: ImportContext; opts: PricingOptions } | undefined
async function createAccounts(admin: HttpApi, n: number, over: Partial<AccountInput> = {}) {
  dicts ??= { ctx: await admin.importContext(), opts: await admin.pricingOptions() }
  const { ctx, opts } = dicts
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(await admin.saveAccount({
      status: 'listed', source: 'consign', ownerContact: uniq('wx_ct_owner_').toLowerCase(), costAmount: 0,
      region: ctx.regions[0], loginMethod: ctx.loginMethods[0], channel: opts.channels[0], assistTime: '09:00-23:00', banRecord: false,
      totalAssets: 400, coinAmount: 300, secretKd: 1.2, level: 40, rank: ctx.ranks[0], safeBox: ctx.safeBoxes[0], stamina: ctx.stamina[0], load: ctx.loads[0],
      awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0, skins: [], cycle: opts.cycles[0], coinRatio: 20, discountMode: 'system',
      deposit: 100, remark: '契约测试', ...over,
    }))
  }
  return out
}
const orderInput = (accountId: string, renterContact: string, over: Record<string, unknown> = {}) =>
  ({ accountId, renterContact, startAt: new Date().toISOString(), rentalDays: 2, deposit: 100, extraFee: 0, remark: '契约测试', ...over })
function forbiddenKeys(obj: unknown, found: string[] = []): string[] {
  if (Array.isArray(obj)) obj.forEach((x) => forbiddenKeys(x, found))
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (FORBIDDEN_OWNER_KEYS.includes(k) && v !== null && v !== undefined) found.push(k); forbiddenKeys(v, found) }
  return found
}
const isProposed = (o: Op) => o.op['x-status'] === 'proposed'

beforeAll(async () => {
  const doc: any = await SwaggerParser.dereference('docs/openapi.yaml')
  errorSchema = doc.components.schemas.ErrorResponse
  for (const [path, item] of Object.entries<any>(doc.paths))
    for (const [method, op] of Object.entries<any>(item)) {
      const re = new RegExp('^' + path.replace(/\{\w+\}/g, '[^/]+') + '$')
      ops.push({ method: method.toUpperCase(), path, operationId: op.operationId, op, re })
    }
  if (REMOTE) base = REMOTE.endsWith('/api') ? REMOTE : `${REMOTE}/api`
  else { srv = await startFakeServer(fake!, 0); base = `http://127.0.0.1:${srv.port}/api` }
  console.info(`[contract] 模式：${mode}，后端 ${base}，本次运行后缀 ${RUN}`)
})
afterAll(async () => {
  await srv?.close()
  if (notes.length) console.warn('[contract] 建议项提示：\n  ' + notes.join('\n  '))
  if (skipped.length) console.warn('[contract] 跳过的用例：\n  ' + skipped.join('\n  '))
})

describe('契约文件自洽', () => {
  it('每个操作都有 operationId、x-roles、至少一个 2xx 响应；operationId 唯一', () => {
    const ids = ops.map((o) => o.operationId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const o of ops) {
      expect(o.op['x-roles'], o.operationId).toBeTruthy()
      expect(Object.keys(o.op.responses).some((s) => s.startsWith('2')), o.operationId).toBe(true)
    }
  })
  it('假后端的路由表与契约一一对应（方法 + 路径）', () => {
    const local = fake ?? createFakeBackend()
    const a = ops.map((o) => `${o.method} ${o.path} ${o.operationId}`).sort()
    const b = local.routes.map((r) => `${r.method} ${r.template} ${r.operationId}`).sort()
    expect(b).toEqual(a)
  })
})

describe('HttpApi ↔ 契约：每个方法的路径、方法、请求与响应', () => {
  it('启动：/meta；无令牌时不调 /auth/me', async () => {
    const { api } = client()
    await api.init()
    expect(api.features().mode).toBe('http')
    if (mode === 'fake') {
      expect(api.features()).toMatchObject({ demo: true, serverVersion: 'fake-0.1' })
      expect(api.demoAccounts().map((d) => d.username)).toContain('owner1')
    } else if (!api.features().demo) expect(api.demoAccounts()).toEqual([])
    expect(api.currentUser()).toBeNull()
  })

  it('管理员全流程：库存 / 截图上传 / 导入 / 订单生命周期 / 台账 / 档案 / 回收 / 规则 / 报表 / 员工 / 日志', async () => {
    const { api } = await asAdmin({ pageSize: 7 })
    // 会话恢复：新客户端用同一令牌 init → /auth/me
    const again = new HttpApi({ baseUrl: base, tokenStore: memoryTokenStore((api as any).tokens.get()), onUnauthorized: vi.fn(), fetch: vfetch })
    await again.init()
    expect(again.currentUser()?.username).toBe(ADMIN.user)

    // 测试数据：3 个寄租空闲账号 + 熟客 / 黑名单租客
    const mine = await createAccounts(api, 3)
    const vip = uniq('wx_ct_vip_').toLowerCase(), black = uniq('wx_ct_black_').toLowerCase()
    expect((await api.saveRenter({ contact: vip, displayName: '契约熟客', tag: 'regular', note: '' })).tag).toBe('regular')
    expect((await api.saveRenter({ contact: black, displayName: '', tag: 'blacklist', note: '契约测试' })).tag).toBe('blacklist')

    // 前台
    const lobby = await api.listListedAccounts()
    expect(lobby.some((a) => a.id === mine[0].id)).toBe(true)
    if (fake) expect(lobby.length).toBe((await fake.api.login('admin', 'admin123'), (await fake.api.listListedAccounts()).length))
    expect(lobby[0].quote?.ownerSettlement).toBeTypeOf('number') // 员工看到完整报价
    expect((await api.getAccount(mine[0].id))?.accountNo).toBe(mine[0].accountNo)
    expect(await api.getAccount('no-such-id')).toBeUndefined()
    const opts = await api.pricingOptions()
    expect(opts.channels.length).toBeGreaterThan(0)
    const q = await api.calcPricing({ coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: opts.channels[0], discountMode: 'system', cycle: opts.cycles[0], deposit: 0 })
    expect(q.totalAmount).toBeGreaterThan(0)
    const asset = { contact: uniq('wx_ct_r_').toLowerCase(), region: dicts!.ctx.regions[0], loginMethod: dicts!.ctx.loginMethods[0], coinAmount: 200, totalAssets: 260, level: 40, rank: dicts!.ctx.ranks[0], safeBox: dicts!.ctx.safeBoxes[0], skins: [], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 }
    expect((await api.calcValuation(asset)).center).toBeGreaterThan(0)
    expect((await api.listCsAgents()).length).toBeGreaterThan(0)
    await api.currentCsAgent()

    // 分页拉全量（pageSize=7 → 多页）
    const accs = await api.listAccounts()
    expect(new Set(accs.map((a) => a.id)).size).toBe(accs.length)
    expect(mine.every((m) => accs.some((a) => a.id === m.id))).toBe(true)
    if (fake) expect(accs.length).toBe(23) // 20 个种子 + 3 个现建

    // 新截图：先 POST /uploads 再带 attachmentIds；返回 url 映射为 dataUrl，且不带 Bearer 就能取到图（签名地址）
    const { id: _i, accountNo: _n, quote: _q, createdAt: _c, updatedAt: _u, cumulativeIncome: _ci, paybackPercent: _p, ownerName: _o, attachments: _a, deleted: _d, ...fields } = mine[0] as any
    const created = await api.saveAccount({ ...fields, ownerContact: uniq('wx_ct_owner_').toLowerCase(), status: 'draft', attachments: [{ name: 'a.png', dataUrl: PNG }] })
    expect(created.attachments).toHaveLength(1)
    const img = await fetch(new URL(created.attachments[0].dataUrl, base).toString())
    expect(img.status, '签名地址不带 Authorization 应能直接取图').toBe(200)
    expect(img.headers.get('content-type')).toMatch(/^image\//)
    if (fake) expect(created.attachments[0].dataUrl).toMatch(/^\/api\/uploads\/[^/]+\/content\?exp=\d+&sig=[0-9a-f]+$/)
    if (created.attachments[0].expiresAt) expect(Date.parse(created.attachments[0].expiresAt) - Date.now()).toBeGreaterThan(50 * 60e3)
    else notes.push('Attachment.expiresAt 缺省（提议字段）：前端只能在图片加载失败时续签')
    const edited = await api.saveAccount({ ...fields, id: created.id, ownerContact: created.ownerContact, status: 'draft', remark: '改', attachments: [...created.attachments, { name: 'b.png', dataUrl: PNG }] })
    expect(edited.attachments.map((x) => x.id)[0]).toBe(created.attachments[0].id)
    expect(edited.attachments).toHaveLength(2)
    expect((await api.setAccountStatus(created.id, 'listed')).status).toBe('listed')
    await api.setAccountStatus(created.id, 'off')
    await api.deleteAccount(created.id)

    // 导入（编号带本次运行后缀，可重复运行）
    const ctx = await api.importContext()
    expect(ctx.existingNos.length).toBeGreaterThan(0)
    const [h, ex] = templateAoa()
    const noA = uniq('CT'), noB = uniq('CT')
    const bad = ex.slice(); bad[0] = noB; bad[4] = '火星区'
    const out = await api.importAccounts([h, [noA, ...ex.slice(1)], bad], 'c.xlsx')
    expect(out).toMatchObject({ imported: [noA], operator: ADMIN.user })
    expect(out.skipped[0].rowNo).toBe(3)

    // 订单生命周期
    const pv = await api.previewOrder(mine[0].id, vip)
    expect(pv).toMatchObject({ blocked: false, profile: { tag: 'regular' } })
    if (pv.ruleVersion !== undefined) expect(pv.ruleVersion).toBe(mine[0].quote.ruleVersion)
    else notes.push('OrderPreview.ruleVersion 缺省（提议字段）')
    const o = await api.createOrder(orderInput(mine[0].id, uniq('wx_ct_r_').toLowerCase()))
    expect(o.status).toBe('active')
    if (o.ruleVersion !== undefined) expect(o.ruleVersion).toBe(mine[0].quote.ruleVersion)
    else notes.push('RentalOrder.ruleVersion 缺省（提议字段）')
    expect(await api.getOrder(o.id)).toMatchObject({ id: o.id, reminder: null, ownerPayableBalance: o.ownerPayable })
    await expect(api.getOrder('no-such-order')).rejects.toMatchObject({ code: 404 })
    await api.markHandover(o.id, '已交号')
    await api.extendOrder(o.id, 3, '续一天')
    await api.addDepositEntry(o.id, { type: 'collect', amount: 50, reason: '补收押金' })
    await api.endOrder(o.id)
    await api.markReturned(o.id)
    await api.addDepositEntry(o.id, { type: 'deduct', amount: 30, reason: 'AWM 消耗' })
    const bal = depositBalance(await api.getOrder(o.id))
    await api.addDepositEntry(o.id, { type: 'refund', amount: bal, reason: '退余额' })
    const paid = await api.payOwner(o.id, o.ownerPayable, '微信转账')
    expect(paid.events.map((e) => e.step)).toEqual(expect.arrayContaining(['register', 'handover', 'extend', 'collect', 'expire', 'return', 'deduct', 'refund', 'payOwner']))
    expect((await api.completeOrder(o.id, true)).status).toBe('done')
    const o2 = await api.createOrder(orderInput(mine[1].id, uniq('wx_ct_r_').toLowerCase(), { deposit: 0 }))
    expect((await api.cancelOrder(o2.id, '客户取消')).status).toBe('cancelled')
    expect((await api.listOrders()).find((x) => x.id === o.id)?.ownerPayableBalance).toBe(0)
    const pay = await api.listPayables({ ownerId: mine[0].ownerId })
    expect(pay.some((x) => x.type === 'pay' && x.orderId === o.id)).toBe(true)
    const byOrder = await api.listPayables({ orderId: o.id })
    if (byOrder.some((x) => x.orderId !== o.id)) notes.push('GET /payables?orderId= 被忽略（提议参数）：前端已在本地按订单过滤')
    expect(byOrder.filter((x) => x.orderId === o.id).map((x) => x.type).sort()).toEqual(['accrue', 'pay'])
    // 黑名单：业务错误映射为 ApiError（409 RENTER_BLACKLISTED）
    await expect(api.createOrder(orderInput(mine[2].id, black))).rejects.toMatchObject({ name: 'ApiError', code: 409, errorCode: 'RENTER_BLACKLISTED' })

    // 档案
    expect((await api.renterProfiles()).some((r) => r.contact === vip)).toBe(true)
    expect((await api.lookupRenter(vip))?.tag).toBe('regular')
    expect(await api.lookupRenter(uniq('wx_nobody_').toLowerCase())).toBeNull()
    const owners = await api.ownerProfiles()
    expect(owners.some((x) => x.id === mine[0].ownerId)).toBe(true)

    // 回收
    const rr = await api.submitRecycle(asset)
    expect((await api.myRecycles()).some((x) => x.id === rr.id)).toBe(true)
    await api.updateRecycle(rr.id, 'following', '跟进')
    await api.updateRecycle(rr.id, 'quoted', '报价', 300)
    expect((await api.recycleToInventory(rr.id)).source).toBe('buyin')
    expect((await api.listRecycles()).find((x) => x.id === rr.id)?.status).toBe('deal')

    // 规则（版本化；按原样保存，不改远端的计价 / 估值参数）
    const pr = await api.getPricingRule()
    const prv = await api.previewPricingRule(pr).catch((e) => e)
    if (prv instanceof ApiError && prv.errorCode === 'NOT_SUPPORTED') notes.push('POST /rules/pricing/preview 未实现：按旧方式保存规则（不重算库存）')
    const saved = await api.savePricingRule(pr, '契约测试', prv instanceof ApiError ? undefined : { baseVersion: prv.baseVersion, previewToken: prv.previewToken })
    expect(saved.rule.version).toBe(pr.version + 1)
    if (saved.repriced === null) notes.push('PUT /rules/pricing 仍回 PricingRule，未回 PricingRuleSaveResult（不重算库存）')
    const vr = await api.getValuationRule()
    expect((await api.saveValuationRule(vr, '契约测试')).version).toBe(vr.version + 1)
    const hist = await api.ruleHistory()
    expect(hist.pricing[0].summary).toBe('契约测试')
    await api.trialPricing({ coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: opts.channels[0], discountMode: 'system', cycle: opts.cycles[0], deposit: 0 }, pr)
    expect((await api.trialValuation(asset, { ...vr, marketCoefficient: 2 })).marketCoefficient).toBe(2)
    // 改规则后已上架账号的价格不变（§12-4），登记仍按账号报价
    const pv2 = await api.previewOrder(mine[2].id, uniq('wx_ct_r_').toLowerCase())
    expect(pv2.coinRent).toBe(mine[2].quote.coinRent)

    // 报表 / 看板 / 员工 / 日志 / 号主门户（管理员看全部）
    const rep = await api.report(Date.now() - 30 * 864e5, Date.now() + 60e3, 'rank')
    expect(rep.groups.length).toBeGreaterThan(0)
    expect((await api.dashboard()).listed).toBeGreaterThan(0)
    const users = await api.listUsers()
    expect(users.some((u) => u.username === ADMIN.user && u.role === 'admin')).toBe(true)
    if (fake) expect(users.length).toBe(6)
    const victim = users.find((u) => u.role !== 'admin' && u.enabled)
    if (victim) {
      expect((await api.setUserEnabled(victim.username, false)).enabled).toBe(false)
      await api.setUserEnabled(victim.username, true)
    } else notes.push('没有可停用再启用的非管理员用户，跳过 PATCH /staff/{username}')
    expect((await api.auditLogs()).some((l) => l.action === '批量导入')).toBe(true)
    const all = await api.ownerAccounts()
    expect(all.some((x) => x.ownerName)).toBe(true)
    await api.ownerAccount(all[0].id)

    await api.logout()
    expect(api.currentUser()).toBeNull()
  })

  it('幂等：同键同体重放（不重复登记 / 付款 / 入库）；同键异体 409 DUPLICATE', async () => {
    const { api } = await asAdmin()
    const [acc, acc2] = await createAccounts(api, 2)
    const renter = uniq('wx_ct_r_').toLowerCase()
    const input = orderInput(acc.id, renter)
    const k = newIdempotencyKey()
    const o1 = await api.createOrder(input, { idempotencyKey: k })
    const o2 = await api.createOrder(input, { idempotencyKey: k })
    expect(o2.id).toBe(o1.id)
    expect((await api.listOrders()).filter((x) => x.renterContact === renter)).toHaveLength(1)
    const replay = trace.filter((t) => t.operationId === 'createOrder').slice(-1)[0]
    expect(replay.status).toBe(201)
    if (replay.headers.get('Idempotent-Replayed') !== 'true') (mode === 'fake' ? violations : notes).push('createOrder 重放响应没有 Idempotent-Replayed: true（建议项）')
    await expect(api.createOrder({ ...input, accountId: acc2.id }, { idempotencyKey: k })).rejects.toMatchObject({ code: 409, errorCode: 'DUPLICATE' })
    // 付号主款
    const pk = newIdempotencyKey()
    await api.payOwner(o1.id, 1, '幂等测试', { idempotencyKey: pk })
    await api.payOwner(o1.id, 1, '幂等测试', { idempotencyKey: pk })
    expect((await api.listPayables({ orderId: o1.id })).filter((p) => p.orderId === o1.id && p.type === 'pay')).toHaveLength(1)
    await expect(api.payOwner(o1.id, 2, '幂等测试', { idempotencyKey: pk })).rejects.toMatchObject({ code: 409, errorCode: 'DUPLICATE' })
    // 导入
    const [h, ex] = templateAoa()
    const no = uniq('CT')
    const ik = newIdempotencyKey()
    const r1 = await api.importAccounts([h, [no, ...ex.slice(1)]], 'idem.xlsx', { idempotencyKey: ik })
    const r2 = await api.importAccounts([h, [no, ...ex.slice(1)]], 'idem.xlsx', { idempotencyKey: ik })
    expect(r1.imported).toEqual([no])
    expect(r2).toEqual(r1) // 重放：仍是“导入成功”，而不是“与库存重复”
  })

  it('幂等重试：响应在路上丢了（服务端已处理）→ HttpApi 用同一个键自动重试，服务端重放，只登记一笔', async () => {
    const { api } = await asAdmin()
    const [acc] = await createAccounts(api, 1)
    const renter = uniq('wx_ct_r_').toLowerCase()
    const keys: string[] = []
    let dropped = false
    scripted = async (r, next) => {
      if (r.method !== 'POST' || r.path !== '/orders') return undefined
      keys.push(r.headers.get('Idempotency-Key') ?? '')
      if (!dropped) { dropped = true; await next(); throw new TypeError('fetch failed') } // 服务端已执行，客户端收不到
      return undefined
    }
    try {
      const o = await api.createOrder(orderInput(acc.id, renter), { idempotencyKey: newIdempotencyKey() })
      expect(o.renterContact).toBe(renter)
    } finally { scripted = undefined }
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect((await api.listOrders()).filter((x) => x.renterContact === renter)).toHaveLength(1)
    // 没带键的普通 POST 不自动重试
    let n = 0
    scripted = (r) => { if (r.method === 'POST' && r.path === '/orders') { n++; throw new TypeError('fetch failed') } return undefined }
    try { await expect(api.createOrder(orderInput(acc.id, renter))).rejects.toMatchObject({ errorCode: 'NETWORK_ERROR' }) } finally { scripted = undefined }
    expect(n).toBe(1)
  })

  it('号主：只能拿到白名单字段（大厅无报价、算价只有到手、门户不含租客 / 租金 / 抽成），上架带截图', async (ctx) => {
    const owner = await loginAs('owner')
    if (!owner) return skipWith(ctx, skipReason)
    const { api } = owner
    // 确保这个号主名下有一个空闲账号（按号主档案的联系方式现建）
    const me = api.currentUser()!
    const { api: admin } = await asAdmin()
    const prof = (await admin.ownerProfiles()).find((p) => p.id === me.ownerId)
    expect(prof, '号主用户的 ownerId 应对应一个号主档案').toBeTruthy()
    await createAccounts(admin, 1, { ownerContact: prof!.contact })
    const raw: unknown[] = []
    const lobby = await api.listListedAccounts(); raw.push(lobby)
    expect(lobby.every((a) => a.quote === null && a.ownerContact === undefined && a.costAmount === undefined)).toBe(true)
    const opts = await api.pricingOptions()
    const q = await api.calcPricing({ coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: opts.channels[0], discountMode: 'system', cycle: opts.cycles[0], deposit: 0 })
    expect(Object.keys(q).sort()).toEqual(['ownerSettlement', 'ruleVersion'])
    const mine = await api.ownerAccounts(); raw.push(mine)
    const idle = mine.find((m) => m.ownerStatus === '空闲')!
    expect(idle).toBeTruthy()
    raw.push(await api.ownerAccount(idle.id))
    const draft = await api.ownerRecycleDraft(idle.id)
    const est = await api.ownerEstimate(draft); raw.push(est)
    expect(est.takeHome).toBeGreaterThan(0)
    const listing = await api.ownerSubmitListing({ asset: draft, assistTime: '全天', remark: '', attachments: [{ name: 's.png', dataUrl: PNG }] })
    raw.push(listing)
    expect(listing).toMatchObject({ ownerStatus: '待确认' })
    expect(listing.attachments[0].dataUrl).toMatch(/^\/api\/uploads\//)
    expect(forbiddenKeys(raw)).toEqual([])
    await expect(api.getPricingRule()).rejects.toMatchObject({ code: 403 }) // 含服务费率，号主不可读
    await expect(api.listOrders()).rejects.toMatchObject({ code: 403 })
  })

  it('客服：导入接口在服务端被拒（403）；成员：大厅报价不含号主可得与服务费', async (ctx) => {
    const cs = await loginAs('cs')
    if (!cs) return skipWith(ctx, skipReason)
    await expect(cs.api.importAccounts(templateAoa(), 'x.xlsx')).rejects.toMatchObject({ code: 403 })
    await expect(cs.api.importContext()).rejects.toMatchObject({ code: 403 })
    const m = await loginAs('member')
    if (!m) return skipWith(ctx, skipReason)
    const lobby = await m.api.listListedAccounts()
    expect(lobby.every((a) => a.quote && a.quote.ownerSettlement === undefined && a.quote.serviceFee === undefined)).toBe(true)
  })

  it('改规则重算库存：预览不落库；租赁中跳过；确认后原子重算并升报价版本；旧预览 / 旧版本 409 RULE_CONFLICT', async (ctx) => {
    const { api } = await asAdmin()
    const orig = await api.getPricingRule()
    const probe = await api.previewPricingRule(orig).catch((e) => e)
    if (probe instanceof ApiError && probe.errorCode === 'NOT_SUPPORTED') return skipWith(ctx, 'POST /rules/pricing/preview 未实现（v0.4 新增）；规则页退回“仍然保存（不重算）”')
    const [a, b] = await createAccounts(api, 2)
    const o = await api.createOrder(orderInput(b.id, uniq('wx_ct_rp_').toLowerCase()))
    const cand = { ...orig, extraFee: { mode: 'fixed' as const, value: (orig.extraFee.mode === 'fixed' ? orig.extraFee.value : 0) + 7 } }
    const pv = await api.previewPricingRule(cand)
    expect(pv.baseVersion).toBe(orig.version)
    expect(pv.nextVersion).toBe(orig.version + 1)
    expect((await api.getPricingRule()).version).toBe(orig.version) // 不落库
    const ia = pv.affected.find((x) => x.accountId === a.id)!
    expect(ia).toMatchObject({ accountNo: a.accountNo, status: 'listed', oldRuleVersion: a.quote.ruleVersion, changed: true })
    expect(ia.oldPrice.renterRent).toBe(a.quote.renterRent)
    expect(ia.newPrice.extraFee).toBe(cand.extraFee.value)
    expect(ia.delta).toBe(ia.newPrice.renterRent - ia.oldPrice.renterRent)
    expect(pv.skipped.find((x) => x.accountId === b.id)).toMatchObject({ reason: 'RENTED', ruleVersion: b.quote.ruleVersion })
    expect(pv.summary.affectedCount).toBe(pv.affected.length)
    expect(pv.summary.skippedCount).toBe(pv.skipped.length)
    // 缺预览 → 422；规则内容与预览不一致 → 409 PREVIEW_STALE
    // 故意发不合契约的请求体，绕过客户端校验直接发
    const raw = await fetch(`${base}/rules/pricing`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(api as any).tokens.get()}` }, body: JSON.stringify({ rule: cand, summary: '契约测试' }) })
    expect(raw.status).toBe(422)
    expect(await api.savePricingRule({ ...cand, defaultDeposit: cand.defaultDeposit + 1 }, '契约测试', pv).catch((e) => e)).toMatchObject({ code: 409, errorCode: 'RULE_CONFLICT', details: { reason: 'PREVIEW_STALE' } })
    const res = await api.savePricingRule(cand, '契约测试：改价重算', { baseVersion: pv.baseVersion, previewToken: pv.previewToken })
    expect(res.rule.version).toBe(orig.version + 1)
    expect(res.repriced).toMatchObject({ affectedCount: pv.summary.affectedCount, skippedCount: pv.summary.skippedCount })
    const accs = await api.listAccounts()
    expect(accs.find((x) => x.id === a.id)!.quote).toMatchObject({ ruleVersion: res.rule.version, renterRent: ia.newPrice.renterRent })
    expect(accs.find((x) => x.id === b.id)!.quote.ruleVersion).toBe(b.quote.ruleVersion)
    expect(await api.getOrder(o.id)).toMatchObject({ coinRent: o.coinRent, ownerPayable: o.ownerPayable, totalAmount: o.totalAmount })
    const log = (await api.auditLogs()).find((l) => l.action === '计价规则')
    expect(log?.summary).toContain(`v${res.rule.version}`)
    // 拿旧预览再存 → 版本已变
    expect(await api.savePricingRule(cand, '契约测试', pv).catch((e) => e)).toMatchObject({ code: 409, errorCode: 'RULE_CONFLICT', details: { reason: 'VERSION_CHANGED' } })
    // 还原规则内容（远端不留下改动的参数；版本号照常 +1）
    const back = await api.previewPricingRule({ ...orig, version: res.rule.version })
    await api.savePricingRule({ ...orig, version: res.rule.version }, '契约测试：还原', back)
    await api.cancelOrder(o.id, '契约测试')
  })

  describe('提议接口（x-status: proposed）：后端未实现时跳过并说明', () => {
    it('GET /dicts：所有登录角色可读的只读字典', async (ctx) => {
      const { api } = await asAdmin()
      const d = await api.getDicts().catch((e) => e)
      if (d instanceof ApiError && [404, 405, 501].includes(d.code)) return skipWith(ctx, 'GET /dicts 未实现（提议接口）；前端已退回 import/context / 内置字典')
      expect(d.regions.length).toBeGreaterThan(0)
      expect(d.skins.every((s: any) => s.name && s.category)).toBe(true)
    })
    it('POST /staff：新建号主用户并一对一绑定号主档案；冲突与校验', async (ctx) => {
      const { api } = await asAdmin()
      const [acc] = await createAccounts(api, 1, { status: 'draft' })
      const username = uniq('ct_owner_').toLowerCase()
      const created = await api.createUser({ username, displayName: '契约号主', role: 'owner', password: `Ct-${RUN}-pw`, ownerId: acc.ownerId }).catch((e) => e)
      if (created instanceof ApiError && created.errorCode === 'NOT_SUPPORTED') return skipWith(ctx, 'POST /staff 未实现（提议接口，待用户确认）；前端表单显示“后端暂未支持”')
      expect(created).toMatchObject({ username, role: 'owner', ownerId: acc.ownerId, enabled: true })
      expect((await api.ownerProfiles()).find((p) => p.id === acc.ownerId)?.userId).toBe(username)
      await expect(api.createUser({ username, displayName: 'x', role: 'cs', password: 'longenough' })).rejects.toMatchObject({ code: 409, errorCode: 'DUPLICATE' })
      await expect(api.createUser({ username: uniq('ct_o2_').toLowerCase(), displayName: 'x', role: 'owner', password: 'longenough', ownerId: acc.ownerId })).rejects.toMatchObject({ code: 409, errorCode: 'OWNER_ALREADY_BOUND' })
      await expect(api.createUser({ username: uniq('ct_o3_').toLowerCase(), displayName: 'x', role: 'owner', password: 'longenough' })).rejects.toMatchObject({ code: 422 })
      const me = await login(username, `Ct-${RUN}-pw`)
      expect(me.api.currentUser()?.ownerId).toBe(acc.ownerId)
      expect((await me.api.ownerAccounts()).some((x) => x.id === acc.id)).toBe(true)
    })
    it('POST /staff 后端未实现（404 / 501）→ ApiError NOT_SUPPORTED + “后端暂未支持”', async () => {
      const { api } = await asAdmin()
      for (const status of [404, 501]) {
        scripted = (r) => (r.method === 'POST' && r.path === '/staff' ? json(status, { error: { code: 'NOT_FOUND', message: 'Not Found' } }) : undefined)
        try { await expect(api.createUser({ username: 'abc', displayName: 'x', role: 'cs', password: 'longenough' })).rejects.toMatchObject({ errorCode: 'NOT_SUPPORTED', message: expect.stringContaining('后端暂未支持') }) }
        finally { scripted = undefined }
      }
    })
    it('POST /staff/{username}/password：重置密码并吊销旧令牌', async (ctx) => {
      const { api } = await asAdmin()
      const username = uniq('ct_pw_').toLowerCase()
      const made = await api.createUser({ username, displayName: '重置测试', role: 'cs', password: `Old-${RUN}-pw` }).catch((e) => e)
      if (made instanceof ApiError && made.errorCode === 'NOT_SUPPORTED') return skipWith(ctx, 'POST /staff 未实现，无法准备重置密码的用户')
      const victim = await login(username, `Old-${RUN}-pw`)
      const token = (api as any).tokens.get()
      const res = await vfetch(`${base}/staff/${encodeURIComponent(username)}/password`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: `New-${RUN}-pw` }) })
      if ([404, 405, 501].includes(res.status)) return skipWith(ctx, 'POST /staff/{username}/password 未实现（提议接口）')
      expect(res.status).toBe(204)
      await expect(victim.api.dashboard()).rejects.toMatchObject({ code: 401 })
      await login(username, `New-${RUN}-pw`)
    })
    it('GET /uploads/{id}：签名地址过期 → 403；重新签发后可用', async (ctx) => {
      const { api } = await asAdmin()
      if (fake) fake.setUrlTtl(1)
      let acc
      try { [acc] = await createAccounts(api, 1, { status: 'draft', attachments: [{ name: 'e.png', dataUrl: PNG }] }) } finally { fake?.setUrlTtl(3600e3) }
      const att = acc.attachments[0]
      if (fake) {
        await new Promise((ok) => setTimeout(ok, 5))
        expect((await fetch(new URL(att.dataUrl, base).toString())).status).toBe(403)
      }
      const fresh = await api.refreshAttachment(att.id).catch((e) => e)
      if (fresh instanceof ApiError && [404, 405, 501].includes(fresh.code)) return skipWith(ctx, 'GET /uploads/{id} 未实现（提议接口）；前端在地址失效时重新拉取所在资源')
      expect(fresh.id).toBe(att.id)
      expect(fresh.dataUrl).not.toBe(att.dataUrl)
      const img = await fetch(new URL(fresh.dataUrl, base).toString())
      expect(img.status).toBe(200)
      expect(img.headers.get('content-type')).toMatch(/^image\//)
      await expect(api.refreshAttachment('no-such-upload')).rejects.toMatchObject({ code: 404 })
    })
  })

  it('演示重置（仅 demo 环境；远端需 CONTRACT_ALLOW_RESET=1 才会真的调用）', async (ctx) => {
    const { api } = await asAdmin()
    if (mode === 'remote') {
      if (!api.features().demo) { await expect(api.resetDemo()).rejects.toMatchObject({ code: 404 }); return }
      if (process.env.CONTRACT_ALLOW_RESET !== '1') return skipWith(ctx, '远端是演示环境，/demo/reset 会清空数据；设 CONTRACT_ALLOW_RESET=1 才调用')
    }
    await api.resetDemo()
    provisioned.clear()
  })

  it('请求 / 响应全部符合契约；契约里每个操作都被客户端用到（x-client-unused、x-status: proposed 除外）', () => {
    expect(violations).toEqual([])
    const unused = ops.filter((o) => !o.op['x-client-unused'] && !isProposed(o) && !seen.has(o.operationId)).map((o) => o.operationId)
    if (mode === 'remote' && skipped.length && unused.length) { notes.push(`有用例被跳过，以下操作本次未覆盖：${unused.join(', ')}`); return }
    expect(unused).toEqual([])
  })
})

describe('错误映射（客户端脚本化响应，两种模式相同）', () => {
  const once = (match: (r: Req) => boolean, res: Response | ((r: Req) => Promise<Response>)) => {
    let used = false
    scripted = async (r) => { if (!used && match(r)) { used = true; return typeof res === 'function' ? res(r) : res } return undefined }
  }
  afterAll(() => { scripted = undefined })

  it('422 + fields → ApiError(code=422, errorCode, fields, message, requestId)', async () => {
    const { api } = await asAdmin()
    once((r) => r.path === '/accounts' && r.method === 'POST', json(422, { error: { code: 'VALIDATION_FAILED', message: '数据校验未通过', fields: [{ field: 'coinAmount', message: '纯币需大于 0' }] } }, { 'X-Request-Id': 'rq1' }))
    const e = await api.saveAccount({} as any).catch((x) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ code: 422, errorCode: 'VALIDATION_FAILED', message: '数据校验未通过', fields: [{ field: 'coinAmount', message: '纯币需大于 0' }], requestId: 'rq1' })
  })
  it('只有 fields 没有 message → 用字段错误拼成提示', async () => {
    const { api } = await asAdmin()
    once((r) => r.path === '/renters', json(422, { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'contact', message: '联系方式必填' }, { field: 'note', message: '备注过长' }] } }))
    await expect(api.saveRenter({ contact: '', displayName: '', tag: null, note: '' })).rejects.toMatchObject({ message: '联系方式必填；备注过长' })
  })
  it('409 业务冲突保留服务端 code 与 message', async () => {
    const { api } = await asAdmin()
    once((r) => r.path === '/orders' && r.method === 'POST', json(409, { error: { code: 'RENTER_BLACKLISTED', message: '该联系方式在黑名单中，禁止登记' } }))
    await expect(api.createOrder({} as any)).rejects.toMatchObject({ code: 409, errorCode: 'RENTER_BLACKLISTED', message: '该联系方式在黑名单中，禁止登记' })
  })
  it('会话中 401 → 清令牌、清当前用户、回调跳转登录', async () => {
    const { api, onUnauthorized } = await asAdmin()
    once((r) => r.path === '/dashboard', json(401, { error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录' } }))
    await expect(api.dashboard()).rejects.toMatchObject({ code: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(api.currentUser()).toBeNull()
    expect((api as any).tokens.get()).toBeNull()
  })
  it('登录失败（真实服务端）：401 INVALID_CREDENTIALS，不触发跳转，提示用服务端文案', async () => {
    const { api, onUnauthorized } = client()
    const e = await api.login(ADMIN.user, `wrong-${RUN}`).catch((x) => x)
    expect(e).toMatchObject({ code: 401, errorCode: 'INVALID_CREDENTIALS' })
    expect(e.message).toBeTruthy()
    if (mode === 'fake') expect(e.message).toBe('账号或密码错误')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('启动时令牌已失效（真实服务端）：静默清除、不跳转', async () => {
    const onUnauthorized = vi.fn()
    const api = new HttpApi({ baseUrl: base, tokenStore: memoryTokenStore(`stale-${RUN}`), onUnauthorized, fetch: vfetch })
    await api.init()
    expect(api.currentUser()).toBeNull()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('网关返回 HTML 502 → 通用提示 + HTTP_502', async () => {
    const { api } = await asAdmin()
    once((r) => r.path === '/dashboard', json(502, '<html>Bad Gateway</html>'))
    await expect(api.dashboard()).rejects.toMatchObject({ code: 502, errorCode: 'HTTP_502', message: '服务暂不可用' })
  })
  it('超时 → TIMEOUT；连不上 → NETWORK_ERROR', async () => {
    const { api } = await asAdmin({ timeoutMs: 50 })
    once((r) => r.path === '/dashboard', (r) => new Promise((_ok, fail) => r.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')))))
    await expect(api.dashboard()).rejects.toMatchObject({ code: 0, errorCode: 'TIMEOUT' })
    const dead = new HttpApi({ baseUrl: 'http://127.0.0.1:1/api', tokenStore: memoryTokenStore(), onUnauthorized: vi.fn() })
    await expect(dead.login('a', 'b')).rejects.toMatchObject({ code: 0, errorCode: 'NETWORK_ERROR' })
  })
  it('带 Bearer 令牌、JSON 请求头；路径参数做 URL 编码', async () => {
    const { api } = await asAdmin()
    let seenReq: Req | undefined
    scripted = (r) => { if (r.path.startsWith('/staff/')) { seenReq = r; return json(200, { username: 'a/b', displayName: 'x', role: 'cs', enabled: true }) } return undefined }
    try { await api.setUserEnabled('a/b', true) } finally { scripted = undefined }
    expect(seenReq?.headers.get('Authorization')).toMatch(/^Bearer \S{16,}$/)
    expect(seenReq?.headers.get('X-Requested-With')).toBe('XMLHttpRequest')
    expect(seenReq?.path).toBe('/staff/a%2Fb')
  })
})
