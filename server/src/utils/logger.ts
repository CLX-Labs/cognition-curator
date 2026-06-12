import winston from 'winston';

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  silent: process.env.NODE_ENV === 'test',
  format: winston.format.combine(
    winston.format.timestamp(),
    isDev
      ? winston.format.combine(winston.format.colorize(), winston.format.simple())
      : winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});
