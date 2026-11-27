// SheetJS 仅在点击「下载模板 / 选择文件」时动态加载，不进主包
import { templateAoa, templateHelpAoa, type ImportContext } from './importAccounts'

const loadXlsx = () => import('xlsx')

export async function buildTemplateWorkbook(ctx: ImportContext) {
  const XLSX = await loadXlsx()
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(templateAoa())
  ws['!cols'] = templateAoa()[0].map((h) => ({ wch: Math.max(10, String(h).length * 2 + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, '账号导入')
  const help = XLSX.utils.aoa_to_sheet(templateHelpAoa(ctx))
  help['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(wb, help, '填写说明')
  return { XLSX, wb }
}
export async function downloadTemplate(ctx: ImportContext, filename = '账号批量导入模板.xlsx') {
  const { XLSX, wb } = await buildTemplateWorkbook(ctx)
  XLSX.writeFile(wb, filename)
}

/** 读第一个工作表为二维数组；CSV 按 UTF-8（兼容 BOM）读取 */
export async function readSheet(name: string, data: ArrayBuffer): Promise<unknown[][]> {
  const XLSX = await loadXlsx()
  const lower = name.toLowerCase()
  if (!/\.(xlsx|xls|csv)$/.test(lower)) throw new Error('仅支持 .xlsx / .csv 文件')
  const wb = lower.endsWith('.csv')
    ? XLSX.read(new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws || !ws['!ref']) return []
  // 从 A1 开始读并保留空行，保证数组下标 + 1 = Excel 行号（错误提示里的行号与表格一致）
  const end = XLSX.utils.decode_range(ws['!ref']).e
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: true, range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: end }) })
}
