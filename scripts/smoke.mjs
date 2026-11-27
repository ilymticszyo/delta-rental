// 冒烟：node scripts/smoke.mjs <url> <shotDir>
import { chromium } from 'playwright'
import fs from 'node:fs'
const [url = 'http://localhost:4173/', dir = 'shots'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const results = []
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name, String(e).slice(0, 200)]) } }
const base = url.replace(/#.*$/, '')

await check('未登录跳转登录页并显示演示账号', async () => {
  await page.goto(base + '#/accounts')
  await page.waitForSelector('text=成员登录')
  await page.waitForSelector('text=demo123')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/01-login.png` })
})
await check('前台登录 -> 大厅 15 个可租账号', async () => {
  await page.click('text=一键填入')
  await page.click('button:has-text("登录")')
  await page.waitForSelector('text=共 15 个空闲可租账号')
  await page.waitForSelector('.el-table__row')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/02-lobby.png` })
})
await check('快捷筛选 + 清空', async () => {
  await page.click('.el-check-tag:has-text("9 格")')
  await page.waitForTimeout(200)
  await page.click('button:has-text("清空筛选")')
  await page.waitForSelector('text=共 15 个空闲可租账号')
})
await check('联系客服弹窗带编号', async () => {
  await page.locator('button:has-text("联系客服下单")').first().click()
  await page.waitForSelector('.el-dialog img[alt="客服二维码"]')
  await page.waitForSelector('.el-dialog >> text=咨询账号编号')
  await page.keyboard.press('Escape')
})
await check('账号详情', async () => {
  await page.locator('.el-table__body-wrapper button:has-text("详情")').first().click()
  await page.waitForSelector('text=报价明细')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/03-detail.png` })
})
await check('出租算价', async () => {
  await page.goto(base + '#/pricing')
  await page.waitForSelector('text=出租精准算价')
  await page.fill('input[placeholder="微信 / QQ / 手机"]', 'wx_test')
  for (const [label, opt] of [['大区', 'QQ区'], ['上号方式', '扫码']]) {
    await page.locator(`.el-form-item:has(label:text-is("${label}")) .el-select`).click()
    await page.locator(`.el-select-dropdown:visible li:has-text("${opt}")`).click()
  }
  await page.click('button:has-text("立即精准计算")')
  await page.waitForSelector('text=号主可得')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/04-pricing.png` })
})
await check('回收估值 + 提交得单号', async () => {
  await page.goto(base + '#/recycle')
  await page.fill('input[placeholder="微信 / QQ / 手机"]', 'wx_smoke_' + Date.now())
  for (const [label, opt] of [['大区', 'VX区'], ['上号方式', '账密']]) {
    await page.locator(`.el-form-item:has(label:text-is("${label}")) .el-select`).click()
    await page.locator(`.el-select-dropdown:visible li:has-text("${opt}")`).click()
  }
  await page.click('button:has-text("估价")')
  await page.waitForSelector('text=参考区间')
  await page.click('button:has-text("确认提交回收申请")')
  await page.waitForSelector('text=已提交回收申请')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/05-recycle.png` })
})
await check('客服中心', async () => {
  await page.goto(base + '#/contact')
  await page.waitForSelector('text=排班表')
  await page.waitForSelector('img[alt="客服二维码"]')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/06-contact.png` })
})
await check('会员访问后台被拦到后台登录', async () => {
  await page.goto(base + '#/admin/dashboard')
  await page.waitForSelector('text=后台登录')
  await page.waitForSelector('text=admin123')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/07-admin-login.png` })
})
await check('后台登录 -> 看板', async () => {
  await page.click('text=一键填入')
  await page.click('button:has-text("登录")')
  await page.waitForSelector('text=空闲可租账号')
  await page.waitForSelector('text=待跟进回收单')
  await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/08-admin-dashboard.png` })
})
for (const [path, text, shot] of [['inventory', '新增账号', '09-inventory'], ['orders', '登记出租订单', '10-orders'], ['recycles', '系统参考', '11-recycles'], ['rules', '大额折扣档', '12-rules'], ['audit', '操作日志', '13-audit']]) {
  await check(`后台 ${path}`, async () => {
    await page.goto(base + '#/admin/' + path)
    await page.waitForSelector(`text=${text}`)
    await page.waitForTimeout(300)
    await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/${shot}.png` })
  })
}
await check('登记订单后账号从大厅消失', async () => {
  await page.goto(base + '#/admin/orders')
  await page.click('button:has-text("登记出租订单")')
  await page.locator('.el-dialog .el-select').first().click()
  const opt = page.locator('.el-select-dropdown:visible li').first()
  const no = (await opt.innerText()).split(' ')[0]
  await opt.click()
  await page.locator('.el-dialog .el-form-item:has-text("租客联系方式") input').fill('wx_renter_smoke')
  await page.click('button:has-text("登记并锁定账号")')
  await page.waitForSelector('text=登记成功')
  await page.goto(base + '#/accounts')
  await page.waitForSelector('text=共 14 个空闲可租账号')
  if (await page.locator(`.el-table__row:has-text("${no}")`).count()) throw new Error('仍在大厅')
})
await browser.close()
for (const r of results) console.log(r.join(' | '))
const uniq = [...new Set(errors)]
if (uniq.length) console.log('console errors:', uniq)
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed || uniq.length ? 1 : 0)
