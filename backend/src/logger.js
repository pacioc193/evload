const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const logDir = process.env.LOG_DIR || path.resolve('/app/logs');

const textFormat = winston.format.printf(({ timestamp, level, message, stack }) => {
  return stack
    ? `${timestamp} [${level}]: ${message}\n${stack}`
    : `${timestamp} [${level}]: ${message}`;
});

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  textFormat
);

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      textFormat
    ),
  }),
];

// Only add file transport if the log directory is accessible
try {
  fs.mkdirSync(logDir, { recursive: true });
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD-HH',
      maxFiles: '2d',
      zippedArchive: false,
      auditFile: path.join(logDir, '.audit.json'),
    })
  );
} catch (err) {
  // File transport unavailable (e.g., in test environments); console-only logging
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: baseFormat,
  transports,
});

module.exports = logger;
