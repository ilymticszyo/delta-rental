// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalApi } from '../src/api/local'

let api: LocalApi
beforeEach(async () => {
  localStorage.clear()
  api = new LocalApi(localStorage)
  await api.login('admin', 'admin123')
})

describe('LocalApi 业务流转', () => {
  it('初始有约 20 个演示账号', async () => {
    expect((await api.listAccounts()).length).toBe(20)
  })
  it('错误密码被拒绝；未登录不能访问', async () => {
    await expect(api.login('admin', 'x')).rejects.toThrow('账号或密码错误')
    await api.logout()
    await expect(api.listListedAccounts()).rejects.toThrow('未登录')
  })
  it('会员不能访问后台接口', async () => {
    await api.login('demo', 'demo123')
    await expect(api.listAccounts()).rejects.toThrow('无权限')
  })
  it('登记订单锁定账号，重复下单被拒，取消后恢复', async () => {
    const listed = await api.listListedAccounts()
    const a = listed[0]
    const o = await api.createOrder({ accountId: a.id, renterContact: 'wx_r', startAt: new Date().toISOString(), rentalDays: 3, deposit: 0, extraFee: 0, remark: '' })
    expect(o.totalAmount).toBe(a.quote.coinRent)
    expect((await api.listListedAccounts()).find((x) => x.id === a.id)).toBeUndefined()
    await expect(api.createOrder({ accountId: a.id, renterContact: 'wx_r', startAt: new Date().toISOString(), rentalDays: 3, deposit: 0, extraFee: 0, remark: '' })).rejects.toThrow()
    await expect(api.deleteAccount(a.id)).rejects.toThrow('不能删除')
    await api.cancelOrder(o.id)
    expect((await api.getAccount(a.id))!.status).toBe('listed')
  })
  it('结算：押金余额不为 0 不能完成；退还后完成并再上架', async () => {
    const a = (await api.listListedAccounts())[0]
    const o = await api.createOrder({ accountId: a.id, renterContact: 'wx_r', startAt: new Date().toISOString(), rentalDays: 3, deposit: 200, extraFee: 0, remark: '' })
    await api.endOrder(o.id)
    expect((await api.getAccount(a.id))!.status).toBe('settling')
    await expect(api.completeOrder(o.id, true)).rejects.toThrow('押金余额')
    await api.addDepositEntry(o.id, { type: 'deduct', amount: 50, reason: 'AWM 消耗' })
    await api.addDepositEntry(o.id, { type: 'refund', amount: 150, reason: '退还' })
    const done = await api.completeOrder(o.id, true)
    expect(done.status).toBe('done')
    expect((await api.getAccount(a.id))!.status).toBe('listed')
  })
  it('回收：提交 -> 跟进 -> 报价 -> 人工确认后入库为已回收持有', async () => {
    const input = { contact: 'wx_s', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6, skins: [], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 }
    const r = await api.submitRecycle(input)
    expect(r.requestNo).toMatch(/^HS/)
    await expect(api.submitRecycle(input)).rejects.toThrow('重复')
    await expect(api.recycleToInventory(r.id)).rejects.toThrow()
    await api.updateRecycle(r.id, 'following', '接单')
    await api.updateRecycle(r.id, 'quoted', '确认报价', 330)
    const acc = await api.recycleToInventory(r.id)
    expect(acc.status).toBe('held')
    expect(acc.source).toBe('recycle')
  })
  it('改规则后新计算走新规则，版本号递增，历史回收单快照不变', async () => {
    const before = (await api.listRecycles())[0]
    const rule = await api.getValuationRule()
    const saved = await api.saveValuationRule({ ...rule, buyRatio: 50 })
    expect(saved.version).toBe(rule.version + 1)
    const after = (await api.listRecycles()).find((x) => x.id === before.id)!
    expect(after.result).toEqual(before.result)
  })
  it('非法状态流转被拒', async () => {
    const a = (await api.listListedAccounts())[0]
    await expect(api.setAccountStatus(a.id, 'rented')).rejects.toThrow()
    expect((await api.setAccountStatus(a.id, 'off')).status).toBe('off')
  })
  it('看板数字', async () => {
    const d = await api.dashboard()
    expect(d.listed).toBe(15)
    expect(d.rented).toBe(2)
    expect(d.pendingRecycles).toBe(3)
  })
})
