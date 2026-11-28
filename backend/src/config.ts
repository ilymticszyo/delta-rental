import fs from 'fs'
import path from 'path'
import { parseTrustProxy } from './trustProxy'

function flag(name: string, fallback: boolean) {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  enableDemoAccounts: flag('DEMO', flag('ENABLE_DEMO_ACCOUNTS', true)),
  enableDemoReset: flag('ENABLE_DEMO_RESET', true),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSlideMs: Number(process.env.SESSION_SLIDE_HOURS || 12) * 3600000,
  sessionAbsoluteMs: Number(process.env.SESSION_ABSOLUTE_DAYS || 7) * 86400000,
  /** 见 trustProxy.ts。非法值（true/all）在读取时就抛错。 */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  /** 超期订单自动转入待结算的间隔（毫秒）。0 表示不跑定时任务（打开订单/库存/看板时仍会扫）。 */
  orderSweepMs: Number(process.env.ORDER_SWEEP_MS ?? 60_000),
}

export function assertConfig() {
  if (!process.env.DATABASE_URL) throw new Error('缺少环境变量 DATABASE_URL')
  if (!Number.isFinite(config.port) || config.port <= 0) throw new Error('PORT 无效')
  if (config.nodeEnv === 'production' && config.jwtSecret.length < 16) {
    throw new Error('生产环境 JWT_SECRET 至少 16 位')
  }
  fs.mkdirSync(config.uploadDir, { recursive: true })
}
