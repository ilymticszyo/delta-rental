// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import * as XLSX from 'xlsx'
import { LocalApi } from '../src/api/local'
import { IMPORT_COLUMNS, parseImport, templateAoa, type ImportContext } from '../src/domain/importAccounts'
import { buildTemplateWorkbook, readSheet } from '../src/domain/importXlsx'

let api: LocalApi
const pw: Record<string, string> = { owner1: 'owner123', demo: 'demo123', cs: 'cs123', ops: 'ops123', admin: 'admin123' }
const as = (u: string) => api.login(u, pw[u])
beforeEach(async () => { localStorage.clear(); api = new LocalApi(localStorage); await as('ops') })

const header = () => templateAoa()[0]
const example = () => templateAoa()[1].slice()
const col = (h: string) => IMPORT_COLUMNS.findIndex((c) => c.header === h)
/** 以示例行为基础，按表头名覆盖若干单元格 */
const row = (over: Record<string, string | number> = {}) => { const r = example(); for (const [h, v] of Object.entries(over)) r[col(h)] = v; return r }
const ctx = async (): Promise<ImportContext> => api.importContext()

describe('模板', () => {
  it('每个账号字段一列（编号 / 大区 / 段位 / 资产 / 皮肤 / 来源 / 成本等），带一行示例；必填列带 *', () => {
    const [h, ex] = templateAoa()
    expect(h.length).toBe(IMPORT_COLUMNS.length)
    for (const name of ['账号编号*', '大区*', '段位*', '纯币(M)*', '总资产(M)*', '保险格*', '皮肤', '来源*', '成本(元)', '号主联系方式', 'AWM数量', '周期*', '纯币比例(1:N)*'])
      expect(h).toContain(name)
    expect(ex.length).toBe(h.length)
    expect(h.join()).not.toMatch(/截图/) // 截图不随表格导入
  })
  it('模板 .xlsx 含「账号导入」+「填写说明」两个工作表，示例行可直接通过校验', async () => {
    const { wb } = await buildTemplateWorkbook(await ctx())
    expect(wb.SheetNames).toEqual(['账号导入', '填写说明'])
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const aoa = await readSheet('t.xlsx', buf)
    expect(aoa[0]).toEqual(header())
    const r = parseImport(aoa, await ctx())
    expect(r.headerErrors).toEqual([])
    expect(r.valid).toBe(1)
    expect(r.rows[0].input).toMatchObject({ accountNo: 'DF20001', status: 'draft', source: 'consign', region: 'QQ区', safeBox: 6, skins: ['威龙·赤焰', '金色AWM'], remark: '', internalRemark: '示例行，导入前请删除' })
    const help = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['填写说明'], { header: 1 })
    expect(help.find((x) => x[0] === '大区')?.[2]).toContain('QQ区 / VX区')
  })
})

describe('解析', () => {
  it('CSV（含 BOM，中文）与 xlsx 解析结果一致；空行跳过；列顺序可调换，表头 * 与全角括号可省略', async () => {
    const lines = [header(), row({ 账号编号: 'CSV001' }), [], row({ 账号编号: 'CSV002', 来源: '自收', '成本(元)': 600, 号主联系方式: '' })]
    const csv = '\uFEFF' + lines.map((l) => l.map((c) => `"${String(c)}"`).join(',')).join('\n')
    const aoa = await readSheet('a.csv', new TextEncoder().encode(csv).buffer as ArrayBuffer)
    const r = parseImport(aoa, await ctx())
    expect(r.rows.map((x) => x.rowNo)).toEqual([2, 4])
    expect(r.valid).toBe(2)
    expect(r.rows[1].input).toMatchObject({ source: 'buyin', costAmount: 600, ownerContact: '自有', coinAmount: 300 })
    // 调换列顺序 + 去掉 * + 全角括号
    const idx = header().map((_, i) => i).reverse()
    const h2 = idx.map((i) => String(header()[i]).replace('*', '').replace('(', '（').replace(')', '）'))
    const r2 = parseImport([h2, idx.map((i) => row({ 账号编号: 'REV01' })[i])], await ctx())
    expect(r2.valid).toBe(1)
  })
  it('非 xlsx / csv 文件被拒', async () => {
    await expect(readSheet('a.txt', new ArrayBuffer(0))).rejects.toThrow('仅支持')
  })
  it('缺少必填列时整份文件报错', async () => {
    const h = header().filter((x) => x !== '大区*')
    const r = parseImport([h, example().slice(0, h.length)], await ctx())
    expect(r.headerErrors).toContain('缺少列「大区」')
    expect(r.rows).toEqual([])
  })
  it('只有表头没有数据行', async () => {
    expect(parseImport([header()], await ctx()).headerErrors).toContain('没有可导入的数据行')
  })
})

describe('逐行校验：每类错误都带行号与原因', () => {
  const errs = async (over: Record<string, string | number>) => parseImport([header(), row(over)], await ctx()).rows[0]
  it('必填缺失', async () => {
    const r = await errs({ 账号编号: '', 大区: '', '纯币(M)': '' })
    expect(r.rowNo).toBe(2)
    expect(r.errors).toEqual(expect.arrayContaining(['「账号编号」必填', '「大区」必填', '「纯币(M)」必填']))
    expect(r.input).toBeUndefined()
  })
  it('条件必填：寄租缺号主联系方式；自收缺成本', async () => {
    expect((await errs({ 号主联系方式: '' })).errors).toContain('「号主联系方式」必填')
    expect((await errs({ 来源: '自收', '成本(元)': '' })).errors).toContain('「成本(元)」必填')
    expect((await errs({ 来源: '自收', 号主联系方式: '' })).errors).toEqual([])
  })
  it('格式错误：数字 / 整数 / 是否 / 枚举 / 皮肤 / 编号 / 跨字段', async () => {
    expect((await errs({ '纯币(M)': 'abc' })).errors[0]).toMatch(/「纯币\(M\)」应为非负数字，实际为「abc」/)
    expect((await errs({ AWM数量: 1.5 })).errors[0]).toMatch(/「AWM数量」应为整数/)
    expect((await errs({ 封禁记录: '也许' })).errors[0]).toMatch(/「封禁记录」应为 是 \/ 否/)
    expect((await errs({ 大区: '微信区' })).errors[0]).toMatch(/「大区」不在可选值中（QQ区 \/ VX区），实际为「微信区」/)
    expect((await errs({ 保险格: 5 })).errors[0]).toMatch(/「保险格」不在可选值中/)
    expect((await errs({ 来源: '代售' })).errors[0]).toMatch(/「来源」应为 号主寄租 \/ 自收/)
    expect((await errs({ 皮肤: '威龙·赤焰,不存在的皮' })).errors[0]).toBe('「皮肤」未在字典中：不存在的皮')
    expect((await errs({ 账号编号: 'DF 01!' })).errors[0]).toMatch(/「账号编号」格式错误/)
    expect((await errs({ '总资产(M)': 100, '纯币(M)': 300 })).errors).toContain('「总资产(M)」不能小于「纯币(M)」')
    expect((await errs({ '纯币(M)': 0, '总资产(M)': 0 })).errors).toContain('「纯币(M)」需大于 0')
    expect((await errs({ 折扣方式: '自定义' })).errors).toContain('折扣方式为自定义时「自定义折扣(%)」必填')
    expect((await errs({ 折扣方式: '自定义', '自定义折扣(%)': 120 })).errors).toContain('「自定义折扣(%)」应在 1-100')
    expect((await errs({ 等级: 300 })).errors).toContain('「等级」应在 1-200')
  })
  it('合法值宽松识别：是/否、y/n、大小写、数字字符串、千分位', async () => {
    const r = await errs({ 封禁记录: 'Y', 大区: 'qq区', '纯币(M)': '1,200', '总资产(M)': '1500', 保险格: '9' })
    expect(r.errors).toEqual([])
    expect(r.input).toMatchObject({ banRecord: true, region: 'QQ区', coinAmount: 1200, totalAssets: 1500, safeBox: 9 })
  })
})

describe('编号重复', () => {
  it('文件内重复：后出现的行报错并指出首次出现的行号（大小写不敏感）', async () => {
    const r = parseImport([header(), row({ 账号编号: 'X001' }), row({ 账号编号: 'Y001' }), row({ 账号编号: 'x001' })], await ctx())
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[2].errors).toEqual(['账号编号「x001」与本文件第 2 行重复'])
    expect([r.valid, r.invalid]).toEqual([2, 1])
  })
  it('与库存已有编号重复（含已逻辑删除的编号）', async () => {
    const accs = await api.listAccounts()
    const existing = accs[0].accountNo
    const del = accs.find((a) => a.status === 'listed')!
    await api.deleteAccount(del.id)
    expect((await api.listAccounts()).some((a) => a.id === del.id)).toBe(false)
    const r = parseImport([header(), row({ 账号编号: existing.toLowerCase() }), row({ 账号编号: del.accountNo })], await ctx())
    expect(r.rows[0].errors).toEqual([`账号编号「${existing.toLowerCase()}」与库存已有账号重复`])
    expect(r.rows[1].errors).toEqual([`账号编号「${del.accountNo}」与库存已有账号重复`])
  })
  it('xlsx 中间有空行、首行之前的区域偏移时，行号仍与 Excel 一致', async () => {
    const ws = XLSX.utils.aoa_to_sheet([header(), row({ 账号编号: 'R2' }), [], [], row({ 账号编号: 'R5', 大区: '' })])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 's')
    const aoa = await readSheet('b.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const r = parseImport(aoa, await ctx())
    expect(r.rows.map((x) => [x.rowNo, x.errors.length])).toEqual([[2, 0], [5, 1]])
  })
})

describe('导入接口', () => {
  const file = () => [header(), row({ 账号编号: 'IMP001' }), row({ 账号编号: 'IMP002', 来源: '自收', '成本(元)': 800, 号主联系方式: '' }), row({ 账号编号: 'IMP001' }), row({ 大区: '火星区', 账号编号: 'IMP003' })]
  it('权限：仅运营 / 管理员可导入；客服、成员、号主调用被拒（403）', async () => {
    for (const u of ['cs', 'demo', 'owner1']) {
      await as(u)
      await expect(api.importAccounts(file(), 'a.xlsx')).rejects.toMatchObject({ code: 403 })
      await expect(api.importContext()).rejects.toMatchObject({ code: 403 })
    }
    await as('admin')
    expect((await api.importAccounts(file(), 'a.xlsx')).imported).toEqual(['IMP001', 'IMP002'])
  })
  it('合法行一次性导入为「待确认」，非法行跳过并返回行号与原因；不进大厅，确认后才上架', async () => {
    const before = (await api.listAccounts()).length
    const out = await api.importAccounts(file(), '库存.xlsx')
    expect(out.imported).toEqual(['IMP001', 'IMP002'])
    expect(out.skipped.map((s) => s.rowNo)).toEqual([4, 5])
    expect(out.skipped[0].errors[0]).toMatch(/与本文件第 2 行重复/)
    expect(out.skipped[1].errors[0]).toMatch(/「大区」不在可选值中/)
    const accs = await api.listAccounts()
    expect(accs.length).toBe(before + 2)
    const imp = accs.filter((a) => a.accountNo.startsWith('IMP'))
    expect(imp.every((a) => a.status === 'draft' && a.attachments.length === 0 && a.quote.totalAmount > 0)).toBe(true)
    expect(imp.find((a) => a.accountNo === 'IMP002')).toMatchObject({ source: 'buyin', costAmount: 800 })
    expect(imp.find((a) => a.accountNo === 'IMP001')?.ownerId).toBeTruthy() // 寄租号自动关联号主档案
    expect((await api.listListedAccounts()).some((a) => a.accountNo.startsWith('IMP'))).toBe(false)
    await api.setAccountStatus(imp.find((a) => a.accountNo === 'IMP001')!.id, 'listed')
    expect((await api.listListedAccounts()).some((a) => a.accountNo === 'IMP001')).toBe(true)
  })
  it('写操作日志：文件名、导入数量与编号、跳过行号、操作人', async () => {
    await api.importAccounts(file(), '库存.xlsx')
    await as('admin')
    const log = (await api.auditLogs()).find((l) => l.action === '批量导入')!
    expect(log.actor).toBe('ops')
    expect(log.summary).toBe('库存.xlsx：导入 2 条（待确认）：IMP001、IMP002；跳过 2 条（第 4、5 行）')
  })
  it('服务端重新校验：再次导入同一文件全部判为与库存重复，不会重复入库', async () => {
    await api.importAccounts(file(), 'a.xlsx')
    const again = await api.importAccounts(file(), 'a.xlsx')
    expect(again.imported).toEqual([])
    expect(again.skipped[0].errors[0]).toMatch(/与库存已有账号重复/)
  })
  it('缺少必填列整份拒绝；超过 500 行拒绝', async () => {
    await expect(api.importAccounts([header().slice(1), example().slice(1)], 'a.xlsx')).rejects.toThrow('缺少列「账号编号」')
    await expect(api.importAccounts([header(), ...Array.from({ length: 501 }, () => example())], 'a.xlsx')).rejects.toThrow('单次最多导入 500 行')
  })
  it('导入占用的 DF 编号不会与后续自动编号冲突', async () => {
    const ctxNow = await api.importContext()
    const maxDf = Math.max(...ctxNow.existingNos.filter((n) => /^DF\d+$/.test(n)).map((n) => Number(n.slice(2))))
    await api.importAccounts([header(), row({ 账号编号: `DF${maxDf + 1}` }), row({ 账号编号: `DF${maxDf + 2}` })], 'a.xlsx')
    const a = (await api.listAccounts())[0]
    const { id, accountNo, quote, createdAt, updatedAt, cumulativeIncome, paybackPercent, ownerName, ...rest } = a as any
    const saved = await api.saveAccount({ ...rest, status: 'draft' })
    expect(saved.accountNo).toBe(`DF${maxDf + 3}`)
    const nos = (await api.listAccounts()).map((x) => x.accountNo)
    expect(new Set(nos).size).toBe(nos.length)
  })
})
