// 端到端冒烟（v0.2，覆盖五档角色）：node scripts/smoke.mjs <url> <shotDir>
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
const [url = 'http://localhost:4173/', dir = 'shots'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const results = []
const base = url.replace(/#.*$/, '')
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${dir}/${name}.png` }) }
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (e) {
    results.push(['FAIL', name, String(e).split('\n')[0].slice(0, 220)])
    await page.screenshot({ path: `${dir}/FAIL-${results.length}.png` }).catch(() => {})
  }
}
const go = async (hash) => { await page.goto(base + '#' + hash); await page.waitForLoadState('networkidle') }
const expectNo = async (re, what) => { const t = await page.locator('body').innerText(); if (re.test(t)) throw new Error(`页面不应出现 ${what}: ${t.match(re)[0]}`) }
const pickSelect = async (scope, label, option) => {
  await scope.locator(`.el-form-item:has(label:text-is("${label}")) .el-select`).first().click()
  await page.locator(`.el-select-dropdown:visible li:has-text("${option}")`).first().click()
}
async function login(user, pass, admin = false) {
  await page.evaluate(() => localStorage.removeItem('dr:v1:session')).catch(() => {})
  await go(admin ? '/admin/login' : '/login')
  await page.fill('input[name=username]', user)
  await page.fill('input[name=password]', pass)
  await page.click('button:has-text("登录")')
  await page.waitForTimeout(400)
}
const png = path.join(dir, '_upload.png')
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

// ---------- 登录页 ----------
await check('登录页列出五档角色演示账号', async () => {
  await go('/accounts')
  await page.waitForSelector('text=登录（成员 / 号主 / 员工统一入口）')
  for (const r of ['号主', '内部成员', '客服', '运营', '管理员']) await page.waitForSelector(`.demo-table >> text=${r}`)
  await page.evaluate(() => localStorage.clear())
  await go('/login')
  await shot('01-login-roles')
})

// ---------- 号主 ----------
await check('号主登录 → 我的账号：只见状态 / 到期 / 到手，不见租客与订单', async () => {
  await login('owner1', 'owner123')
  await page.waitForSelector('text=我的账号')
  await page.waitForSelector('.el-table__row >> text=出租中')
  await page.waitForSelector('.el-table__row >> text=待确认')
  await expectNo(/wx_renter|wx_vip|ZD\d{5}|服务费|抽成金额/, '租客 / 订单 / 抽成')
  await shot('02-owner-accounts')
})
await check('号主账号详情', async () => {
  await page.locator('.el-table__row:has-text("空闲") button:has-text("详情")').first().click()
  await page.waitForSelector('text=寄租到手')
  await page.waitForSelector('button:has-text("转入回收估值")')
  await expectNo(/wx_renter|ZD\d{5}|服务费/, '租客 / 订单 / 服务费')
  await shot('03-owner-detail')
})
await check('号主从账号转入回收估值：资产自动带入，估价含市场系数与参考成交，提交成功', async () => {
  await page.click('button:has-text("转入回收估值")')
  await page.waitForSelector('text=资产已自动带入')
  await page.click('button:has-text("估价")')
  await page.waitForSelector('text=整体市场系数')
  await page.waitForSelector('text=近期同类成交参考')
  await shot('04-owner-transfer-estimate')
  await page.click('button:has-text("确认提交回收申请")')
  await page.waitForSelector('text=已提交回收申请')
})
await check('号主上架：复用回收估值 + 上传截图 + 自动估到手 → 待确认', async () => {
  await go('/owner/list')
  await page.waitForSelector('text=上架新账号')
  await page.locator('.el-form-item:has(label:text-is("复用回收估值")) .el-select').click()
  await page.locator('.el-select-dropdown:visible li').first().click()
  await page.waitForSelector('text=已复用回收估值里的资产')
  await page.setInputFiles('.el-upload input[type=file]', png)
  await page.click('button:has-text("估算到手")')
  await page.waitForSelector('text=每个租期预计到手')
  await page.click('button:has-text("提交上架")')
  await page.waitForSelector('text=已提交上架')
  await shot('05-owner-list')
})
await check('号主看大厅：不展示报价列', async () => {
  await go('/accounts')
  await page.waitForSelector('text=号主视图：大厅不展示租金与报价')
  if (await page.locator('.el-table__header >> text=总金额').count()) throw new Error('出现了总金额列')
  await shot('06-owner-lobby')
})
await check('号主算价只回显到手金额', async () => {
  await go('/pricing')
  await page.waitForSelector('text=出租精准算价')
  await page.fill('input[placeholder="微信 / QQ / 手机"]', 'wx_owner_wang')
  await pickSelect(page, '大区', 'QQ区')
  await pickSelect(page, '上号方式', '扫码')
  await page.click('button:has-text("立即精准计算")')
  await page.waitForSelector('text=预计到手金额')
  await expectNo(/服务费（|号主可得|租客总金额/, '服务费 / 租客总额')
  await shot('07-owner-pricing')
})
await check('号主访问后台被拦截', async () => {
  await go('/admin/dashboard')
  await page.waitForSelector('text=当前角色无权进入后台')
})

// ---------- 内部成员 ----------
await check('成员大厅有报价；算价不见服务费与号主可得', async () => {
  await login('demo', 'demo123')
  await page.waitForSelector('.el-table__header >> text=总金额')
  await go('/pricing')
  await page.waitForSelector('text=出租精准算价')
  await page.fill('input[placeholder="微信 / QQ / 手机"]', 'wx_test')
  await pickSelect(page, '大区', 'QQ区')
  await pickSelect(page, '上号方式', '扫码')
  await page.fill('input[placeholder^="可选：熟客"]', 'wx_vip_laoliu')
  await page.click('button:has-text("立即精准计算")')
  await page.waitForSelector('text=已识别熟客')
  if (await page.locator('.el-descriptions__label:text-is("号主可得"), .el-descriptions__label:text-is("服务费")').count()) throw new Error('成员不应看到号主可得 / 服务费')
  await shot('08-member-pricing-regular')
})

// ---------- 客服 ----------
await check('客服看板：到期提醒 + 待付号主款；菜单无规则与日志', async () => {
  await login('cs', 'cs123', true)
  await page.waitForSelector('text=即将到期 / 超期订单')
  await page.waitForSelector('text=到期提醒')
  await page.waitForSelector('text=待付号主款')
  if (await page.locator('.el-menu-item:has-text("规则与估值依据")').count()) throw new Error('客服不应看到规则菜单')
  if (await page.locator('.el-menu-item:has-text("操作日志")').count()) throw new Error('客服不应看到日志菜单')
  await shot('09-cs-dashboard')
})
await check('客服库存只读：有成本 / 回本，无新增与编辑', async () => {
  await go('/admin/inventory')
  await page.waitForSelector('text=客服：只读查看')
  await page.waitForSelector('.el-table__header >> text=回本进度')
  if (await page.locator('button:has-text("新增账号")').count()) throw new Error('客服不应能新增')
  if (await page.locator('button:has-text("下载模板"), button:has-text("批量导入")').count()) throw new Error('客服不应看到导入入口')
  await shot('10-cs-inventory')
})
await check('登记订单：黑名单拦截', async () => {
  await go('/admin/orders')
  await page.click('button:has-text("登记出租订单")')
  await page.locator('.el-dialog .el-select').first().click()
  await page.locator('.el-select-dropdown:visible li').first().click()
  await page.fill('.el-dialog input[placeholder^="微信号"]', 'wx_black_ahu')
  await page.waitForSelector('.el-dialog >> text=黑名单，禁止登记')
  if (!(await page.locator('.el-dialog button:has-text("登记并锁定账号")').isDisabled())) throw new Error('黑名单时登记按钮应禁用')
  await shot('11-order-blacklist')
})
await check('登记订单：熟客自动带入优惠并免押金，登记成功', async () => {
  await page.fill('.el-dialog input[placeholder^="微信号"]', 'wx_vip_laoliu')
  await page.waitForSelector('.el-dialog >> text=熟客：')
  await page.waitForSelector('.el-dialog >> text=熟客免押金')
  await shot('12-order-regular')
  await page.click('.el-dialog button:has-text("登记并锁定账号")')
  await page.waitForSelector('text=登记成功')
})
await check('订单详情：生命周期留痕、押金与号主应付台账', async () => {
  await page.waitForTimeout(500)
  await page.locator('.el-table__row').first().locator('button:has-text("详情")').click()
  await page.waitForSelector('.el-drawer >> text=生命周期留痕')
  await page.click('.el-drawer button:has-text("登记交号")')
  await page.waitForSelector('.el-drawer .el-timeline >> text=交号')
  await page.waitForSelector('.el-drawer >> text=号主应付')
  await shot('13-order-detail')
  await page.keyboard.press('Escape')
})
for (const [p, text, name] of [['payables', '余额', '14-payables'], ['renters', '租过次数', '15-renters'], ['owners', '累计结算', '16-owners'], ['reports', '哪类号最好租', '17-reports']]) {
  await check(`客服可访问 ${p}`, async () => { await go('/admin/' + p); await page.waitForSelector(`text=${text}`); await shot(name) })
}
await check('报表切换维度', async () => {
  await page.click('.el-radio-button:has-text("段位")')
  await page.waitForSelector('text=按段位')
  await page.waitForSelector('text=自收号回本周期')
})
await check('客服访问规则页被拒（403）', async () => {
  await go('/admin/rules')
  await page.waitForSelector('text=无权限（403）')
})
await check('租客档案：打黑名单标签', async () => {
  await go('/admin/renters')
  await page.click('button:has-text("新建档案 / 打标签")')
  await page.locator('.el-dialog .el-form-item:has-text("联系方式") input').fill('wx_e2e_bad')
  await page.locator('.el-dialog .el-radio:has-text("黑名单")').click()
  await page.click('.el-dialog button:has-text("保存")')
  await page.waitForSelector('.el-table__row:has-text("wx_e2e_bad") >> text=黑名单')
})

// ---------- 运营 ----------
await check('运营：改整体市场系数 + 新增参考成交价 → 生成新版本', async () => {
  await login('ops', 'ops123', true)
  await go('/admin/rules')
  await page.click('.el-tabs__item:has-text("回收估值依据")')
  const inp = page.locator('.el-form-item:has(label:text-is("整体市场系数")) input')
  await inp.fill('1.10'); await inp.blur()
  await page.click('button:has-text("+ 添加参考成交")')
  await page.locator('.el-form-item:has(label:text-is("修改说明")) input').last().fill('e2e：市场上浮 10%')
  await page.click('button:has-text("保存估值依据")')
  await page.waitForSelector('text=e2e：市场上浮 10%')
  await page.click('#pane-valuation button:has-text("试算")')
  await page.waitForSelector('text=市场系数 1.1')
  await shot('18-ops-rules-valuation')
  await page.click('.el-tabs__item:has-text("出租计价规则")')
  await page.waitForSelector('text=熟客优惠')
  await shot('19-ops-rules-pricing')
})
await check('运营：人工确认号主上架的待确认账号', async () => {
  await go('/admin/inventory?status=draft')
  await page.waitForSelector('.el-table__row >> text=号主寄租')
  await page.locator('.el-table__fixed-right .el-table__row, .el-table__row').first().locator('button:has-text("状态")').click()
  await page.locator('.el-dropdown-menu:visible li:has-text("人工确认上架")').click()
  await page.waitForSelector('text=状态已更新')
  await go('/admin/inventory?source=buyin')
  await page.waitForSelector('.el-progress')
  await shot('20-ops-inventory-payback')
})

// ---------- 运营：Excel 批量导入 ----------
const tag = 'E2E' + String(Date.now() % 100000).padStart(5, '0')
const tplPath = path.join(dir, '_template.xlsx'), impPath = path.join(dir, '_import.xlsx')
await check('运营：库存页「下载模板」得到 .xlsx（每个字段一列 + 示例行 + 填写说明）', async () => {
  await go('/admin/inventory')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("下载模板")')])
  if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error('文件名：' + dl.suggestedFilename())
  await dl.saveAs(tplPath)
  const wb = XLSX.read(fs.readFileSync(tplPath))
  if (wb.SheetNames.join() !== '账号导入,填写说明') throw new Error('工作表：' + wb.SheetNames)
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['账号导入'], { header: 1, defval: '' })
  for (const h of ['账号编号*', '大区*', '段位*', '纯币(M)*', '皮肤', '来源*', '成本(元)']) if (!aoa[0].includes(h)) throw new Error('模板缺列 ' + h)
  if (aoa.length !== 2) throw new Error('模板应只有表头 + 1 行示例')
  // 在模板上填：3 行合法 + 4 行有误（缺必填 / 格式 / 文件内重复 / 与库存重复）
  const H = aoa[0], ex = aoa[1]
  const mk = (o) => H.map((h, i) => (h.replace('*', '') in o ? o[h.replace('*', '')] : ex[i]))
  const rows = [H,
    mk({ 账号编号: tag + 'A', 备注: 'e2e 合法 1' }),
    mk({ 账号编号: tag + 'B', 来源: '自收', '成本(元)': 900, 号主联系方式: '', 备注: 'e2e 合法 2（自收）' }),
    mk({ 账号编号: tag + 'C', 大区: '', 备注: 'e2e 缺大区' }),
    mk({ 账号编号: tag + 'D', '纯币(M)': 'abc', 备注: 'e2e 纯币格式错' }),
    mk({ 账号编号: tag + 'A', 备注: 'e2e 文件内重复' }),
    mk({ 账号编号: 'DF10001', 备注: 'e2e 与库存重复' }),
    mk({ 账号编号: tag + 'E', 皮肤: '', 段位: '巅峰', 备注: 'e2e 合法 3' }),
  ]
  const out = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(rows), '账号导入')
  fs.writeFileSync(impPath, XLSX.write(out, { type: 'buffer', bookType: 'xlsx' }))
})
await check('上传含好坏行的文件：逐行校验，错误行标红并给出行号与原因', async () => {
  await page.click('button:has-text("批量导入")')
  await page.waitForSelector('.import-dialog >> text=下载模板并填写')
  await page.setInputFiles('.import-upload input[type=file]', impPath)
  await page.waitForSelector('.import-summary >> text=合法 3 行')
  await page.waitForSelector('.import-summary >> text=有误 4 行（将跳过）')
  for (const t of ['第 4 行：「大区」必填', '第 5 行：「纯币(M)」应为非负数字，实际为「abc」', `第 6 行：账号编号「${tag}A」与本文件第 2 行重复`, '第 7 行：账号编号「DF10001」与库存已有账号重复'])
    await page.waitForSelector(`.import-row-bad .import-errors >> text=${t}`)
  if ((await page.locator('.import-row-bad').count()) !== 4) throw new Error('标红行数应为 4')
  const color = await page.locator('.import-errors').first().evaluate((e) => getComputedStyle(e).color)
  if (color !== 'rgb(245, 108, 108)') throw new Error('错误原因不是红色：' + color)
  await shot('24-import-validate')
  await page.click('.import-summary .el-radio-button:has-text("只看有误")')
  await page.waitForTimeout(300)
  if ((await page.locator('.import-dialog .el-table__body tr').count()) !== 4) throw new Error('只看有误应为 4 行')
  await shot('25-import-validate-bad-only')
})
await check('确认导入：合法行一次性入库，非法行跳过', async () => {
  await page.click('.import-dialog button:has-text("确认导入 3 行（跳过 4 行）")')
  await page.waitForSelector('.import-outcome >> text=已导入 3 个账号（待确认）')
  await page.waitForSelector('.import-outcome >> text=第 4、5、6、7 行')
  await shot('26-import-done')
  await page.click('.import-dialog .el-dialog__footer button:has-text("关闭")')
})
await check('导入的账号为「待确认」，确认上架后才可租；操作日志可追溯', async () => {
  await page.waitForTimeout(500)
  for (const n of ['A', 'B', 'E']) await page.waitForSelector(`.el-table__row:has-text("${tag}${n}") >> text=待确认`)
  for (const n of ['C', 'D']) if (await page.locator(`.el-table__row:has-text("${tag}${n}")`).count()) throw new Error(tag + n + ' 不应入库')
  await page.waitForSelector(`.el-table__row:has-text("${tag}B") >> text=自收`)
  await shot('27-import-pending-accounts')
  await go('/admin/inventory?kw=' + tag + 'A')
  await page.locator(`.el-table__row:has-text("${tag}A")`).first().locator('button:has-text("状态")').click()
  await page.locator('.el-dropdown-menu:visible li:has-text("人工确认上架")').click()
  await page.waitForSelector('text=状态已更新')
  await page.waitForSelector(`.el-table__row:has-text("${tag}A") >> text=空闲可租`)
})
await check('运营不能看员工与日志', async () => {
  await go('/admin/audit')
  await page.waitForSelector('text=无权限（403）')
})

// ---------- 管理员 ----------
await check('管理员：员工与角色、操作日志、号主门户全部', async () => {
  await login('admin', 'admin123', true)
  await go('/admin/staff')
  await page.waitForSelector('text=员工与角色')
  await shot('21-admin-staff')
  await go('/admin/audit')
  await page.waitForSelector('text=租客标签')
  await page.waitForSelector('text=批量导入')
  await page.waitForSelector(`text=导入 3 条（待确认）`)
  await page.waitForSelector('text=估值依据')
  await shot('22-admin-audit')
  await go('/owner/accounts')
  await page.waitForSelector('text=号主门户（管理员查看全部）')
  await page.waitForSelector('.el-table__row >> text=李老板')
  await shot('23-admin-owner-portal')
})
await check('角色切换器可切到号主', async () => {
  await go('/admin/dashboard')
  await page.click('button:has-text("切换演示角色")')
  await page.locator('.el-dropdown-menu:visible li:has-text("李老板")').click()
  await page.waitForSelector('text=我的账号')
  await page.waitForSelector('.el-table__row')
})

await browser.close()
for (const f of [png, tplPath, impPath]) fs.rmSync(f, { force: true })
for (const r of results) console.log(r.join(' | '))
const uniq = [...new Set(errors)]
if (uniq.length) console.log('console errors:', uniq)
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed || uniq.length ? 1 : 0)
