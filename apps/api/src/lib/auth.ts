import type { FastifyRequest } from 'fastify'

export function bearerToken(request: FastifyRequest): string | undefined {
  return /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
}
