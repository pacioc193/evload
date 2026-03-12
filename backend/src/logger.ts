import winston from 'winston'
import path from 'path'

const LOG_DIR = path.join(process.cwd(), 'logs')

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxFiles: 2,
      tailable: true,
    } as winston.transports.FileTransportOptions),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxFiles: 2,
      tailable: true,
    } as winston.transports.FileTransportOptions),
  ],
})
