// 逐角色点遍所有页面（http 模式对真实后端用）：node scripts/e2e-roles.mjs <url> <截图目录>
// 记录：页面报错 / 控制台错误 / 错误提示框 / 图片加载失败 / 所有 4xx·5xx 的 /api 请求（含请求体与响应体），并做号主隔离的 API 检查。
import { chromium } from 'playwright'
import fs from 'node:fs'
const url = process.argv[2] ?? 'http://localhost:4175/'
const dir = process.argv[3] ?? 'shots-roles'
fs.mkdirSync(dir, { recursive: true })
const base = url.replace(/#.*$/, '')
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' })
const ROLES = [
  { u: 'owner1', p: 'owner123', admin: false, pages: ['/accounts', '#detail', '/pricing', '/recycle', '/contact', '/owner/accounts', '#owner-detail', '/owner/list'], denied: ['/admin/dashboard'] },
  { u: 'owner2', p: 'owner123', admin: false, pages: ['/accounts', '#detail', '/pricing', '/recycle', '/contact', '/owner/accounts', '#owner-detail', '/owner/list'], denied: ['/admin/inventory'] },
  { u: 'demo', p: 'demo123', admin: false, pages: ['/accounts', '#detail', '/pricing', '/recycle', '/contact'], denied: ['/owner/accounts', '/admin/dashboard'] },
  { u: 'cs', p: 'cs123', admin: true, pages: ['/admin/dashboard', '/admin/inventory', '/admin/orders', '#order-detail', '/admin/payables', '/admin/recycles', '/admin/renters', '/admin/owners', '/admin/reports', '/accounts', '#detail'], denied: ['/admin/rules', '/admin/staff', '/admin/audit'] },
  { u: 'ops', p: 'ops123', admin: true, pages: ['/admin/dashboard', '/admin/inventory', '#inventory-edit', '/admin/orders', '#order-detail', '/admin/payables', '/admin/recycles', '/admin/renters', '/admin/owners', '/admin/reports', '/admin/rules'], denied: ['/admin/staff', '/admin/audit', '/owner/accounts'] },
  { u: 'admin', p: 'admin123', admin: true, pages: ['/admin/dashboard', '/admin/inventory', '#inventory-edit', '/admin/orders', '#order-detail', '/admin/payables', '/admin/recycles', '/admin/renters', '/admin/owners', '/admin/reports', '/admin/rules', '/admin/staff', '/admin/audit', '/owner/accounts', '#owner-detail'], denied: [] },
]
const results = []
const apiFailures = []
const expected = (f) => (f.status === 404 && f.path === '/api/rules/pricing/preview') || (f.status === 403 && f.denied)
for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const issues = []
  let current = ''
  let inDenied = false
  page.on('pageerror', (e) => issues.push(`[${current}] pageerror: ${String(e).slice(0, 200)}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push(`[${current}] console: ${m.text().slice(0, 200)}`) })
  page.on('response', async (res) => {
    const u = new URL(res.url())
    if (!u.pathname.startsWith('/api/') || res.status() < 400) return
    const req = res.request()
    const f = { role: role.u, page: current, method: req.method(), path: u.pathname, query: u.search, status: res.status(), request: req.postData()?.slice(0, 600) ?? null, response: (await res.text().catch(() => '')).slice(0, 600), denied: inDenied }
    apiFailures.push(f)
  })
  const go = async (h) => { current = h; await page.goto(base + '#' + h); await page.waitForLoadState('networkidle'); await page.waitForTimeout(700) }
  const check = async (name) => {
    const errs = await page.locator('.el-message--error').allInnerTexts().catch(() => [])
    for (const e of errs) issues.push(`[${name}] 错误提示：${e.trim()}`)
    const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => i.complete && i.src && !i.src.startsWith('data:') && i.naturalWidth === 0).map((i) => i.src))
    for (const b of broken) issues.push(`[${name}] 图片加载失败：${b}`)
    await page.screenshot({ path: `${dir}/${role.u}-${name.replace(/[^\w-]+/g, '_').replace(/^_+/, '')}.png` })
  }
  await go(role.admin ? '/admin/login' : '/login')
  await page.fill('input[name=username]', role.u); await page.fill('input[name=password]', role.p)
  await page.click('button:has-text("登录")'); await page.waitForTimeout(1200)
  for (const pg of role.pages) {
    try {
      if (pg === '#detail') { await go('/accounts'); current = 'lobby→detail'; await page.locator('button:has-text("详情")').first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800); await check('account-detail'); continue }
      if (pg === '#owner-detail') { await go('/owner/accounts'); current = 'owner→detail'; await page.locator('.el-table__row button:has-text("详情")').first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800); await check('owner-account-detail'); continue }
      if (pg === '#order-detail') { await go('/admin/orders'); current = 'orders→detail'; await page.locator('.el-table__row button:has-text("详情")').first().click(); await page.waitForTimeout(1200); await check('order-detail'); await page.keyboard.press('Escape'); continue }
      if (pg === '#inventory-edit') { await go('/admin/inventory?status=listed'); current = 'inventory→edit'; await page.locator('.el-table__row button:has-text("编辑")').first().click(); await page.waitForTimeout(1200); await check('inventory-edit'); await page.keyboard.press('Escape'); continue }
      await go(pg); await check(pg)
    } catch (e) { issues.push(`[${pg}] 失败：${String(e).split('\n')[0].slice(0, 200)}`) }
  }
  for (const d of role.denied) {
    inDenied = true
    await go(d)
    const h = new URL(page.url()).hash
    if (h.startsWith('#' + d)) {
      const txt = await page.locator('body').innerText()
      if (!/无权|403|没有权限|禁止/.test(txt)) issues.push(`[${d}] 应被拒绝，但页面正常打开`)
    }
    await page.screenshot({ path: `${dir}/${role.u}-denied-${d.replace(/[^\w-]+/g, '_').replace(/^_+/, '')}.png` })
    inDenied = false
  }
  results.push({ role: role.u, pages: role.pages.length, denied: role.denied.length, issues })
  await ctx.close()
}
// 号主隔离：owner2 看不到 owner1 的账号；直接按 id 访问 → 404
const api = async (path, opts = {}) => { const r = await fetch(new URL('/api' + path, base), opts); return { status: r.status, body: await r.json().catch(() => null) } }
const login = async (u, p) => (await api('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).body.token
const t1 = await login('owner1', 'owner123'), t2 = await login('owner2', 'owner123')
const H = (t) => ({ headers: { Authorization: `Bearer ${t}` } })
const a1 = (await api('/owner/accounts?pageSize=200', H(t1))).body.items, a2 = (await api('/owner/accounts?pageSize=200', H(t2))).body.items
const iso = []
if (a1.some((x) => a2.some((y) => y.id === x.id))) iso.push('owner1 与 owner2 的账号列表有重叠')
if (a1[0]) { const r = await api(`/owner/accounts/${a1[0].id}`, H(t2)); if (r.status !== 404) iso.push(`owner2 访问 owner1 的账号 ${a1[0].id} 得到 ${r.status}（应为 404）`) }
results.push({ role: 'owner 隔离（API）', pages: 0, denied: 0, issues: iso, info: `owner1 ${a1.length} 个、owner2 ${a2.length} 个` })
await browser.close()
fs.writeFileSync(`${dir}/_api-failures.json`, JSON.stringify(apiFailures, null, 2))
let bad = 0
for (const r of results) { console.log(`${r.issues.length ? 'FAIL' : 'PASS'} | ${r.role}：${r.pages} 页 + ${r.denied} 个越权检查${r.info ? '，' + r.info : ''}`); for (const i of r.issues) console.log('   - ' + i); bad += r.issues.length }
const unexpected = apiFailures.filter((f) => !expected(f))
console.log(`API 4xx/5xx：共 ${apiFailures.length}，非预期 ${unexpected.length}`)
for (const f of unexpected) console.log(`   - ${f.role} [${f.page}] ${f.method} ${f.path}${f.query} → ${f.status} ${f.response.slice(0, 200)}`)
process.exit(bad + unexpected.length ? 1 : 0)
