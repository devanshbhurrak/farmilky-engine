import { isProd } from '../config/env.js';

type LogFields = Record<string, unknown>;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function serialize(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: Level, first: LogFields | string | Error, second?: string): void {
  const minLevel = isProd() ? LEVELS.info : LEVELS.debug;
  if (LEVELS[level] < minLevel) return;

  let payload: LogFields;
  if (typeof first === 'string') {
    payload = { msg: first };
  } else if (first instanceof Error) {
    payload = { err: first, msg: second };
  } else {
    payload = { ...first, msg: second };
  }

  const line = JSON.stringify({ level, time: new Date().toISOString(), ...payload }, serialize);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug(fields: LogFields | string, msg?: string) { emit('debug', fields, msg); },
  info(fields: LogFields | string, msg?: string) { emit('info', fields, msg); },
  warn(fields: LogFields | string, msg?: string) { emit('warn', fields, msg); },
  error(fields: LogFields | string | Error, msg?: string) { emit('error', fields, msg); },
  child() { return logger; },
};

export function createLogger() {
  return logger;
}
