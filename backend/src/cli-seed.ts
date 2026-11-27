import './load-env'
import { assertConfig } from './config'
import { prisma } from './persistence'
import { seed } from './seed'

assertConfig()
seed({ force: process.argv.includes('--force') })
  .then((r) => {
    console.log(r.seeded ? 'seeded' : 'already seeded')
    return prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
