// 领域类型：前后端共享的数据结构（后端接入时可直接复用）
export type AccountStatus = 'draft' | 'listed' | 'rented' | 'settling' | 'off' | 'held'
export type AccountSource = 'manual' | 'pricing' | 'recycle'
export type DiscountMode = 'system' | 'custom'

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  draft: '草稿',
  listed: '空闲可租',
  rented: '租赁中',
  settling: '待结算',
  off: '已下架',
  held: '已回收持有',
}

/** 出租计价入参 */
export interface PricingInput {
  coinAmount: number // 纯币 M
  totalAssets: number // 总资产 M
  coinRatio: number // 纯币比例 W/元 (1:N)
  channel: string
  discountMode: DiscountMode
  customDiscountPercent?: number
  cycle: string
  deposit: number
}

export interface PricingResult {
  ruleVersion: number
  usedRatio: number
  tierHit: string | null
  discountPercent: number
  originalCoinRent: number
  coinRent: number
  serviceFeeRate: number // 百分比
  serviceFee: number
  ownerSettlement: number
  extraFee: number
  renterRent: number
  deposit: number
  totalAmount: number
  rentalDays: number
}

export interface Account {
  id: string
  accountNo: string
  status: AccountStatus
  source: AccountSource
  ownerContact: string
  region: string
  loginMethod: string
  channel: string
  assistTime: string // 辅助上号时段，如 09:00-23:00
  banRecord: boolean
  totalAssets: number
  coinAmount: number
  secretKd: number
  level: number
  rank: string
  safeBox: number
  stamina: string
  load: string
  awmCount: number
  helmet6Count: number
  armor6Count: number
  experienceCardCount: number
  skins: string[]
  cycle: string
  coinRatio: number
  discountMode: DiscountMode
  customDiscountPercent?: number
  deposit: number
  remark: string
  quote: PricingResult // 按保存时规则生成的报价快照
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export type AccountInput = Omit<Account, 'id' | 'accountNo' | 'quote' | 'createdAt' | 'updatedAt' | 'deleted'> & { id?: string }

export interface ValuationInput {
  contact: string
  region: string
  loginMethod: string
  coinAmount: number
  totalAssets: number
  level: number
  rank: string
  safeBox: number
  skins: string[]
  banRecord: boolean
  awmCount: number
  helmet6Count: number
  armor6Count: number
  experienceCardCount: number
  remark?: string
}

export interface ValuationLine { label: string; value: number }
export interface ValuationResult {
  ruleVersion: number
  rejected: boolean // 有封禁且规则为仅转人工
  coinValue: number
  skinValue: number
  extraValue: number
  banFactor: number
  buyDiscount: number
  center: number
  min: number
  max: number
  lines: ValuationLine[]
}

export type RecycleStatus = 'submitted' | 'following' | 'quoted' | 'deal' | 'rejected' | 'cancelled'
export const RECYCLE_STATUS_LABEL: Record<RecycleStatus, string> = {
  submitted: '已提交',
  following: '跟进中',
  quoted: '已报价',
  deal: '已成交',
  rejected: '已拒绝',
  cancelled: '已取消',
}
export const RECYCLE_TRANSITIONS: Record<RecycleStatus, RecycleStatus[]> = {
  submitted: ['following', 'cancelled'],
  following: ['quoted', 'rejected', 'cancelled'],
  quoted: ['quoted', 'deal', 'rejected'],
  deal: [],
  rejected: [],
  cancelled: [],
}

export interface RecycleEvent {
  at: string
  operator: string
  fromStatus: RecycleStatus | null
  toStatus: RecycleStatus
  price?: number
  note: string
}

export interface RecycleRequest {
  id: string
  requestNo: string
  submitter: string
  contact: string
  asset: ValuationInput
  result: ValuationResult // 提交时的估值快照（含规则版本）
  staffPrice?: number
  status: RecycleStatus
  relatedAccountId?: string
  events: RecycleEvent[]
  createdAt: string
}

export type OrderStatus = 'active' | 'settling' | 'done' | 'cancelled'
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  active: '租赁中',
  settling: '待结算',
  done: '已完成',
  cancelled: '已取消',
}

export interface DepositEntry {
  type: 'collect' | 'deduct' | 'refund'
  amount: number
  reason: string
  at: string
  operator: string
}

export interface RentalOrder {
  id: string
  orderNo: string
  accountId: string
  accountNo: string
  renterContact: string
  startAt: string
  endAt: string
  rentalDays: number
  coinRent: number
  extraFee: number
  deposit: number
  totalAmount: number
  status: OrderStatus
  remark: string
  deposits: DepositEntry[]
  createdBy: string
  createdAt: string
}

export interface OrderInput {
  accountId: string
  renterContact: string
  startAt: string
  rentalDays: number
  deposit: number
  extraFee: number
  remark: string
}

export type Role = 'member' | 'cs' | 'ops' | 'admin'
export interface User { username: string; displayName: string; role: Role }

export interface CsAgent { id: string; name: string; wechat: string; isFallback: boolean; schedule: { weekdays: number[]; start: string; end: string }[] }

export interface DashboardStats {
  listed: number
  rented: number
  settling: number
  held: number
  todayOrders: number
  weekOrders: number
  pendingRecycles: number
  depositBalance: number
  revenueTotal: number
  revenueMonth: number
}
