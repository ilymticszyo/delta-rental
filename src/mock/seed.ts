import { dicts } from '../config/rules'
import type { AccountInput, CsAgent } from '../domain/types'

// 伪随机（固定种子，保证每次初始化数据一致）
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
}

export const demoUsers = [
  { username: 'demo', password: 'demo123', displayName: '演示成员', role: 'member' as const },
  { username: 'admin', password: 'admin123', displayName: '演示管理员', role: 'admin' as const },
]

export const demoCsAgents: CsAgent[] = [
  { id: 'cs1', name: '客服小鹿', wechat: 'df_kefu_xiaolu', isFallback: false, schedule: [{ weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }] },
  { id: 'cs2', name: '客服阿杰', wechat: 'df_kefu_ajie', isFallback: false, schedule: [{ weekdays: [1, 2, 3, 4, 5], start: '18:00', end: '24:00' }, { weekdays: [0, 6], start: '10:00', end: '24:00' }] },
  { id: 'cs3', name: '值班客服（备用）', wechat: 'df_kefu_backup', isFallback: true, schedule: [] },
]

const remarks = ['', '', '号主在线快，秒上号', '仅限周末', '可续租', '新号，资产干净', '支持长租优惠', '']

export function seedAccounts(): AccountInput[] {
  const rand = rng(20261127)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
  const out: AccountInput[] = []
  for (let i = 0; i < 20; i++) {
    const coin = Math.round(60 + rand() * 640) // 60M - 700M
    const total = Math.round(coin * (1.3 + rand() * 1.2))
    const skinCount = Math.floor(rand() * 6)
    const skins = [...new Set(Array.from({ length: skinCount }, () => pick(dicts.skins).name))]
    const custom = rand() < 0.2
    out.push({
      status: i < 15 ? 'listed' : i < 17 ? 'rented' : i < 18 ? 'off' : i < 19 ? 'held' : 'draft',
      source: 'manual',
      ownerContact: `wx_owner${String(i + 1).padStart(2, '0')}`,
      region: pick(dicts.regions),
      loginMethod: pick(dicts.loginMethods),
      channel: rand() < 0.7 ? '普通区' : '平台专区',
      assistTime: pick(['09:00-23:00', '全天', '12:00-02:00', '18:00-24:00']),
      banRecord: rand() < 0.1,
      totalAssets: total,
      coinAmount: coin,
      secretKd: Math.round((0.6 + rand() * 3) * 100) / 100,
      level: Math.floor(20 + rand() * 60),
      rank: pick(dicts.ranks),
      safeBox: pick(dicts.safeBoxes),
      stamina: pick(dicts.stamina),
      load: pick(dicts.loads),
      awmCount: Math.floor(rand() * 30),
      helmet6Count: Math.floor(rand() * 20),
      armor6Count: Math.floor(rand() * 20),
      experienceCardCount: Math.floor(rand() * 4),
      skins,
      cycle: pick(dicts.cycles),
      coinRatio: pick([18, 19, 20, 21, 22]),
      discountMode: custom ? 'custom' : 'system',
      customDiscountPercent: custom ? pick([85, 88, 90, 95]) : undefined,
      deposit: pick([0, 0, 100, 200, 300]),
      remark: pick(remarks),
    })
  }
  return out
}
