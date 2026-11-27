// 演示数据（v0.2 / 种子版本 2）。固定随机种子，保证每次初始化一致。
import { defaultPricingRule, defaultValuationRule, dicts, type PricingRule, type RuleVersionMeta, type ValuationRule } from './rules'
import { calcPricing } from './pricing'
import { calcValuation } from './valuation'
import type {
  Account, AccountInput, CsAgent, OwnerPayableEntry, PricingInput, RecycleRequest, RecycleStatus, RentalOrder, RenterTag, Role, ValuationInput,
} from './types'

export const SEED_VERSION = 2

export interface DbUser { username: string; password: string; displayName: string; role: Role; enabled: boolean; ownerId?: string }
export interface DbOwner { id: string; contact: string; displayName: string; userId?: string }
export interface DbRenter { contact: string; displayName: string; tag: RenterTag | null; note: string }
export interface AuditLog { at: string; actor: string; action: string; summary: string }

export interface Db {
  seedVersion: number
  seq: { account: number; order: number; recycle: number; entry: number }
  users: DbUser[]
  owners: DbOwner[]
  renters: DbRenter[]
  accounts: Account[]
  orders: RentalOrder[]
  payables: OwnerPayableEntry[]
  recycles: RecycleRequest[]
  pricingRule: PricingRule
  valuationRule: ValuationRule
  pricingHistory: (RuleVersionMeta & { rule?: PricingRule })[]
  valuationHistory: (RuleVersionMeta & { rule: ValuationRule })[]
  csAgents: CsAgent[]
  audit: AuditLog[]
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
}

export const demoUsers: DbUser[] = [
  { username: 'owner1', password: 'owner123', displayName: '王老板（号主）', role: 'owner', enabled: true, ownerId: 'ow1' },
  { username: 'owner2', password: 'owner123', displayName: '李老板（号主）', role: 'owner', enabled: true, ownerId: 'ow2' },
  { username: 'demo', password: 'demo123', displayName: '演示成员', role: 'member', enabled: true },
  { username: 'cs', password: 'cs123', displayName: '客服小鹿', role: 'cs', enabled: true },
  { username: 'ops', password: 'ops123', displayName: '运营阿强', role: 'ops', enabled: true },
  { username: 'admin', password: 'admin123', displayName: '演示管理员', role: 'admin', enabled: true },
]

export const demoOwners: DbOwner[] = [
  { id: 'ow1', contact: 'wx_owner_wang', displayName: '王老板', userId: 'owner1' },
  { id: 'ow2', contact: 'wx_owner_li', displayName: '李老板', userId: 'owner2' },
  { id: 'ow3', contact: 'wx_owner_zhang', displayName: '张老板' },
  { id: 'ow4', contact: 'wx_owner_zhao', displayName: '赵老板' },
  { id: 'ow5', contact: 'wx_owner_chen', displayName: '陈老板' },
]

export const demoRenters: DbRenter[] = [
  { contact: 'wx_vip_laoliu', displayName: '老刘', tag: 'regular', note: '长期租客，结算爽快' },
  { contact: 'wx_care_xiaozhou', displayName: '小周', tag: 'caution', note: '曾超时还号' },
  { contact: 'wx_black_ahu', displayName: '阿虎', tag: 'blacklist', note: '恶意消耗物资，拒租' },
]

export const demoCsAgents: CsAgent[] = [
  { id: 'cs1', name: '客服小鹿', wechat: 'df_kefu_xiaolu', isFallback: false, schedule: [{ weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }] },
  { id: 'cs2', name: '客服阿杰', wechat: 'df_kefu_ajie', isFallback: false, schedule: [{ weekdays: [1, 2, 3, 4, 5], start: '18:00', end: '24:00' }, { weekdays: [0, 6], start: '10:00', end: '24:00' }] },
  { id: 'cs3', name: '值班客服（备用）', wechat: 'df_kefu_backup', isFallback: true, schedule: [] },
]

const remarks = ['', '', '号主在线快，秒上号', '仅限周末', '可续租', '新号，资产干净', '支持长租优惠', '']
const BUYIN = new Set([3, 8, 12, 18])

export function toPricingInput(a: AccountInput, renterRegular = false): PricingInput {
  return {
    coinAmount: a.coinAmount, totalAssets: a.totalAssets, coinRatio: a.coinRatio, channel: a.channel,
    discountMode: a.discountMode, customDiscountPercent: a.customDiscountPercent, cycle: a.cycle, deposit: a.deposit, renterRegular,
  }
}

export function seedAccounts(): AccountInput[] {
  const rand = rng(20261127)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
  const out: AccountInput[] = []
  for (let i = 0; i < 20; i++) {
    const coin = Math.round(60 + rand() * 640)
    const total = Math.round(coin * (1.3 + rand() * 1.2))
    const skinCount = Math.floor(rand() * 6)
    const skins = [...new Set(Array.from({ length: skinCount }, () => pick(dicts.skins).name))]
    const custom = rand() < 0.2
    const buyin = BUYIN.has(i)
    const owner = i === 19 ? demoOwners[0] : demoOwners[i % demoOwners.length]
    out.push({
      status: i < 15 ? 'listed' : i < 17 ? 'rented' : i < 18 ? 'off' : i < 19 ? 'held' : 'draft',
      source: buyin ? 'buyin' : 'consign',
      ownerId: buyin ? undefined : owner.id,
      ownerContact: buyin ? '自有' : owner.contact,
      costAmount: 0,
      region: pick(dicts.regions),
      loginMethod: pick(dicts.loginMethods),
      channel: rand() < 0.7 ? '普通区' : '平台专区',
      assistTime: pick(['09:00-23:00', '全天', '12:00-02:00', '18:00-24:00']),
      banRecord: rand() < 0.1,
      totalAssets: total,
      coinAmount: coin,
      secretKd: Math.round((0.6 + rand() * 3) * 100) / 100,
      level: Math.floor(20 + rand() * 60),
      rank: pick(dicts.ranks),
      safeBox: pick(dicts.safeBoxes),
      stamina: pick(dicts.stamina),
      load: pick(dicts.loads),
      awmCount: Math.floor(rand() * 30),
      helmet6Count: Math.floor(rand() * 20),
      armor6Count: Math.floor(rand() * 20),
      experienceCardCount: Math.floor(rand() * 4),
      skins,
      cycle: pick(dicts.cycles),
      coinRatio: pick([18, 19, 20, 21, 22]),
      discountMode: custom ? 'custom' : 'system',
      customDiscountPercent: custom ? pick([85, 88, 90, 95]) : undefined,
      deposit: pick([0, 0, 100, 200, 300]),
      remark: pick(remarks),
    })
    if (buyin) { out[i].costAmount = Math.round(400 + rand() * 1200) }
  }
  return out
}

export function buildSeedDb(nowMs = Date.now()): Db {
  const rand = rng(1127)
  const iso = (ms: number) => new Date(ms).toISOString()
  const DAY = 86400000
  const db: Db = {
    seedVersion: SEED_VERSION,
    seq: { account: 10000, order: 0, recycle: 0, entry: 0 },
    users: JSON.parse(JSON.stringify(demoUsers)),
    owners: JSON.parse(JSON.stringify(demoOwners)),
    renters: JSON.parse(JSON.stringify(demoRenters)),
    accounts: [], orders: [], payables: [], recycles: [],
    pricingRule: JSON.parse(JSON.stringify(defaultPricingRule)),
    valuationRule: JSON.parse(JSON.stringify(defaultValuationRule)),
    pricingHistory: [], valuationHistory: [],
    csAgents: JSON.parse(JSON.stringify(demoCsAgents)), audit: [],
  }
  const t0 = iso(nowMs - 40 * DAY)
  db.pricingHistory.push({ version: 1, savedAt: t0, savedBy: 'system', summary: '初始规则（PRD 示例值）', rule: JSON.parse(JSON.stringify(db.pricingRule)) })
  db.valuationHistory.push({ version: 1, savedAt: t0, savedBy: 'system', summary: '初始估值依据（市场系数 1.00）', rule: JSON.parse(JSON.stringify(db.valuationRule)) })

  seedAccounts().forEach((input, i) => {
    const t = iso(nowMs - 40 * DAY + i * 3600000 * 20)
    db.seq.account++
    db.accounts.push({ ...input, attachments: [], id: `a${db.seq.account}`, accountNo: `DF${db.seq.account}`, quote: calcPricing(toPricingInput(input), db.pricingRule), createdAt: t, updatedAt: t })
  })

  const renterPool = ['wx_vip_laoliu', 'wx_care_xiaozhou', 'wx_renter_a', 'wx_renter_b', 'wx_renter_c', 'wx_renter_d', 'wx_renter_e']
  const mkOrder = (acc: Account, startMs: number, days: number, status: RentalOrder['status'], renter: string, ownerPaid: boolean) => {
    db.seq.order++
    const regular = renter === 'wx_vip_laoliu'
    const q = regular ? calcPricing(toPricingInput(acc, true), db.pricingRule) : acc.quote
    const startAt = iso(startMs)
    const endAt = iso(startMs + days * DAY)
    const op = 'cs'
    const o: RentalOrder = {
      id: `o${db.seq.order}`, orderNo: `ZD${String(db.seq.order).padStart(5, '0')}`, accountId: acc.id, accountNo: acc.accountNo,
      renterContact: renter, startAt, endAt, rentalDays: days, coinRent: q.coinRent, extraFee: q.extraFee, deposit: q.deposit,
      totalAmount: q.coinRent + q.extraFee + q.deposit, ownerPayable: acc.source === 'consign' ? q.ownerSettlement : 0, regularApplied: regular,
      handedOver: true, returned: status === 'done', status, remark: '演示数据', deposits: [], createdBy: op, createdAt: startAt,
      events: [{ step: 'register', note: `登记 ${days} 天`, at: startAt, operator: op }, { step: 'handover', note: '已交号', at: iso(startMs + 600000), operator: op }],
    }
    if (q.deposit) { o.deposits.push({ type: 'collect', amount: q.deposit, reason: '收取押金', at: startAt, operator: op }); o.events.push({ step: 'collect', note: `收押金 ${q.deposit}`, at: startAt, operator: op }) }
    if (o.ownerPayable) {
      db.seq.entry++
      db.payables.push({ id: `p${db.seq.entry}`, ownerId: acc.ownerId!, accountId: acc.id, accountNo: acc.accountNo, orderId: o.id, orderNo: o.orderNo, type: 'accrue', amount: o.ownerPayable, note: '订单登记计提', at: startAt, operator: op })
    }
    if (status === 'done') {
      o.events.push({ step: 'expire', note: '到期', at: endAt, operator: op }, { step: 'return', note: '已还号', at: endAt, operator: op })
      if (q.deposit) {
        const deduct = rand() < 0.25 ? Math.min(50, q.deposit) : 0
        if (deduct) { o.deposits.push({ type: 'deduct', amount: deduct, reason: 'AWM 消耗', at: endAt, operator: op }); o.events.push({ step: 'deduct', note: `扣押金 ${deduct}（AWM 消耗）`, at: endAt, operator: op }) }
        if (q.deposit - deduct > 0) { o.deposits.push({ type: 'refund', amount: q.deposit - deduct, reason: '到期退还', at: endAt, operator: op }); o.events.push({ step: 'refund', note: `退押金 ${q.deposit - deduct}`, at: endAt, operator: op }) }
      }
      if (o.ownerPayable && ownerPaid) {
        db.seq.entry++
        db.payables.push({ id: `p${db.seq.entry}`, ownerId: acc.ownerId!, accountId: acc.id, accountNo: acc.accountNo, orderId: o.id, orderNo: o.orderNo, type: 'pay', amount: o.ownerPayable, note: '微信转账', at: endAt, operator: op })
        o.events.push({ step: 'payOwner', note: `付号主 ${o.ownerPayable}`, at: endAt, operator: op })
      } else if (o.ownerPayable) o.remark = '号主款月结，待付'
      o.events.push({ step: 'settle', note: '结算完成', at: endAt, operator: op })
    }
    db.orders.push(o)
  }
  // 历史已完成订单：分布在近 30 天
  db.accounts.filter((a) => a.status === 'listed' || a.status === 'off').forEach((a, idx) => {
    const n = Math.floor(rand() * 4)
    let cursor = nowMs - 30 * DAY + Math.floor(rand() * 5) * DAY
    for (let k = 0; k < n; k++) {
      const days = 2 + Math.floor(rand() * 5)
      if (cursor + days * DAY > nowMs - DAY) break
      mkOrder(a, cursor, days, 'done', renterPool[Math.floor(rand() * renterPool.length)], !(idx % 4 === 0 && k === n - 1))
      cursor += (days + 1 + Math.floor(rand() * 3)) * DAY
    }
  })
  const rented = db.accounts.filter((a) => a.status === 'rented')
  mkOrder(rented[0], nowMs - 2 * DAY - 2 * 3600000, 3, 'active', 'wx_renter_a', false) // 22 小时后到期 → 提醒
  mkOrder(rented[1], nowMs - DAY, 5, 'active', 'wx_vip_laoliu', false)
  db.orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const samples: [ValuationInput, RecycleStatus, string, string?][] = [
    [{ contact: 'wx_seller01', region: 'QQ区', loginMethod: '扫码', coinAmount: 120, totalAssets: 200, level: 45, rank: '钻石', safeBox: 6, skins: ['威龙·赤焰', '龙牙战刀'], banRecord: false, awmCount: 5, helmet6Count: 3, armor6Count: 2, experienceCardCount: 0, remark: '想尽快出' }, 'submitted', 'demo'],
    [{ contact: 'wx_seller02', region: 'VX区', loginMethod: '账密', coinAmount: 300, totalAssets: 520, level: 60, rank: '黑鹰', safeBox: 9, skins: ['金色AWM', '典藏·雷霆', '蜂医·霓虹'], banRecord: false, awmCount: 12, helmet6Count: 8, armor6Count: 6, experienceCardCount: 1 }, 'following', 'demo'],
    [{ contact: 'wx_seller03', region: 'QQ区', loginMethod: '均可', coinAmount: 80, totalAssets: 110, level: 30, rank: '黄金', safeBox: 4, skins: [], banRecord: true, awmCount: 0, helmet6Count: 1, armor6Count: 0, experienceCardCount: 0 }, 'quoted', 'demo'],
    [{ contact: 'wx_owner_wang', region: 'VX区', loginMethod: '扫码', coinAmount: 220, totalAssets: 330, level: 52, rank: '铂金', safeBox: 6, skins: ['红狼·烈阳', '影锋匕首'], banRecord: false, awmCount: 8, helmet6Count: 4, armor6Count: 3, experienceCardCount: 1, remark: '先估个价，考虑寄租' }, 'following', 'owner1', 'ow1'],
  ]
  samples.forEach(([asset, status, submitter, ownerId], i) => {
    db.seq.recycle++
    const result = calcValuation(asset, db.valuationRule)
    const at = iso(nowMs - (4 - i) * 3600000 * 5)
    const req: RecycleRequest = {
      id: `r${db.seq.recycle}`, requestNo: `HS${String(db.seq.recycle).padStart(5, '0')}`, submitter, ownerId, contact: asset.contact,
      asset, result, status: 'submitted', createdAt: at,
      events: [{ at, operator: submitter, fromStatus: null, toStatus: 'submitted', note: '提交回收申请' }],
    }
    if (status !== 'submitted') req.events.push({ at, operator: 'cs', fromStatus: 'submitted', toStatus: 'following', note: '已加微信沟通' })
    if (status === 'quoted') { req.staffPrice = result.min; req.events.push({ at, operator: 'cs', fromStatus: 'following', toStatus: 'quoted', price: result.min, note: '有封禁记录，按下限报价' }) }
    req.status = status
    db.recycles.unshift(req)
  })
  return db
}
