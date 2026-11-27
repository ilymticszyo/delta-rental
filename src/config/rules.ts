// 规则与字典的默认配置（开箱数据）。运行时由后台「规则配置」修改并持久化。
// 文中数字均为 PRD 第 7 章示例初值。

export interface DiscountTier { threshold: number; ratioPlus: number; discount: number }
export interface PricingRule {
  version: number
  channelFeeRates: Record<string, number> // 渠道服务费率 %
  triggerMetric: 'coinAmount' | 'totalAssets'
  discountTiers: DiscountTier[]
  customDiscountMin: number
  customDiscountMax: number
  dayCalcMode: 'byCycleRate' | 'fixedDays'
  cycleValues: Record<string, number> // byCycleRate: M/天；fixedDays: 天数
  extraFee: { mode: 'fixed' | 'percent'; value: number } // 附加服务费，默认 0
  defaultDeposit: number
}

export interface ValuationRule {
  version: number
  buyRatio: number // 回收比例 W/元
  buyDiscount: number
  banFactor: number
  rejectIfBanned: boolean
  floatDown: number
  floatUp: number
  skinCategoryPrices: Record<string, number> // 按皮肤类别默认单价
  skinPrices: Record<string, number> // 单个皮肤单价（覆盖类别价）
  extraItemPrices: { awm: number; helmet6: number; armor6: number; experienceCard: number }
  rankPrices: Record<string, number>
}

export const defaultPricingRule: PricingRule = {
  version: 1,
  channelFeeRates: { 普通区: 5, 平台专区: 10 },
  triggerMetric: 'coinAmount',
  discountTiers: [
    { threshold: 300, ratioPlus: 1, discount: 98 },
    { threshold: 400, ratioPlus: 1, discount: 97 },
    { threshold: 500, ratioPlus: 1, discount: 96 },
    { threshold: 600, ratioPlus: 1, discount: 95 },
  ],
  customDiscountMin: 80,
  customDiscountMax: 100,
  dayCalcMode: 'byCycleRate',
  cycleValues: { '5M/天': 5, '10M/天': 10, '20M/天': 20, '30M/天': 30 },
  extraFee: { mode: 'fixed', value: 0 },
  defaultDeposit: 0,
}

export const defaultValuationRule: ValuationRule = {
  version: 1,
  buyRatio: 25,
  buyDiscount: 0.8,
  banFactor: 0.8,
  rejectIfBanned: false,
  floatDown: 0.05,
  floatUp: 0.05,
  skinCategoryPrices: { 红皮: 30, 刀皮: 40, 金皮: 20, 砖皮: 50 },
  skinPrices: {},
  extraItemPrices: { awm: 0, helmet6: 0, armor6: 0, experienceCard: 0 },
  rankPrices: {},
}

// 选项字典（v1 只读，后续接后台字典管理）
export const dicts = {
  regions: ['QQ区', 'VX区'],
  loginMethods: ['扫码', '账密', '均可'],
  channels: ['普通区', '平台专区'],
  ranks: ['青铜', '白银', '黄金', '铂金', '钻石', '黑鹰', '巅峰'],
  safeBoxes: [2, 4, 6, 9],
  stamina: ['1级', '2级', '3级', '4级', '5级', '6级', '7级'],
  loads: ['1级', '2级', '3级', '4级', '5级', '6级', '7级'],
  cycles: Object.keys(defaultPricingRule.cycleValues),
  skins: [
    { name: '威龙·赤焰', category: '红皮' },
    { name: '蜂医·霓虹', category: '红皮' },
    { name: '骇爪·暗影', category: '红皮' },
    { name: '红狼·烈阳', category: '红皮' },
    { name: '牧羊人·极光', category: '红皮' },
    { name: '露娜·星夜', category: '红皮' },
    { name: '深蓝·潮汐', category: '红皮' },
    { name: '龙牙战刀', category: '刀皮' },
    { name: '影锋匕首', category: '刀皮' },
    { name: '破晓爪刀', category: '刀皮' },
    { name: '金色M4A1', category: '金皮' },
    { name: '金色AK-12', category: '金皮' },
    { name: '金色AWM', category: '金皮' },
    { name: '典藏·雷霆', category: '砖皮' },
    { name: '典藏·苍穹', category: '砖皮' },
  ] as { name: string; category: string }[],
}

export const skinCategory = (name: string) => dicts.skins.find((s) => s.name === name)?.category ?? '未配置'

export const quickFilters = [
  { key: 'discount', label: '折扣区' },
  { key: 'small', label: '小额区（≤300元）' },
  { key: 'box9', label: '9 格' },
  { key: 'box6', label: '6 格' },
  { key: 'box4', label: '4 格' },
]
