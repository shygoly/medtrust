import type { AgentConfig } from '@medtrust/pi-agent';

export const AGENT_CONFIG = 'AGENT_CONFIG';

/**
 * LLM 供应商模式。
 *
 * - `anthropic`：Anthropic Messages API
 * - `deepseek`：OpenAI 兼容协议（`DEEPSEEK_BASE_URL`，默认 https://api.deepseek.com）
 * - `rule-based`：确定性回退，**问题文本不出域**（无 key 或缺 key 时）
 */
export type LlmMode = 'anthropic' | 'deepseek' | 'rule-based';

export interface MedTrustChatConfig {
  port: number;
  nodeEnv: string;
  apiUrl: string;
  apiPrefix: string;
  llmMode: LlmMode;
  /** 实际生效的模型名（按供应商取自 LLM_MODEL / DEEPSEEK_MODEL；rule-based 时为 'rule-based'） */
  llmModelEffective: string;
  anthropicApiKey: string | null;
  llmModel: string;
  llmMaxTokens: number;
  deepseekApiKey: string | null;
  deepseekBaseUrl: string;
  deepseekModel: string;
  sessionTtlHours: number;
  contextMaxMessages: number;
  /** agent 自有凭证（R2）：目录等元数据读取用，缺省读公开目录端点 */
  serviceToken: string | null;
  defaultContracts: string[];
  defaultMinCell: number;
  defaultWindowDays: number;
  corsOrigins: string[];
  /** 会话存储驱动：memory（test/keyless fallback）| postgres（持久化） */
  dbDriver: 'memory' | 'postgres';
  databaseUrl: string;
  /** 单条用户消息字符上限（超出即 413） */
  maxMessageChars: number;
  /** 每用户每分钟请求上限；<=0 关闭该维度 */
  rateLimitPerUserPerMin: number;
  /** 每 IP 每分钟请求上限；<=0 关闭该维度 */
  rateLimitPerIpPerMin: number;
  metricsEnabled: boolean;
  /** Redis 连接串；空 = 不启用（缓存关闭、限流退化为每实例） */
  redisUrl: string | null;
  /** 目录缓存 TTL（秒） */
  directoryCacheTtlSeconds: number;
  /** Redis 键前缀（同库多环境共存时避免撞键） */
  redisKeyPrefix: string;
  /** 是否挂载 /api/docs（OpenAPI/Swagger UI） */
  swaggerEnabled: boolean;
  /** 是否启用 OpenTelemetry 追踪（缺省关闭：不启用就不加载 SDK） */
  otelEnabled: boolean;
  otelServiceName: string;
  otelExporter: 'otlp' | 'console';
  otelEndpoint: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFormat: 'json' | 'pretty';
  /** 供 PiAgent 使用的 system prompt（由 agent 层注入，避免循环依赖） */
  systemPrompt: string;
}

export type EnvLike = Record<string, string | undefined>;

/**
 * 显式列出本应用读取的环境变量。
 *
 * 为什么不用隐式对象属性：`DEPLOY.md` 的环境变量双向对拍按 `process.env.<KEY>` 的
 * **字面形态**扫描（附录第 4 条）。写成 `env.KEY` 会让登记项被判成「死条目」。
 * 新增键时同步改这里 + `.env.example` + `DEPLOY.md` §2。
 */
export function readEnv(): EnvLike {
  return {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    MEDTRUST_API_URL: process.env.MEDTRUST_API_URL,
    MEDTRUST_API_PREFIX: process.env.MEDTRUST_API_PREFIX,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    CHAT_AGENT_SERVICE_TOKEN: process.env.CHAT_AGENT_SERVICE_TOKEN,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_MAX_TOKENS: process.env.LLM_MAX_TOKENS,
    SESSION_TTL_HOURS: process.env.SESSION_TTL_HOURS,
    AGENT_CONTEXT_MAX_MESSAGES: process.env.AGENT_CONTEXT_MAX_MESSAGES,
    DEFAULT_CONTRACTS: process.env.DEFAULT_CONTRACTS,
    DEFAULT_MIN_CELL: process.env.DEFAULT_MIN_CELL,
    DEFAULT_WINDOW_DAYS: process.env.DEFAULT_WINDOW_DAYS,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    CHAT_AGENT_DB: process.env.CHAT_AGENT_DB,
    CHAT_AGENT_DATABASE_URL: process.env.CHAT_AGENT_DATABASE_URL,
    CHAT_MAX_MESSAGE_CHARS: process.env.CHAT_MAX_MESSAGE_CHARS,
    RATE_LIMIT_PER_USER_PER_MIN: process.env.RATE_LIMIT_PER_USER_PER_MIN,
    RATE_LIMIT_PER_IP_PER_MIN: process.env.RATE_LIMIT_PER_IP_PER_MIN,
    METRICS_ENABLED: process.env.METRICS_ENABLED,
    SWAGGER_ENABLED: process.env.SWAGGER_ENABLED,
    REDIS_URL: process.env.REDIS_URL,
    CACHE_DIRECTORY_TTL_SECONDS: process.env.CACHE_DIRECTORY_TTL_SECONDS,
    REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTEL_EXPORTER: process.env.OTEL_EXPORTER,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_FORMAT: process.env.LOG_FORMAT,
  };
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

/** 允许 0：0 在限流语义里是"关闭该维度"，不能被当成缺省值吞掉。 */
const nonNegativeInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/**
 * 从环境变量构建配置。`systemPrompt` 由调用方（agent 层）补，保持本文件对 agent 无依赖。
 */
export function buildChatConfig(
  env: EnvLike,
  systemPrompt = '',
): MedTrustChatConfig {
  const anthropicApiKey = (env.ANTHROPIC_API_KEY ?? '').trim() || null;
  const deepseekApiKey = (env.DEEPSEEK_API_KEY ?? '').trim() || null;
  const llmModel = env.LLM_MODEL ?? 'claude-3-5-sonnet-20241022';
  const deepseekModel = env.DEEPSEEK_MODEL ?? 'deepseek-flash';

  // 供应商选择：LLM_PROVIDER 显式指定优先；否则按"哪个 key 在"推断；都没有则 rule-based。
  // 显式指定了却没有对应 key → 退回 rule-based（**不崩**）：/health/ready 会如实报 llm 模式，
  // 配错能立刻看出来，而不是把演示挂在一个配置笔误上。
  const requested = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
  const llmMode: LlmMode =
    requested === 'anthropic' || requested === 'deepseek' || requested === 'rule-based'
      ? requested === 'anthropic' && !anthropicApiKey
        ? 'rule-based'
        : requested === 'deepseek' && !deepseekApiKey
          ? 'rule-based'
          : requested
      : anthropicApiKey
        ? 'anthropic'
        : deepseekApiKey
          ? 'deepseek'
          : 'rule-based';

  return {
    port: int(env.PORT, 5032),
    nodeEnv: env.NODE_ENV ?? 'development',
    apiUrl: (env.MEDTRUST_API_URL ?? 'http://localhost:5021').replace(/\/+$/, ''),
    apiPrefix: env.MEDTRUST_API_PREFIX ?? '/api/v1',
    llmMode,
    llmModelEffective:
      llmMode === 'deepseek' ? deepseekModel : llmMode === 'anthropic' ? llmModel : 'rule-based',
    anthropicApiKey,
    llmModel,
    llmMaxTokens: int(env.LLM_MAX_TOKENS, 4096),
    deepseekApiKey,
    deepseekBaseUrl: (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
    deepseekModel,
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 24),
    contextMaxMessages: int(env.AGENT_CONTEXT_MAX_MESSAGES, 20),
    serviceToken: (env.CHAT_AGENT_SERVICE_TOKEN ?? '').trim() || null,
    defaultContracts: list(env.DEFAULT_CONTRACTS),
    defaultMinCell: int(env.DEFAULT_MIN_CELL, 5),
    defaultWindowDays: int(env.DEFAULT_WINDOW_DAYS, 90),
    corsOrigins: (env.CORS_ORIGIN ?? 'http://localhost:5020')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    dbDriver:
      (env.CHAT_AGENT_DB ?? 'memory').trim() === 'postgres'
        ? 'postgres'
        : 'memory',
    databaseUrl: env.CHAT_AGENT_DATABASE_URL ?? '',
    maxMessageChars: int(env.CHAT_MAX_MESSAGE_CHARS, 4000),
    rateLimitPerUserPerMin: nonNegativeInt(env.RATE_LIMIT_PER_USER_PER_MIN, 30),
    rateLimitPerIpPerMin: nonNegativeInt(env.RATE_LIMIT_PER_IP_PER_MIN, 120),
    metricsEnabled: (env.METRICS_ENABLED ?? 'true').trim() !== 'false',
    swaggerEnabled: (env.SWAGGER_ENABLED ?? 'true').trim() !== 'false',
    redisUrl: (env.REDIS_URL ?? '').trim() || null,
    directoryCacheTtlSeconds: int(env.CACHE_DIRECTORY_TTL_SECONDS, 300),
    redisKeyPrefix: (env.REDIS_KEY_PREFIX ?? 'medtrust:chat-agent').trim(),
    otelEnabled: (env.OTEL_ENABLED ?? 'false').trim() === 'true',
    otelServiceName: (env.OTEL_SERVICE_NAME ?? 'medtrust-chat-agent').trim(),
    otelExporter: (env.OTEL_EXPORTER ?? 'otlp').trim() === 'console' ? 'console' : 'otlp',
    otelEndpoint: (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim() || null,
    logLevel: LOG_LEVELS.has((env.LOG_LEVEL ?? '').trim())
      ? ((env.LOG_LEVEL ?? '').trim() as 'debug' | 'info' | 'warn' | 'error')
      : 'info',
    logFormat: (env.LOG_FORMAT ?? 'json').trim() === 'pretty' ? 'pretty' : 'json',
    systemPrompt,
  };
}

export function toAgentConfig(config: MedTrustChatConfig): AgentConfig {
  return {
    systemPrompt: config.systemPrompt,
    maxTokens: config.llmMaxTokens,
  };
}
