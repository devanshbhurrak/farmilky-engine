import pino from 'pino';
import { isProd } from '../config/env.js';

export const logger = pino({
  level: isProd() ? 'info' : 'debug',
});

export function createLogger() {
  return logger;
}
