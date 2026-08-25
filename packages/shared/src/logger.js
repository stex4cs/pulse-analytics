import pino from 'pino';
import { config } from './config.js';

export function createLogger(name) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? (config.env === 'production' ? 'info' : 'debug'),
    transport: config.env === 'production'
      ? undefined
      : { target: 'pino/file', options: { destination: 1 } },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'password_hash'],
      remove: true,
    },
  });
}
