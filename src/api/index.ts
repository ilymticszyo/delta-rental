import { LocalApi } from './local'
import type { Api } from './types'

// 切换后端：实现一个 HttpApi implements Api（同域 /api），然后在这里替换。
export const api: Api = new LocalApi()
export { depositBalance, payableBalance, ApiError } from './local'
export type { Api, OrderView, OrderPreview, ImportOutcome } from './types'
