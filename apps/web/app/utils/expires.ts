import { EXPIRES_IN, EXPIRES_IN_LABELS } from '@qzz/shared'

export const expiresOptions = EXPIRES_IN.map((value) => ({ label: EXPIRES_IN_LABELS[value], value }))

export function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now()
}
