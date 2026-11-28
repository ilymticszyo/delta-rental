// 字段可见性：所有「按角色裁剪」集中在这里，API 返回前统一调用（PRD 第 10、11 章）。
import { can } from './permissions'
import type { Account, LobbyAccount, OwnerAccountView, OwnerStatus, PricingResult, RecycleRequest, RentalOrder, Role } from './types'

const RENTER_FACING: (keyof PricingResult)[] = ['ruleVersion', 'discountPercent', 'tierHit', 'originalCoinRent', 'coinRent', 'extraFee', 'renterRent', 'deposit', 'totalAmount', 'rentalDays', 'regularDiscountApplied', 'depositWaived']

/** 旧数据只有 remark：视为内部备注，对外清空（更安全）。已经拆分过的对象不动。 */
export function normalizeAccountRemarks<T extends { remark?: string; internalRemark?: string }>(a: T): T {
  if (typeof a.internalRemark !== 'string') {
    a.internalRemark = a.remark ?? ''
    a.remark = ''
  } else if (typeof a.remark !== 'string') a.remark = ''
  return a
}

/** 保存账号时：缺省的一边沿用原值（更新）或空串（新建），避免把未传字段写成 undefined。 */
export function settleRemarks(input: { remark?: string; internalRemark?: string }, prev?: { remark?: string; internalRemark?: string }) {
  return {
    remark: typeof input.remark === 'string' ? input.remark : (prev?.remark ?? ''),
    internalRemark: typeof input.internalRemark === 'string' ? input.internalRemark : (prev?.internalRemark ?? ''),
  }
}

/** 大厅搜索文本。内部备注只拼进能看库存的员工的搜索串。 */
export function accountSearchText(role: Role | null | undefined, a: Pick<Account, 'accountNo' | 'region' | 'rank' | 'channel' | 'remark' | 'skins'> & { internalRemark?: string }) {
  const pub = `${a.accountNo} ${a.region} ${a.rank} ${a.channel} ${a.remark ?? ''} ${(a.skins ?? []).join(' ')}`
  if (can(role, 'inventoryView')) return `${pub} ${a.internalRemark ?? ''}`
  return pub
}

/** 算价结果：员工全量；成员仅租客应付部分；号主只见到手金额 */
export function pricingFor(role: Role, res: PricingResult): Partial<PricingResult> {
  if (can(role, 'seeCommission')) return { ...res }
  if (role === 'owner') return { ruleVersion: res.ruleVersion, ownerSettlement: res.ownerSettlement }
  const out: Partial<PricingResult> = {}
  for (const k of RENTER_FACING) (out as any)[k] = res[k]
  return out
}

/** 大厅 / 详情中的账号：员工全量；成员去掉号主与成本；号主连报价也不返回 */
export function lobbyAccountFor(role: Role, a: Account): LobbyAccount {
  normalizeAccountRemarks(a)
  const { quote, ownerContact, ownerId, formerOwnerId, costAmount, internalRemark, ...rest } = a
  if (can(role, 'seeCommission')) return { ...rest, internalRemark, quote: { ...quote }, ownerContact, ownerId, costAmount }
  if (role === 'owner') {
    // 号主不看任何租价参数：押金、纯币比例、折扣方式也属于出租报价
    const { deposit, coinRatio, discountMode, customDiscountPercent, ...assetOnly } = rest
    void deposit; void coinRatio; void discountMode; void customDiscountPercent
    return { ...assetOnly, quote: null }
  }
  return { ...rest, quote: pricingFor(role, quote) }
}

export function ownerStatusOf(a: Account): OwnerStatus {
  if (a.source === 'buyin' && a.formerOwnerId) return '已回收'
  switch (a.status) {
    case 'listed': return '空闲'
    case 'rented':
    case 'settling': return '出租中'
    case 'draft': return '待确认'
    case 'held': return '已回收'
    default: return '已下架'
  }
}

/** 号主视图：白名单拼装，杜绝租客信息 / 租金 / 抽成外泄 */
export function toOwnerView(a: Account, activeOrder: RentalOrder | undefined, recycle: RecycleRequest | undefined, ownerName?: string): OwnerAccountView {
  const status = ownerStatusOf(a)
  return {
    id: a.id,
    accountNo: a.accountNo,
    ownerStatus: status,
    expireAt: status === '出租中' && activeOrder ? activeOrder.endAt : null,
    takeHome: status === '已回收' ? null : a.quote.ownerSettlement,
    recycle: recycle
      ? { requestNo: recycle.requestNo, status: recycle.status, min: recycle.result.min, max: recycle.result.max, rejected: recycle.result.rejected, staffPrice: recycle.staffPrice ?? null }
      : null,
    region: a.region,
    loginMethod: a.loginMethod,
    assistTime: a.assistTime,
    coinAmount: a.coinAmount,
    totalAssets: a.totalAssets,
    level: a.level,
    rank: a.rank,
    safeBox: a.safeBox,
    secretKd: a.secretKd,
    skins: [...a.skins],
    banRecord: a.banRecord,
    awmCount: a.awmCount,
    helmet6Count: a.helmet6Count,
    armor6Count: a.armor6Count,
    experienceCardCount: a.experienceCardCount,
    attachments: a.attachments.map((x) => ({ ...x })),
    ...(ownerName ? { ownerName } : {}),
    createdAt: a.createdAt,
  }
}

/** 号主看自己的回收单：去掉内部跟进人信息以外的字段照常返回（本就是其本人提交的资产与估值） */
export const FORBIDDEN_OWNER_KEYS = ['renterContact', 'renter', 'coinRent', 'serviceFee', 'serviceFeeRate', 'ownerPayable', 'commission', 'quote', 'renterRent', 'totalAmount', 'orderNo', 'deposit', 'extraFee', 'costAmount', 'internalRemark']
