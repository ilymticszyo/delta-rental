// C11 经营报表：由订单与库存汇总，不另建实体表（PRD 第 9 章）
import type { Account, RentalOrder } from './types'

export type ReportDimension = 'safeBox' | 'rank' | 'price' | 'channel'
export const DIMENSION_LABEL: Record<ReportDimension, string> = { safeBox: '保险格', rank: '段位', price: '价位', channel: '渠道' }
const DAY = 86400000

export interface ReportRow { key: string; accounts: number; orders: number; rentedDays: number; accountDays: number; utilization: number; gross: number; net: number }
export interface AccountReportRow { id: string; accountNo: string; source: Account['source']; orders: number; rentedDays: number; utilization: number; gross: number; net: number; dailyNet: number }
export interface PaybackRow { id: string; accountNo: string; cost: number; income: number; percent: number; daysHeld: number; estPaybackDays: number | null; paidBack: boolean }
export interface Report {
  from: string; to: string; days: number
  utilization: number; gross: number; net: number; dailyNetPerAccount: number; orderCount: number; accountCount: number
  groups: ReportRow[]; accounts: AccountReportRow[]; payback: PaybackRow[]
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
const r2 = (n: number) => Math.round(n * 100) / 100
export const platformIncome = (o: RentalOrder) => o.coinRent + o.extraFee - o.ownerPayable
export const grossRent = (o: RentalOrder) => o.coinRent + o.extraFee

export function priceBand(total: number) {
  if (total < 300) return '300 元以下'
  if (total < 800) return '300-800 元'
  if (total < 1500) return '800-1500 元'
  return '1500 元以上'
}
function dimKey(a: Account, d: ReportDimension) {
  if (d === 'safeBox') return `${a.safeBox} 格`
  if (d === 'rank') return a.rank
  if (d === 'channel') return a.channel
  return priceBand(a.quote.totalAmount)
}

export function buildReport(accounts: Account[], orders: RentalOrder[], fromMs: number, toMs: number, dimension: ReportDimension, nowMs = Date.now()): Report {
  const acc = accounts.filter((a) => !a.deleted && a.status !== 'draft')
  const valid = orders.filter((o) => o.status !== 'cancelled')
  const rows: AccountReportRow[] = []
  const groups = new Map<string, ReportRow>()
  let totalAccDays = 0, totalRented = 0, totalGross = 0, totalNet = 0, orderCount = 0
  for (const a of acc) {
    const accDays = overlap(new Date(a.createdAt).getTime(), toMs, fromMs, toMs) / DAY
    const os = valid.filter((o) => o.accountId === a.id)
    let rented = 0, gross = 0, net = 0, n = 0
    for (const o of os) {
      const s = new Date(o.startAt).getTime()
      const e = o.status === 'active' ? Math.min(new Date(o.endAt).getTime(), nowMs) : new Date(o.endAt).getTime()
      rented += overlap(s, e, fromMs, toMs) / DAY
      if (s >= fromMs && s < toMs) { gross += grossRent(o); net += platformIncome(o); n++ }
    }
    rented = Math.min(rented, accDays)
    rows.push({ id: a.id, accountNo: a.accountNo, source: a.source, orders: n, rentedDays: r2(rented), utilization: accDays ? r2((rented / accDays) * 100) : 0, gross, net, dailyNet: accDays ? r2(net / accDays) : 0 })
    const k = dimKey(a, dimension)
    const g = groups.get(k) ?? { key: k, accounts: 0, orders: 0, rentedDays: 0, accountDays: 0, utilization: 0, gross: 0, net: 0 }
    g.accounts++; g.orders += n; g.rentedDays += rented; g.accountDays += accDays; g.gross += gross; g.net += net
    groups.set(k, g)
    totalAccDays += accDays; totalRented += rented; totalGross += gross; totalNet += net; orderCount += n
  }
  const groupRows = [...groups.values()].map((g) => ({ ...g, rentedDays: r2(g.rentedDays), accountDays: r2(g.accountDays), utilization: g.accountDays ? r2((g.rentedDays / g.accountDays) * 100) : 0 }))
    .sort((a, b) => b.utilization - a.utilization)
  const payback: PaybackRow[] = acc.filter((a) => a.source === 'buyin' && a.costAmount > 0).map((a) => {
    const income = valid.filter((o) => o.accountId === a.id).reduce((s, o) => s + platformIncome(o), 0)
    const daysHeld = Math.max(1, Math.round((nowMs - new Date(a.createdAt).getTime()) / DAY))
    const daily = income / daysHeld
    return { id: a.id, accountNo: a.accountNo, cost: a.costAmount, income, percent: r2((income / a.costAmount) * 100), daysHeld, estPaybackDays: daily > 0 ? Math.ceil(a.costAmount / daily) : null, paidBack: income >= a.costAmount }
  })
  return {
    from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), days: r2((toMs - fromMs) / DAY),
    utilization: totalAccDays ? r2((totalRented / totalAccDays) * 100) : 0,
    gross: totalGross, net: totalNet, dailyNetPerAccount: totalAccDays ? r2(totalNet / totalAccDays) : 0,
    orderCount, accountCount: acc.length, groups: groupRows, accounts: rows.sort((a, b) => b.net - a.net), payback,
  }
}
