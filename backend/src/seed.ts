import bcrypt from 'bcryptjs'
import { config } from './config'
import { buildSeedDb } from './domain/seedData'
import { prisma, saveDb, wipeDb } from './persistence'
import { removeUploadFiles } from './uploads'

/** 空库写入演示数据；--force / reset 时整库重建。管理员账号密码来自环境变量。 */
export async function seed(opts?: { force?: boolean }) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(872211)`
    const existing = await tx.meta.findUnique({ where: { key: 'seedVersion' } })
    if (existing && !opts?.force) return { seeded: false }
    if (opts?.force) await wipeDb(tx)
    const db = buildSeedDb(Date.now())
    const admin = db.users.find((u) => u.username === 'admin')
    if (admin) {
      admin.username = config.adminUsername
      admin.password = config.adminPassword
    }
    for (const u of db.users) u.password = await bcrypt.hash(u.password, 10)
    await saveDb(tx, db)
    return { seeded: true }
  }, { timeout: 60000, maxWait: 10000 })
  if (opts?.force) await removeUploadFiles()
  return result
}
