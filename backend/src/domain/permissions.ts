import type { Role } from './types'

/** PRD 第 10 章：五档固定角色的能力表。API 与页面都按这里判断。 */
export type Cap =
  | 'front' // 前台大厅 / 算价 / 提交回收 / 客服二维码
  | 'ownerPortal' // 号主门户（仅本人）
  | 'ownerPortalAll' // 查看全部号主门户（管理员）
  | 'seeRent' // 大厅报价（租客应付部分）
  | 'seeCommission' // 服务费 / 号主可得 / 抽成 / 租客信息
  | 'adminArea' // 进入后台
  | 'dashboard'
  | 'orders' // 登记与处理出租订单、押金与号主应付台账
  | 'recycles' // 跟进回收单、改报价、成交入库
  | 'inventoryView' // 查看库存、成本与回本
  | 'inventoryEdit' // 库存增删改、上下架
  | 'rulesEdit' // 计价 / 估值依据 / 参考成交价
  | 'profiles' // 租客 / 号主档案与标签
  | 'reports' // 经营报表
  | 'csView' // 客服排班
  | 'staff' // 员工账号与角色
  | 'audit' // 操作日志

const STAFF: Cap[] = ['front', 'seeRent', 'seeCommission', 'adminArea', 'dashboard', 'orders', 'recycles', 'inventoryView', 'profiles', 'reports', 'csView']

export const ROLE_CAPS: Record<Role, Cap[]> = {
  owner: ['front', 'ownerPortal'],
  member: ['front', 'seeRent'],
  cs: [...STAFF],
  ops: [...STAFF, 'inventoryEdit', 'rulesEdit'],
  admin: [...STAFF, 'inventoryEdit', 'rulesEdit', 'ownerPortalAll', 'staff', 'audit'],
}

export const can = (role: Role | undefined | null, cap: Cap) => !!role && ROLE_CAPS[role].includes(cap)
