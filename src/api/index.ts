import { HttpApi } from './http'
import { LocalApi } from './local'
import type { Api } from './types'

// VITE_API_MODE=mock（默认，浏览器 localStorage 演示，GitHub Pages 用这个）| http（真实后端，同域 /api）
export const API_MODE: 'mock' | 'http' = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock'
export const api: Api = API_MODE === 'http' ? new HttpApi({ baseUrl: import.meta.env.VITE_API_BASE || '/api' }) : new LocalApi()
export { depositBalance, payableBalance } from './local'
export { ApiError } from './errors'
export type { Api, OrderView, OrderPreview, ImportOutcome, ApiFeatures, PricingOptions } from './types'
