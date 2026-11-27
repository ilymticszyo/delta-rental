/** 字段级错误（表单校验 / 导入等） */
export interface FieldError { field: string; message: string }

/**
 * 统一错误：mock 与 http 两种实现都抛它。
 * code = HTTP 状态码（mock 也按同样语义填写：400/401/403/404/409/422…）；
 * errorCode = 机器可读错误码（见 docs/api-contract.md「错误」）；fields = 字段级错误。
 */
export class ApiError extends Error {
  constructor(message: string, public code = 400, public errorCode?: string, public fields: FieldError[] = [], public requestId?: string, public details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
  }
}
