// omop-data-source-access —— SQL 执行通道（task 1.3 / 2.4）。
//
// 三条约束：
//   · **只接受参数化语句**：值一律走绑定参数；SQL 文本只由方言 + 已校验标识符拼出，
//     外部输入永远进不了 SQL 文本（spec: 参数化执行不拼接不可信输入）。
//   · **连接失败不拖垮连接器**：pg 的 Pool 若对空闲连接的 'error' 事件无人监听，
//     会直接让 Node 进程崩溃——那会连带拖死长轮询循环。这里一律接住并降为可归因的错误。
//   · **错误可归因**：权限不足（42501）、对象不存在（42P01/3F000）、超时（57014）、
//     连接失败（08xxx / 28xxx）分门别类，接入校验靠它区分「哪个权限域不满足」。
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import {
  CdmDataSourceConfig,
  describeSource,
  resolvePassword,
} from './data-source-config';
import { resolveDialect, type SqlDialect } from './sql-dialect';

/** 一条已参数化的语句：文本里只有占位符，值在 values 里。 */
export interface SqlStatement {
  text: string;
  values?: readonly unknown[];
}

export type DataSourceErrorKind =
  | 'permission-denied'
  | 'undefined-object'
  | 'timeout'
  | 'unavailable'
  | 'auth-failed'
  | 'query-failed';

export class DataSourceError extends Error {
  constructor(
    message: string,
    readonly kind: DataSourceErrorKind,
    readonly sqlstate?: string,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/**
 * 按错误码归类。两类码：PostgreSQL 的 5 位 SQLSTATE（42501…），以及 Node 网络层的
 * errno 字符串（ECONNREFUSED / ENOTFOUND / ETIMEDOUT…）——后者表示根本没连上库。
 */
export function classifySqlState(code: string | undefined): DataSourceErrorKind {
  if (!code) return 'unavailable';
  // Node errno（连接被拒 / 域名解析失败 / 超时 / 被重置）= 数据源不可达，不是查询错。
  if (/^E[A-Z_]+$/.test(code)) return 'unavailable';
  if (code === '42501') return 'permission-denied';
  if (code === '42P01' || code === '3F000' || code === '42703') return 'undefined-object';
  if (code === '57014') return 'timeout';
  if (code.startsWith('08')) return 'unavailable';
  if (code.startsWith('28')) return 'auth-failed';
  return 'query-failed';
}

/** 连接池的最小接口（便于测试注入）。 */
export interface QueryablePool {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null; fields?: Array<{ name: string }> }>;
  end(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export type PoolFactory = (config: PoolConfig) => QueryablePool;

const defaultPoolFactory: PoolFactory = (config) => new Pool(config);

export class CdmExecutor {
  readonly dialect: SqlDialect;
  private pool: QueryablePool | null = null;
  /** 最近一次连接级错误（空闲连接断开等）——供健康检查读取，不抛出。 */
  private lastPoolError: string | null = null;
  /**
   * 口令只通过闭包取得，**不把 env 存成字段**：生产环境里 env 就是 `process.env`，
   * 里面有连接器的全部秘密（含 SM2 私钥）。若 env 是字段，任何人把执行器
   * 序列化进日志，就会一次性泄露所有秘密。函数不会被 JSON.stringify 序列化，
   * util.inspect 也只显示函数名、不显示闭包里捕获的值。
   */
  private readonly passwordOf: () => string;

  constructor(
    readonly config: CdmDataSourceConfig,
    private readonly poolFactory: PoolFactory = defaultPoolFactory,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    // 方言在构造期就解析：未实现的方言此处即拒（spec: 未实现方言明确拒绝）。
    this.dialect = resolveDialect(config.dbms);
    this.passwordOf = () => resolvePassword(config, env);
  }

  /** 懒建连接池：口令只在这一刻从环境变量取出并交给驱动，不挂到本对象任何字段上。 */
  private getPool(): QueryablePool {
    if (this.pool) return this.pool;
    const pool = this.poolFactory({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.passwordOf(),
      max: this.config.maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: this.config.statementTimeoutMs,
      application_name: `medtrust-connector:${this.config.label}`,
    });
    // pg 的空闲连接出错若无人监听会 crash 进程 —— 必须接住（task 1.3）。
    pool.on('error', (err: Error) => {
      this.lastPoolError = `${new Date().toISOString()} ${err.message}`;
    });
    this.pool = pool;
    return pool;
  }

  /**
   * 执行一条参数化语句。values 一律走绑定参数；失败统一抛 DataSourceError（已归类）。
   */
  async query<R extends QueryResultRow = QueryResultRow>(
    statement: SqlStatement,
  ): Promise<R[]> {
    try {
      const result = await this.getPool().query<R>(
        statement.text,
        statement.values ? [...statement.values] : undefined,
      );
      return result.rows;
    } catch (err) {
      throw this.wrap(err);
    }
  }

  /**
   * 执行并返回结果集的**列名**（`LIMIT 0` 也会带回列定义）。
   * 用途只限接入校验检查「视图有没有多出直接标识列」——不用于决定生成 SQL 的字段名
   * （spec: 不反射表结构即可生成查询）。
   */
  async columns(statement: SqlStatement): Promise<string[]> {
    try {
      const result = await this.getPool().query(
        statement.text,
        statement.values ? [...statement.values] : undefined,
      );
      return (result.fields ?? []).map((f) => f.name);
    } catch (err) {
      throw this.wrap(err);
    }
  }

  /** 最近一次连接级错误（没有则为 null）。 */
  poolHealth(): { lastError: string | null } {
    return { lastError: this.lastPoolError };
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    if (pool) await pool.end();
  }

  /** 转成可归因、且**不含口令**的错误。 */
  private wrap(err: unknown): DataSourceError {
    if (err instanceof DataSourceError) return err;
    const e = err as { code?: string; message?: string };
    const kind = classifySqlState(e.code);
    const where = `数据源 ${describeSource(this.config).label}`;
    // 驱动的连接错误信息可能带主机名，但不会带口令；仍然只取 message，不 dump 对象。
    return new DataSourceError(
      `${where}：${e.message ?? String(err)}`,
      kind,
      e.code,
    );
  }
}
