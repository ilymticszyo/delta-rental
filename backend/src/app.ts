import crypto from 'crypto'
import fs from 'fs'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer, { MulterError } from 'multer'
import bcrypt from 'bcryptjs'
import { config } from './config'
import type { ReportDimension } from './domain/reports'
import { demoUsers } from './domain/seedData'
import type { PricingRule, ValuationRule } from './domain/rules'
import type { Account, AccountInput, AccountStatus, Attachment, OrderInput, PricingInput, RecycleStatus, RenterTag, Role, User, ValuationInput } from './domain/types'
import { Engine, toPublicUser } from './engine'
import { ApiError, type FieldError } from './errors'
import { prisma, readDb, writeDb } from './persistence'
import { seed } from './seed'
import { openapiYamlPath } from './openapi'
import { DiskAttachmentStore, safeUploadPath, writeImageBuffer } from './uploads'

const engine = new Engine()
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '5mb' }))

const imgUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } })
const SLIDE = config.sessionSlideMs
const ABSOLUTE = config.sessionAbsoluteMs
const IDEM_TTL = 24 * 3600000

function sha256(s: string) { return crypto.createHash('sha256').update(s).digest('hex') }
function requestId() { return crypto.randomBytes(4).toString('hex') }
function signedUpload(id: string, ttlMs = 3600_000) {
  const expMs = Date.now() + ttlMs
  const exp = String(expMs)
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${id}.${exp}`).digest('hex')
  return { url: `/api/uploads/${id}/content?exp=${exp}&sig=${sig}`, expiresAt: new Date(expMs).toISOString() }
}
function verifyUpload(id: string, expRaw: unknown, sigRaw: unknown) {
  const exp = Number(expRaw)
  const sig = String(sigRaw ?? '')
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const expect = crypto.createHmac('sha256', config.jwtSecret).update(`${id}.${exp}`).digest('hex')
  const a = Buffer.from(expect)
  const b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
const IDEM_KEY = /^[A-Za-z0-9_-]{8,128}$/

app.use((req, res, next) => {
  const id = requestId()
  res.setHeader('X-Request-Id', id)
  const orig = res.json.bind(res)
  res.json = (body: unknown) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return orig(body)
  }
  next()
})

function sendError(res: Response, status: number, code: string, message: string, fields?: FieldError[]) {
  const requestIdHeader = String(res.getHeader('X-Request-Id') ?? '')
  res.status(status).json({ error: { code, message, ...(fields?.length ? { fields } : {}), ...(requestIdHeader ? { requestId: requestIdHeader } : {}) } })
}
function mapError(e: ApiError, login: boolean) {
  if (login && e.code === 401) return { status: 401, code: 'INVALID_CREDENTIALS', message: e.message || '账号或密码错误' }
  if (login && e.code === 403) return { status: 403, code: 'USER_DISABLED', message: e.message || '该账号已停用' }
  if (e.errorCode) return { status: e.code, code: e.errorCode, message: e.message, fields: e.fields }
  if (e.code === 401) return { status: 401, code: 'UNAUTHENTICATED', message: e.message || '登录已失效，请重新登录' }
  if (e.code === 403) return { status: 403, code: 'FORBIDDEN', message: e.message }
  if (e.code === 404) return { status: 404, code: 'NOT_FOUND', message: e.message }
  if (e.code === 413) return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: e.message }
  if (e.code === 415) return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: e.message }
  if (e.code === 429) return { status: 429, code: 'RATE_LIMITED', message: e.message }
  if (e.message.includes('黑名单')) return { status: 409, code: 'RENTER_BLACKLISTED', message: e.message }
  if (e.message.includes('不能登记订单')) return { status: 409, code: 'ACCOUNT_NOT_AVAILABLE', message: e.message }
  if (e.message.includes('未结清') || e.message.includes('余额不为 0')) return { status: 409, code: 'BALANCE_NOT_SETTLED', message: e.message }
  if (e.message.includes('最后一个管理员') || e.message.includes('不能停用自己')) return { status: 409, code: 'LAST_ADMIN', message: e.message }
  if (e.message.includes('不能从') || e.message.includes('不能登记') || e.message.includes('只有') || e.message.includes('成交入库') || e.message.includes('已关闭') || e.message.includes('已取消'))
    return { status: 409, code: 'INVALID_TRANSITION', message: e.message }
  if (e.code === 409) return { status: 409, code: 'DUPLICATE', message: e.message }
  return { status: e.code >= 400 && e.code < 500 ? e.code : 422, code: 'VALIDATION_FAILED', message: e.message, fields: e.fields }
}

const fails = new Map<string, { n: number; t: number }>()
function hitFail(key: string) {
  const now = Date.now()
  const b = fails.get(key)
  if (!b || now - b.t > 10 * 60 * 1000) { fails.set(key, { n: 1, t: now }); return 1 }
  b.n += 1
  return b.n
}
function tooMany(key: string) {
  const b = fails.get(key)
  return !!b && Date.now() - b.t <= 10 * 60 * 1000 && b.n >= 10
}

function bearer(req: Request) {
  const h = req.headers.authorization
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null
}
function isPublic(req: Request) {
  if (req.method === 'GET' && req.path === '/api/meta') return true
  if (req.method === 'POST' && req.path === '/api/auth/login') return true
  if (req.method === 'GET' && /^\/api\/uploads\/[a-f0-9]{32}\/content$/.test(req.path)) return true
  return false
}

app.use(async (req, res, next) => {
  try {
    if (isPublic(req)) return next()
    const token = bearer(req)
    if (!token) { req.user = null; return next() }
    const tokenHash = sha256(token)
    const session = await prisma.session.findUnique({ where: { tokenHash } })
    const now = new Date()
    if (!session || session.expiresAt < now || session.absoluteExpiresAt < now) {
      if (session) await prisma.session.delete({ where: { tokenHash } }).catch(() => undefined)
      return sendError(res, 401, 'UNAUTHENTICATED', '登录已失效，请重新登录')
    }
    const row = await prisma.user.findUnique({ where: { username: session.username } })
    if (!row || !row.enabled) {
      await prisma.session.deleteMany({ where: { username: session.username } })
      return sendError(res, 401, 'UNAUTHENTICATED', '登录已失效，请重新登录')
    }
    const slide = new Date(Math.min(now.getTime() + SLIDE, session.absoluteExpiresAt.getTime()))
    // 1 分钟内不写库，避免每个请求都续期。快到期时才把 expiresAt 往后推。
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000 || session.expiresAt.getTime() - now.getTime() < 3600_000) {
      await prisma.session.update({ where: { tokenHash }, data: { lastSeenAt: now, expiresAt: slide } })
    }
    req.user = toPublicUser({ username: row.username, displayName: row.displayName, role: row.role as Role, ownerId: row.ownerId ?? undefined })
    next()
  } catch (e) { next(e) }
})

const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next) }
const actor = (req: Request) => req.user ?? null
function requireRoles(req: Request, roles: Role[]) {
  const u = actor(req)
  if (!u) throw new ApiError('未登录', 401, false, 'UNAUTHENTICATED')
  if (!roles.includes(u.role)) throw new ApiError('无权限（403）', 403, false, 'FORBIDDEN')
  return u
}
function qstr(v: unknown) { return typeof v === 'string' ? v : '' }
function assertDateTime(v: unknown, field: string) {
  if (typeof v !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(v) || Number.isNaN(Date.parse(v)))
    throw new ApiError('时间必须带时区', 422, false, 'VALIDATION_FAILED', [{ field, message: '时间必须是带时区的 ISO 8601' }])
  return v
}
function assertMoney(v: unknown, field: string) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    throw new ApiError('金额须为非负整数元', 422, false, 'VALIDATION_FAILED', [{ field, message: '金额须为非负整数（元）' }])
}
function pageOf<T>(items: T[], query: Request['query']) {
  const page = query.page == null || query.page === '' ? 1 : Number(query.page)
  let pageSize = query.pageSize == null || query.pageSize === '' ? 50 : Number(query.pageSize)
  if (!Number.isInteger(page) || page < 1) throw new ApiError('page 无效', 422, false, 'VALIDATION_FAILED', [{ field: 'page', message: 'page 从 1 开始' }])
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new ApiError('pageSize 无效', 422, false, 'VALIDATION_FAILED', [{ field: 'pageSize', message: 'pageSize 至少为 1' }])
  if (pageSize > 200) pageSize = 200
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize }
}
function sorted<T>(items: T[], sort: unknown, allowed: string[], fallback: string, alias: Record<string, string> = {}) {
  const spec = String(sort || fallback).split(',').map((s) => s.trim()).filter(Boolean)
  for (const s of spec) {
    const field = (s.startsWith('-') ? s.slice(1) : s)
    const name = alias[field] ?? field
    if (!allowed.includes(field) && !allowed.includes(name))
      throw new ApiError(`未知排序字段 ${field}`, 422, false, 'VALIDATION_FAILED', [{ field: 'sort', message: `未知排序字段 ${field}` }])
  }
  const value = (row: T, field: string) => (row as Record<string, unknown>)[field] ?? ''
  return [...items].sort((a, b) => {
    for (const s of spec) {
      const desc = s.startsWith('-')
      const raw = s.startsWith('-') ? s.slice(1) : s
      const field = alias[raw] ?? raw
      const av = value(a, field)
      const bv = value(b, field)
      if (av < bv) return desc ? 1 : -1
      if (av > bv) return desc ? -1 : 1
    }
    return 0
  })
}
function present(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(present)
  if (!v || typeof v !== 'object') return v
  const o: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'deleted' || k === 'password') continue
    if (k === 'attachments' && Array.isArray(x)) {
      o.attachments = x.map((a) => {
        const att = a as Attachment & { mime?: string; size?: number }
        const signed = signedUpload(att.id)
        const out: Record<string, unknown> = { id: att.id, name: att.name, url: signed.url, expiresAt: signed.expiresAt, uploadedBy: att.uploadedBy, at: att.at }
        if (att.mime) out.mime = att.mime
        if (att.size) out.size = att.size
        return out
      })
    } else o[k] = present(x)
  }
  return o
}

async function issueToken(username: string) {
  const token = crypto.randomBytes(24).toString('hex')
  const now = new Date()
  await prisma.session.create({
    data: { tokenHash: sha256(token), username, createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + SLIDE), absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE) },
  })
  return { token, expiresAt: new Date(now.getTime() + SLIDE).toISOString() }
}
async function revokeUser(username: string) { await prisma.session.deleteMany({ where: { username } }) }

async function idemLookup(req: Request, route: string) {
  const key = req.get('Idempotency-Key')
  if (!key) return null
  if (!IDEM_KEY.test(key)) throw new ApiError('Idempotency-Key 须为 8–128 位字母、数字、下划线或连字符', 422, false, 'VALIDATION_FAILED', [{ field: 'Idempotency-Key', message: '格式无效' }])
  const username = actor(req)!.username
  const id = sha256(`${username}\n${route}\n${key}`)
  const bodyHash = sha256(JSON.stringify(req.body ?? null))
  const row = await prisma.idempotencyRecord.findUnique({ where: { id } })
  if (!row) return { id, bodyHash, replay: null as null }
  if (Date.now() - row.createdAt.getTime() > IDEM_TTL) {
    await prisma.idempotencyRecord.delete({ where: { id } })
    return { id, bodyHash, replay: null }
  }
  if (row.bodyHash !== bodyHash) throw new ApiError('Idempotency-Key 已用于不同的请求体', 409, false, 'DUPLICATE')
  return { id, bodyHash, replay: row }
}
async function idemSave(id: string, username: string, route: string, bodyHash: string, statusCode: number, body: unknown) {
  await prisma.idempotencyRecord.create({ data: { id, username, route, bodyHash, statusCode, body: body as object, createdAt: new Date() } })
}

async function bindAttachments(ids: string[] | undefined, user: string, account?: Account): Promise<Attachment[] | undefined> {
  if (ids == null) return undefined
  if (ids.length > 5) throw new ApiError('最多 5 张截图', 422, false, 'VALIDATION_FAILED', [{ field: 'attachmentIds', message: '最多 5 张截图' }])
  const owned = new Set((account?.attachments ?? []).map((a) => a.id))
  const out: Attachment[] = []
  for (const [i, id] of ids.entries()) {
    const row = await prisma.upload.findUnique({ where: { id } })
    if (!row) throw new ApiError('截图不存在', 422, false, 'VALIDATION_FAILED', [{ field: `attachmentIds[${i}]`, message: '截图不存在' }])
    const onThis = owned.has(id)
    if (!onThis && (row.uploadedBy !== user || row.accountId))
      throw new ApiError('只能绑定自己上传且未使用的截图', 422, false, 'VALIDATION_FAILED', [{ field: `attachmentIds[${i}]`, message: '只能绑定自己上传且未使用的截图' }])
    out.push({ id: row.id, name: row.name, dataUrl: `/api/uploads/${row.id}`, uploadedBy: row.uploadedBy, at: row.createdAt.toISOString() })
  }
  return out
}
async function markBound(accountId: string, ids: string[], previous: string[] = []) {
  const next = new Set(ids)
  for (const id of previous) if (!next.has(id)) await prisma.upload.update({ where: { id }, data: { accountId: null } }).catch(() => undefined)
  for (const id of ids) await prisma.upload.update({ where: { id }, data: { accountId } }).catch(() => undefined)
}

app.get('/api/openapi.yaml', (_req, res) => {
  const file = openapiYamlPath()
  if (!file) return sendError(res, 404, 'NOT_FOUND', '未找到 openapi.yaml')
  res.type('yaml').send(fs.readFileSync(file, 'utf8'))
})

app.get('/api/meta', wrap(async (_req, res) => {
  const demo = config.enableDemoAccounts
  res.json({
    version: '1.0.0',
    demo,
    serverTime: new Date().toISOString(),
    ...(demo ? { demoAccounts: demoUsers.map((u) => u.username === 'admin'
      ? { username: config.adminUsername, password: config.adminPassword, role: u.role, displayName: u.displayName }
      : { username: u.username, password: u.password, role: u.role, displayName: u.displayName }) } : {}),
  })
}))

app.post('/api/auth/login', wrap(async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const ip = req.ip || 'unknown'
  if (tooMany(`ip:${ip}`) || tooMany(`user:${username}`)) throw new ApiError('登录尝试过于频繁，请稍后再试', 429, false, 'RATE_LIMITED')
  const row = await prisma.user.findUnique({ where: { username } })
  const dbUser = row ? { username: row.username, password: row.passwordHash, displayName: row.displayName, role: row.role as Role, enabled: row.enabled, ...(row.ownerId ? { ownerId: row.ownerId } : {}) } : null
  let user: User
  try {
    user = await engine.login(dbUser, String(req.body?.password ?? ''), async (hash, plain) => { try { return await bcrypt.compare(plain, hash) } catch { return false } })
  } catch (e) {
    hitFail(`ip:${ip}`); hitFail(`user:${username}`)
    throw e
  }
  fails.delete(`ip:${ip}`); fails.delete(`user:${username}`)
  const issued = await issueToken(user.username)
  res.json({ token: issued.token, expiresAt: issued.expiresAt, user })
}))

app.post('/api/auth/logout', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  await revokeUser(u.username)
  res.status(204).end()
}))
app.get('/api/auth/me', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  res.json({ user: u })
}))

app.get('/api/lobby/accounts', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  let items = await readDb((db) => engine.listListedAccounts(db, u))
  const region = qstr(req.query.region), channel = qstr(req.query.channel), rank = qstr(req.query.rank)
  const safeBox = req.query.safeBox == null || req.query.safeBox === '' ? undefined : Number(req.query.safeBox)
  const minCoin = req.query.minCoin == null || req.query.minCoin === '' ? undefined : Number(req.query.minCoin)
  const maxCoin = req.query.maxCoin == null || req.query.maxCoin === '' ? undefined : Number(req.query.maxCoin)
  const maxTotal = req.query.maxTotal == null || req.query.maxTotal === '' ? undefined : Number(req.query.maxTotal)
  const q = qstr(req.query.q).toLowerCase()
  items = items.filter((a) => {
    if (region && a.region !== region) return false
    if (channel && a.channel !== channel) return false
    if (rank && a.rank !== rank) return false
    if (safeBox != null && a.safeBox !== safeBox) return false
    if (minCoin != null && Number(a.coinAmount) < minCoin) return false
    if (maxCoin != null && Number(a.coinAmount) > maxCoin) return false
    if (u.role !== 'owner' && maxTotal != null) {
      const total = (a.quote as { totalAmount?: number } | null)?.totalAmount
      if (total == null || total > maxTotal) return false
    }
    if (q) {
      const blob = `${a.accountNo} ${a.region} ${a.rank} ${a.channel} ${a.remark ?? ''} ${(a.skins as string[]).join(' ')}`.toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })
  items = sorted(items, req.query.sort, ['createdAt', 'accountNo', 'coinAmount', 'totalAssets', 'safeBox', 'rank', 'level', 'updatedAt'], '-createdAt')
  res.json(present(pageOf(items, req.query)))
}))
app.get('/api/lobby/accounts/:id', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  const row = await readDb((db) => engine.getAccount(db, u, req.params.id))
  if (!row) throw new ApiError('账号不存在', 404, false, 'NOT_FOUND')
  res.json(present(row))
}))
app.get('/api/pricing/options', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  res.json(await readDb((db) => engine.pricingOptions(db, u)))
}))
app.post('/api/pricing/quote', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  if (req.body?.deposit != null) assertMoney(req.body.deposit, 'deposit')
  const input = { ...req.body } as PricingInput
  delete (input as { renterRegular?: boolean }).renterRegular
  res.json(await readDb((db) => engine.calcPricing(db, u, input)))
}))
app.post('/api/valuation/quote', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  res.json(await readDb((db) => engine.calcValuation(db, u, req.body as ValuationInput)))
}))
app.get('/api/dicts', wrap(async (req, res) => {
  requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  const { dicts } = await import('./domain/rules')
  res.json({
    regions: dicts.regions, loginMethods: dicts.loginMethods, ranks: dicts.ranks, safeBoxes: dicts.safeBoxes,
    stamina: dicts.stamina, loads: dicts.loads, skins: dicts.skins,
  })
}))
app.get('/api/cs-agents', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  res.json(await readDb((db) => engine.listCsAgents(db, u)))
}))
app.get('/api/cs-agents/current', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  res.json({ agent: await readDb((db) => engine.currentCsAgent(db, u)) })
}))

app.post('/api/recycles', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  const asset = req.body?.asset as ValuationInput
  if (!asset) throw new ApiError('缺少资产', 422, false, 'VALIDATION_FAILED', [{ field: 'asset', message: '请填写资产' }])
  const created = await writeDb((db) => engine.submitRecycle(db, u, asset, { sourceAccountId: req.body?.sourceAccountId }))
  res.status(201).json(present(created))
}))
app.get('/api/recycles/mine', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'member', 'cs', 'ops', 'admin'])
  const items = sorted(await readDb((db) => engine.myRecycles(db, u)), req.query.sort, ['createdAt', 'requestNo', 'status'], '-createdAt')
  res.json(present(pageOf(items, req.query)))
}))
app.get('/api/recycles', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  let items = await readDb((db) => engine.listRecycles(db, u))
  if (qstr(req.query.status)) items = items.filter((r) => r.status === req.query.status)
  const q = qstr(req.query.q).toLowerCase()
  if (q) items = items.filter((r) => `${r.requestNo} ${r.contact} ${r.submitter}`.toLowerCase().includes(q))
  items = sorted(items, req.query.sort, ['createdAt', 'requestNo', 'status'], '-createdAt')
  res.json(present(pageOf(items, req.query)))
}))
app.post('/api/recycles/:id/transitions', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  if (req.body?.staffPrice != null) assertMoney(req.body.staffPrice, 'staffPrice')
  const row = await writeDb((db) => engine.updateRecycle(db, u, req.params.id, req.body?.toStatus as RecycleStatus, String(req.body?.note ?? ''), req.body?.staffPrice == null ? undefined : Number(req.body.staffPrice)))
  res.json(present(row))
}))
app.post('/api/recycles/:id/to-inventory', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(present(await writeDb((db) => engine.recycleToInventory(db, u, req.params.id))))
}))

app.get('/api/owner/accounts', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'admin'])
  const items = sorted(await readDb((db) => engine.ownerAccounts(db, u)), req.query.sort, ['createdAt', 'accountNo', 'ownerStatus'], '-createdAt')
  res.json(present(pageOf(items, req.query)))
}))
app.get('/api/owner/accounts/:id/recycle-draft', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner'])
  res.json(await readDb((db) => engine.ownerRecycleDraft(db, u, req.params.id)))
}))
app.get('/api/owner/accounts/:id', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'admin'])
  res.json(present(await readDb((db) => engine.ownerAccount(db, u, req.params.id))))
}))
app.post('/api/owner/estimate', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner'])
  res.json(await readDb((db) => engine.ownerEstimate(db, u, req.body as ValuationInput)))
}))
app.post('/api/owner/listings', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner'])
  const ids: string[] = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : []
  const attachments = (await bindAttachments(ids, u.username)) ?? []
  const created = await writeDb((db, files) => engine.ownerSubmitListing(db, u, {
    asset: req.body?.asset, assistTime: String(req.body?.assistTime ?? ''), remark: String(req.body?.remark ?? ''),
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, dataUrl: a.dataUrl })), fromRecycleId: req.body?.fromRecycleId || undefined,
  }, files))
  await markBound(created.id, ids)
  res.status(201).json(present(created))
}))

app.get('/api/accounts/import/context', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  res.json(await readDb((db) => engine.importContext(db, u)))
}))
app.post('/api/accounts/import', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  const route = 'POST /api/accounts/import'
  const idem = await idemLookup(req, route)
  if (idem?.replay) { res.setHeader('Idempotent-Replayed', 'true'); res.status(idem.replay.statusCode).json(idem.replay.body); return }
  const rows = req.body?.rows
  const fileName = String(req.body?.fileName ?? 'import.xlsx')
  if (req.body?.dryRun === true) {
    const preview = await readDb((db) => engine.previewImport(db, u, rows))
    res.json(preview)
    return
  }
  const outcome = await writeDb((db) => engine.importAccounts(db, u, rows, fileName))
  if (idem) await idemSave(idem.id, u.username, route, idem.bodyHash, 200, outcome)
  res.json(outcome)
}))
app.get('/api/accounts', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  let items = await readDb((db) => engine.listAccounts(db, u))
  if (qstr(req.query.status)) items = items.filter((a) => a.status === req.query.status)
  if (qstr(req.query.source)) items = items.filter((a) => a.source === req.query.source)
  if (qstr(req.query.ownerId)) items = items.filter((a) => a.ownerId === req.query.ownerId)
  const q = qstr(req.query.q).toLowerCase()
  if (q) items = items.filter((a) => `${a.accountNo} ${a.ownerContact} ${a.ownerName ?? ''}`.toLowerCase().includes(q))
  items = sorted(items, req.query.sort, ['createdAt', 'updatedAt', 'accountNo', 'status', 'coinAmount', 'costAmount'], '-createdAt')
  res.json(present(pageOf(items, req.query)))
}))
app.post('/api/accounts', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  if (req.body?.costAmount != null) assertMoney(req.body.costAmount, 'costAmount')
  if (req.body?.deposit != null) assertMoney(req.body.deposit, 'deposit')
  const ids: string[] | undefined = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : undefined
  const attachments = await bindAttachments(ids, u.username)
  const { attachmentIds, ...rest } = req.body ?? {}
  const created = await writeDb((db, files) => engine.saveAccount(db, u, { ...rest, ...(attachments ? { attachments } : {}) } as AccountInput, files))
  if (ids) await markBound(created.id, ids)
  res.status(201).json(present(created))
}))
app.put('/api/accounts/:id', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  if (req.body?.costAmount != null) assertMoney(req.body.costAmount, 'costAmount')
  if (req.body?.deposit != null) assertMoney(req.body.deposit, 'deposit')
  const existing = await readDb((db) => engine.listAccounts(db, u)).then((rows) => rows.find((a) => a.id === req.params.id))
  if (!existing) throw new ApiError('账号不存在', 404, false, 'NOT_FOUND')
  const ids: string[] | undefined = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : undefined
  const attachments = await bindAttachments(ids, u.username, existing)
  const { attachmentIds, ...rest } = req.body ?? {}
  const saved = await writeDb((db, files) => engine.saveAccount(db, u, { ...rest, id: req.params.id, ...(attachments ? { attachments } : {}) } as AccountInput, files))
  if (ids) await markBound(saved.id, ids, existing.attachments.map((a) => a.id))
  res.json(present(saved))
}))
app.delete('/api/accounts/:id', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  await writeDb((db) => engine.deleteAccount(db, u, req.params.id))
  res.status(204).end()
}))
app.post('/api/accounts/:id/status', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  res.json(present(await writeDb((db) => engine.setAccountStatus(db, u, req.params.id, req.body?.status as AccountStatus))))
}))

app.post('/api/uploads', imgUpload.single('file'), wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'ops', 'admin'])
  if (!req.file) throw new ApiError('请上传文件', 422, false, 'VALIDATION_FAILED', [{ field: 'file', message: '请上传文件' }])
  const saved = await writeImageBuffer(req.file.buffer, req.file.mimetype, req.file.originalname || 'image', u.username)
  try {
    await prisma.upload.create({ data: { id: saved.id, name: saved.name, mime: saved.mime, relPath: saved.relPath, bytes: saved.bytes, uploadedBy: saved.uploadedBy, createdAt: saved.createdAt } })
  } catch (e) {
    await import('fs').then((fs) => fs.promises.rm(safeUploadPath(saved.relPath), { force: true }))
    throw e
  }
  const signed = signedUpload(saved.id)
  res.status(201).json({ id: saved.id, name: saved.name, url: signed.url, expiresAt: signed.expiresAt, mime: saved.mime, size: saved.bytes, uploadedBy: saved.uploadedBy, at: saved.createdAt.toISOString() })
}))
app.get('/api/uploads/:id', wrap(async (req, res) => {
  const u = requireRoles(req, ['owner', 'cs', 'ops', 'admin'])
  if (!/^[a-f0-9]{32}$/.test(req.params.id)) throw new ApiError('截图不存在', 404, false, 'NOT_FOUND')
  const row = await prisma.upload.findUnique({ where: { id: req.params.id } })
  if (!row) throw new ApiError('截图不存在', 404, false, 'NOT_FOUND')
  let visible = row.uploadedBy === u.username
  if (!visible && row.accountId && u.role !== 'owner') visible = true
  if (!visible && row.accountId && u.role === 'owner') {
    const acc = await readDb((db) => db.accounts.find((a) => a.id === row.accountId && !a.deleted))
    visible = !!acc && (acc.ownerId === u.ownerId || acc.formerOwnerId === u.ownerId)
  }
  if (!visible) throw new ApiError('截图不存在', 404, false, 'NOT_FOUND')
  const signed = signedUpload(row.id)
  res.json({ id: row.id, name: row.name, url: signed.url, expiresAt: signed.expiresAt, mime: row.mime, size: row.bytes, uploadedBy: row.uploadedBy, at: row.createdAt.toISOString() })
}))
app.get('/api/uploads/:id/content', wrap(async (req, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.id) || !verifyUpload(req.params.id, req.query.exp, req.query.sig))
    throw new ApiError('截图不存在或链接已过期', 404, false, 'NOT_FOUND')
  const row = await prisma.upload.findUnique({ where: { id: req.params.id } })
  if (!row) throw new ApiError('截图不存在', 404, false, 'NOT_FOUND')
  res.setHeader('Content-Type', row.mime)
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.sendFile(safeUploadPath(row.relPath))
}))

app.get('/api/orders', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  let items = await readDb((db) => engine.listOrders(db, u))
  if (qstr(req.query.status)) items = items.filter((o) => o.status === req.query.status)
  if (qstr(req.query.reminder)) items = items.filter((o) => o.reminder === req.query.reminder)
  if (qstr(req.query.accountId)) items = items.filter((o) => o.accountId === req.query.accountId)
  if (req.query.from) { assertDateTime(req.query.from, 'from'); const t = Date.parse(String(req.query.from)); items = items.filter((o) => Date.parse(String(o.createdAt)) >= t) }
  if (req.query.to) { assertDateTime(req.query.to, 'to'); const t = Date.parse(String(req.query.to)); items = items.filter((o) => Date.parse(String(o.createdAt)) < t) }
  const q = qstr(req.query.q).toLowerCase()
  if (q) items = items.filter((o) => `${o.orderNo} ${o.accountNo} ${o.renterContact}`.toLowerCase().includes(q))
  items = sorted(items, req.query.sort, ['createdAt', 'orderNo', 'startAt', 'endAt', 'status', 'totalAmount'], '-createdAt')
  res.json(present(pageOf(items, req.query)))
}))
app.post('/api/orders/preview', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(await readDb((db) => engine.previewOrder(db, u, String(req.body?.accountId ?? ''), String(req.body?.renterContact ?? ''))))
}))
app.post('/api/orders', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  const route = 'POST /api/orders'
  const idem = await idemLookup(req, route)
  if (idem?.replay) { res.setHeader('Idempotent-Replayed', 'true'); res.status(idem.replay.statusCode).json(idem.replay.body); return }
  assertDateTime(req.body?.startAt, 'startAt')
  assertMoney(req.body?.deposit, 'deposit')
  assertMoney(req.body?.extraFee, 'extraFee')
  if (!Number.isInteger(req.body?.rentalDays) || req.body.rentalDays < 1)
    throw new ApiError('租期至少 1 天', 422, false, 'VALIDATION_FAILED', [{ field: 'rentalDays', message: '租期至少 1 天' }])
  const order = await writeDb((db) => engine.createOrder(db, u, req.body as OrderInput))
  const body = present(order)
  if (idem) await idemSave(idem.id, u.username, route, idem.bodyHash, 201, body)
  res.status(201).json(body)
}))
app.get('/api/orders/:id', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  const orders = await readDb((db) => engine.listOrders(db, u))
  const order = orders.find((o) => o.id === req.params.id)
  if (!order) throw new ApiError('订单不存在', 404, false, 'NOT_FOUND')
  res.json(present(order))
}))
app.post('/api/orders/:id/handover', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(present(await writeDb((db) => engine.markHandover(db, u, req.params.id, qstr(req.body?.note)))))
}))
app.post('/api/orders/:id/extend', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  if (!Number.isInteger(req.body?.rentalDays) || req.body.rentalDays < 1)
    throw new ApiError('租期至少 1 天', 422, false, 'VALIDATION_FAILED', [{ field: 'rentalDays', message: '租期至少 1 天' }])
  res.json(present(await writeDb((db) => engine.extendOrder(db, u, req.params.id, req.body.rentalDays, qstr(req.body?.note)))))
}))
app.post('/api/orders/:id/end', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(present(await writeDb((db) => engine.endOrder(db, u, req.params.id, qstr(req.body?.note)))))
}))
app.post('/api/orders/:id/return', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(present(await writeDb((db) => engine.markReturned(db, u, req.params.id, qstr(req.body?.note)))))
}))
app.post('/api/orders/:id/deposits', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  assertMoney(req.body?.amount, 'amount')
  if (req.body.amount < 1) throw new ApiError('金额需大于 0', 422, false, 'VALIDATION_FAILED', [{ field: 'amount', message: '金额需大于 0' }])
  res.json(present(await writeDb((db) => engine.addDepositEntry(db, u, req.params.id, { type: req.body?.type, amount: req.body.amount, reason: String(req.body?.reason ?? '') }))))
}))
app.post('/api/orders/:id/owner-payments', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  const route = `POST /api/orders/${req.params.id}/owner-payments`
  const idem = await idemLookup(req, route)
  if (idem?.replay) { res.setHeader('Idempotent-Replayed', 'true'); res.status(idem.replay.statusCode).json(idem.replay.body); return }
  assertMoney(req.body?.amount, 'amount')
  const order = await writeDb((db) => engine.payOwner(db, u, req.params.id, Number(req.body?.amount), String(req.body?.note ?? '')))
  const body = present(order)
  if (idem) await idemSave(idem.id, u.username, route, idem.bodyHash, 200, body)
  res.json(body)
}))
app.post('/api/orders/:id/complete', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(present(await writeDb((db) => engine.completeOrder(db, u, req.params.id, !!req.body?.relist, qstr(req.body?.note)))))
}))
app.post('/api/orders/:id/cancel', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(present(await writeDb((db) => engine.cancelOrder(db, u, req.params.id, qstr(req.body?.note)))))
}))
app.get('/api/payables', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  let items = await readDb((db) => engine.listPayables(db, u, qstr(req.query.ownerId) || undefined))
  if (qstr(req.query.orderId)) items = items.filter((p) => p.orderId === req.query.orderId)
  const q = qstr(req.query.q).toLowerCase()
  if (q) items = items.filter((p) => `${p.accountNo} ${p.orderNo ?? ''} ${p.note}`.toLowerCase().includes(q))
  items = sorted(items, req.query.sort, ['at', 'createdAt', 'amount', 'accountNo'], '-createdAt', { createdAt: 'at' })
  res.json(present(pageOf(items, req.query)))
}))

app.get('/api/renters/lookup', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json({ profile: await readDb((db) => engine.lookupRenter(db, u, qstr(req.query.contact))) })
}))
app.get('/api/renters', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  let items = await readDb((db) => engine.renterProfiles(db, u))
  if (qstr(req.query.tag)) items = items.filter((r) => r.tag === req.query.tag)
  const q = qstr(req.query.q).toLowerCase()
  if (q) items = items.filter((r) => `${r.contact} ${r.displayName} ${r.note}`.toLowerCase().includes(q))
  items = sorted(items, req.query.sort, ['contact', 'rentalCount', 'totalSpend', 'lastRentAt', 'displayName'], '-rentalCount')
  res.json(present(pageOf(items, req.query)))
}))
app.post('/api/renters', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  const profile = await writeDb((db) => engine.saveRenter(db, u, {
    contact: String(req.body?.contact ?? ''), displayName: String(req.body?.displayName ?? ''), tag: (req.body?.tag ?? null) as RenterTag | null, note: String(req.body?.note ?? ''),
  }))
  res.json(present(profile))
}))
app.get('/api/owners', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  let items = await readDb((db) => engine.ownerProfiles(db, u))
  const q = qstr(req.query.q).toLowerCase()
  if (q) items = items.filter((o) => `${o.contact} ${o.displayName}`.toLowerCase().includes(q))
  items = sorted(items, req.query.sort, ['contact', 'displayName', 'consignedCount', 'balance'], '-consignedCount')
  res.json(present(pageOf(items, req.query)))
}))

app.get('/api/rules/pricing', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(await readDb((db) => engine.getPricingRule(db, u)))
}))
app.put('/api/rules/pricing', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  const rule = (req.body?.rule ?? req.body) as PricingRule
  res.json(await writeDb((db) => engine.savePricingRule(db, u, rule, typeof req.body?.summary === 'string' ? req.body.summary : '')))
}))
app.get('/api/rules/valuation', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  res.json(await readDb((db) => engine.getValuationRule(db, u)))
}))
app.put('/api/rules/valuation', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  const rule = (req.body?.rule ?? req.body) as ValuationRule
  res.json(await writeDb((db) => engine.saveValuationRule(db, u, rule, typeof req.body?.summary === 'string' ? req.body.summary : '')))
}))
app.get('/api/rules/versions', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  res.json(await readDb((db) => engine.ruleHistory(db, u)))
}))
app.post('/api/rules/pricing/trial', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  res.json(await readDb((db) => engine.trialPricing(db, u, req.body?.input as PricingInput, req.body?.rule as PricingRule)))
}))
app.post('/api/rules/valuation/trial', wrap(async (req, res) => {
  const u = requireRoles(req, ['ops', 'admin'])
  res.json(await readDb((db) => engine.trialValuation(db, u, req.body?.input as ValuationInput, req.body?.rule as ValuationRule)))
}))

app.get('/api/reports', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  if (!req.query.from || !req.query.to || !req.query.dimension) throw new ApiError('缺少 from / to / dimension', 422, false, 'VALIDATION_FAILED')
  assertDateTime(req.query.from, 'from')
  assertDateTime(req.query.to, 'to')
  res.json(await readDb((db) => engine.report(db, u, Date.parse(String(req.query.from)), Date.parse(String(req.query.to)), qstr(req.query.dimension) as ReportDimension)))
}))
app.get('/api/dashboard', wrap(async (req, res) => {
  const u = requireRoles(req, ['cs', 'ops', 'admin'])
  res.json(await readDb((db) => engine.dashboard(db, u)))
}))
app.get('/api/staff', wrap(async (req, res) => {
  const u = requireRoles(req, ['admin'])
  res.json(await readDb((db) => engine.listUsers(db, u)))
}))
app.patch('/api/staff/:username', wrap(async (req, res) => {
  const u = requireRoles(req, ['admin'])
  const username = req.params.username
  const enabled = !!req.body?.enabled
  const staff = await writeDb((db) => engine.setUserEnabled(db, u, username, enabled))
  if (!enabled) await revokeUser(username)
  res.json(staff)
}))
app.get('/api/audit-logs', wrap(async (req, res) => {
  const u = requireRoles(req, ['admin'])
  let items = await readDb((db) => engine.auditLogs(db, u))
  if (qstr(req.query.actor)) items = items.filter((a) => a.actor === req.query.actor)
  if (qstr(req.query.action)) items = items.filter((a) => a.action === req.query.action)
  if (req.query.from) { assertDateTime(req.query.from, 'from'); const t = Date.parse(String(req.query.from)); items = items.filter((a) => Date.parse(String(a.at)) >= t) }
  if (req.query.to) { assertDateTime(req.query.to, 'to'); const t = Date.parse(String(req.query.to)); items = items.filter((a) => Date.parse(String(a.at)) < t) }
  const q = qstr(req.query.q).toLowerCase()
  if (q) items = items.filter((a) => `${a.actor} ${a.action} ${a.summary}`.toLowerCase().includes(q))
  items = sorted(items, req.query.sort, ['at', 'createdAt', 'actor', 'action'], '-createdAt', { createdAt: 'at' })
  res.json(pageOf(items, req.query))
}))
app.post('/api/demo/reset', wrap(async (req, res) => {
  requireRoles(req, ['admin'])
  if (!config.enableDemoAccounts || !config.enableDemoReset) throw new ApiError('演示数据重置不可用', 404, false, 'NOT_FOUND')
  await seed({ force: true })
  await prisma.session.deleteMany()
  res.status(204).end()
}))

app.use('/api', (req, res) => {
  sendError(res, 404, 'NOT_FOUND', `接口不存在 ${req.method} ${req.path}`)
})

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    const mapped = mapError(err, req.path === '/api/auth/login')
    return sendError(res, mapped.status, mapped.code, mapped.message, mapped.fields)
  }
  if (err instanceof MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE'
    return sendError(res, tooBig ? 413 : 400, tooBig ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', tooBig ? '单张截图不能超过 1MB' : '上传失败')
  }
  const anyErr = err as { type?: string; status?: number }
  if (anyErr?.type === 'entity.too.large' || anyErr?.status === 413) return sendError(res, 413, 'PAYLOAD_TOO_LARGE', '请求体不能超过 5MB')
  if (err instanceof SyntaxError && 'body' in (err as object)) return sendError(res, 400, 'BAD_REQUEST', '请求体不是合法 JSON')
  console.error(err)
  return sendError(res, 500, 'INTERNAL', '服务器错误')
})

export { app }
