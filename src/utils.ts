import { ElMessage } from 'element-plus'
import { ApiError } from './api'

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  ElMessage.success('已复制')
}

export function fmtTime(iso?: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 包装 API 调用：错误统一弹提示 */
export async function run<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
  try {
    const r = await fn()
    if (okMsg) ElMessage.success(okMsg)
    return r
  } catch (e) {
    ElMessage.error(e instanceof ApiError || e instanceof Error ? e.message : String(e))
    return undefined
  }
}

export const statusTagType: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'primary'> = {
  listed: 'success', rented: 'warning', settling: 'danger', off: 'info', draft: 'info', held: 'primary',
  active: 'warning', done: 'success', cancelled: 'info',
  submitted: 'primary', following: 'warning', quoted: 'success', deal: 'success', rejected: 'danger',
}
