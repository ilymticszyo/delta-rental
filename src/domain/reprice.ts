// 改规则 → 库存重算（参考实现，后端同口径实现）。纯函数，不读写存储。
import type { PricingRule } from '../config/rules'
import { calcPricing } from './pricing'
import type { Account, AccountStatus, PricingInput, PricingResult } from './types'

/** 预览 / 确认里展示的“价格”：一个租期的报价明细（取自账号报价快照 PricingResult） */
export interface RepricePrice {
  coinRent: number // 折后租金
  renterRent: number // 租客应付 = 折后租金 + 附加服务费（不含押金）——delta 以它为准
  extraFee: number
  serviceFee: number
  ownerSettlement: number // 号主可得（自收号也照算，仅展示）
  deposit: number
  totalAmount: number // 应付 + 押金
  rentalDays: number
  discountPercent: number
}
export type RepriceSkipReason = 'RENTED' | 'SETTLING' | 'PRICING_ERROR'
export interface RepriceItem {
  accountId: string
  accountNo: string
  status: AccountStatus
  oldRuleVersion: number
  oldPrice: RepricePrice
  newPrice: RepricePrice
  delta: number // newPrice.renterRent − oldPrice.renterRent
  changed: boolean // 任一价格字段有变化
}
export interface RepriceSkip { accountId: string; accountNo: string; status: AccountStatus; reason: RepriceSkipReason; ruleVersion: number; message?: string }
export interface RepriceSummary { affectedCount: number; changedCount: number; skippedCount: number; totalDelta: number }
export interface PricingRulePreview { baseVersion: number; nextVersion: number; previewToken: string; affected: RepriceItem[]; skipped: RepriceSkip[]; summary: RepriceSummary }

const PRICE_KEYS: (keyof RepricePrice)[] = ['coinRent', 'renterRent', 'extraFee', 'serviceFee', 'ownerSettlement', 'deposit', 'totalAmount', 'rentalDays', 'discountPercent']
export const priceOf = (q: Partial<PricingResult>): RepricePrice => Object.fromEntries(PRICE_KEYS.map((k) => [k, Number(q[k] ?? 0)])) as unknown as RepricePrice

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}
/** 53 位 × 2 的非加密散列（mock / 假后端用；真实后端建议 HMAC-SHA256(服务端密钥, 同一指纹串)） */
function hash(s: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}
/** 指纹 = 基准版本 + 候选规则（去掉 version）+ 每个未删除账号的 (id, status, updatedAt, quote.ruleVersion)。任何一项变了，令牌就失效。 */
export function previewTokenOf(baseVersion: number, rule: PricingRule, accounts: Account[]) {
  const { version: _v, ...r } = rule
  const acc = accounts.filter((a) => !a.deleted).map((a) => [a.id, a.status, a.updatedAt, a.quote?.ruleVersion ?? null])
  return `pv1.${baseVersion}.${hash(stable({ baseVersion, rule: r, acc }))}`
}

/**
 * 计算重算计划：未删除、且不是 rented / settling 的账号（draft / listed / off / held）按候选规则重算报价快照（非熟客口径，与保存账号时相同）；
 * rented / settling 跳过（订单在途，报价与已登记订单都不动）；新规则下算不出价（周期 / 渠道被删、自定义折扣超出新范围）→ PRICING_ERROR 跳过，保留旧报价。
 */
export function planReprice(accounts: Account[], currentVersion: number, rule: PricingRule, toInput: (a: Account) => PricingInput) {
  const nextVersion = currentVersion + 1
  const candidate: PricingRule = { ...rule, version: nextVersion }
  const affected: RepriceItem[] = []
  const skipped: RepriceSkip[] = []
  const updates: { account: Account; quote: PricingResult }[] = []
  for (const a of accounts) {
    if (a.deleted) continue
    const base = { accountId: a.id, accountNo: a.accountNo, status: a.status }
    if (a.status === 'rented' || a.status === 'settling') { skipped.push({ ...base, reason: a.status === 'rented' ? 'RENTED' : 'SETTLING', ruleVersion: a.quote.ruleVersion }); continue }
    let q: PricingResult
    try { q = calcPricing(toInput(a), candidate) } catch (e) { skipped.push({ ...base, reason: 'PRICING_ERROR', ruleVersion: a.quote.ruleVersion, message: (e as Error).message }); continue }
    const oldPrice = priceOf(a.quote), newPrice = priceOf(q)
    affected.push({ ...base, oldRuleVersion: a.quote.ruleVersion, oldPrice, newPrice, delta: newPrice.renterRent - oldPrice.renterRent, changed: PRICE_KEYS.some((k) => oldPrice[k] !== newPrice[k]) })
    updates.push({ account: a, quote: q })
  }
  const preview: PricingRulePreview = {
    baseVersion: currentVersion, nextVersion, previewToken: previewTokenOf(currentVersion, rule, accounts), affected, skipped,
    summary: { affectedCount: affected.length, changedCount: affected.filter((x) => x.changed).length, skippedCount: skipped.length, totalDelta: affected.reduce((s, x) => s + x.delta, 0) },
  }
  return { preview, updates, candidate }
}
