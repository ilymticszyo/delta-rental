#!/usr/bin/env node
// 对已启动的 API 做关键路径冒烟。用法：node scripts/smoke.mjs http://127.0.0.1:3000
const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const failures = []

function fail(msg) { failures.push(msg); console.error('FAIL', msg) }
function ok(msg) { console.log('OK  ', msg) }

async function req(path, { method = 'GET', token, body, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(base + path, { method, headers, body: payload })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text, token: res.headers.get('x-auth-token'), cookie: res.headers.get('set-cookie') || '' }
}

async function login(username, password) {
  const res = await req('/api/auth/login', { method: 'POST', body: { username, password } })
  if (res.status !== 200) fail(`login ${username} -> ${res.status} ${res.text}`)
  if (!res.token) fail(`login ${username} missing X-Auth-Token`)
  if (!res.cookie.includes('token=')) fail(`login ${username} missing cookie`)
  if (res.json?.password || res.json?.token) fail(`login body leaked secret fields`)
  return res.token
}

const health = await req('/api/health')
if (health.status !== 200 || health.json?.ok !== true) fail(`health ${health.status}`)
else ok('health')

const anon = await req('/api/lobby/accounts')
if (anon.status !== 401) fail(`anon lobby ${anon.status}`)
else ok('anon 401')

const bad = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })
if (bad.status !== 401) fail(`bad password ${bad.status}`)
else ok('bad password')

const docs = await req('/api/openapi.json')
if (docs.status !== 200 || !docs.json?.paths?.['/api/auth/login']) fail('openapi')
else ok('openapi')

const admin = await login('admin', 'admin123')
const demo = await login('demo', 'demo123')
const cs = await login('cs', 'cs123')
const ops = await login('ops', 'ops123')
const owner = await login('owner1', 'owner123')

const accounts = await req('/api/admin/accounts', { token: admin })
if (accounts.status !== 200 || accounts.json?.length !== 20) fail(`accounts ${accounts.status} len=${accounts.json?.length}`)
else ok('20 accounts')

const denied = await req('/api/admin/accounts', { token: demo })
if (denied.status !== 403) fail(`member inventory ${denied.status}`)
else ok('member 403 inventory')

const lobby = await req('/api/lobby/accounts', { token: demo })
if (lobby.status !== 200 || !lobby.json?.[0]?.quote?.totalAmount || lobby.json[0].quote.serviceFee != null || lobby.json[0].ownerContact != null) {
  fail(`member lobby shape ${JSON.stringify(lobby.json?.[0]?.quote)}`)
} else ok('member lobby redacted')

const ownerLobby = await req('/api/lobby/accounts', { token: owner })
if (ownerLobby.status !== 200 || !ownerLobby.json?.every((a) => a.quote === null)) fail('owner lobby quote')
else ok('owner lobby quote null')

const price = await req('/api/pricing/calc', { method: 'POST', token: demo, body: { coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', discountMode: 'system', cycle: '10M/天', deposit: 200 } })
if (price.status !== 200 || price.json?.coinRent !== 500 || price.json?.serviceFee != null) fail(`pricing ${price.status} ${JSON.stringify(price.json)}`)
else ok('pricing 500')

const valuation = await req('/api/valuation/calc', { method: 'POST', token: demo, body: { contact: 'wx_test', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6, skins: ['威龙·赤焰', '蜂医·霓虹'], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 } })
if (valuation.status !== 200 || valuation.json?.center !== 368) fail(`valuation ${valuation.status} ${valuation.json?.center}`)
else ok('valuation 368')

const mine = await req('/api/owner/accounts', { token: owner })
if (mine.status !== 200 || !mine.json?.length || JSON.stringify(mine.json).match(/wx_renter|serviceFee|coinRent/)) fail('owner portal leak')
else ok('owner portal')

const csRule = await req('/api/admin/rules/pricing', { method: 'PUT', token: cs, body: { rule: { version: 1 }, summary: 'nope' } })
if (csRule.status !== 403) fail(`cs save rule ${csRule.status}`)
else ok('cs cannot edit rules')

const opsAudit = await req('/api/admin/audit', { token: ops })
if (opsAudit.status !== 403) fail(`ops audit ${opsAudit.status}`)
else ok('ops cannot read audit')

const audit = await req('/api/admin/audit', { token: admin })
if (audit.status !== 200 || !Array.isArray(audit.json)) fail('admin audit')
else ok('admin audit')

const ver = await req('/api/admin/rules/pricing/versions/1', { token: ops })
if (ver.status !== 200 || ver.json?.version !== 1) fail(`rule snapshot ${ver.status}`)
else ok('pricing rule v1 snapshot')

const listed = accounts.json.find((a) => a.status === 'listed' && a.source === 'consign')
const blocked = await req('/api/admin/orders', { method: 'POST', token: cs, body: { accountId: listed.id, renterContact: 'wx_black_ahu', startAt: new Date().toISOString(), rentalDays: 2, deposit: 0, extraFee: 0, remark: '' } })
if (blocked.status !== 403) fail(`blacklist ${blocked.status} ${blocked.text}`)
else ok('blacklist blocked')

const audit2 = await req('/api/admin/audit', { token: admin })
if (!audit2.json?.some((x) => x.action === '拦截黑名单')) fail('blacklist audit not persisted')
else ok('blacklist audit persisted')

const order = await req('/api/admin/orders', { method: 'POST', token: cs, body: { accountId: listed.id, renterContact: 'wx_smoke', startAt: new Date().toISOString(), rentalDays: 2, deposit: 80, extraFee: 0, remark: 'smoke' } })
if (order.status !== 200 || !order.json?.orderNo) fail(`create order ${order.status} ${order.text}`)
else ok(`order ${order.json.orderNo}`)

const cancelled = await req(`/api/admin/orders/${order.json.id}/cancel`, { method: 'POST', token: cs, body: { note: 'smoke cancel' } })
if (cancelled.status !== 200 || cancelled.json?.status !== 'cancelled') fail(`cancel ${cancelled.status}`)
else ok('order cancelled')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const form = new FormData()
form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png')
const uploaded = await req('/api/uploads', { method: 'POST', token: owner, form })
if (uploaded.status !== 200 || !uploaded.json?.dataUrl?.startsWith('/api/uploads/')) fail(`upload ${uploaded.status} ${uploaded.text}`)
else ok('upload')

const img = await fetch(base + uploaded.json.dataUrl, { headers: { authorization: `Bearer ${owner}` } })
if (img.status !== 200 || !img.headers.get('content-type')?.includes('image/png')) fail(`fetch image ${img.status}`)
else ok('fetch image')
const imgAnon = await fetch(base + uploaded.json.dataUrl)
if (imgAnon.status !== 401) fail(`image anon ${imgAnon.status}`)
else ok('image requires auth')

const header = ['账号编号','来源','号主联系方式','成本(元)','大区','上号方式','上架渠道','辅助上号时段','封禁记录','纯币(M)','总资产(M)','绝密KD','等级','段位','保险格','体力','负重','AWM数量','6头数量','6甲数量','体验卡数量','皮肤','周期','纯币比例(1:N)','折扣方式','自定义折扣(%)','押金(元)','备注']
const row = ['DFSMOKE1','号主寄租','wx_owner_wang',0,'QQ区','扫码','普通区','全天','否',100,150,1.2,40,'钻石',6,'1级','1级',0,0,0,0,'威龙·赤焰','10M/天',20,'系统推荐','',0,'smoke']
const imported = await req('/api/admin/accounts/import', { method: 'POST', token: ops, body: { aoa: [header, row], fileName: 'smoke.xlsx' } })
if (imported.status !== 200 || !imported.json?.imported?.includes('DFSMOKE1')) fail(`import ${imported.status} ${imported.text}`)
else ok('xlsx-json import')

const users = await req('/api/admin/users', { token: admin })
if (users.status !== 200 || JSON.stringify(users.json).includes('$2')) fail('user list leaked hash')
else ok('users have no password hash')

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke passed')
