import type { LoggerService } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 这些键一旦出现在日志字段里必须打码（token / 口令 / 请求体 / 用户原话）。 */
const SENSITIVE_KEY = /^(authorization|token|access_?token|refresh_?token|password|secret|api_?key|cookie|body|prompt|user_?message|values|content|text)$/i;

const MAX_STRING = 200;
const MAX_DEPTH = 4;
const MAX_ARRAY = 20;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 递归打码 + 截断。
 *
 * 这不是"顺手做的脱敏"，是 NFR-3/4.3.3 的**硬要求**：日志里不得出现令牌、口令、
 * 请求体或患者相关原话。键名命中即整体替换，值长与层级也封顶，避免日志本身成为数据出口。
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[depth-limited]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** 稳定的假名：日志里用 ref 代替真实用户标识（不可逆，但可跨行关联）。 */
export function pseudonymize(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 10);
}

export interface JsonLoggerOptions {
  level?: LogLevel;
  format?: 'json' | 'pretty';
  /** 输出落点；缺省 process.stdout */
  sink?: (line: string) => void;
}

/**
 * 结构化日志（4.2.1）。JSON 一行一条，字段经 redact() 打码。
 * 通过 `app.useLogger(new JsonLogger(...))` 接管 Nest 的 Logger。
 */
export class JsonLogger implements LoggerService {
  private readonly level: LogLevel;
  private readonly format: 'json' | 'pretty';
  private readonly sink: (line: string) => void;

  constructor(options: JsonLoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.format = options.format ?? 'json';
    this.sink = options.sink ?? ((line) => process.stdout.write(line + '\n'));
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }

  private write(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;

    const strings = rest.filter((item): item is string => typeof item === 'string');
    const context = strings.length > 0 ? strings[strings.length - 1] : undefined;
    const trace = level === 'error' && strings.length > 0 ? strings[0] : undefined;

    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      ...(isPlainObject(message) ? { fields: redact(message) } : { message: redact(message) }),
      ...(trace && trace !== context ? { trace: redact(trace) } : {}),
    };

    if (this.format === 'pretty') {
      const tail = record.fields ? ` ${JSON.stringify(record.fields)}` : record.message ? ` ${String(record.message)}` : '';
      this.sink(`[${level}] ${context ?? '-'}${tail}`);
      return;
    }
    this.sink(JSON.stringify(record));
  }
}
