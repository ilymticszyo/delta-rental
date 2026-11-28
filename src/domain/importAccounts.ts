// 库存 Excel / CSV 批量导入：模板列定义 + 逐行校验（纯函数，前端预览与 API 层共用同一套校验）
import type { AccountInput } from './types'

export type CellType = 'text' | 'int' | 'num' | 'bool' | 'enum' | 'skins'
export interface ImportColumn {
  key: string
  header: string
  required: boolean | 'consign' | 'buyin' // consign / buyin = 仅该来源必填
  type: CellType
  example: string | number
  hint: string
  options?: (ctx: ImportContext) => string[]
}
export interface ImportContext {
  regions: string[]; loginMethods: string[]; channels: string[]; cycles: string[]; ranks: string[]
  safeBoxes: number[]; stamina: string[]; loads: string[]; skins: string[]
  existingNos: string[] // 已有库存编号（含逻辑删除，避免编号复用）
}
export interface ImportRowResult {
  rowNo: number // Excel 行号（表头为第 1 行）
  accountNo: string
  errors: string[]
  input?: AccountInput & { accountNo: string } // 仅校验通过时存在
}
export interface ImportParseResult { headerErrors: string[]; rows: ImportRowResult[]; valid: number; invalid: number }

const SOURCE: Record<string, 'consign' | 'buyin'> = { 号主寄租: 'consign', 寄租: 'consign', consign: 'consign', 自收: 'buyin', buyin: 'buyin' }
const BOOL: Record<string, boolean> = { 是: true, 有: true, y: true, yes: true, true: true, '1': true, 否: false, 无: false, n: false, no: false, false: false, '0': false }
const DISCOUNT: Record<string, 'system' | 'custom'> = { 系统推荐: 'system', system: 'system', 自定义: 'custom', custom: 'custom' }
export const ACCOUNT_NO_RE = /^[A-Za-z0-9_-]{2,20}$/

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'accountNo', header: '账号编号', required: true, type: 'text', example: 'DF20001', hint: '2-20 位字母 / 数字 / - _，不可与库存或本文件重复' },
  { key: 'source', header: '来源', required: true, type: 'enum', example: '号主寄租', hint: '号主寄租 / 自收', options: () => ['号主寄租', '自收'] },
  { key: 'ownerContact', header: '号主联系方式', required: 'consign', type: 'text', example: 'wx_owner_demo', hint: '号主寄租时必填' },
  { key: 'costAmount', header: '成本(元)', required: 'buyin', type: 'num', example: 0, hint: '自收时必填，≥0' },
  { key: 'region', header: '大区', required: true, type: 'enum', example: 'QQ区', hint: '', options: (c) => c.regions },
  { key: 'loginMethod', header: '上号方式', required: true, type: 'enum', example: '扫码', hint: '', options: (c) => c.loginMethods },
  { key: 'channel', header: '上架渠道', required: true, type: 'enum', example: '普通区', hint: '', options: (c) => c.channels },
  { key: 'assistTime', header: '辅助上号时段', required: false, type: 'text', example: '09:00-23:00', hint: '默认 全天' },
  { key: 'banRecord', header: '封禁记录', required: false, type: 'bool', example: '否', hint: '是 / 否，默认 否' },
  { key: 'coinAmount', header: '纯币(M)', required: true, type: 'num', example: 300, hint: '>0' },
  { key: 'totalAssets', header: '总资产(M)', required: true, type: 'num', example: 420, hint: '≥ 纯币' },
  { key: 'secretKd', header: '绝密KD', required: false, type: 'num', example: 1.5, hint: '默认 1' },
  { key: 'level', header: '等级', required: false, type: 'int', example: 45, hint: '1-200，默认 1' },
  { key: 'rank', header: '段位', required: true, type: 'enum', example: '钻石', hint: '', options: (c) => c.ranks },
  { key: 'safeBox', header: '保险格', required: true, type: 'enum', example: 6, hint: '', options: (c) => c.safeBoxes.map(String) },
  { key: 'stamina', header: '体力', required: false, type: 'enum', example: '5级', hint: '默认 1级', options: (c) => c.stamina },
  { key: 'load', header: '负重', required: false, type: 'enum', example: '5级', hint: '默认 1级', options: (c) => c.loads },
  { key: 'awmCount', header: 'AWM数量', required: false, type: 'int', example: 2, hint: '默认 0' },
  { key: 'helmet6Count', header: '6头数量', required: false, type: 'int', example: 1, hint: '默认 0' },
  { key: 'armor6Count', header: '6甲数量', required: false, type: 'int', example: 1, hint: '默认 0' },
  { key: 'experienceCardCount', header: '体验卡数量', required: false, type: 'int', example: 0, hint: '默认 0' },
  { key: 'skins', header: '皮肤', required: false, type: 'skins', example: '威龙·赤焰、金色AWM', hint: '多个用 、 , ; 分隔，须为字典中的皮肤' },
  { key: 'cycle', header: '周期', required: true, type: 'enum', example: '10M/天', hint: '', options: (c) => c.cycles },
  { key: 'coinRatio', header: '纯币比例(1:N)', required: true, type: 'num', example: 20, hint: '填 N，>0' },
  { key: 'discountMode', header: '折扣方式', required: false, type: 'enum', example: '系统推荐', hint: '系统推荐 / 自定义，默认 系统推荐', options: () => ['系统推荐', '自定义'] },
  { key: 'customDiscountPercent', header: '自定义折扣(%)', required: false, type: 'num', example: '', hint: '折扣方式为自定义时必填，1-100' },
  { key: 'deposit', header: '押金(元)', required: false, type: 'num', example: 0, hint: '默认 0' },
  { key: 'internalRemark', header: '备注', required: false, type: 'text', example: '示例行，导入前请删除', hint: '仅客服、运营、管理员可见，不会出现在大厅' },
  { key: 'remark', header: '对外备注', required: false, type: 'text', example: '', hint: '大厅和详情可见，可被搜索；留空则不对外展示' },
]

/** 模板：表头 + 填写说明行之外的一行示例（数组形式，便于 SheetJS aoa_to_sheet） */
export function templateAoa(): (string | number)[][] {
  return [IMPORT_COLUMNS.map((c) => c.header + (c.required === true ? '*' : '')), IMPORT_COLUMNS.map((c) => c.example)]
}
export function templateHelpAoa(ctx: ImportContext): string[][] {
  return [['列', '是否必填', '说明 / 可选值'], ...IMPORT_COLUMNS.map((c) => [c.header,
    c.required === true ? '必填' : c.required === 'consign' ? '号主寄租时必填' : c.required === 'buyin' ? '自收时必填' : '选填',
    [c.hint, c.options ? `可选：${c.options(ctx).join(' / ')}` : ''].filter(Boolean).join('；')])]
}

const normHeader = (h: unknown) => String(h ?? '').replace(/[*＊\s]/g, '').replace(/（/g, '(').replace(/）/g, ')')
const isBlank = (v: unknown) => v == null || String(v).trim() === ''
const str = (v: unknown) => (v == null ? '' : String(v).trim())

/** rows：二维数组，第 0 行为表头（来自 SheetJS sheet_to_json header:1 或 CSV） */
export function parseImport(aoa: unknown[][], ctx: ImportContext): ImportParseResult {
  const headerErrors: string[] = []
  const header = (aoa[0] ?? []).map(normHeader)
  const colIdx: Record<string, number> = {}
  for (const c of IMPORT_COLUMNS) {
    const i = header.indexOf(normHeader(c.header))
    if (i >= 0) colIdx[c.key] = i
    else if (c.required) headerErrors.push(`缺少列「${c.header}」`)
  }
  if (!aoa.length) headerErrors.push('文件为空')
  const rows: ImportRowResult[] = []
  if (headerErrors.length) return { headerErrors, rows, valid: 0, invalid: 0 }

  const existing = new Set(ctx.existingNos.map((n) => n.trim().toUpperCase()))
  const firstSeen = new Map<string, number>()
  for (let r = 1; r < aoa.length; r++) {
    const raw = aoa[r] ?? []
    const cell = (key: string) => (colIdx[key] == null ? undefined : raw[colIdx[key]])
    if (IMPORT_COLUMNS.every((c) => isBlank(cell(c.key)))) continue // 空行跳过
    const errors: string[] = []
    const out: Record<string, unknown> = {}
    const source = SOURCE[str(cell('source')).toLowerCase()] ?? SOURCE[str(cell('source'))]
    for (const c of IMPORT_COLUMNS) {
      const v = cell(c.key)
      const required = c.required === true || (c.required === 'consign' && source === 'consign') || (c.required === 'buyin' && source === 'buyin')
      if (isBlank(v)) { if (required) errors.push(`「${c.header}」必填`); continue }
      const s = str(v)
      switch (c.type) {
        case 'text': out[c.key] = s; break
        case 'int': case 'num': {
          const n = typeof v === 'number' ? v : Number(s.replace(/,/g, ''))
          if (!Number.isFinite(n) || n < 0) { errors.push(`「${c.header}」应为非负数字，实际为「${s}」`); break }
          if (c.type === 'int' && !Number.isInteger(n)) { errors.push(`「${c.header}」应为整数，实际为「${s}」`); break }
          out[c.key] = n; break
        }
        case 'bool': {
          const b = BOOL[s.toLowerCase()]
          if (b === undefined) errors.push(`「${c.header}」应为 是 / 否，实际为「${s}」`); else out[c.key] = b
          break
        }
        case 'enum': {
          const opts = c.options!(ctx)
          if (c.key === 'source') { if (!source) errors.push(`「来源」应为 号主寄租 / 自收，实际为「${s}」`); else out.source = source; break }
          if (c.key === 'discountMode') { const d = DISCOUNT[s.toLowerCase()] ?? DISCOUNT[s]; if (!d) errors.push(`「折扣方式」应为 系统推荐 / 自定义，实际为「${s}」`); else out.discountMode = d; break }
          const hit = opts.find((o) => o === s || o.toLowerCase() === s.toLowerCase())
          if (!hit) errors.push(`「${c.header}」不在可选值中（${opts.join(' / ')}），实际为「${s}」`)
          else out[c.key] = c.key === 'safeBox' ? Number(hit) : hit
          break
        }
        case 'skins': {
          const list = s.split(/[、,，;；\n]/).map((x) => x.trim()).filter(Boolean)
          const unknown = list.filter((x) => !ctx.skins.includes(x))
          if (unknown.length) errors.push(`「皮肤」未在字典中：${unknown.join('、')}`)
          else out.skins = [...new Set(list)]
          break
        }
      }
    }
    // 编号格式与重复
    const accountNo = str(cell('accountNo'))
    if (accountNo) {
      const key = accountNo.toUpperCase()
      if (!ACCOUNT_NO_RE.test(accountNo)) errors.push(`「账号编号」格式错误（2-20 位字母 / 数字 / - _），实际为「${accountNo}」`)
      else if (existing.has(key)) errors.push(`账号编号「${accountNo}」与库存已有账号重复`)
      else if (firstSeen.has(key)) errors.push(`账号编号「${accountNo}」与本文件第 ${firstSeen.get(key)} 行重复`)
      if (!firstSeen.has(key)) firstSeen.set(key, r + 1)
    }
    // 跨字段规则
    if (typeof out.coinAmount === 'number' && out.coinAmount <= 0) errors.push('「纯币(M)」需大于 0')
    if (typeof out.coinRatio === 'number' && out.coinRatio <= 0) errors.push('「纯币比例(1:N)」需大于 0')
    if (typeof out.coinAmount === 'number' && typeof out.totalAssets === 'number' && out.totalAssets < out.coinAmount) errors.push('「总资产(M)」不能小于「纯币(M)」')
    if (typeof out.level === 'number' && (out.level < 1 || out.level > 200)) errors.push('「等级」应在 1-200')
    if (out.discountMode === 'custom') {
      const p = out.customDiscountPercent
      if (typeof p !== 'number') errors.push('折扣方式为自定义时「自定义折扣(%)」必填')
      else if (p < 1 || p > 100) errors.push('「自定义折扣(%)」应在 1-100')
    }

    const res: ImportRowResult = { rowNo: r + 1, accountNo, errors }
    if (!errors.length) {
      const src = out.source as 'consign' | 'buyin'
      res.input = {
        accountNo, status: 'draft', source: src,
        ownerContact: src === 'buyin' ? (str(out.ownerContact) || '自有') : str(out.ownerContact),
        costAmount: src === 'buyin' ? (out.costAmount as number) : 0,
        region: out.region as string, loginMethod: out.loginMethod as string, channel: out.channel as string,
        assistTime: (out.assistTime as string) || '全天', banRecord: (out.banRecord as boolean) ?? false,
        coinAmount: out.coinAmount as number, totalAssets: out.totalAssets as number,
        secretKd: (out.secretKd as number) ?? 1, level: (out.level as number) ?? 1, rank: out.rank as string, safeBox: out.safeBox as number,
        stamina: (out.stamina as string) ?? '1级', load: (out.load as string) ?? '1级',
        awmCount: (out.awmCount as number) ?? 0, helmet6Count: (out.helmet6Count as number) ?? 0, armor6Count: (out.armor6Count as number) ?? 0,
        experienceCardCount: (out.experienceCardCount as number) ?? 0, skins: (out.skins as string[]) ?? [],
        cycle: out.cycle as string, coinRatio: out.coinRatio as number, discountMode: (out.discountMode as 'system' | 'custom') ?? 'system',
        ...(out.discountMode === 'custom' ? { customDiscountPercent: out.customDiscountPercent as number } : {}),
        deposit: (out.deposit as number) ?? 0, remark: (out.remark as string) ?? '', internalRemark: (out.internalRemark as string) ?? '',
      }
    }
    rows.push(res)
  }
  if (!rows.length) headerErrors.push('没有可导入的数据行')
  const valid = rows.filter((x) => !x.errors.length).length
  return { headerErrors, rows, valid, invalid: rows.length - valid }
}

export const IMPORT_MAX_ROWS = 500
