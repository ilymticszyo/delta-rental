import type { ImportContext } from '../domain/importAccounts'
// API 抽象层：页面只依赖这个接口。当前实现为 localStorage（src/api/local.ts），
// 接后端时新增一个 http 实现（同域 /api），在 src/api/index.ts 切换即可。
// 鉴权与字段裁剪在实现层完成（模拟后端），不只靠前端藏菜单。
import type { PricingRule, RuleVersionMeta, ValuationRule } from '../config/rules'
import type { Report, ReportDimension } from '../domain/reports'
import type {
  AccountAdminView, AccountInput, AccountStatus, Attachment, CsAgent, DashboardStats, DepositEntry, LobbyAccount, OrderInput, OwnerAccountView,
  OwnerPayableEntry, OwnerProfile, PricingInput, PricingResult, RecycleRequest, RecycleStatus, RenterProfile, RenterTag, RentalOrder,
  Role, StaffUser, User, ValuationInput, ValuationResult,
} from '../domain/types'
import type { AuditLog } from '../mock/seed'
export type { AuditLog }

export type OrderView = RentalOrder & { reminder: 'expiring' | 'overdue' | null; ownerPayableBalance: number }
export interface ImportOutcome { imported: string[]; skipped: { rowNo: number; accountNo: string; errors: string[] }[]; operator: string }

export interface OrderPreview {
  profile: RenterProfile | null
  blocked: boolean
  coinRent: number
  extraFee: number
  deposit: number
  ownerPayable: number
  rentalDays: number
  regularApplied: boolean
  depositWaived: boolean
}
export interface OwnerListingInput { asset: ValuationInput; assistTime: string; remark: string; attachments: Omit<Attachment, 'id' | 'uploadedBy' | 'at'>[]; fromRecycleId?: string }
export interface DemoAccount { username: string; password: string; role: Role; displayName: string }

export interface Api {
  // 认证
  login(username: string, password: string): Promise<User>
  logout(): Promise<void>
  currentUser(): User | null
  demoAccounts(): DemoAccount[]

  // 前台
  listListedAccounts(): Promise<LobbyAccount[]>
  getAccount(id: string): Promise<LobbyAccount | undefined>
  calcPricing(input: PricingInput): Promise<Partial<PricingResult>>
  calcValuation(input: ValuationInput): Promise<ValuationResult>
  submitRecycle(input: ValuationInput, opts?: { sourceAccountId?: string }): Promise<RecycleRequest>
  myRecycles(): Promise<RecycleRequest[]>
  currentCsAgent(now?: Date): Promise<CsAgent | null>
  listCsAgents(): Promise<CsAgent[]>

  // 号主门户（E1–E4）
  ownerAccounts(): Promise<OwnerAccountView[]>
  ownerAccount(id: string): Promise<OwnerAccountView>
  ownerEstimate(asset: ValuationInput): Promise<{ takeHome: number; ruleVersion: number }>
  ownerSubmitListing(input: OwnerListingInput): Promise<OwnerAccountView>
  ownerRecycleDraft(accountId: string): Promise<ValuationInput>

  // 后台：库存
  listAccounts(): Promise<AccountAdminView[]>
  saveAccount(input: AccountInput): Promise<AccountAdminView>
  /** 批量导入的校验上下文（字典 + 已有编号）；仅运营 / 管理员 */
  importContext(): Promise<ImportContext>
  /** 批量导入：服务端重新逐行校验，合法行以「待确认」入库，非法行跳过；记操作日志 */
  importAccounts(aoa: unknown[][], fileName: string): Promise<ImportOutcome>
  deleteAccount(id: string): Promise<void>
  setAccountStatus(id: string, status: AccountStatus): Promise<AccountAdminView>

  // 后台：订单与台账
  listOrders(): Promise<OrderView[]>
  previewOrder(accountId: string, renterContact: string): Promise<OrderPreview>
  createOrder(input: OrderInput): Promise<RentalOrder>
  markHandover(id: string, note?: string): Promise<RentalOrder>
  extendOrder(id: string, rentalDays: number, note?: string): Promise<RentalOrder>
  endOrder(id: string, note?: string): Promise<RentalOrder>
  markReturned(id: string, note?: string): Promise<RentalOrder>
  addDepositEntry(id: string, entry: Omit<DepositEntry, 'at' | 'operator'>): Promise<RentalOrder>
  payOwner(orderId: string, amount: number, note: string): Promise<RentalOrder>
  completeOrder(id: string, relist: boolean, note?: string): Promise<RentalOrder>
  cancelOrder(id: string, note?: string): Promise<RentalOrder>
  listPayables(ownerId?: string): Promise<OwnerPayableEntry[]>

  // 后台：客户档案（C12）
  renterProfiles(): Promise<RenterProfile[]>
  lookupRenter(contact: string): Promise<RenterProfile | null>
  saveRenter(input: { contact: string; displayName: string; tag: RenterTag | null; note: string }): Promise<RenterProfile>
  ownerProfiles(): Promise<OwnerProfile[]>

  // 后台：回收
  listRecycles(): Promise<RecycleRequest[]>
  updateRecycle(id: string, toStatus: RecycleStatus, note: string, staffPrice?: number): Promise<RecycleRequest>
  recycleToInventory(id: string): Promise<AccountAdminView>

  // 后台：规则（带版本）
  getPricingRule(): Promise<PricingRule>
  savePricingRule(rule: PricingRule, summary?: string): Promise<PricingRule>
  getValuationRule(): Promise<ValuationRule>
  saveValuationRule(rule: ValuationRule, summary?: string): Promise<ValuationRule>
  ruleHistory(): Promise<{ pricing: RuleVersionMeta[]; valuation: RuleVersionMeta[] }>
  trialPricing(input: PricingInput, rule: PricingRule): Promise<PricingResult>
  trialValuation(input: ValuationInput, rule: ValuationRule): Promise<ValuationResult>

  // 报表、看板、员工、日志
  report(fromMs: number, toMs: number, dimension: ReportDimension): Promise<Report>
  dashboard(now?: Date): Promise<DashboardStats>
  listUsers(): Promise<StaffUser[]>
  setUserEnabled(username: string, enabled: boolean): Promise<StaffUser>
  auditLogs(): Promise<AuditLog[]>
  resetDemo(): Promise<void>
}
