import { defineConfig } from 'drizzle-kit'

try {
  process.loadEnvFile('.env')
} catch {
  // 沒有 .env 時改用系統環境變數(例如 CI 或正式環境)
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
