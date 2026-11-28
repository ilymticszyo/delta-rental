// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { LocalApi } from '../src/api/local'
import { buildSeedDb } from '../src/mock/seed'
import { accountSearchText, normalizeAccountRemarks } from '../src/domain/visibility'

describe('备注可见性', () => {
  it('旧备注迁移为内部，成员大厅看不到也搜不到', async () => {
    const legacy = normalizeAccountRemarks({ remark: '成本800', internalRemark: undefined as unknown as string })
    expect(legacy).toEqual({ remark: '', internalRemark: '成本800' })

    localStorage.clear()
    const db = buildSeedDb(Date.parse('2026-06-01T00:00:00Z'))
    const acc = db.accounts.find((a) => a.status === 'listed')!
    acc.remark = '只有旧备注'
    delete (acc as { internalRemark?: string }).internalRemark
    localStorage.setItem('dr:v1:db', JSON.stringify(db))
    const api = new LocalApi(localStorage, () => Date.parse('2026-06-01T00:00:00Z'))
    await api.login('demo', 'demo123')
    const row = (await api.listListedAccounts()).find((a) => a.id === acc.id)!
    expect(row.remark).toBe('')
    expect('internalRemark' in row).toBe(false)
    expect(JSON.stringify(row)).not.toContain('只有旧备注')
    expect(accountSearchText('member', { ...acc, remark: '', internalRemark: '只有旧备注' })).not.toContain('只有旧备注')
    expect(accountSearchText('cs', { ...acc, remark: '', internalRemark: '只有旧备注' })).toContain('只有旧备注')
    await api.login('cs', 'cs123')
    const staff = (await api.listListedAccounts()).find((a) => a.id === acc.id)!
    expect(staff.internalRemark).toBe('只有旧备注')
    expect((await api.listAccounts()).find((a) => a.id === acc.id)!.internalRemark).toBe('只有旧备注')
  })

  it('号主提交的备注记在内部，对外为空', async () => {
    localStorage.clear()
    const api = new LocalApi(localStorage)
    await api.login('owner1', 'owner123')
    const draft = await api.ownerRecycleDraft((await api.ownerAccounts())[0].id)
    const view = await api.ownerSubmitListing({ asset: { ...draft, contact: draft.contact || 'wx_owner_wang' }, assistTime: '全天', remark: '号主私下说', attachments: [] })
    await api.login('ops', 'ops123')
    const saved = (await api.listAccounts()).find((a) => a.id === view.id)!
    expect(saved.remark).toBe('')
    expect(saved.internalRemark).toBe('号主私下说')
  })
})
