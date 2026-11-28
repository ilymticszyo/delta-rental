// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalApi } from '../src/api/local'

const DAY = 86400000

describe('订单完成与超期', () => {
  let now: number
  let api: LocalApi
  beforeEach(async () => {
    localStorage.clear()
    now = Date.parse('2026-06-01T00:00:00Z')
    api = new LocalApi(localStorage, () => now)
    await api.login('admin', 'admin123')
  })

  it('未交号或未还号时完成结算被拒绝，账号保持待结算', async () => {
    const acc = (await api.listAccounts()).find((a) => a.status === 'listed' && a.source === 'consign')!
    const order = await api.createOrder({ accountId: acc.id, renterContact: 'wx_gate', startAt: new Date(now).toISOString(), rentalDays: 2, deposit: 0, extraFee: 0, remark: '' })
    await api.endOrder(order.id)
    await expect(api.completeOrder(order.id, true)).rejects.toThrow(/还号/)
    expect((await api.listAccounts()).find((a) => a.id === acc.id)!.status).toBe('settling')
    await expect(api.markReturned(order.id)).rejects.toThrow(/交号/)
    await api.markHandover(order.id)
    await api.markReturned(order.id)
    const done = await api.completeOrder(order.id, false, '测试说明')
    expect(done.status).toBe('done')
    expect((await api.listAccounts()).find((a) => a.id === acc.id)!.status).toBe('off')
  })

  it('过了租期仍未处理的订单自动转入待结算，不上架', async () => {
    const acc = (await api.listAccounts()).find((a) => a.status === 'listed' && a.source === 'buyin')!
    const order = await api.createOrder({ accountId: acc.id, renterContact: 'wx_late', startAt: new Date(now).toISOString(), rentalDays: 1, deposit: 0, extraFee: 0, remark: '' })
    now += 2 * DAY
    const view = (await api.listOrders()).find((o) => o.id === order.id)!
    expect(view.status).toBe('settling')
    expect(view.returned).toBe(false)
    expect(view.reminder).toBe('overdue')
    expect(view.events[view.events.length - 1]?.operator).toBe('system')
    expect((await api.listAccounts()).find((a) => a.id === acc.id)!.status).toBe('settling')
    expect((await api.listListedAccounts()).some((a) => a.id === acc.id)).toBe(false)
    await expect(api.completeOrder(order.id, true)).rejects.toThrow(/不能把账号放回上架/)
    const again = (await api.listOrders()).find((o) => o.id === order.id)!
    expect(again.events.filter((e) => e.operator === 'system')).toHaveLength(1)
  })
})
