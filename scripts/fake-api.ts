// 本地以 http 模式联调前端：npm run fake-api（默认 :8080），另开 npm run dev:http
// 环境变量：PORT；FAKE_DEMO=0 关闭演示开关；FAKE_PROPOSED=0 模拟未实现提议接口 / 字段的后端；FAKE_ADMIN_ONLY=1 只保留管理员账号
import { createFakeBackend, startFakeServer } from '../tests/contract/fakeBackend'
const port = Number(process.env.PORT ?? 8080)
const fake = createFakeBackend({ demo: process.env.FAKE_DEMO !== '0', proposed: process.env.FAKE_PROPOSED !== '0', adminOnly: process.env.FAKE_ADMIN_ONLY === '1' })
startFakeServer(fake, port).then(({ port }) => console.log(`fake API listening on http://127.0.0.1:${port}/api （数据在内存中，重启即重置）`))
