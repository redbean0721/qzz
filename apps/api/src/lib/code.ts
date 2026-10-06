import { randomInt } from 'node:crypto'
import { isUniqueViolation } from './db-errors.js'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const CODE_LENGTH = 7
export const CODE_PATTERN = /^[0-9A-Za-z]{1,16}$/

const MAX_CODE_ATTEMPTS = 5

// 62^7 ≈ 3.5 兆種組合；碰撞由 insertWithUniqueCode 靠 unique constraint 重試處理
export function generateCode(length: number = CODE_LENGTH): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    // randomInt 內部做 rejection sampling，不會有 modulo bias
    code += BASE62[randomInt(BASE62.length)]
  }
  return code
}

// 產生 code 並執行 insert，撞到指定的 unique constraint 就換一個重試
export async function insertWithUniqueCode(
  constraint: string,
  insert: (code: string) => Promise<unknown>,
  onCollision?: (code: string, attempt: number) => void,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode()
    try {
      await insert(code)
      return code
    } catch (err) {
      if (!isUniqueViolation(err, constraint)) throw err
      onCollision?.(code, attempt)
    }
  }
  throw new Error(`failed to allocate a unique short code after ${MAX_CODE_ATTEMPTS} attempts`)
}
