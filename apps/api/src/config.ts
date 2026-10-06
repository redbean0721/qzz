if (!process.env.PUBLIC_BASE_URL) {
  throw new Error('PUBLIC_BASE_URL is not set')
}

export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
