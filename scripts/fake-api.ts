// 本地以 http 模式联调前端：npm run fake-api（默认 :8080），另开 npm run dev:http
import { createFakeBackend, startFakeServer } from '../tests/contract/fakeBackend'
const port = Number(process.env.PORT ?? 8080)
const fake = createFakeBackend({ demo: process.env.FAKE_DEMO !== '0' })
startFakeServer(fake, port).then(({ port }) => console.log(`fake API listening on http://127.0.0.1:${port}/api （数据在内存中，重启即重置）`))
