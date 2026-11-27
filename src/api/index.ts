import { LocalApi } from './local'
import type { Api } from './types'

// 切换后端：实现一个 HttpApi implements Api，然后在这里替换。
export const api: Api = new LocalApi()
export { depositBalance, ApiError } from './local'
export type { Api } from './types'
