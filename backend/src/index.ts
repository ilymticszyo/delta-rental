import './load-env'
import { assertConfig, config } from './config'
import { app, startExpiredOrderSweep } from './app'
import { prisma } from './persistence'
import { seed } from './seed'

assertConfig()

seed()
  .then((r) => {
    console.log(r.seeded ? 'seeded initial data' : 'database already initialized')
    const stopSweep = startExpiredOrderSweep()
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`delta-rental api listening on :${config.port}`)
    })
    const shutdown = () => {
      stopSweep()
      server.close(() => {
        prisma.$disconnect().finally(() => process.exit(0))
      })
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })