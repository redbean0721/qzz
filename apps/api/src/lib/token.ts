import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// 256-bit 隨機 token，base64url 編碼後 43 字元
export function generateDeleteToken(): string {
  return randomBytes(32).toString('base64url')
}

// token 本身是高熵亂數，不需要 bcrypt/argon2，SHA-256 即可
export function hashDeleteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function verifyDeleteToken(token: string, hash: string): boolean {
  const actual = Buffer.from(hashDeleteToken(token), 'hex')
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
