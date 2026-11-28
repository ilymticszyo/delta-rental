import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { templateAoa, parseImport } from '../src/domain/importAccounts'
import { buildSeedDb } from '../src/domain/seedData'
import type { Account, User } from '../src/domain/types'
import { accountSearchText, normalizeAccountRemarks } from '../src/domain/visibility'
import { Engine, toPublicUser } from '../src/engine'

const NOW = Date.parse('2026-11-27T04:00:00Z')

function setup() {
  const db = buildSeedDb(NOW)
  const eng = new Engine(() => NOW)
  const as = (username: string): User => toPublicUser(db.users.find((u) => u.username === username)!)
  return { db, eng, as }
}

describe('对外备注与内部备注', () => {
  it('没有 internalRemark 的旧数据收进内部备注，对外清空', () => {
    const a = { remark: '成本 800，别外传', internalRemark: undefined as unknown as string }
    normalizeAccountRemarks(a)
    assert.equal(a.remark, '')
    assert.equal(a.internalRemark, '成本 800，别外传')
    a.remark = '大厅可见'
    normalizeAccountRemarks(a)
    assert.equal(a.remark, '大厅可见')
    assert.equal(a.internalRemark, '成本 800，别外传')
  })
  it('成员、号主、访客看不到内部备注，搜索也匹配不到；员工可以', () => {
    const { db, eng, as } = setup()
    const acc = db.accounts.find((a) => a.status === 'listed')!
    acc.remark = '可续租'
    acc.internalRemark = '内部机密XYZ'
    for (const who of [null, as('demo'), as('owner1')] as const) {
      const view = eng.getAccount(db, who, acc.id)!
      assert.equal(view.remark, '可续租')
      assert.equal('internalRemark' in view, false)
      assert.equal(JSON.stringify(view).includes('内部机密XYZ'), false)
      assert.equal(accountSearchText(who && who.role, acc).includes('内部机密XYZ'), false)
      assert.equal(accountSearchText(who && who.role, acc).includes('可续租'), true)
    }
    const staff = eng.getAccount(db, as('cs'), acc.id)!
    assert.equal(staff.internalRemark, '内部机密XYZ')
    assert.equal(accountSearchText('cs', acc).includes('内部机密XYZ'), true)
    const adminList = eng.listAccounts(db, as('admin')).find((a) => a.id === acc.id)!
    assert.equal(adminList.internalRemark, '内部机密XYZ')
  })
  it('号主上架备注记为内部；导入的「备注」列也是内部', async () => {
    const { db, eng, as } = setup()
    const view = await eng.ownerSubmitListing(db, as('owner1'), { asset: { contact: 'wx_owner_wang', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6, skins: [], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 }, assistTime: '全天', remark: '号主私下说', attachments: [] })
    const saved = db.accounts.find((a) => a.id === view.id)!
    assert.equal(saved.remark, '')
    assert.equal(saved.internalRemark, '号主私下说')
    const [header, example] = templateAoa()
    const ctx = eng.importContext(db, as('ops'))
    const parsed = parseImport([header, example], ctx)
    assert.equal(parsed.rows[0].input?.remark, '')
    assert.equal(parsed.rows[0].input?.internalRemark, '示例行，导入前请删除')
  })
  it('保存时省略内部备注不会把已有内容清空', async () => {
    const { db, eng, as } = setup()
    const acc = db.accounts.find((a) => a.status === 'listed')! as Account
    acc.internalRemark = '留下'
    acc.remark = '对外'
    const { quote: _q, accountNo: _n, createdAt: _c, updatedAt: _u, deleted: _d, attachments: _a, ...input } = acc
    delete (input as { internalRemark?: string }).internalRemark
    const saved = await eng.saveAccount(db, as('ops'), { ...input, id: acc.id })
    assert.equal(saved.internalRemark, '留下')
    assert.equal(saved.remark, '对外')
  })
})
