export class ApiError extends Error {
  constructor(message: string, public code = 400, public persist = false) {
    super(message)
    this.name = 'ApiError'
  }
}
