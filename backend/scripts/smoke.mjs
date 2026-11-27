#!/usr/bin/env node
// 对新契约做关键路径冒烟。用法：node scripts/smoke.mjs http://127.0.0.1:3000
const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const failures = []
const fail = (m) => { failures.push(m); console.error('FAIL', m) }
const ok = (m) => console.log('OK  ', m)

async function req(path, { method = 'GET', token, body, form, headers = {} } = {}) {
  const h = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(base + path, { method, headers: h, body: payload })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text, reqId: res.headers.get('x-request-id') }
}
async function login(username, password) {
  const res = await req('/api/auth/login', { method: 'POST', body: { username, password } })
  if (res.status !== 200 || !/^[0-9a-f]{48}$/.test(res.json?.token || '')) fail(`login ${username} ${res.status} ${res.text}`)
  if (res.json?.user?.password) fail('login leaked password')
  return res.json.token
}

const meta = await req('/api/meta')
if (meta.status !== 200 || meta.json?.demo !== true || !meta.json.serverTime?.endsWith('Z') || !meta.reqId) fail(`meta ${meta.status}`)
else ok('meta')

const anon = await req('/api/lobby/accounts')
if (anon.status !== 401 || anon.json?.error?.code !== 'UNAUTHENTICATED') fail(`anon ${anon.status} ${anon.text}`)
else ok('anon 401')

const bad = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })
if (bad.status !== 401 || bad.json?.error?.code !== 'INVALID_CREDENTIALS') fail(`bad password ${bad.text}`)
else ok('invalid credentials')

const admin0 = await login('admin', 'admin123')
const reset = await req('/api/demo/reset', { method: 'POST', token: admin0 })
if (reset.status !== 204) fail(`reset ${reset.status} ${reset.text}`)
else ok('demo reset')

const admin = await login('admin', 'admin123')
const demo = await login('demo', 'demo123')
const cs = await login('cs', 'cs123')
const ops = await login('ops', 'ops123')
const owner = await login('owner1', 'owner123')

const accounts = await req('/api/accounts?pageSize=200', { token: admin })
if (accounts.status !== 200 || accounts.json?.total !== 20) fail(`accounts ${accounts.status} total=${accounts.json?.total}`)
else ok('20 accounts')

const denied = await req('/api/accounts', { token: demo })
if (denied.status !== 403 || denied.json?.error?.code !== 'FORBIDDEN') fail(`member inventory ${denied.status}`)
else ok('member 403')

const lobby = await req('/api/lobby/accounts?pageSize=5', { token: demo })
const q0 = lobby.json?.items?.[0]?.quote
if (lobby.status !== 200 || !(q0?.totalAmount > 0) || q0.serviceFee != null || q0.ownerSettlement != null || lobby.json.items[0].ownerContact != null) fail('member lobby')
else ok('member lobby redacted')

const ownerLobby = await req('/api/lobby/accounts?pageSize=200', { token: owner })
if (!ownerLobby.json?.items?.every((a) => a.quote === null && a.deposit == null && a.coinRatio == null)) fail('owner lobby')
else ok('owner lobby')

const price = await req('/api/pricing/quote', { method: 'POST', token: demo, body: { coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', discountMode: 'system', cycle: '10M/天', deposit: 200 } })
if (price.json?.coinRent !== 500 || price.json?.serviceFee != null || price.json?.rentalDays !== 10) fail(`pricing ${JSON.stringify(price.json)}`)
else ok('pricing 500 / 10 days')

const fast = await req('/api/pricing/quote', { method: 'POST', token: demo, body: { coinAmount: 100, totalAssets: 300, coinRatio: 20, channel: '普通区', discountMode: 'system', cycle: '5M/天', deposit: 200 } })
if (fast.json?.coinRent !== 500 || fast.json?.rentalDays !== 20) fail(`cycle days must not change rent ${JSON.stringify(fast.json)}`)
else ok('Q8 days do not change rent')

const valuation = await req('/api/valuation/quote', { method: 'POST', token: demo, body: { contact: 'wx_test', region: 'QQ区', loginMethod: '扫码', coinAmount: 100, totalAssets: 150, level: 40, rank: '钻石', safeBox: 6, skins: ['威龙·赤焰', '蜂医·霓虹'], banRecord: false, awmCount: 0, helmet6Count: 0, armor6Count: 0, experienceCardCount: 0 } })
if (valuation.json?.center !== 368) fail(`valuation ${valuation.json?.center}`)
else ok('valuation 368')

const mine = await req('/api/owner/accounts?pageSize=200', { token: owner })
if (mine.status !== 200 || !mine.json.items?.length || JSON.stringify(mine.json).match(/wx_renter|serviceFee|"coinRent"/)) fail('owner portal leak')
else ok('owner portal')

const staff = await req('/api/staff', { token: admin })
const ownerUser = staff.json?.find((u) => u.username === 'owner1')
if (ownerUser?.ownerId !== 'ow1') fail(`staff ownerId ${JSON.stringify(ownerUser)}`)
else ok('staff ownerId')

const csImport = await req('/api/accounts/import', { method: 'POST', token: cs, body: { fileName: 'x.xlsx', rows: [['a']], dryRun: true } })
if (csImport.status !== 403) fail(`cs import ${csImport.status}`)
else ok('cs cannot import')

const listed = accounts.json.items.find((a) => a.status === 'listed' && a.source === 'consign')
const blocked = await req('/api/orders', { method: 'POST', token: cs, body: { accountId: listed.id, renterContact: 'wx_black_ahu', startAt: new Date().toISOString(), rentalDays: 2, deposit: 0, extraFee: 0, remark: '' } })
if (blocked.status !== 409 || blocked.json?.error?.code !== 'RENTER_BLACKLISTED') fail(`blacklist ${blocked.status} ${blocked.text}`)
else ok('blacklist 409')

const preview = await req('/api/orders/preview', { method: 'POST', token: cs, body: { accountId: listed.id, renterContact: 'wx_smoke' } })
const created = await req('/api/orders', { method: 'POST', token: cs, headers: { 'Idempotency-Key': 'smoke-order-1' }, body: { accountId: listed.id, renterContact: 'wx_smoke', startAt: new Date().toISOString(), rentalDays: preview.json.rentalDays + 5, deposit: 0, extraFee: 0, remark: 'smoke' } })
if (created.status !== 201 || created.json.coinRent !== preview.json.coinRent || created.json.rentalDays !== preview.json.rentalDays + 5) fail(`order rent ${created.status} ${created.text}`)
else ok(`order ${created.json.orderNo} rent locked`)
const replay = await req('/api/orders', { method: 'POST', token: cs, headers: { 'Idempotency-Key': 'smoke-order-1' }, body: { accountId: listed.id, renterContact: 'wx_smoke', startAt: created.json.startAt, rentalDays: preview.json.rentalDays + 5, deposit: 0, extraFee: 0, remark: 'smoke' } })
if (replay.status !== 201 || replay.json.id !== created.json.id) fail(`idempotency replay ${replay.status}`)
else ok('idempotency replay')
const clash = await req('/api/orders', { method: 'POST', token: cs, headers: { 'Idempotency-Key': 'smoke-order-1' }, body: { accountId: listed.id, renterContact: 'wx_other', startAt: new Date().toISOString(), rentalDays: 1, deposit: 0, extraFee: 0, remark: 'x' } })
if (clash.status !== 409 || clash.json?.error?.code !== 'DUPLICATE') fail(`idempotency clash ${clash.status} ${clash.text}`)
else ok('idempotency clash')

const extended = await req(`/api/orders/${created.json.id}/extend`, { method: 'POST', token: cs, body: { rentalDays: 2, note: '只改期' } })
if (extended.json?.coinRent !== created.json.coinRent || extended.json?.rentalDays !== 2) fail(`extend changed rent ${JSON.stringify(extended.json)}`)
else ok('extend keeps rent')
const cancelled = await req(`/api/orders/${created.json.id}/cancel`, { method: 'POST', token: cs, body: { note: 'smoke' } })
if (cancelled.json?.status !== 'cancelled') fail(`cancel ${cancelled.status}`)
else ok('cancelled')

const detail = await req(`/api/orders/${created.json.id}`, { token: cs })
if (detail.status !== 200 || detail.json?.id !== created.json.id) fail('get order')
else ok('GET /orders/{id}')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const form = new FormData()
form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png')
const uploaded = await req('/api/uploads', { method: 'POST', token: owner, form })
if (uploaded.status !== 201 || !uploaded.json?.url?.includes('/content?')) fail(`upload ${uploaded.status} ${uploaded.text}`)
else ok('upload signed url')
const img = await fetch(base + uploaded.json.url)
if (img.status !== 200 || !img.headers.get('content-type')?.includes('image/png')) fail(`image ${img.status}`)
else ok('signed image without bearer')

const header = ['账号编号','来源','号主联系方式','成本(元)','大区','上号方式','上架渠道','辅助上号时段','封禁记录','纯币(M)','总资产(M)','绝密KD','等级','段位','保险格','体力','负重','AWM数量','6头数量','6甲数量','体验卡数量','皮肤','周期','纯币比例(1:N)','折扣方式','自定义折扣(%)','押金(元)','备注']
const row = ['DFSMOKE2','号主寄租','wx_owner_wang',0,'QQ区','扫码','普通区','全天','否',100,150,1.2,40,'钻石',6,'1级','1级',0,0,0,0,'威龙·赤焰','10M/天',20,'系统推荐','',0,'smoke']
const imported = await req('/api/accounts/import', { method: 'POST', token: ops, body: { fileName: 'smoke.xlsx', rows: [header, row], dryRun: false } })
if (!imported.json?.imported?.includes('DFSMOKE2')) fail(`import ${imported.status} ${imported.text}`)
else ok('import')

await req('/api/auth/logout', { method: 'POST', token: admin })
const dead = await req('/api/auth/me', { token: admin })
if (dead.status !== 401) fail(`logout did not revoke ${dead.status}`)
else ok('logout revokes token')

if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1) }
console.log('\nsmoke passed')
