/** 登录失败计数：同一 IP、同一用户名各自累计，窗口内达到上限后拒绝。 */
export const LOGIN_FAIL_LIMIT = 10
export const LOGIN_FAIL_WINDOW_MS = 10 * 60 * 1000

export function createLoginGuard(now: () => number = () => Date.now(), limit = LOGIN_FAIL_LIMIT, windowMs = LOGIN_FAIL_WINDOW_MS) {
  const fails = new Map<string, { n: number; t: number }>()
  return {
    tooMany(key: string) {
      const b = fails.get(key)
      return !!b && now() - b.t <= windowMs && b.n >= limit
    },
    hit(key: string) {
      const t = now()
      const b = fails.get(key)
      if (!b || t - b.t > windowMs) { fails.set(key, { n: 1, t }); return 1 }
      b.n += 1
      return b.n
    },
    clear(key: string) { fails.delete(key) },
  }
}
