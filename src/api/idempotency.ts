// 提交幂等：每次“提交动作”生成一个 Idempotency-Key（UUID v4），重试 / 双击时复用（契约 §1、openapi components.parameters.IdempotencyKey）。
import { ApiError } from './errors'

/** UUID v4。crypto.randomUUID 只在安全上下文（https / localhost）可用，http 访问时退回 getRandomValues */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = (globalThis as any).crypto
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID() } catch { /* 非安全上下文 */ }
  }
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** 结果不确定、值得用同一个键再试的错误：网络 / 超时（code 0）、5xx、429、幂等处理中冲突 */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false
  return e.code === 0 || e.code >= 500 || e.code === 429 || e.errorCode === 'IDEMPOTENCY_IN_PROGRESS'
}

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

/**
 * 一个表单 / 动作一个实例。
 * - 同一请求体、上次结果不确定（网络 / 超时 / 5xx）→ 复用同一个键（服务端重放，不会重复入账）；
 * - 上次有确定结果（2xx 或 4xx 业务错误）或请求体变了 → 新键；
 * - 请求进行中再次点击（双击）→ 不再发请求，直接复用进行中的那次（同一个键）。
 */
export function createSubmitKey(gen: () => string = newIdempotencyKey) {
  let key: string | null = null
  let fp = ''
  let inflight: { fp: string; p: Promise<unknown> } | null = null
  return {
    get current() { return key },
    async submit<T>(body: unknown, fn: (idempotencyKey: string) => Promise<T>): Promise<T> {
      const f = stable(body)
      if (inflight && inflight.fp === f) return inflight.p as Promise<T>
      if (!key || f !== fp) { key = gen(); fp = f }
      const k = key
      let p: Promise<T> | undefined = undefined
      p = (async () => {
        await Promise.resolve() // 让 p 先赋值，再执行 fn（fn 同步抛错时 finally 也能正确清理）
        try { const r = await fn(k); if (key === k) key = null; return r }
        catch (e) { if (!isRetryable(e) && key === k) key = null; throw e }
        finally { if (inflight?.p === p) inflight = null }
      })()
      inflight = { fp: f, p }
      return p!
    },
    reset() { key = null; fp = ''; inflight = null },
  }
}
export type SubmitKey = ReturnType<typeof createSubmitKey>
