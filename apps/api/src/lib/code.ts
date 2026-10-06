import { randomInt } from 'node:crypto'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const CODE_LENGTH = 7

// 62^7 ≈ 3.5 兆種組合；碰撞由呼叫端靠 unique constraint 重試處理
export function generateCode(length: number = CODE_LENGTH): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    // randomInt 內部做 rejection sampling，不會有 modulo bias
    code += BASE62[randomInt(BASE62.length)]
  }
  return code
}
