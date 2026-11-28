/**
 * 反代后面的客户端 IP。
 *
 * 不能无条件信任 X-Forwarded-For：谁都能伪造这个头。只在「直接连上来的那一跳」
 * 属于可信地址时，才采用代理追加的客户端地址（Express 的 trust proxy）。
 *
 * 默认 `loopback,uniquelocal`：本机回环，以及 RFC1918 / 唯一本地地址
 * （Docker 网桥、1Panel 反代打到 127.0.0.1:3000 时，容器里看到的往往是 172.x）。
 * 公网直连进来的请求会忽略转发头，用套接字上的地址。
 *
 * TRUST_PROXY 还可设为：
 * - `false` / `0` / `off`：从不信任转发头
 * - 正整数：信任从本进程往外数的这么多跳（例如确定只有一层反代时设 `1`）
 * - 逗号分隔的 IP、网段或 loopback / linklocal / uniquelocal
 *
 * 不要设成 true / all。部署文档里的 nginx 使用 `$proxy_add_x_forwarded_for`（在末尾追加真实客户端），
 * 伪造的靠前地址不会被当成客户。
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const v = (raw ?? 'loopback,uniquelocal').trim()
  if (v === '' || /^(0|false|off|no)$/i.test(v)) return false
  if (/^(true|yes|all|\*)$/i.test(v)) {
    throw new Error('TRUST_PROXY 不能设为 true / all：那会信任任意来源的 X-Forwarded-For。请用跳数（如 1）或可信地址（默认 loopback,uniquelocal）。')
  }
  if (/^\d+$/.test(v)) return Number(v)
  return v
}
