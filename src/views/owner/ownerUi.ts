import type { OwnerStatus } from '../../domain/types'
export const ownerStatusType: Record<OwnerStatus, 'success' | 'warning' | 'info' | 'danger' | 'primary'> = {
  空闲: 'success', 出租中: 'warning', 待确认: 'info', 已下架: 'info', 已回收: 'primary',
}
