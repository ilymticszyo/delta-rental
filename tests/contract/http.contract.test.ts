// 契约测试：HttpApi（src/api/http.ts）经真实 HTTP 调用按 docs/openapi.yaml 实现的假后端。
// 校验：① 每个 Api 方法打到契约里声明的 方法 + 路径；② 请求体 / 查询参数符合契约；③ 响应符合契约 schema 且被正确映射；
// ④ 契约里每个操作都被客户端用到（x-client-unused 除外）；⑤ 错误 / 401 / 超时 / 网络错误的映射。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import SwaggerParser from '@apidevtools/swagger-parser'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { HttpApi, memoryTokenStore } from '../../src/api/http'
import { ApiError } from '../../src/api/errors'
import { depositBalance } from '../../src/api/local'
import { FORBIDDEN_OWNER_KEYS } from '../../src/domain/visibility'
import { templateAoa } from '../../src/domain/importAccounts'
import { createFakeBackend, startFakeServer, type FakeRequest, type FakeResponse } from './fakeBackend'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PW: Record<string, string> = { admin: 'admin123', owner1: 'owner123', cs: 'cs123', ops: 'ops123', demo: 'demo123' }

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
let ops: Op[] = []
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

// ---------- 假后端 + 校验钩子 ----------
const fake = createFakeBackend({ demo: true })
const violations: string[] = []
const seen = new Set<string>()
let scripted: ((r: FakeRequest) => FakeResponse | undefined | Promise<FakeResponse | undefined>) | undefined
let srv: Awaited<ReturnType<typeof startFakeServer>>
let base = ''

async function hook(r: FakeRequest): Promise<FakeResponse | undefined> {
  const s = await scripted?.(r)
  if (s) return s
  const op = ops.find((o) => o.method === r.method && o.re.test(r.path))
  if (!op) { violations.push(`契约未定义：${r.method} ${r.path}`); return undefined }
  seen.add(op.operationId)
  // 查询参数必须在契约里声明
  const declared = new Set((op.op.parameters ?? []).filter((p: any) => p.in === 'query').map((p: any) => p.name))
  for (const k of r.query.keys()) if (!declared.has(k)) violations.push(`${op.operationId}: 未声明的查询参数 ${k}`)
  for (const p of (op.op.parameters ?? []).filter((p: any) => p.in === 'query' && p.required)) if (!r.query.has(p.name)) violations.push(`${op.operationId}: 缺少必填查询参数 ${p.name}`)
  // 请求体
  const rb = op.op.requestBody?.content
  if (rb?.['application/json'] && r.body !== undefined) { const e = validate(`${op.operationId}.req`, rb['application/json'].schema, r.body); if (e) violations.push(`${op.operationId} 请求体：${e}`) }
  if (rb?.['application/json'] && op.op.requestBody.required && r.body === undefined) violations.push(`${op.operationId}: 缺少请求体`)
  if (rb?.['multipart/form-data'] && !r.form) violations.push(`${op.operationId}: 应为 multipart/form-data`)
  // 响应
  const res = await fake.handle(r)
  const spec = op.op.responses[String(res.status)]
  if (!spec) violations.push(`${op.operationId}: 契约未声明状态码 ${res.status}（${JSON.stringify(res.body).slice(0, 160)}）`)
  else {
    const schema = spec.content?.['application/json']?.schema
    if (schema) { const e = validate(`${op.operationId}.${res.status}`, schema, res.body); if (e) violations.push(`${op.operationId} 响应 ${res.status}：${e}`) }
    else if (res.status !== 204 && res.body !== undefined) violations.push(`${op.operationId}: 契约没有响应体但返回了内容`)
  }
  return res
}

const client = (o: Partial<ConstructorParameters<typeof HttpApi>[0]> = {}) => {
  const onUnauthorized = vi.fn()
  const api = new HttpApi({ baseUrl: base, tokenStore: memoryTokenStore(), onUnauthorized, ...o })
  return { api, onUnauthorized }
}
async function as(u: string, o: Partial<ConstructorParameters<typeof HttpApi>[0]> = {}) {
  const c = client(o); await c.api.init(); await c.api.login(u, PW[u]); return c
}
function forbiddenKeys(obj: unknown, found: string[] = []): string[] {
  if (Array.isArray(obj)) obj.forEach((x) => forbiddenKeys(x, found))
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (FORBIDDEN_OWNER_KEYS.includes(k) && v !== null && v !== undefined) found.push(k); forbiddenKeys(v, found) }
  return found
}

beforeAll(async () => {
  const doc: any = await SwaggerParser.dereference('docs/openapi.yaml')
  for (const [path, item] of Object.entries<any>(doc.paths))
    for (const [method, op] of Object.entries<any>(item)) {
      const re = new RegExp('^' + path.replace(/\{\w+\}/g, '[^/]+') + '$')
      ops.push({ method: method.toUpperCase(), path, operationId: op.operationId, op, re })
    }
  srv = await startFakeServer(fake, 0, hook)
  base = `http://127.0.0.1:${srv.port}/api`
})
afterAll(async () => { await srv?.close() })

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
    const a = ops.map((o) => `${o.method} ${o.path} ${o.operationId}`).sort()
    const b = fake.routes.map((r) => `${r.method} ${r.template} ${r.operationId}`).sort()
    expect(b).toEqual(a)
  })
})

describe('HttpApi ↔ 契约：每个方法的路径、方法、请求与响应', () => {
  it('启动：/meta 的演示开关；无令牌时不调 /auth/me', async () => {
    const { api } = client()
    await api.init()
    expect(api.features()).toMatchObject({ mode: 'http', demo: true, serverVersion: 'fake-0.1' })
    expect(api.demoAccounts().map((d) => d.username)).toContain('owner1')
    expect(api.currentUser()).toBeNull()
  })

  it('管理员全流程：库存 / 截图上传 / 导入 / 订单生命周期 / 台账 / 档案 / 回收 / 规则 / 报表 / 员工 / 日志', async () => {
    const { api } = await as('admin', { pageSize: 7 })
    // 会话恢复：新客户端用同一令牌 init → /auth/me
    const token = (api as any).tokens.get()
    const again = new HttpApi({ baseUrl: base, tokenStore: memoryTokenStore(token), onUnauthorized: vi.fn() })
    await again.init()
    expect(again.currentUser()?.username).toBe('admin')

    // 前台
    const lobby = await api.listListedAccounts()
    expect(lobby.length).toBe((await fake.api.login('admin', 'admin123'), (await fake.api.listListedAccounts()).length))
    expect(lobby[0].quote?.ownerSettlement).toBeTypeOf('number') // 员工看到完整报价
    expect((await api.getAccount(lobby[0].id))?.accountNo).toBe(lobby[0].accountNo)
    expect(await api.getAccount('no-such-id')).toBeUndefined()
    const opts = await api.pricingOptions()
    expect(opts.channels.length).toBeGreaterThan(0)
    const q = await api.calcPricing({ coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: opts.channels[0], discountMode: 'system', cycle: opts.cycles[0], deposit: 0 })
    expect(q.totalAmount).toBeGreaterThan(0)
    const asset = { contact: 'wx_c', region: 'QQ区', loginMethod: '扫码', coinAmount: 200, totalAssets: 260, level: 40, rank: '钻石', safeBox: 6, skins: [], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 }
    expect((await api.calcValuation(asset)).center).toBeGreaterThan(0)
    expect((await api.listCsAgents()).length).toBeGreaterThan(0)
    await api.currentCsAgent()

    // 分页拉全量（pageSize=7 → 多页）
    const accs = await api.listAccounts()
    expect(accs.length).toBe(20)
    expect(new Set(accs.map((a) => a.id)).size).toBe(20)

    // 新增账号 + 新截图：先 POST /uploads 再带 attachmentIds；返回 url 映射为 dataUrl
    const base0 = accs.find((a) => a.status === 'listed')!
    const { id: _i, accountNo: _n, quote: _q, createdAt: _c, updatedAt: _u, cumulativeIncome: _ci, paybackPercent: _p, ownerName: _o, attachments: _a, deleted: _d, ...fields } = base0 as any
    const created = await api.saveAccount({ ...fields, status: 'draft', attachments: [{ name: 'a.png', dataUrl: PNG }] })
    expect(created.attachments).toHaveLength(1)
    expect(created.attachments[0].dataUrl).toMatch(/^\/api\/uploads\/.+\/content$/)
    const edited = await api.saveAccount({ ...fields, id: created.id, status: 'draft', remark: '改', attachments: [...created.attachments, { name: 'b.png', dataUrl: PNG }] })
    expect(edited.attachments.map((x) => x.id)[0]).toBe(created.attachments[0].id)
    expect(edited.attachments).toHaveLength(2)
    expect((await api.setAccountStatus(created.id, 'listed')).status).toBe('listed')
    await api.setAccountStatus(created.id, 'off')
    await api.deleteAccount(created.id)

    // 导入
    const ctx = await api.importContext()
    expect(ctx.existingNos.length).toBeGreaterThan(20)
    const [h, ex] = templateAoa()
    const bad = ex.slice(); bad[0] = 'CT002'; bad[4] = '火星区'
    const out = await api.importAccounts([h, ['CT001', ...ex.slice(1)], bad], 'c.xlsx')
    expect(out).toMatchObject({ imported: ['CT001'], operator: 'admin' })
    expect(out.skipped[0].rowNo).toBe(3)

    // 订单生命周期
    const listed = (await api.listAccounts()).filter((a) => a.status === 'listed' && a.source === 'consign')
    const pv = await api.previewOrder(listed[0].id, 'wx_vip_laoliu')
    expect(pv).toMatchObject({ blocked: false, regularApplied: true })
    const o = await api.createOrder({ accountId: listed[0].id, renterContact: 'wx_ct', startAt: new Date().toISOString(), rentalDays: 2, deposit: 100, extraFee: 0, remark: '' })
    expect(o.status).toBe('active')
    await api.markHandover(o.id, '已交号')
    await api.extendOrder(o.id, 3, '续一天')
    await api.addDepositEntry(o.id, { type: 'collect', amount: 50, reason: '补收押金' })
    await api.endOrder(o.id)
    await api.markReturned(o.id)
    await api.addDepositEntry(o.id, { type: 'deduct', amount: 30, reason: 'AWM 消耗' })
    const bal = depositBalance((await api.listOrders()).find((x) => x.id === o.id)!)
    await api.addDepositEntry(o.id, { type: 'refund', amount: bal, reason: '退余额' })
    const paid = await api.payOwner(o.id, o.ownerPayable, '微信转账')
    expect(paid.events.map((e) => e.step)).toEqual(expect.arrayContaining(['register', 'handover', 'extend', 'collect', 'expire', 'return', 'deduct', 'refund', 'payOwner']))
    expect((await api.completeOrder(o.id, true)).status).toBe('done')
    const o2 = await api.createOrder({ accountId: listed[1].id, renterContact: 'wx_ct2', startAt: new Date().toISOString(), rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
    expect((await api.cancelOrder(o2.id, '客户取消')).status).toBe('cancelled')
    const orders = await api.listOrders()
    expect(orders.find((x) => x.id === o.id)?.ownerPayableBalance).toBe(0)
    const pay = await api.listPayables(listed[0].ownerId)
    expect(pay.some((x) => x.type === 'pay' && x.orderId === o.id)).toBe(true)
    // 黑名单：业务错误映射为 ApiError
    await expect(api.createOrder({ accountId: listed[2].id, renterContact: 'wx_black_ahu', startAt: new Date().toISOString(), rentalDays: 1, deposit: 0, extraFee: 0, remark: '' }))
      .rejects.toMatchObject({ name: 'ApiError', message: expect.stringContaining('黑名单') })

    // 档案
    expect((await api.renterProfiles()).length).toBeGreaterThan(2)
    expect((await api.lookupRenter('wx_vip_laoliu'))?.tag).toBe('regular')
    expect(await api.lookupRenter('wx_nobody')).toBeNull()
    expect((await api.saveRenter({ contact: 'wx_ct_bad', displayName: '', tag: 'blacklist', note: '' })).tag).toBe('blacklist')
    expect((await api.ownerProfiles()).length).toBe(6) // 5 个种子号主 + 导入时按联系方式新建的 1 个

    // 回收
    const rr = await api.submitRecycle(asset)
    expect((await api.myRecycles()).some((x) => x.id === rr.id)).toBe(true)
    await api.updateRecycle(rr.id, 'following', '跟进')
    await api.updateRecycle(rr.id, 'quoted', '报价', 300)
    expect((await api.recycleToInventory(rr.id)).source).toBe('buyin')
    expect((await api.listRecycles()).find((x) => x.id === rr.id)?.status).toBe('deal')

    // 规则（版本化）
    const pr = await api.getPricingRule()
    expect((await api.savePricingRule(pr, '契约测试')).version).toBe(pr.version + 1)
    const vr = await api.getValuationRule()
    expect((await api.saveValuationRule({ ...vr, marketCoefficient: 1.05 }, '契约测试')).version).toBe(vr.version + 1)
    const hist = await api.ruleHistory()
    expect(hist.pricing[0].summary).toBe('契约测试')
    await api.trialPricing({ coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: opts.channels[0], discountMode: 'system', cycle: opts.cycles[0], deposit: 0 }, pr)
    expect((await api.trialValuation(asset, { ...vr, marketCoefficient: 2 })).marketCoefficient).toBe(2)

    // 报表 / 看板 / 员工 / 日志 / 号主门户（管理员看全部）
    const rep = await api.report(Date.now() - 30 * 864e5, Date.now(), 'rank')
    expect(rep.groups.length).toBeGreaterThan(0)
    expect((await api.dashboard()).listed).toBeGreaterThan(0)
    expect((await api.listUsers()).length).toBe(6)
    expect((await api.setUserEnabled('demo', false)).enabled).toBe(false)
    await api.setUserEnabled('demo', true)
    const logs = await api.auditLogs()
    expect(logs.some((l) => l.action === '批量导入')).toBe(true)
    const all = await api.ownerAccounts()
    expect(all.some((x) => x.ownerName)).toBe(true)
    await api.ownerAccount(all[0].id)

    await api.logout()
    expect(api.currentUser()).toBeNull()
  })

  it('号主：只能拿到白名单字段（大厅无报价、算价只有到手、门户不含租客 / 租金 / 抽成），上架带截图', async () => {
    const { api } = await as('owner1')
    const raw: unknown[] = []
    const lobby = await api.listListedAccounts(); raw.push(lobby)
    expect(lobby.every((a) => a.quote === null && a.ownerContact === undefined && a.costAmount === undefined)).toBe(true)
    const opts = await api.pricingOptions()
    const q = await api.calcPricing({ coinAmount: 300, totalAssets: 400, coinRatio: 20, channel: opts.channels[0], discountMode: 'system', cycle: opts.cycles[0], deposit: 0 })
    expect(Object.keys(q).sort()).toEqual(['ownerSettlement', 'ruleVersion'])
    const mine = await api.ownerAccounts(); raw.push(mine)
    const idle = mine.find((m) => m.ownerStatus === '空闲')!
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

  it('客服：导入接口在服务端被拒（403）；成员：大厅报价不含号主可得与服务费', async () => {
    const { api } = await as('cs')
    await expect(api.importAccounts(templateAoa(), 'x.xlsx')).rejects.toMatchObject({ code: 403 })
    await expect(api.importContext()).rejects.toMatchObject({ code: 403 })
    const m = await as('demo')
    const lobby = await m.api.listListedAccounts()
    expect(lobby.every((a) => a.quote && a.quote.ownerSettlement === undefined && a.quote.serviceFee === undefined)).toBe(true)
  })

  it('演示重置（仅 demo 环境）', async () => {
    const { api } = await as('admin')
    await api.resetDemo()
  })

  it('请求 / 响应全部符合契约；契约里每个操作都被客户端用到（x-client-unused 除外）', () => {
    expect(violations).toEqual([])
    const unused = ops.filter((o) => !o.op['x-client-unused'] && !seen.has(o.operationId)).map((o) => o.operationId)
    expect(unused).toEqual([])
  })
})

describe('错误映射', () => {
  const once = (match: (r: FakeRequest) => boolean, res: FakeResponse | (() => Promise<FakeResponse>)) => {
    let used = false
    scripted = async (r) => { if (!used && match(r)) { used = true; return typeof res === 'function' ? res() : res } return undefined }
  }
  afterAll(() => { scripted = undefined })

  it('422 + fields → ApiError(code=422, errorCode, fields, message, requestId)', async () => {
    const { api } = await as('ops')
    once((r) => r.path === '/accounts' && r.method === 'POST', { status: 422, headers: { 'X-Request-Id': 'rq1' }, body: { error: { code: 'VALIDATION_FAILED', message: '数据校验未通过', fields: [{ field: 'coinAmount', message: '纯币需大于 0' }] } } })
    const e = await api.saveAccount({} as any).catch((x) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ code: 422, errorCode: 'VALIDATION_FAILED', message: '数据校验未通过', fields: [{ field: 'coinAmount', message: '纯币需大于 0' }], requestId: 'rq1' })
  })
  it('只有 fields 没有 message → 用字段错误拼成提示', async () => {
    const { api } = await as('ops')
    once((r) => r.path === '/renters', { status: 422, body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'contact', message: '联系方式必填' }, { field: 'note', message: '备注过长' }] } } })
    await expect(api.saveRenter({ contact: '', displayName: '', tag: null, note: '' })).rejects.toMatchObject({ message: '联系方式必填；备注过长' })
  })
  it('409 业务冲突保留服务端 code 与 message', async () => {
    const { api } = await as('cs')
    once((r) => r.path === '/orders' && r.method === 'POST', { status: 409, body: { error: { code: 'RENTER_BLACKLISTED', message: '该联系方式在黑名单中，禁止登记' } } })
    await expect(api.createOrder({} as any)).rejects.toMatchObject({ code: 409, errorCode: 'RENTER_BLACKLISTED', message: '该联系方式在黑名单中，禁止登记' })
  })
  it('会话中 401 → 清令牌、清当前用户、回调跳转登录', async () => {
    const { api, onUnauthorized } = await as('cs')
    once((r) => r.path === '/dashboard', { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录' } } })
    await expect(api.dashboard()).rejects.toMatchObject({ code: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(api.currentUser()).toBeNull()
    expect((api as any).tokens.get()).toBeNull()
  })
  it('登录失败的 401 不触发跳转，提示用服务端文案', async () => {
    const { api, onUnauthorized } = client()
    await expect(api.login('admin', 'wrong')).rejects.toMatchObject({ code: 401, errorCode: 'INVALID_CREDENTIALS', message: '账号或密码错误' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('启动时令牌已失效：静默清除、不跳转', async () => {
    const onUnauthorized = vi.fn()
    const api = new HttpApi({ baseUrl: base, tokenStore: memoryTokenStore('stale-token'), onUnauthorized })
    await api.init()
    expect(api.currentUser()).toBeNull()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('网关返回 HTML 500 → 通用提示 + HTTP_500', async () => {
    const { api } = await as('cs')
    once((r) => r.path === '/dashboard', { status: 502, body: '<html>Bad Gateway</html>' })
    await expect(api.dashboard()).rejects.toMatchObject({ code: 502, errorCode: 'HTTP_502', message: '服务暂不可用' })
  })
  it('超时 → TIMEOUT；连不上 → NETWORK_ERROR', async () => {
    const { api } = await as('cs', { timeoutMs: 50 })
    once((r) => r.path === '/dashboard', () => new Promise((ok) => setTimeout(() => ok({ status: 200, body: {} }), 300)))
    await expect(api.dashboard()).rejects.toMatchObject({ code: 0, errorCode: 'TIMEOUT' })
    const dead = new HttpApi({ baseUrl: 'http://127.0.0.1:1/api', tokenStore: memoryTokenStore(), onUnauthorized: vi.fn() })
    await expect(dead.login('a', 'b')).rejects.toMatchObject({ code: 0, errorCode: 'NETWORK_ERROR' })
  })
  it('带 Bearer 令牌、JSON 请求头；路径参数做 URL 编码', async () => {
    const { api } = await as('admin')
    let seenReq: FakeRequest | undefined
    scripted = (r) => { if (r.path.startsWith('/staff/')) { seenReq = r; return { status: 200, body: { username: 'a/b', displayName: 'x', role: 'cs', enabled: true } } } return undefined }
    await api.setUserEnabled('a/b', true)
    scripted = undefined
    expect(seenReq?.token).toMatch(/^[0-9a-f]{48}$/)
    expect(seenReq?.path).toBe('/staff/a%2Fb')
  })
})
