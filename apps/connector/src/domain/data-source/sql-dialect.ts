// omop-data-source-access —— SQL 方言抽象（task 2.1 / 2.2 / 2.3，D-CN-7）。
//
// 为什么需要：实测里 OHDSI Book 的队列 SQL 用 SQL Server 的 `DATEDIFF(DAY,a,b)`，
// 在 PostgreSQL 上必须改写成日期相减。OHDSI 为此专门造了 SqlRender；而国产库
// （达梦、人大金仓、OceanBase）SqlRender 亦不支持。
//
// 这里只留**接缝**：第一版只实现 PostgreSQL，未实现的方言**明确报错**，
// 绝不「用最像的那个方言凑合跑」——同一份研究定义在不同库上算出不同结果，
// 比报错危险得多。
import { DataSourceConfigError, IMPLEMENTED_DIALECTS } from './data-source-config';

export interface SqlDialect {
  readonly name: string;
  /** 标识符引用。只接受已校验的安全标识符（schema 名、CDM 表名/列名）。 */
  quoteIdent(identifier: string): string;
  /** `schema.table`，两段都做引用。 */
  qualify(schema: string, table: string): string;
  /** 第 i 个（从 1 起）绑定参数的占位符。值一律走绑定参数，不进 SQL 文本。 */
  placeholder(index: number): string;
  /** 两个日期表达式相差的天数（later - earlier）。 */
  dateDiffDays(later: string, earlier: string): string;
  /** 行数上限子句（附加在查询末尾）。 */
  limitClause(rows: number): string;
  /** 参数是否为某数组中任一值（用于 concept_id 集合）。 */
  anyOf(expression: string, placeholder: string): string;
  /** 日期表达式截到月：'YYYY-MM'（覆盖元数据只报到月）。 */
  yearMonth(expression: string): string;

  // ── 接入校验用的**权限自省**（无副作用；只看当前账号自己的权限）──────────
  /** 当前账号的角色属性：是否超级用户 / 可建角色 / 可建库 / 可绕过行级安全。 */
  rolePropertiesQuery(): string;
  /**
   * 当前账号**实际可读**（schema USAGE 且表 SELECT）、但位于允许集合之外的关系。
   * 绑定参数 $1 = 允许的 schema 名数组。结果非空 = 越权（「底表可达」）。
   */
  readableOutsideQuery(): string;
  /** 当前账号对某个 schema.table 是否有任一写权限（绑定参数 $1 = 限定名）。 */
  tableWritableQuery(): string;
  /** 当前账号对某个 schema 是否有 CREATE 权限（绑定参数 $1 = schema 名）。 */
  schemaCreatableQuery(): string;
  /** 某 schema 里**当前账号拥有**的表（绑定参数 $1 = schema 名）——清理只碰自己建的表。 */
  ownedTablesQuery(): string;
}

const SAFE_IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export class UnsafeIdentifierError extends Error {
  constructor(identifier: string) {
    super(
      `拒绝不安全的 SQL 标识符「${identifier}」：标识符只能来自已校验的配置或 CDM 规范，` +
        `不得由外部输入拼接（spec: 参数化执行不拼接不可信输入）`,
    );
    this.name = 'UnsafeIdentifierError';
  }
}

export class PostgresDialect implements SqlDialect {
  readonly name = 'postgresql';

  quoteIdent(identifier: string): string {
    if (!SAFE_IDENT.test(identifier)) throw new UnsafeIdentifierError(identifier);
    return `"${identifier}"`;
  }

  qualify(schema: string, table: string): string {
    return `${this.quoteIdent(schema)}.${this.quoteIdent(table)}`;
  }

  placeholder(index: number): string {
    if (!Number.isInteger(index) || index < 1) {
      throw new Error(`占位符序号须为正整数：${index}`);
    }
    return `$${index}`;
  }

  dateDiffDays(later: string, earlier: string): string {
    // PG 的 date - date 直接得到整数天数；这正是 SQL Server DATEDIFF(DAY,…) 要翻译成的样子。
    return `((${later})::date - (${earlier})::date)`;
  }

  limitClause(rows: number): string {
    if (!Number.isInteger(rows) || rows < 0) {
      throw new Error(`行数上限须为非负整数：${rows}`);
    }
    return `LIMIT ${rows}`;
  }

  anyOf(expression: string, placeholder: string): string {
    return `${expression} = ANY(${placeholder})`;
  }

  yearMonth(expression: string): string {
    return `to_char((${expression})::date, 'YYYY-MM')`;
  }

  rolePropertiesQuery(): string {
    return `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
            FROM pg_catalog.pg_roles WHERE rolname = current_user`;
  }

  readableOutsideQuery(): string {
    // 只有 schema USAGE 不等于能读表（PG ≤14 默认给所有人 public 的 USAGE）——
    // 判据必须是「schema 能进 且 表能 SELECT」，否则会把大多数真实医院误判为越权。
    return `SELECT n.nspname AS schema, c.relname AS relation
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
              AND n.nspname <> ALL($1)
              AND has_schema_privilege(current_user, n.oid, 'USAGE')
              AND has_table_privilege(current_user, c.oid, 'SELECT')
            ORDER BY n.nspname, c.relname
            LIMIT 50`;
  }

  tableWritableQuery(): string {
    return `SELECT has_table_privilege(current_user, $1, 'INSERT')
                OR has_table_privilege(current_user, $1, 'UPDATE')
                OR has_table_privilege(current_user, $1, 'DELETE')
                OR has_table_privilege(current_user, $1, 'TRUNCATE') AS writable`;
  }

  schemaCreatableQuery(): string {
    return `SELECT has_schema_privilege(current_user, $1, 'CREATE') AS creatable`;
  }

  ownedTablesQuery(): string {
    return `SELECT tablename FROM pg_catalog.pg_tables
            WHERE schemaname = $1 AND tableowner = current_user
            ORDER BY tablename`;
  }
}

/** 按配置的 dbms 取方言。未实现的一律拒绝——不做近似替代。 */
export function resolveDialect(dbms: string): SqlDialect {
  switch ((dbms ?? '').toLowerCase()) {
    case 'postgresql':
      return new PostgresDialect();
    default:
      throw new DataSourceConfigError(
        `方言「${dbms}」尚未实现（当前只实现 ${IMPLEMENTED_DIALECTS.join(', ')}），拒绝执行。` +
          `国产库（达梦 / 人大金仓 / OceanBase）需单独评估后另立变更`,
      );
  }
}
