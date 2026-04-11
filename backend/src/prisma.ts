import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const defaultDatabaseUrl = (process.env.NODE_ENV ?? 'development') === 'production'
	? 'file:./data/evload.db'
	: 'file:./dev.db'

const databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl
const adapter = new PrismaLibSql({ url: databaseUrl })

export const prisma = new PrismaClient({ adapter })
