// 领域类型：前后端共享的数据结构（后端接入时可直接复用）
export type AccountStatus = 'draft' | 'listed' | 'rented' | 'settling' | 'off' | 'held'
export type AccountSource = 'consign' | 'buyin'
export const ACCOUNT_SOURCE_LABEL: Record<AccountSource, string> = { consign: '号主寄租', buyin: '自收' }
export type DiscountMode = 'system' | 'custom'

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  draft: '草稿 / 待确认',
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
  renterContact?: string // 可选：填了且为熟客时自动带入熟客优惠
  renterRegular?: boolean // 由 API 按租客档案判定后传入计价函数
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
  regularDiscountApplied: boolean
  depositWaived: boolean
}

export interface Attachment { id: string; name: string; dataUrl: string; uploadedBy: string; at: string }

export interface Account {
  id: string
  accountNo: string
  status: AccountStatus
  source: AccountSource
  ownerId?: string // 号主档案 id（寄租号）
  formerOwnerId?: string // 号主转回收后，原号主
  ownerContact: string
  costAmount: number // 成本（自收号 = 回收成交价）
  attachments: Attachment[]
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

export type AccountInput = Omit<Account, 'id' | 'accountNo' | 'quote' | 'createdAt' | 'updatedAt' | 'deleted' | 'attachments'> & { id?: string; attachments?: Attachment[] }

/** 后台库存视图：附带累计收入与回本进度（由订单汇总） */
export interface AccountAdminView extends Account {
  cumulativeIncome: number
  paybackPercent: number | null // 仅自收且成本 > 0
  ownerName?: string
}

/** 前台大厅 / 详情视图：按角色裁剪字段 */
export type LobbyAccount = Omit<Account, 'quote' | 'ownerContact' | 'ownerId' | 'formerOwnerId' | 'costAmount' | 'deposit' | 'coinRatio' | 'discountMode'> & {
  deposit?: number
  coinRatio?: number
  discountMode?: Account['discountMode']
  quote: Partial<PricingResult> | null
  ownerContact?: string
  ownerId?: string
  costAmount?: number
}

export type OwnerStatus = '待确认' | '空闲' | '出租中' | '已下架' | '已回收'
/** 号主视图：白名单字段，永远不含租客信息、租金、服务费与抽成 */
export interface OwnerAccountView {
  id: string
  accountNo: string
  ownerStatus: OwnerStatus
  expireAt: string | null
  takeHome: number | null // 寄租到手（每租期）
  recycle: { requestNo: string; status: RecycleStatus; min: number; max: number; rejected: boolean; staffPrice: number | null } | null
  region: string
  loginMethod: string
  assistTime: string
  coinAmount: number
  totalAssets: number
  level: number
  rank: string
  safeBox: number
  secretKd: number
  skins: string[]
  banRecord: boolean
  awmCount: number
  helmet6Count: number
  armor6Count: number
  experienceCardCount: number
  attachments: Attachment[]
  ownerName?: string // 仅管理员查看全部时
  createdAt: string
}

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

export interface DealReference { id: string; title: string; assetSummary: string; coinAmount: number; safeBox: number; dealPrice: number; dealAt: string; enabled: boolean; sort: number }

export interface ValuationLine { label: string; value: number }
export interface ValuationResult {
  ruleVersion: number
  rejected: boolean // 有封禁且规则为仅转人工
  coinValue: number
  skinValue: number
  extraValue: number
  banFactor: number
  safeBoxFactor: number
  buyDiscount: number
  marketCoefficient: number
  references: DealReference[] // 近期同类成交参考（只供人工调价，不改写中枢）
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
  ownerId?: string
  sourceAccountId?: string // 号主从自己的账号转入
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

export type OrderStep = 'register' | 'handover' | 'expire' | 'return' | 'settle' | 'refund' | 'deduct' | 'collect' | 'extend' | 'cancel' | 'payOwner'
export const ORDER_STEP_LABEL: Record<OrderStep, string> = {
  register: '下单登记', handover: '交号', expire: '到期', return: '还号', settle: '结算完成', refund: '退押金',
  deduct: '押金扣除', collect: '收押金', extend: '改租期', cancel: '取消', payOwner: '付号主款',
}
export interface OrderEvent { step: OrderStep; note: string; at: string; operator: string }

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
  ownerPayable: number // 本单号主应付（自收号为 0）
  regularApplied: boolean
  handedOver: boolean
  returned: boolean
  status: OrderStatus
  remark: string
  deposits: DepositEntry[]
  events: OrderEvent[]
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

export type Role = 'owner' | 'member' | 'cs' | 'ops' | 'admin'
export const ROLE_LABEL: Record<Role, string> = { owner: '号主', member: '内部成员', cs: '客服', ops: '运营', admin: '管理员' }
export interface User { username: string; displayName: string; role: Role; ownerId?: string }
export interface StaffUser extends User { enabled: boolean }

export type RenterTag = 'regular' | 'caution' | 'blacklist'
export const RENTER_TAG_LABEL: Record<RenterTag, string> = { regular: '熟客', caution: '慎租', blacklist: '黑名单' }
export interface RenterProfile {
  contact: string
  displayName: string
  tag: RenterTag | null
  note: string
  rentalCount: number
  totalSpend: number
  depositDeductCount: number
  lastRentAt: string | null
}
export interface OwnerProfile {
  id: string
  contact: string
  displayName: string
  userId?: string
  consignedCount: number
  cumulativeSettlement: number // 已结
  accrued: number // 累计应付
  balance: number // 应付余额 = 应付 − 已结 − 冲销
}
export interface OwnerPayableEntry {
  id: string
  ownerId: string
  accountId: string
  accountNo: string
  orderId?: string
  orderNo?: string
  type: 'accrue' | 'pay' | 'reverse'
  amount: number
  note: string
  at: string
  operator: string
}

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
  expiringOrders: number
  ownerPayableBalance: number
  revenueTotal: number
  revenueMonth: number
}
