// 截图签名地址的续期（契约 §7：url 1 小时过期，过期后 GET /uploads/{id} 重新签发）
import type { Attachment } from '../domain/types'
import { api } from './index'

/** 距过期不足这么久就提前续签 */
export const RENEW_BEFORE_MS = 2 * 60_000
export const isExpiring = (a: Pick<Attachment, 'expiresAt'>, now = Date.now()) => !!a.expiresAt && Date.parse(a.expiresAt) - now < RENEW_BEFORE_MS

/** 返回一份地址都可用的截图列表：快过期的逐个重新签发；续签失败的保留原值（图片会显示失败，用户可重开） */
export async function freshAttachments(list: Attachment[] | undefined): Promise<Attachment[]> {
  return Promise.all((list ?? []).map(async (a) => {
    if (!a.id || !isExpiring(a)) return a
    try { return { ...a, ...(await api.refreshAttachment(a.id)) } } catch { return a }
  }))
}
