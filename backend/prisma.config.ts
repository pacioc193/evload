import { defineConfig } from 'prisma/config'

const defaultDatabaseUrl = (process.env.NODE_ENV ?? 'development') === 'production'
  ? 'file:./data/evload.db'
  : 'file:./dev.db'

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
})
