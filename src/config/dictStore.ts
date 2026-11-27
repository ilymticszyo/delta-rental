// 界面用的选项字典（响应式）。mock 模式直接用内置种子；http 模式由 HttpApi 在启动 / 登录后
// 从 GET /api/dicts（字典）与 GET /api/pricing/options（渠道、周期）读取并覆盖。读取失败时保留内置种子。
import { reactive } from 'vue'
import { dicts as seed } from './rules'

export interface SkinDict { name: string; category: string }
/** 与契约 components.schemas.Dicts 一致 */
export interface Dicts { regions: string[]; loginMethods: string[]; ranks: string[]; safeBoxes: number[]; stamina: string[]; loads: string[]; skins: SkinDict[] }
export interface UiDicts extends Dicts { channels: string[]; cycles: string[] }

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
export const dicts = reactive<UiDicts & { source: 'bundled' | 'server' }>({ ...copy(seed), source: 'bundled' })

export function applyDicts(d: Partial<UiDicts>, source: 'bundled' | 'server' = 'server') {
  for (const k of ['regions', 'loginMethods', 'ranks', 'safeBoxes', 'stamina', 'loads', 'skins', 'channels', 'cycles'] as const) {
    if (Array.isArray(d[k])) (dicts as any)[k] = copy(d[k])
  }
  dicts.source = source
}
export const skinCategoryOf = (name: string) => dicts.skins.find((s) => s.name === name)?.category ?? '未配置'
