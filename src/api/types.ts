// API 抽象层：页面只依赖这个接口。当前实现为 localStorage（src/api/local.ts），
// 接后端时新增一个 http 实现（/app-api、/admin-api），在 src/api/index.ts 切换即可。
import type { PricingRule, ValuationRule } from '../config/rules'
import type {
  Account, AccountInput, AccountStatus, CsAgent, DashboardStats, OrderInput, PricingInput, PricingResult,
  RecycleRequest, RecycleStatus, RentalOrder, User, ValuationInput, ValuationResult, DepositEntry,
} from '../domain/types'

export interface AuditLog { at: string; actor: string; action: string; summary: string }

export interface Api {
  // 认证
  login(username: string, password: string): Promise<User>
  logout(): Promise<void>
  currentUser(): User | null

  // 前台
  listListedAccounts(): Promise<Account[]>
  getAccount(id: string): Promise<Account | undefined>
  calcPricing(input: PricingInput): Promise<PricingResult>
  calcValuation(input: ValuationInput): Promise<ValuationResult>
  submitRecycle(input: ValuationInput): Promise<RecycleRequest>
  myRecycles(): Promise<RecycleRequest[]>
  currentCsAgent(now?: Date): Promise<CsAgent | null>

  // 后台：库存
  listAccounts(): Promise<Account[]>
  saveAccount(input: AccountInput): Promise<Account>
  deleteAccount(id: string): Promise<void>
  setAccountStatus(id: string, status: AccountStatus): Promise<Account>

  // 后台：订单
  listOrders(): Promise<RentalOrder[]>
  createOrder(input: OrderInput): Promise<RentalOrder>
  endOrder(id: string): Promise<RentalOrder> // 到期 / 提前结束 -> 待结算
  addDepositEntry(id: string, entry: Omit<DepositEntry, 'at' | 'operator'>): Promise<RentalOrder>
  completeOrder(id: string, relist: boolean, note?: string): Promise<RentalOrder>
  cancelOrder(id: string): Promise<RentalOrder>

  // 后台：回收
  listRecycles(): Promise<RecycleRequest[]>
  updateRecycle(id: string, toStatus: RecycleStatus, note: string, staffPrice?: number): Promise<RecycleRequest>
  recycleToInventory(id: string): Promise<Account>

  // 后台：规则
  getPricingRule(): Promise<PricingRule>
  savePricingRule(rule: PricingRule): Promise<PricingRule>
  getValuationRule(): Promise<ValuationRule>
  saveValuationRule(rule: ValuationRule): Promise<ValuationRule>
  listCsAgents(): Promise<CsAgent[]>

  // 看板与日志
  dashboard(now?: Date): Promise<DashboardStats>
  auditLogs(): Promise<AuditLog[]>
  resetDemo(): Promise<void>
}
