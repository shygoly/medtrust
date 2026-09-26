// omop-data-source-access —— 配置模型 / 方言 / 执行通道（tasks 1.1 / 1.2 / 1.3 / 2.x）。
//
// 纯逻辑用例无条件运行；真实 PostgreSQL 用例需 CDM_TEST_DATABASE_URL
// （起库：sh apps/connector/scripts/omop-test-db.sh），缺省跳过。
import {
  DataSourceConfigError,
  describeSource,
  loadDataSourceConfigs,
  parseDataSourceConfig,
  resolvePassword,
} from './data-source-config';
import {
  CdmExecutor,
  DataSourceError,
  classifySqlState,
} from './cdm-executor';
import { PostgresDialect, UnsafeIdentifierError, resolveDialect } from './sql-dialect';

const SECRET = 'S3cr3t-口令-不得外泄';

const BASE = {
  label: 'huashan-cdm',
  type: 'omop-cdm',
  host: '127.0.0.1',
  port: 5025,
  database: 'omop',
  user: 'connector_ok',
  passwordEnv: 'CDM_HUASHAN_PASSWORD',
  cdmVersion: '5.4',
  dbms: 'postgresql',
  schemas: { cdm: 'cdm', vocabulary: 'cdm', results: 'results' },
};

describe('数据源配置模型（task 1.1）', () => {
  it('合法配置被规范化，缺省值齐全', () => {
    const c = parseDataSourceConfig(BASE);
    expect(c.label).toBe('huashan-cdm');
    expect(c.schemas).toEqual({ cdm: 'cdm', vocabulary: 'cdm', results: 'results' });
    expect(c.statementTimeoutMs).toBe(120_000);
    expect(c.maxConnections).toBe(4);
  });

  it('vocabulary schema 缺省同 cdm', () => {
    const c = parseDataSourceConfig({
      ...BASE,
      schemas: { cdm: 'cdm', results: 'results' },
    });
    expect(c.schemas.vocabulary).toBe('cdm');
  });

  it('配置项是白名单：没有「开放给算法模块 / agent」的开关（task 4.4）', () => {
    for (const extra of [
      { exposeToModules: true },
      { agents: ['hospital-a-agent'] },
      { shareWith: 'fl-agent' },
    ]) {
      expect(() => parseDataSourceConfig({ ...BASE, ...extra })).toThrow(
        /未知配置项.*不存在「开放给算法模块 \/ agent」的选项/,
      );
    }
    expect(() =>
      parseDataSourceConfig({ ...BASE, schemas: { ...BASE.schemas, raw: 'cdm_raw' } }),
    ).toThrow(/schemas 含未知项 raw/);
  });

  it('label 判据与控制面数据产品声明同源（两端的唯一关联键）', () => {
    expect(() => parseDataSourceConfig({ ...BASE, label: 'Huashan_CDM' })).toThrow(/label/);
  });

  it('只接 OMOP CDM（D-CN-7）', () => {
    expect(() => parseDataSourceConfig({ ...BASE, type: 'mysql' })).toThrow(/只支持 omop-cdm/);
  });

  it('未实现方言在配置阶段即拒，且说明不会近似替代（task 2.3）', () => {
    for (const dbms of ['oracle', 'sql server', 'dm', 'kingbase', 'oceanbase']) {
      expect(() => parseDataSourceConfig({ ...BASE, dbms })).toThrow(/尚未实现/);
    }
  });

  it('只支持 CDM 5.4（5.3 字段有差异，未决前明确拒绝）', () => {
    expect(() => parseDataSourceConfig({ ...BASE, cdmVersion: '5.3' })).toThrow(/不受支持/);
  });

  it('results 与 cdm 不能是同一 schema（两个权限域必须分开）', () => {
    expect(() =>
      parseDataSourceConfig({
        ...BASE,
        schemas: { cdm: 'cdm', vocabulary: 'cdm', results: 'cdm' },
      }),
    ).toThrow(/两个权限域必须分开/);
  });

  it('schema 名必须是安全标识符（会进 SQL 标识符位置）', () => {
    expect(() =>
      parseDataSourceConfig({
        ...BASE,
        schemas: { cdm: 'cdm"; DROP TABLE x; --', vocabulary: 'cdm', results: 'results' },
      }),
    ).toThrow(/安全标识符/);
  });

  it('label 重复拒绝', () => {
    expect(() =>
      loadDataSourceConfigs({ inline: JSON.stringify([BASE, BASE]) }),
    ).toThrow(/重复/);
  });

  it('没配置 = 没有数据库数据源（不报错）', () => {
    expect(loadDataSourceConfigs({})).toEqual([]);
  });

  it('可从文件读取配置', () => {
    const configs = loadDataSourceConfigs(
      { file: '/etc/medtrust/cdm-sources.json' },
      () => JSON.stringify([BASE]),
    );
    expect(configs.map((c) => c.label)).toEqual(['huashan-cdm']);
  });
});

describe('凭据铁律（task 1.2，spec: 数据库凭据不出连接器）', () => {
  it('配置里出现明文口令字段 → 拒绝', () => {
    for (const field of ['password', 'pass', 'pwd', 'secret']) {
      expect(() => parseDataSourceConfig({ ...BASE, [field]: SECRET })).toThrow(
        /不得包含明文凭据字段/,
      );
    }
  });

  it('连接串夹带口令 → 拒绝，且错误信息本身不回显口令', () => {
    let msg = '';
    try {
      parseDataSourceConfig({
        ...BASE,
        url: `postgres://connector_ok:${SECRET}@127.0.0.1:5025/omop`,
      });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/夹带了口令/);
    expect(msg).not.toContain(SECRET);
  });

  it('不接受任何形式的连接串（避免口令随整串进日志）', () => {
    expect(() =>
      parseDataSourceConfig({ ...BASE, connectionString: 'postgres://127.0.0.1/omop' }),
    ).toThrow(/不接受 connectionString 连接串/);
  });

  it('passwordEnv 必须是环境变量名，不是口令本身', () => {
    expect(() => parseDataSourceConfig({ ...BASE, passwordEnv: SECRET })).toThrow(
      /凭据\*\*引用\*\*|凭据引用|环境变量名/,
    );
  });

  it('对外描述在类型与内容上都不含口令', () => {
    const c = parseDataSourceConfig(BASE);
    const described = JSON.stringify(describeSource(c));
    expect(described).not.toContain(SECRET);
    expect(described).not.toMatch(/password/i);
    // 配置对象本身也只有引用，没有口令。
    expect(JSON.stringify(c)).not.toContain(SECRET);
  });

  it('口令只在建连那一刻从环境变量取；未设置则明确报错', () => {
    const c = parseDataSourceConfig(BASE);
    expect(resolvePassword(c, { CDM_HUASHAN_PASSWORD: SECRET })).toBe(SECRET);
    expect(() => resolvePassword(c, {})).toThrow(/未设置/);
  });

  it('执行器序列化后不含口令（口令不挂在对象字段上）', () => {
    const c = parseDataSourceConfig(BASE);
    const executor = new CdmExecutor(c, () => fakePool(), { CDM_HUASHAN_PASSWORD: SECRET });
    // 即便已经建过连接池，对象上也不应留有口令。
    void executor.query({ text: 'SELECT 1' });
    expect(JSON.stringify(executor)).not.toContain(SECRET);
  });
});

describe('方言抽象（task 2.1 / 2.2 / 2.3）', () => {
  const pg = new PostgresDialect();

  it('PG：日期差是 date 相减（SQL Server DATEDIFF 的翻译目标）', () => {
    expect(pg.dateDiffDays('a.x', 'b.y')).toBe('((a.x)::date - (b.y)::date)');
  });

  it('PG：占位符 $n，值走绑定参数', () => {
    expect(pg.placeholder(1)).toBe('$1');
    expect(pg.anyOf('c.concept_id', '$2')).toBe('c.concept_id = ANY($2)');
    expect(() => pg.placeholder(0)).toThrow();
  });

  it('标识符只接受安全标识符——注入企图直接拒', () => {
    expect(pg.qualify('cdm', 'person')).toBe('"cdm"."person"');
    for (const bad of ['person; DROP TABLE x', 'Person', 'a b', '"x"', '']) {
      expect(() => pg.quoteIdent(bad)).toThrow(UnsafeIdentifierError);
    }
  });

  it('未实现方言明确拒绝，不近似替代', () => {
    expect(() => resolveDialect('oracle')).toThrow(/尚未实现/);
    expect(() => resolveDialect('dm')).toThrow(/国产库/);
  });
});

describe('错误归类（接入校验靠它区分权限域）', () => {
  it('SQLSTATE → 错误种类', () => {
    expect(classifySqlState('42501')).toBe('permission-denied');
    expect(classifySqlState('42P01')).toBe('undefined-object');
    expect(classifySqlState('3F000')).toBe('undefined-object');
    expect(classifySqlState('57014')).toBe('timeout');
    expect(classifySqlState('08006')).toBe('unavailable');
    expect(classifySqlState('28P01')).toBe('auth-failed');
    expect(classifySqlState('22P02')).toBe('query-failed');
    expect(classifySqlState(undefined)).toBe('unavailable');
  });
});

describe('连接失败不拖垮连接器（task 1.3）', () => {
  it('空闲连接 error 事件被接住，不抛到进程', () => {
    let emitted: ((e: Error) => void) | undefined;
    const pool = {
      ...fakePool(),
      on: (_evt: 'error', l: (e: Error) => void) => {
        emitted = l;
        return pool;
      },
    };
    const executor = new CdmExecutor(parseDataSourceConfig(BASE), () => pool, {
      CDM_HUASHAN_PASSWORD: 'x',
    });
    void executor.query({ text: 'SELECT 1' });
    expect(emitted).toBeDefined();
    expect(() => emitted!(new Error('server closed the connection'))).not.toThrow();
    expect(executor.poolHealth().lastError).toMatch(/server closed/);
  });

  it('查询失败被包成可归因错误，而不是原样冒泡驱动对象', async () => {
    const pool = {
      ...fakePool(),
      query: async () => {
        throw Object.assign(new Error('permission denied for schema cdm_raw'), {
          code: '42501',
        });
      },
    };
    const executor = new CdmExecutor(parseDataSourceConfig(BASE), () => pool, {
      CDM_HUASHAN_PASSWORD: 'x',
    });
    await expect(executor.query({ text: 'SELECT 1' })).rejects.toMatchObject({
      name: 'DataSourceError',
      kind: 'permission-denied',
      sqlstate: '42501',
    });
  });
});

// ── 真实 PostgreSQL ──────────────────────────────────────────────────────────

const ADMIN_URL = process.env.CDM_TEST_DATABASE_URL;
const pgDescribe = ADMIN_URL ? describe : describe.skip;

pgDescribe('执行通道对真实 PostgreSQL（task 2.4 / 2.5）', () => {
  const url = new URL(ADMIN_URL ?? 'postgres://x@127.0.0.1:5025/omop');
  const config = parseDataSourceConfig({
    ...BASE,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    user: 'connector_ok',
  });
  const executor = new CdmExecutor(config, undefined, { CDM_HUASHAN_PASSWORD: 'ok-pw' });

  afterAll(() => executor.close());

  it('参数化查询可用', async () => {
    const rows = await executor.query<{ v: number }>({
      text: 'SELECT $1::int + 1 AS v',
      values: [41],
    });
    expect(rows[0].v).toBe(42);
  });

  it('注入企图作为「值」被绑定，不会变成 SQL', async () => {
    const injection = "x'; DROP TABLE results.anything; --";
    const rows = await executor.query<{ n: number }>({
      text: `SELECT count(*)::int AS n FROM ${executor.dialect.qualify('cdm', 'concept')}
             WHERE concept_name = $1`,
      values: [injection],
    });
    expect(rows[0].n).toBe(0);
  });

  it('越权访问被归类为 permission-denied（接入校验据此报权限域）', async () => {
    await expect(
      executor.query({ text: 'SELECT national_id FROM cdm_raw.person LIMIT 1' }),
    ).rejects.toMatchObject({ kind: 'permission-denied' });
  });

  it('错误口令被归类为 auth-failed，且错误信息不含口令', async () => {
    const bad = new CdmExecutor(config, undefined, { CDM_HUASHAN_PASSWORD: SECRET });
    let err: DataSourceError | undefined;
    try {
      await bad.query({ text: 'SELECT 1' });
    } catch (e) {
      err = e as DataSourceError;
    } finally {
      await bad.close();
    }
    expect(err?.kind).toBe('auth-failed');
    expect(err?.message).not.toContain(SECRET);
  });

  it('连不上的库被归类为 unavailable，不挂死调用方', async () => {
    const dead = new CdmExecutor(
      { ...config, port: 1, label: 'dead-cdm' },
      undefined,
      { CDM_HUASHAN_PASSWORD: 'ok-pw' },
    );
    await expect(dead.query({ text: 'SELECT 1' })).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await dead.close();
  }, 30_000);
});

function fakePool() {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => undefined,
    on: () => undefined,
  };
}

void DataSourceConfigError;

describe('序列化边界：执行器绝不携带 env（回归）', () => {
  it('即便 env 里还有其它秘密（如 SM2 私钥），执行器序列化也一条不带', () => {
    const env = {
      CDM_HUASHAN_PASSWORD: SECRET,
      CONNECTOR_SM2_PRIVATE_KEY: 'sm2-private-key-must-not-leak',
    };
    const executor = new CdmExecutor(parseDataSourceConfig(BASE), () => fakePool(), env);
    void executor.query({ text: 'SELECT 1' });
    const dumped = JSON.stringify(executor);
    expect(dumped).not.toContain(SECRET);
    expect(dumped).not.toContain('sm2-private-key-must-not-leak');
    const inspected = require('node:util').inspect(executor, { depth: 5 });
    expect(inspected).not.toContain(SECRET);
    expect(inspected).not.toContain('sm2-private-key-must-not-leak');
  });

  it('Node 网络层 errno 归为 unavailable', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'EAI_AGAIN']) {
      expect(classifySqlState(code)).toBe('unavailable');
    }
  });
});
