// omop-data-source-access —— 数据源配置模型（task 1.1 / 1.2，omop-data-source-access D4；凭据边界 D-CN-6）。
//
// 配置是**部署期**的、只存在于连接器侧：由 `CONNECTOR_CDM_SOURCES`（JSON）或
// `CONNECTOR_CDM_SOURCES_FILE`（JSON 文件路径）提供。形态借鉴 vantage6 的
// `databases: [{label, uri, type, env}]`——按 label 引用、凭据只在节点侧。
//
// 凭据铁律（spec: 数据库凭据不出连接器）：
//   · 配置里**只存凭据引用**（环境变量名 `passwordEnv`），不存密码本身；
//   · 连接串里夹带密码 → 直接拒绝配置（最常见的泄露方式就是把整串打进日志）；
//   · 任何要离开本模块的描述（审计、上报、错误信息）一律走 `describeSource()`，
//     它在类型层面就不含密码字段。
//
// 配置项是**白名单**（task 4.4）：数据源只供连接器进程自己用，没有「开放给算法模块 /
// agent」之类的开关；写了不认识的项就拒绝，而不是静默忽略让人以为配上了。
import { DATA_SOURCE_LABEL_PATTERN } from '@medtrust/database';

/** 已实现的方言（D-CN-7：第一版只 PostgreSQL，未实现的明确拒绝）。 */
export const IMPLEMENTED_DIALECTS = ['postgresql'] as const;
export type ImplementedDialect = (typeof IMPLEMENTED_DIALECTS)[number];

/** 已支持的 CDM 版本（5.3 与 5.4 字段有差异，未决前只支持 5.4）。 */
export const SUPPORTED_CDM_VERSIONS = ['5.4'] as const;

export interface CdmSchemas {
  /** CDM 视图所在 schema（医院提供的视图层）。 */
  cdm: string;
  /** 词汇表所在 schema（常与 cdm 相同）。 */
  vocabulary: string;
  /** 连接器可建表可写的中间结果 schema（队列定义要往这里写）。 */
  results: string;
}

/** 一个 OMOP CDM 数据源的部署配置。**不含**任何密码。 */
export interface CdmDataSourceConfig {
  label: string;
  type: 'omop-cdm';
  host: string;
  port: number;
  database: string;
  user: string;
  /** 凭据引用：存放密码的**环境变量名**，不是密码本身。 */
  passwordEnv: string;
  cdmVersion: string;
  dbms: string;
  schemas: CdmSchemas;
  /** 单次查询超时（毫秒）。 */
  statementTimeoutMs: number;
  /** 连接池上限。 */
  maxConnections: number;
}

export class DataSourceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceConfigError';
  }
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
// label 是连接器配置与控制面数据产品声明的唯一关联键——两端必须用同一个判据。
const LABEL = DATA_SOURCE_LABEL_PATTERN;
const CONFIG_KEYS = [
  'label',
  'type',
  'host',
  'port',
  'database',
  'user',
  'passwordEnv',
  'cdmVersion',
  'dbms',
  'schemas',
  'statementTimeoutMs',
  'maxConnections',
] as const;
const SCHEMA_KEYS = ['cdm', 'vocabulary', 'results'] as const;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;

const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CONNECTIONS = 4;

/**
 * 校验并规范化一条数据源配置。任何不合规都抛 DataSourceConfigError——
 * 配置错误必须在启动时暴露，而不是在第一次查询时以奇怪的方式失败。
 */
export function parseDataSourceConfig(raw: unknown): CdmDataSourceConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DataSourceConfigError('数据源配置必须是对象');
  }
  const r = raw as Record<string, unknown>;

  // 凭据铁律：配置里出现明文密码字段、或连接串夹带口令，一律拒绝。
  for (const forbidden of ['password', 'pass', 'pwd', 'secret']) {
    if (forbidden in r) {
      throw new DataSourceConfigError(
        `数据源配置不得包含明文凭据字段「${forbidden}」——请改用 passwordEnv 引用环境变量`,
      );
    }
  }
  for (const key of ['url', 'uri', 'connectionString']) {
    const v = r[key];
    if (typeof v === 'string') {
      if (/:\/\/[^/@]*:[^/@]*@/.test(v)) {
        throw new DataSourceConfigError(
          `数据源配置的 ${key} 夹带了口令（user:pass@host）——拒绝。` +
            `请拆成 host/port/database/user，口令用 passwordEnv 引用`,
        );
      }
      throw new DataSourceConfigError(
        `数据源配置请用 host/port/database/user 字段，不接受 ${key} 连接串（避免口令随整串进日志）`,
      );
    }
  }

  const label = str(r.label, 'label');
  if (!LABEL.test(label)) {
    throw new DataSourceConfigError(
      `label 须为小写字母数字与连字符（≤63）：${label}`,
    );
  }
  const unknown = Object.keys(r).filter((k) => !(CONFIG_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new DataSourceConfigError(
      `数据源 ${label} 含未知配置项 ${unknown.join(', ')}——数据源只由连接器进程使用，` +
        `不存在「开放给算法模块 / agent」的选项（D-CN-6：句柄由连接器独占）`,
    );
  }
  if (r.type !== 'omop-cdm') {
    throw new DataSourceConfigError(
      `数据源 ${label} 的 type 只支持 omop-cdm（D-CN-7：只接 OMOP CDM，不做通用数据库适配），实际 ${String(r.type)}`,
    );
  }

  const dbms = str(r.dbms, 'dbms').toLowerCase();
  if (!(IMPLEMENTED_DIALECTS as readonly string[]).includes(dbms)) {
    // spec: 未实现方言明确拒绝，MUST NOT 以近似方言替代执行。
    throw new DataSourceConfigError(
      `数据源 ${label} 的 dbms「${dbms}」尚未实现（当前只实现 ${IMPLEMENTED_DIALECTS.join(', ')}）。` +
        `不会用其它方言近似执行——SQL 方言差异会让同一份研究定义在不同库上算出不同结果`,
    );
  }

  const cdmVersion = str(r.cdmVersion, 'cdmVersion');
  if (!(SUPPORTED_CDM_VERSIONS as readonly string[]).includes(cdmVersion)) {
    throw new DataSourceConfigError(
      `数据源 ${label} 的 cdmVersion「${cdmVersion}」不受支持（当前只支持 ${SUPPORTED_CDM_VERSIONS.join(', ')}）`,
    );
  }

  const passwordEnv = str(r.passwordEnv, 'passwordEnv');
  if (!ENV_NAME.test(passwordEnv)) {
    throw new DataSourceConfigError(
      `passwordEnv 须为环境变量名（大写字母数字下划线），实际「${passwordEnv}」——` +
        `它是凭据**引用**，不要把口令本身填进来`,
    );
  }

  const schemasRaw = r.schemas;
  if (!schemasRaw || typeof schemasRaw !== 'object') {
    throw new DataSourceConfigError(`数据源 ${label} 缺少 schemas（cdm / vocabulary / results）`);
  }
  const s = schemasRaw as Record<string, unknown>;
  const unknownSchemas = Object.keys(s).filter((k) => !(SCHEMA_KEYS as readonly string[]).includes(k));
  if (unknownSchemas.length > 0) {
    throw new DataSourceConfigError(
      `数据源 ${label} 的 schemas 含未知项 ${unknownSchemas.join(', ')}（只有 cdm / vocabulary / results）`,
    );
  }
  const schemas: CdmSchemas = {
    cdm: ident(s.cdm, 'schemas.cdm'),
    vocabulary: ident(s.vocabulary ?? s.cdm, 'schemas.vocabulary'),
    results: ident(s.results, 'schemas.results'),
  };
  if (schemas.results === schemas.cdm) {
    throw new DataSourceConfigError(
      `results schema 不能与 cdm schema 相同（${schemas.cdm}）——视图层只读、results 可写，两个权限域必须分开`,
    );
  }

  const port = r.port === undefined ? 5432 : Number(r.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DataSourceConfigError(`数据源 ${label} 的 port 非法：${String(r.port)}`);
  }

  return {
    label,
    type: 'omop-cdm',
    host: str(r.host, 'host'),
    port,
    database: str(r.database, 'database'),
    user: str(r.user, 'user'),
    passwordEnv,
    cdmVersion,
    dbms,
    schemas,
    statementTimeoutMs: positiveInt(
      r.statementTimeoutMs,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      'statementTimeoutMs',
    ),
    maxConnections: positiveInt(r.maxConnections, DEFAULT_MAX_CONNECTIONS, 'maxConnections'),
  };
}

/**
 * 从连接器部署配置读取全部数据源。
 * `CONNECTOR_CDM_SOURCES`（JSON 数组）优先；否则读 `CONNECTOR_CDM_SOURCES_FILE`；都没有 = 无数据库数据源。
 */
export interface DataSourceConfigInput {
  /** `CONNECTOR_CDM_SOURCES`：JSON 数组（优先）。 */
  inline?: string;
  /** `CONNECTOR_CDM_SOURCES_FILE`：JSON 文件路径。 */
  file?: string;
}

/** 部署配置的读取点——显式字面读取，DEPLOY.md 登记与之对拍。 */
export function dataSourceConfigInputFromEnv(): DataSourceConfigInput {
  return {
    inline: process.env.CONNECTOR_CDM_SOURCES,
    file: process.env.CONNECTOR_CDM_SOURCES_FILE,
  };
}

export function loadDataSourceConfigs(
  input: DataSourceConfigInput = dataSourceConfigInputFromEnv(),
  readFile: (path: string) => string = (p) =>
    // 延迟 require：本模块在测试里不应被迫触碰真实文件系统。
    (require('node:fs') as typeof import('node:fs')).readFileSync(p, 'utf8'),
): CdmDataSourceConfig[] {
  const inline = input.inline?.trim();
  const file = input.file?.trim();
  let raw: string | undefined;
  if (inline) raw = inline;
  else if (file) raw = readFile(file);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DataSourceConfigError(
      `数据源配置不是合法 JSON：${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new DataSourceConfigError('数据源配置须为 JSON 数组');
  }
  const configs = parsed.map(parseDataSourceConfig);
  const labels = new Set<string>();
  for (const c of configs) {
    if (labels.has(c.label)) {
      throw new DataSourceConfigError(`数据源 label 重复：${c.label}`);
    }
    labels.add(c.label);
  }
  return configs;
}

/**
 * 按凭据引用取口令。只在**建立连接的那一刻**调用，结果不缓存在任何可被序列化的对象上。
 */
export function resolvePassword(
  config: CdmDataSourceConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[config.passwordEnv];
  if (!value) {
    throw new DataSourceConfigError(
      `数据源 ${config.label} 的凭据环境变量 ${config.passwordEnv} 未设置`,
    );
  }
  return value;
}

/** 可以安全离开本模块的数据源描述（审计 / 上报 / 错误信息）。类型上就不含口令。 */
export interface DataSourceDescription {
  label: string;
  type: 'omop-cdm';
  dbms: string;
  cdmVersion: string;
  host: string;
  port: number;
  database: string;
  schemas: CdmSchemas;
}

export function describeSource(config: CdmDataSourceConfig): DataSourceDescription {
  return {
    label: config.label,
    type: config.type,
    dbms: config.dbms,
    cdmVersion: config.cdmVersion,
    host: config.host,
    port: config.port,
    database: config.database,
    schemas: config.schemas,
  };
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new DataSourceConfigError(`数据源配置缺少 ${field}`);
  }
  return v.trim();
}

function ident(v: unknown, field: string): string {
  const s = str(v, field).toLowerCase();
  // schema 名会被代入 SQL 标识符位置，必须是安全标识符（spec: 不拼接不可信输入）。
  if (!IDENT.test(s)) {
    throw new DataSourceConfigError(
      `${field} 须为小写安全标识符（字母数字下划线，≤63）：${s}`,
    );
  }
  return s;
}

function positiveInt(v: unknown, fallback: number, field: string): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new DataSourceConfigError(`${field} 须为正整数：${String(v)}`);
  }
  return n;
}
