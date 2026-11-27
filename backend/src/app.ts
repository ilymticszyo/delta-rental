import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import multer, { MulterError } from 'multer'
import swaggerUi from 'swagger-ui-express'
import ExcelJS from 'exceljs'
import { Readable } from 'stream'
import bcrypt from 'bcryptjs'
import { config } from './config'
import type { PricingRule, ValuationRule } from './domain/rules'
import type { ReportDimension } from './domain/reports'
import { demoUsers } from './domain/seedData'
import type { AccountInput, AccountStatus, OrderInput, PricingInput as PInput, RecycleStatus, RenterTag, Role, ValuationInput as VInput } from './domain/types'
import { Engine, toPublicUser } from './engine'
import { ApiError } from './errors'
import { openapi } from './openapi'
import { prisma, readDb, writeDb } from './persistence'
import { seed } from './seed'
import { DiskAttachmentStore, safeUploadPath } from './uploads'

const engine = new Engine()
const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')
if (config.corsOrigin.length) {
  app.use(cors({ origin: config.corsOrigin, credentials: true, exposedHeaders: ['X-Auth-Token'] }))
}
app.use(express.json({ limit: '8mb' }))
app.use(cookieParser())

const imgUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } })
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } })

function isPublic(req: Request) {
  const p = req.path
  if (p === '/api/docs' || p.startsWith('/api/docs/')) return true
  if (req.method === 'GET' && (p === '/api/health' || p === '/api/openapi.json' || p === '/api/auth/demo-accounts')) return true
  if (req.method === 'POST' && (p === '/api/auth/login' || p === '/api/auth/logout')) return true
  return false
}
function readToken(req: Request) {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7).trim()
  const c = req.cookies?.token
  return typeof c === 'string' && c ? c : null
}

app.use(async (req, res, next) => {
  try {
    if (isPublic(req)) return next()
    const token = readToken(req)
    if (!token) { req.user = null; return next() }
    let sub = ''
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { sub?: string }
      sub = payload.sub || ''
    } catch {
      return res.status(401).json({ message: '未登录', code: 401 })
    }
    if (!sub) return res.status(401).json({ message: '未登录', code: 401 })
    const row = await prisma.user.findUnique({ where: { username: sub } })
    if (!row) return res.status(401).json({ message: '未登录', code: 401 })
    if (!row.enabled) return res.status(401).json({ message: '该账号已停用', code: 401 })
    req.user = toPublicUser({ username: row.username, displayName: row.displayName, role: row.role as Role, ownerId: row.ownerId ?? undefined })
    next()
  } catch (e) { next(e) }
})

const loginHits = new Map<string, { n: number; t: number }>()
function limitLogin(ip: string) {
  const now = Date.now()
  const b = loginHits.get(ip)
  if (!b || now - b.t > 10 * 60 * 1000) { loginHits.set(ip, { n: 1, t: now }); return }
  b.n += 1
  if (b.n > 30) throw new ApiError('登录尝试过于频繁，请稍后再试', 429)
}

function cookieMaxAge() {
  const m = /^(\d+)([dhms])$/.exec(config.jwtExpiresIn.trim())
  if (!m) return 7 * 86400000
  const unit = { d: 86400000, h: 3600000, m: 60000, s: 1000 }[m[2] as 'd' | 'h' | 'm' | 's']
  return Number(m[1]) * unit
}
function issueToken(res: Response, username: string) {
  const token = jwt.sign({ sub: username }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] })
  res.setHeader('X-Auth-Token', token)
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: cookieMaxAge() })
  return token
}

const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next) }
const actor = (req: Request) => req.user ?? null
const send = (res: Response, body: unknown) => { res.status(200).json(body === undefined ? { ok: true } : body) }
const qstr = (v: unknown) => (typeof v === 'string' ? v : '')
function qdate(v: unknown) {
  if (typeof v !== 'string' || !v) return undefined
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new ApiError('时间参数无效')
  return d
}
function valuationBody(body: unknown): { input: VInput; sourceAccountId?: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (b.input && typeof b.input === 'object') return { input: b.input as VInput, sourceAccountId: typeof b.sourceAccountId === 'string' ? b.sourceAccountId : undefined }
  const { sourceAccountId, ...input } = b
  return { input: input as unknown as VInput, sourceAccountId: typeof sourceAccountId === 'string' ? sourceAccountId : undefined }
}
function ruleBody<T>(body: unknown): { rule: T; summary?: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (b.rule && typeof b.rule === 'object') return { rule: b.rule as T, summary: typeof b.summary === 'string' ? b.summary : undefined }
  const { summary, ...rule } = b
  return { rule: rule as T, summary: typeof summary === 'string' ? summary : undefined }
}

app.get('/api/health', wrap(async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`
  res.json({ ok: true, service: 'delta-rental-api' })
}))
app.get('/api/openapi.json', (_req, res) => { res.json(openapi) })
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: '三角洲租赁 API' }))

app.post('/api/auth/login', wrap(async (req, res) => {
  limitLogin(req.ip || 'unknown')
  const username = String(req.body?.username ?? '')
  const password = String(req.body?.password ?? '')
  const row = await prisma.user.findUnique({ where: { username: username.trim() } })
  const dbUser = row ? {
    username: row.username, password: row.passwordHash, displayName: row.displayName, role: row.role as Role, enabled: row.enabled,
    ...(row.ownerId ? { ownerId: row.ownerId } : {}),
  } : null
  const user = await engine.login(dbUser, password, async (hash, plain) => {
    try { return await bcrypt.compare(plain, hash) } catch { return false }
  })
  issueToken(res, user.username)
  res.json(user)
}))
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' })
  res.json({ ok: true })
})
app.get('/api/auth/me', (req, res) => { res.json(req.user ?? null) })
app.get('/api/auth/demo-accounts', (_req, res) => {
  if (!config.enableDemoAccounts) return res.json([])
  res.json(demoUsers.map((u) => {
    if (u.username === 'admin') return { username: config.adminUsername, password: config.adminPassword, role: u.role, displayName: u.displayName }
    return { username: u.username, password: u.password, role: u.role, displayName: u.displayName }
  }))
})

app.get('/api/lobby/accounts', wrap(async (req, res) => { send(res, await readDb((db) => engine.listListedAccounts(db, actor(req)))) }))
app.get('/api/lobby/accounts/:id', wrap(async (req, res) => {
  const row = await readDb((db) => engine.getAccount(db, actor(req), req.params.id))
  res.json(row ?? null)
}))
app.post('/api/pricing/calc', wrap(async (req, res) => { send(res, await readDb((db) => engine.calcPricing(db, actor(req), req.body as PInput))) }))
app.post('/api/valuation/calc', wrap(async (req, res) => { send(res, await readDb((db) => engine.calcValuation(db, actor(req), req.body as VInput))) }))
app.post('/api/recycles', wrap(async (req, res) => {
  const { input, sourceAccountId } = valuationBody(req.body)
  send(res, await writeDb((db) => engine.submitRecycle(db, actor(req), input, { sourceAccountId })))
}))
app.get('/api/recycles/mine', wrap(async (req, res) => { send(res, await readDb((db) => engine.myRecycles(db, actor(req)))) }))
app.get('/api/cs/current', wrap(async (req, res) => {
  const now = qdate(req.query.now)
  const row = await readDb((db) => engine.currentCsAgent(db, actor(req), now))
  res.json(row)
}))
app.get('/api/cs/agents', wrap(async (req, res) => { send(res, await readDb((db) => engine.listCsAgents(db, actor(req)))) }))

app.get('/api/owner/accounts', wrap(async (req, res) => { send(res, await readDb((db) => engine.ownerAccounts(db, actor(req)))) }))
app.get('/api/owner/accounts/:id/recycle-draft', wrap(async (req, res) => { send(res, await readDb((db) => engine.ownerRecycleDraft(db, actor(req), req.params.id))) }))
app.get('/api/owner/accounts/:id', wrap(async (req, res) => { send(res, await readDb((db) => engine.ownerAccount(db, actor(req), req.params.id))) }))
app.post('/api/owner/estimate', wrap(async (req, res) => {
  const asset = (req.body?.asset ?? req.body) as VInput
  send(res, await readDb((db) => engine.ownerEstimate(db, actor(req), asset)))
}))
app.post('/api/owner/listings', wrap(async (req, res) => {
  send(res, await writeDb((db, files) => engine.ownerSubmitListing(db, actor(req), {
    asset: req.body?.asset, assistTime: String(req.body?.assistTime ?? ''), remark: String(req.body?.remark ?? ''),
    attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [], fromRecycleId: req.body?.fromRecycleId || undefined,
  }, files)))
}))

app.get('/api/admin/accounts/import/context', wrap(async (req, res) => { send(res, await readDb((db) => engine.importContext(db, actor(req)))) }))
app.post('/api/admin/accounts/import', wrap(async (req, res) => {
  send(res, await writeDb((db) => engine.importAccounts(db, actor(req), req.body?.aoa, String(req.body?.fileName ?? 'import.xlsx'))))
}))
function cellValue(v: unknown): unknown {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown }
    if (typeof o.text === 'string') return o.text
    if ('result' in o) return cellValue(o.result)
  }
  return v
}
function worksheetToAoa(sheet: ExcelJS.Worksheet): unknown[][] {
  const aoa: unknown[][] = []
  const width = Math.max(sheet.columnCount, 1)
  for (let r = 1; r <= sheet.rowCount; r++) {
    const raw = sheet.getRow(r).values as unknown[]
    const line: unknown[] = []
    for (let c = 1; c <= Math.max(width, raw.length - 1); c++) line.push(cellValue(raw[c]))
    aoa.push(line)
  }
  return aoa
}
app.post('/api/admin/accounts/import/xlsx', sheetUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new ApiError('请上传文件')
  const wb = new ExcelJS.Workbook()
  const name = (req.file.originalname || '').toLowerCase()
  if (name.endsWith('.csv') || req.file.mimetype === 'text/csv') await wb.csv.read(Readable.from(req.file.buffer))
  else await wb.xlsx.load(req.file.buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const sheet = wb.worksheets[0]
  if (!sheet || sheet.rowCount === 0) throw new ApiError('表格为空')
  const aoa = worksheetToAoa(sheet)
  send(res, await writeDb((db) => engine.importAccounts(db, actor(req), aoa, req.file!.originalname || 'import.xlsx')))
}))
app.get('/api/admin/accounts', wrap(async (req, res) => { send(res, await readDb((db) => engine.listAccounts(db, actor(req)))) }))
app.post('/api/admin/accounts', wrap(async (req, res) => { send(res, await writeDb((db, files) => engine.saveAccount(db, actor(req), req.body as AccountInput, files))) }))
app.delete('/api/admin/accounts/:id', wrap(async (req, res) => { send(res, await writeDb((db) => engine.deleteAccount(db, actor(req), req.params.id))) }))
app.post('/api/admin/accounts/:id/status', wrap(async (req, res) => { send(res, await writeDb((db) => engine.setAccountStatus(db, actor(req), req.params.id, req.body?.status as AccountStatus))) }))

app.get('/api/admin/orders', wrap(async (req, res) => { send(res, await readDb((db) => engine.listOrders(db, actor(req)))) }))
app.post('/api/admin/orders/preview', wrap(async (req, res) => { send(res, await readDb((db) => engine.previewOrder(db, actor(req), String(req.body?.accountId ?? ''), String(req.body?.renterContact ?? '')))) }))
app.post('/api/admin/orders', wrap(async (req, res) => { send(res, await writeDb((db) => engine.createOrder(db, actor(req), req.body as OrderInput))) }))
app.post('/api/admin/orders/:id/handover', wrap(async (req, res) => { send(res, await writeDb((db) => engine.markHandover(db, actor(req), req.params.id, qstr(req.body?.note)))) }))
app.post('/api/admin/orders/:id/extend', wrap(async (req, res) => { send(res, await writeDb((db) => engine.extendOrder(db, actor(req), req.params.id, Number(req.body?.rentalDays), qstr(req.body?.note)))) }))
app.post('/api/admin/orders/:id/end', wrap(async (req, res) => { send(res, await writeDb((db) => engine.endOrder(db, actor(req), req.params.id, qstr(req.body?.note)))) }))
app.post('/api/admin/orders/:id/returned', wrap(async (req, res) => { send(res, await writeDb((db) => engine.markReturned(db, actor(req), req.params.id, qstr(req.body?.note)))) }))
app.post('/api/admin/orders/:id/deposits', wrap(async (req, res) => { send(res, await writeDb((db) => engine.addDepositEntry(db, actor(req), req.params.id, { type: req.body?.type, amount: Number(req.body?.amount), reason: String(req.body?.reason ?? '') }))) }))
app.post('/api/admin/orders/:id/pay-owner', wrap(async (req, res) => { send(res, await writeDb((db) => engine.payOwner(db, actor(req), req.params.id, Number(req.body?.amount), String(req.body?.note ?? '')))) }))
app.post('/api/admin/orders/:id/complete', wrap(async (req, res) => { send(res, await writeDb((db) => engine.completeOrder(db, actor(req), req.params.id, !!req.body?.relist, qstr(req.body?.note)))) }))
app.post('/api/admin/orders/:id/cancel', wrap(async (req, res) => { send(res, await writeDb((db) => engine.cancelOrder(db, actor(req), req.params.id, qstr(req.body?.note)))) }))
app.get('/api/admin/payables', wrap(async (req, res) => { send(res, await readDb((db) => engine.listPayables(db, actor(req), qstr(req.query.ownerId) || undefined))) }))

app.get('/api/admin/renters/lookup', wrap(async (req, res) => { send(res, await readDb((db) => engine.lookupRenter(db, actor(req), qstr(req.query.contact)))) }))
app.get('/api/admin/renters', wrap(async (req, res) => { send(res, await readDb((db) => engine.renterProfiles(db, actor(req)))) }))
app.post('/api/admin/renters', wrap(async (req, res) => {
  send(res, await writeDb((db) => engine.saveRenter(db, actor(req), {
    contact: String(req.body?.contact ?? ''), displayName: String(req.body?.displayName ?? ''), tag: (req.body?.tag ?? null) as RenterTag | null, note: String(req.body?.note ?? ''),
  })))
}))
app.get('/api/admin/owners', wrap(async (req, res) => { send(res, await readDb((db) => engine.ownerProfiles(db, actor(req)))) }))

app.get('/api/admin/recycles', wrap(async (req, res) => { send(res, await readDb((db) => engine.listRecycles(db, actor(req)))) }))
app.post('/api/admin/recycles/:id/to-inventory', wrap(async (req, res) => { send(res, await writeDb((db) => engine.recycleToInventory(db, actor(req), req.params.id))) }))
app.post('/api/admin/recycles/:id', wrap(async (req, res) => {
  send(res, await writeDb((db) => engine.updateRecycle(db, actor(req), req.params.id, req.body?.toStatus as RecycleStatus, String(req.body?.note ?? ''), req.body?.staffPrice == null ? undefined : Number(req.body.staffPrice))))
}))

app.get('/api/admin/rules/pricing/versions/:version', wrap(async (req, res) => { send(res, await readDb((db) => engine.pricingRuleVersion(db, actor(req), Number(req.params.version)))) }))
app.get('/api/admin/rules/valuation/versions/:version', wrap(async (req, res) => { send(res, await readDb((db) => engine.valuationRuleVersion(db, actor(req), Number(req.params.version)))) }))
app.post('/api/admin/rules/pricing/trial', wrap(async (req, res) => { send(res, await readDb((db) => engine.trialPricing(db, actor(req), req.body?.input as PInput, req.body?.rule as PricingRule))) }))
app.post('/api/admin/rules/valuation/trial', wrap(async (req, res) => { send(res, await readDb((db) => engine.trialValuation(db, actor(req), req.body?.input as VInput, req.body?.rule as ValuationRule))) }))
app.get('/api/admin/rules/history', wrap(async (req, res) => { send(res, await readDb((db) => engine.ruleHistory(db, actor(req)))) }))
app.get('/api/admin/rules/pricing', wrap(async (req, res) => { send(res, await readDb((db) => engine.getPricingRule(db, actor(req)))) }))
app.put('/api/admin/rules/pricing', wrap(async (req, res) => {
  const { rule, summary } = ruleBody<PricingRule>(req.body)
  send(res, await writeDb((db) => engine.savePricingRule(db, actor(req), rule, summary)))
}))
app.get('/api/admin/rules/valuation', wrap(async (req, res) => { send(res, await readDb((db) => engine.getValuationRule(db, actor(req)))) }))
app.put('/api/admin/rules/valuation', wrap(async (req, res) => {
  const { rule, summary } = ruleBody<ValuationRule>(req.body)
  send(res, await writeDb((db) => engine.saveValuationRule(db, actor(req), rule, summary)))
}))

app.get('/api/admin/reports', wrap(async (req, res) => {
  if (req.query.fromMs == null || req.query.toMs == null || !req.query.dimension) throw new ApiError('缺少 fromMs / toMs / dimension')
  send(res, await readDb((db) => engine.report(db, actor(req), Number(req.query.fromMs), Number(req.query.toMs), qstr(req.query.dimension) as ReportDimension)))
}))
app.get('/api/admin/dashboard', wrap(async (req, res) => { send(res, await readDb((db) => engine.dashboard(db, actor(req), qdate(req.query.now)))) }))
app.get('/api/admin/users', wrap(async (req, res) => { send(res, await readDb((db) => engine.listUsers(db, actor(req)))) }))
app.post('/api/admin/users/:username/enabled', wrap(async (req, res) => { send(res, await writeDb((db) => engine.setUserEnabled(db, actor(req), req.params.username, !!req.body?.enabled))) }))
app.get('/api/admin/audit', wrap(async (req, res) => { send(res, await readDb((db) => engine.auditLogs(db, actor(req)))) }))
app.post('/api/admin/reset-demo', wrap(async (req, res) => {
  if (!actor(req) || actor(req)?.role !== 'admin') throw new ApiError('无权限（403）', 403)
  if (!config.enableDemoReset) throw new ApiError('演示数据重置已关闭', 403)
  await seed({ force: true })
  res.json({ ok: true })
}))

app.post('/api/uploads', imgUpload.single('file'), wrap(async (req, res) => {
  if (!actor(req)) throw new ApiError('未登录', 401)
  if (!req.file) throw new ApiError('请上传文件')
  const files = new DiskAttachmentStore()
  const saved = await files.saveBuffer(req.file.buffer, req.file.mimetype, req.file.originalname || 'image', actor(req)!.username)
  try {
    await prisma.upload.create({ data: { id: saved.id, name: saved.name, mime: saved.mime, relPath: saved.relPath, bytes: saved.bytes, uploadedBy: saved.uploadedBy, createdAt: saved.createdAt } })
  } catch (e) {
    await import('fs').then((fs) => fs.promises.rm(safeUploadPath(saved.relPath), { force: true }))
    throw e
  }
  res.json({ id: saved.id, name: saved.name, dataUrl: saved.url, uploadedBy: saved.uploadedBy, at: saved.createdAt.toISOString() })
}))
app.get('/api/uploads/:id', wrap(async (req, res) => {
  if (!actor(req)) throw new ApiError('未登录', 401)
  if (!/^[a-f0-9]{32}$/.test(req.params.id)) throw new ApiError('截图不存在', 404)
  const row = await prisma.upload.findUnique({ where: { id: req.params.id } })
  if (!row) throw new ApiError('截图不存在', 404)
  res.setHeader('Content-Type', row.mime)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.sendFile(safeUploadPath(row.relPath))
}))

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) return res.status(err.code).json({ message: err.message, code: err.code })
  if (err instanceof MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? '文件超过大小限制' : '上传失败'
    return res.status(400).json({ message, code: 400 })
  }
  const anyErr = err as { type?: string; status?: number; message?: string }
  if (anyErr?.type === 'entity.too.large') return res.status(413).json({ message: '请求体过大', code: 413 })
  if (err instanceof SyntaxError && 'body' in (err as object)) return res.status(400).json({ message: '请求体不是合法 JSON', code: 400 })
  console.error(err)
  res.status(500).json({ message: '服务器错误', code: 500 })
})

export { app }
