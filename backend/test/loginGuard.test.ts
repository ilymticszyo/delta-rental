import assert from 'node:assert/strict'
import express from 'express'
import { describe, it } from 'node:test'
import { createLoginGuard, LOGIN_FAIL_LIMIT } from '../src/loginGuard'
import { parseTrustProxy } from '../src/trustProxy'

describe('登录失败计数', () => {
  it('同一 IP 和同一用户名各自满 10 次后锁定，成功则清零，窗口过后重计', () => {
    let now = 1_000_000
    const g = createLoginGuard(() => now)
    const ip = 'ip:203.0.113.8'
    const user = 'user:admin'
    for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) {
      assert.equal(g.tooMany(ip), false)
      assert.equal(g.tooMany(user), false)
      g.hit(ip)
      g.hit(user)
    }
    assert.equal(g.tooMany(ip), true)
    assert.equal(g.tooMany(user), true)
    assert.equal(g.tooMany('user:other'), false)
    g.clear(user)
    assert.equal(g.tooMany(user), false)
    assert.equal(g.tooMany(ip), true)
    now += 10 * 60 * 1000 + 1
    assert.equal(g.tooMany(ip), false)
    assert.equal(g.hit(ip), 1)
  })
})

describe('反代后的客户端 IP', () => {
  function ipOf(trust: boolean | number | string, remote: string, forwarded?: string) {
    const app = express()
    app.set('trust proxy', trust)
    const req = Object.create(app.request) as express.Request
    req.app = app
    req.headers = forwarded ? { 'x-forwarded-for': forwarded } : {}
    const socket = { remoteAddress: remote }
    Object.defineProperty(req, 'socket', { value: socket })
    Object.defineProperty(req, 'connection', { value: socket })
    return req.ip
  }

  const trust = parseTrustProxy(undefined)

  it('默认只信任本机和内网，公网直连忽略伪造的 X-Forwarded-For', () => {
    assert.equal(trust, 'loopback,uniquelocal')
    assert.equal(ipOf(trust, '203.0.113.9', '1.2.3.4'), '203.0.113.9')
    assert.equal(ipOf(trust, '127.0.0.1', '203.0.113.50'), '203.0.113.50')
    assert.equal(ipOf(trust, '172.18.0.1', '203.0.113.50'), '203.0.113.50')
  })
  it('代理追加的真实地址生效，靠前的伪造地址不算', () => {
    assert.equal(ipOf(trust, '127.0.0.1', '1.1.1.1, 203.0.113.50'), '203.0.113.50')
    assert.equal(ipOf(trust, '172.18.0.1', '8.8.8.8, 198.51.100.20'), '198.51.100.20')
  })
  it('拒绝把 TRUST_PROXY 设成信任所有人', () => {
    assert.throws(() => parseTrustProxy('true'), /不能设为 true/)
    assert.throws(() => parseTrustProxy('all'), /不能设为 true/)
    assert.equal(parseTrustProxy('false'), false)
    assert.equal(parseTrustProxy('1'), 1)
  })
})
