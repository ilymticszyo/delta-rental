import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/errors'
import { createSubmitKey, newIdempotencyKey } from '../src/api/idempotency'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
describe('Idempotency-Key', () => {
  it('UUID v4；randomUUID 不可用（http 非安全上下文）时退回 getRandomValues', () => {
    expect(newIdempotencyKey()).toMatch(UUID)
    const c = globalThis.crypto as any
    const orig = c.randomUUID
    try { c.randomUUID = undefined; expect(newIdempotencyKey()).toMatch(UUID) } finally { c.randomUUID = orig }
  })
  it('结果不确定（网络 / 超时 / 5xx）→ 同体复用同一个键；成功后、业务错误后或请求体变化 → 新键', async () => {
    let n = 0
    const sk = createSubmitKey(() => `k${++n}`)
    const keys: string[] = []
    const fail = (e: ApiError) => (k: string) => { keys.push(k); return Promise.reject(e) }
    await expect(sk.submit({ a: 1 }, fail(new ApiError('网络错误', 0, 'NETWORK_ERROR')))).rejects.toThrow()
    await expect(sk.submit({ a: 1 }, fail(new ApiError('超时', 0, 'TIMEOUT')))).rejects.toThrow()
    await expect(sk.submit({ a: 1 }, fail(new ApiError('坏网关', 502)))).rejects.toThrow()
    expect(keys).toEqual(['k1', 'k1', 'k1'])
    await sk.submit({ a: 1 }, async (k) => { keys.push(k) })
    await sk.submit({ a: 1 }, async (k) => { keys.push(k) }) // 成功后再次提交 = 新动作
    expect(keys.slice(3)).toEqual(['k1', 'k2'])
    await expect(sk.submit({ a: 2 }, fail(new ApiError('黑名单', 409, 'RENTER_BLACKLISTED')))).rejects.toThrow()
    await expect(sk.submit({ a: 2 }, fail(new ApiError('黑名单', 409, 'RENTER_BLACKLISTED')))).rejects.toThrow()
    expect(keys.slice(5)).toEqual(['k3', 'k4']) // 业务错误是确定结果：下次用新键，不会被重放成旧错误
    await expect(sk.submit({ a: 3 }, fail(new ApiError('x', 500)))).rejects.toThrow()
    await expect(sk.submit({ a: 4 }, fail(new ApiError('x', 500)))).rejects.toThrow()
    expect(keys.slice(7)).toEqual(['k5', 'k6']) // 改了内容 → 新键
    // 键顺序无关
    await expect(sk.submit({ x: 1, y: 2 }, fail(new ApiError('x', 0)))).rejects.toThrow()
    await expect(sk.submit({ y: 2, x: 1 }, fail(new ApiError('x', 0)))).rejects.toThrow()
    expect(keys.slice(9)).toEqual(['k7', 'k7'])
  })
  it('双击：进行中再提交同样内容 → 不发第二个请求，共用同一次结果', async () => {
    const sk = createSubmitKey()
    let calls = 0
    let release!: (v: string) => void
    const fn = (k: string) => { calls++; return new Promise<string>((ok) => { release = () => ok(k) }) }
    const p1 = sk.submit({ a: 1 }, fn)
    const p2 = sk.submit({ a: 1 }, fn)
    await Promise.resolve(); await Promise.resolve()
    release('done')
    const [r1, r2] = await Promise.all([p1, p2])
    expect(calls).toBe(1)
    expect(r1).toBe(r2)
  })
  it('fn 同步抛错也能正确清理进行中状态', async () => {
    const sk = createSubmitKey()
    await expect(sk.submit({ a: 1 }, () => { throw new ApiError('网络', 0) })).rejects.toThrow()
    let called = 0
    await sk.submit({ a: 1 }, async () => { called++ })
    expect(called).toBe(1)
  })
})
