// drizzle 會把 pg 的錯誤包在 DrizzleQueryError.cause 裡，兩層都檢查
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    const pgErr = e as Error & { code?: string; constraint?: string }
    if (pgErr.code === '23505') {
      return constraint === undefined || pgErr.constraint === constraint
    }
  }
  return false
}
