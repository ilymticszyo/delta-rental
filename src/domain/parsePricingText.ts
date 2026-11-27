import type { AccountInput } from './types'

/** 解析前台「一键复制算价信息」的文本，用于后台新增账号时预填（人工确认后入库）。 */
export function parsePricingText(text: string): Partial<AccountInput> {
  const get = (re: RegExp) => text.match(re)?.[1]?.trim()
  const num = (re: RegExp) => { const v = get(re); return v != null && v !== '' ? Number(v) : undefined }
  const out: Partial<AccountInput> = {}
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K] | undefined) => { if (v !== undefined && !(typeof v === 'number' && isNaN(v))) out[k] = v }
  set('ownerContact', get(/号主联系方式：(.+)/))
  set('region', get(/大区：(\S+)/))
  set('loginMethod', get(/上号方式：(\S+)/))
  set('assistTime', get(/辅助时段：(\S+)/))
  set('coinAmount', num(/纯币：([\d.]+)M/))
  set('totalAssets', num(/总资产：([\d.]+)M/))
  set('coinRatio', num(/比例：1:([\d.]+)/))
  set('channel', get(/渠道：(\S+)/))
  set('cycle', get(/周期：(\S+)/))
  set('safeBox', num(/保险格：(\d+)格/))
  set('deposit', num(/押金：([\d.]+) 元/))
  const ah = text.match(/AWM\/6头\/6甲：(\d+)\/(\d+)\/(\d+)/)
  if (ah) { out.awmCount = +ah[1]; out.helmet6Count = +ah[2]; out.armor6Count = +ah[3] }
  const skins = get(/皮肤：(.+)/)
  if (skins) out.skins = skins === '无' ? [] : skins.split('、').map((s) => s.trim()).filter(Boolean)
  return out
}
