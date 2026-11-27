export interface FieldError { field: string; message: string }

export class ApiError extends Error {
  constructor(
    message: string,
    public code = 400,
    public persist = false,
    public errorCode?: string,
    public fields?: FieldError[],
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
