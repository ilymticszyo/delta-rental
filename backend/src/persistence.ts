import { Prisma, PrismaClient } from '@prisma/client'
import type { Account, OwnerPayableEntry, RecycleRequest, RentalOrder } from './domain/types'
import { normalizeAccountRemarks } from './domain/visibility'
import type { Db, DbUser } from './domain/seedData'
import { ApiError } from './errors'
import { DiskAttachmentStore, type StoredUpload } from './uploads'

export const prisma = new PrismaClient({ log: ['error'] })
type Tx = Prisma.TransactionClient

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export async function loadDb(tx: Tx): Promise<Db> {
  const [metas, users, owners, renters, accounts, orders, payables, recycles, audits] = await Promise.all([
    tx.meta.findMany(),
    tx.user.findMany(),
    tx.owner.findMany(),
    tx.renter.findMany(),
    tx.account.findMany(),
    tx.order.findMany(),
    tx.payable.findMany(),
    tx.recycle.findMany(),
    tx.audit.findMany({ orderBy: { seq: 'asc' } }),
  ])
  const meta = Object.fromEntries(metas.map((m) => [m.key, m.value]))
  if (meta.seedVersion == null) throw new ApiError('数据库尚未初始化', 500)
  const db: Db = {
    seedVersion: meta.seedVersion as number,
    seq: meta.seq as Db['seq'],
    users: users.map((u) => ({
      username: u.username,
      password: u.passwordHash,
      displayName: u.displayName,
      role: u.role as DbUser['role'],
      enabled: u.enabled,
      ...(u.ownerId ? { ownerId: u.ownerId } : {}),
    })),
    owners: owners.map((o) => ({ id: o.id, contact: o.contact, displayName: o.displayName, ...(o.userId ? { userId: o.userId } : {}) })),
    renters: renters.map((r) => ({ contact: r.contact, displayName: r.displayName, tag: (r.tag as Db['renters'][number]['tag']) ?? null, note: r.note })),
    accounts: accounts.map((a) => normalizeAccountRemarks(a.payload as unknown as Account)),
    orders: orders.map((o) => o.payload as unknown as RentalOrder),
    payables: payables.map((p) => p.payload as unknown as OwnerPayableEntry),
    recycles: recycles.map((r) => r.payload as unknown as RecycleRequest),
    pricingRule: meta.pricingRule as unknown as Db['pricingRule'],
    valuationRule: meta.valuationRule as unknown as Db['valuationRule'],
    pricingHistory: meta.pricingHistory as unknown as Db['pricingHistory'],
    valuationHistory: meta.valuationHistory as unknown as Db['valuationHistory'],
    csAgents: meta.csAgents as unknown as Db['csAgents'],
    audit: audits.map((a) => ({ at: a.at.toISOString(), actor: a.actor, action: a.action, summary: a.summary })),
  }
  return db
}

async function putMeta(tx: Tx, key: string, value: unknown) {
  const v = json(value)
  await tx.meta.upsert({ where: { key }, create: { key, value: v }, update: { value: v } })
}

const changed = (prev: unknown, next: unknown) => JSON.stringify(prev) !== JSON.stringify(next)

export async function saveDb(tx: Tx, db: Db, before?: Db) {
  const users = before ? db.users.filter((u) => changed(before.users.find((x) => x.username === u.username), u)) : db.users
  const owners = before ? db.owners.filter((o) => changed(before.owners.find((x) => x.id === o.id), o)) : db.owners
  const renters = before ? db.renters.filter((r) => changed(before.renters.find((x) => x.contact.trim().toLowerCase() === r.contact.trim().toLowerCase()), r)) : db.renters
  const accounts = before ? db.accounts.filter((a) => changed(before.accounts.find((x) => x.id === a.id), a)) : db.accounts
  const orders = before ? db.orders.filter((o) => changed(before.orders.find((x) => x.id === o.id), o)) : db.orders
  const payables = before ? db.payables.filter((p) => changed(before.payables.find((x) => x.id === p.id), p)) : db.payables
  const recycles = before ? db.recycles.filter((r) => changed(before.recycles.find((x) => x.id === r.id), r)) : db.recycles
  for (const u of users) {
    const data = { passwordHash: u.password, displayName: u.displayName, role: u.role, enabled: u.enabled, ownerId: u.ownerId ?? null }
    await tx.user.upsert({ where: { username: u.username }, create: { username: u.username, ...data }, update: data })
  }
  for (const o of owners) {
    const data = { contact: o.contact, displayName: o.displayName, userId: o.userId ?? null }
    await tx.owner.upsert({ where: { id: o.id }, create: { id: o.id, ...data }, update: data })
  }
  for (const r of renters) {
    const contactKey = r.contact.trim().toLowerCase()
    const data = { contact: r.contact, displayName: r.displayName, tag: r.tag, note: r.note ?? '' }
    await tx.renter.upsert({ where: { contactKey }, create: { contactKey, ...data }, update: data })
  }
  for (const a of accounts) {
    const data = {
      accountNo: a.accountNo, status: a.status, source: a.source, ownerId: a.ownerId ?? null, formerOwnerId: a.formerOwnerId ?? null,
      deleted: !!a.deleted, payload: json(a), createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt),
    }
    await tx.account.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data })
  }
  for (const o of orders) {
    const data = { orderNo: o.orderNo, accountId: o.accountId, status: o.status, payload: json(o), createdAt: new Date(o.createdAt) }
    await tx.order.upsert({ where: { id: o.id }, create: { id: o.id, ...data }, update: data })
  }
  for (const p of payables) {
    const data = { ownerId: p.ownerId, orderId: p.orderId ?? null, accountId: p.accountId, payload: json(p), at: new Date(p.at) }
    await tx.payable.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data })
  }
  for (const r of recycles) {
    const data = {
      requestNo: r.requestNo, submitter: r.submitter, status: r.status, sourceAccountId: r.sourceAccountId ?? null,
      ownerId: r.ownerId ?? null, payload: json(r), createdAt: new Date(r.createdAt),
    }
    await tx.recycle.upsert({ where: { id: r.id }, create: { id: r.id, ...data }, update: data })
  }
  if (!before || changed(before.audit, db.audit)) {
    await tx.audit.deleteMany()
    if (db.audit.length) {
      await tx.audit.createMany({
        data: db.audit.map((a, seq) => ({ seq, at: new Date(a.at), actor: a.actor, action: a.action, summary: a.summary })),
      })
    }
  }
  const metas: [string, unknown][] = [
    ['seedVersion', db.seedVersion], ['seq', db.seq], ['pricingRule', db.pricingRule], ['valuationRule', db.valuationRule],
    ['pricingHistory', db.pricingHistory], ['valuationHistory', db.valuationHistory], ['csAgents', db.csAgents],
  ]
  for (const [key, value] of metas) {
    if (!before || changed((before as unknown as Record<string, unknown>)[key === 'seedVersion' ? 'seedVersion' : key], value)) await putMeta(tx, key, value)
  }
}

export async function insertUploads(tx: Tx, rows: StoredUpload[]) {
  if (!rows.length) return
  await tx.upload.createMany({
    data: rows.map((f) => ({ id: f.id, name: f.name, mime: f.mime, relPath: f.relPath, bytes: f.bytes, uploadedBy: f.uploadedBy, createdAt: f.createdAt })),
  })
}

export async function wipeDb(tx: Tx) {
  await tx.audit.deleteMany()
  await tx.payable.deleteMany()
  await tx.order.deleteMany()
  await tx.recycle.deleteMany()
  await tx.account.deleteMany()
  await tx.renter.deleteMany()
  await tx.owner.deleteMany()
  await tx.user.deleteMany()
  await tx.upload.deleteMany()
  await tx.session.deleteMany()
  await tx.idempotencyRecord.deleteMany()
  await tx.meta.deleteMany()
}

async function cleanupFiles(rows: StoredUpload[]) {
  const fs = await import('fs')
  const { safeUploadPath } = await import('./uploads')
  await Promise.all(rows.map((r) => fs.promises.rm(safeUploadPath(r.relPath), { force: true }).catch(() => undefined)))
}

export async function readDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  return clone(await fn(await loadDb(prisma as unknown as Tx)))
}

export async function writeDb<T>(fn: (db: Db, files: DiskAttachmentStore) => T | Promise<T>): Promise<T> {
  const files = new DiskAttachmentStore()
  let committed = false
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(872211)`
      const db = await loadDb(tx)
      const before = clone(db)
      try {
        const out = await fn(db, files)
        await insertUploads(tx, files.pending)
        await saveDb(tx, db, before)
        return { out: clone(out) as T, error: null as ApiError | null }
      } catch (e) {
        if (e instanceof ApiError && e.persist) {
          await insertUploads(tx, files.pending)
          await saveDb(tx, db, before)
          return { out: undefined as T, error: e }
        }
        throw e
      }
    }, { timeout: 30000, maxWait: 8000 })
    committed = true
    if (result.error) throw result.error
    return result.out
  } catch (e) {
    if (!committed) await cleanupFiles(files.pending)
    throw e
  }
}
