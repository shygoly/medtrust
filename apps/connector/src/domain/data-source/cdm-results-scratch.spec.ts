// omop-data-source-access —— results schema 中间结果留存治理（tasks 6.1–6.3），真实 PostgreSQL。
// 起库：sh apps/connector/scripts/omop-test-db.sh ；缺省跳过。
import { Client } from 'pg';
import { CdmExecutor } from './cdm-executor';
import { CdmResultsScratch, resultsTaskTag } from './cdm-results-scratch';
import { parseDataSourceConfig } from './data-source-config';

const ADMIN_URL = process.env.CDM_TEST_DATABASE_URL;
const pgDescribe = ADMIN_URL ? describe : describe.skip;

// 本套件自带隔离的账号与 results schema：别的套件的接入复核会以 connector_ok 身份跑兜底清理，
// 共用账号会让它们互相删表（清理只认「本账号拥有」，账号隔离即互不干扰）。
const ROLE = 'connector_scratch';
const RESULTS = 'results_scratch';

function executorFor(user = ROLE, password = 'scratch-pw'): CdmExecutor {
  const url = new URL(ADMIN_URL ?? 'postgres://x@127.0.0.1:5025/omop');
  const config = parseDataSourceConfig({
    label: 'scratch-test',
    type: 'omop-cdm',
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    user,
    passwordEnv: 'CDM_TEST_PASSWORD',
    cdmVersion: '5.4',
    dbms: 'postgresql',
    schemas: { cdm: 'cdm', vocabulary: 'cdm', results: RESULTS },
    statementTimeoutMs: 15_000,
  });
  return new CdmExecutor(config, undefined, { CDM_TEST_PASSWORD: password });
}

async function tablesInResults(executor: CdmExecutor): Promise<string[]> {
  const rows = await executor.query<{ tablename: string }>({
    text: `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = '${RESULTS}' ORDER BY tablename`,
  });
  return rows.map((r) => r.tablename);
}

describe('中间结果表命名（6.1）', () => {
  it('mt_<UTC 分钟>_<任务 SM3 前缀>_<用途>，且不把任务号写进医院库', () => {
    const scratch = new CdmResultsScratch(executorFor(), () => new Date('2026-09-20T08:07:30Z'));
    const t = scratch.tableFor('task-abc-123', 'cohort');
    expect(t.table).toBe(`mt_202609200807_${resultsTaskTag('task-abc-123')}_cohort`);
    expect(t.table).not.toContain('task-abc-123');
    expect(t.qualified).toBe(`"${RESULTS}"."${t.table}"`);
    expect(t.table.length).toBeLessThanOrEqual(63);
  });

  it('用途名只收安全标识符——不能借它往 SQL 里拼东西', () => {
    const scratch = new CdmResultsScratch(executorFor());
    expect(() => scratch.tableFor('t', 'cohort; DROP TABLE x')).toThrow(/用途名/);
    expect(() => scratch.tableFor('t', 'Cohort')).toThrow(/用途名/);
  });
});

pgDescribe('中间结果清理（真实 PostgreSQL，6.2 / 6.3）', () => {
  let admin: Client;
  let executor: CdmExecutor;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${RESULTS} CASCADE`);
    await admin.query(`CREATE SCHEMA ${RESULTS}`);
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        CREATE ROLE ${ROLE} LOGIN PASSWORD 'scratch-pw';
      END IF; END $$`);
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA ${RESULTS} TO ${ROLE}`);
    executor = executorFor();
  }, 60_000);

  afterAll(async () => {
    // 收尾：无论断言成败，都不在测试库里留东西。
    await executor.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${RESULTS} CASCADE`);
    await admin.end();
  });

  it('任务结束：只删该任务的全部中间表，别的任务不受影响', async () => {
    const scratch = new CdmResultsScratch(executor);
    const a1 = scratch.tableFor('task-a', 'cohort');
    const a2 = scratch.tableFor('task-a', 'features');
    const b1 = scratch.tableFor('task-b', 'cohort');
    for (const t of [a1, a2, b1]) {
      await executor.query({ text: `CREATE TABLE ${t.qualified} (person_id BIGINT)` });
    }

    const dropped = await scratch.dropTask('task-a');
    expect(dropped.sort()).toEqual([a1.table, a2.table].sort());
    const remaining = await tablesInResults(executor);
    expect(remaining).toContain(b1.table);
    expect(remaining).not.toContain(a1.table);

    await scratch.dropTask('task-b');
    expect(await tablesInResults(executor)).not.toContain(b1.table);
  }, 60_000);

  it('按库里的目录删：同一任务崩溃重试留下的旧表也一并清掉', async () => {
    const tag = resultsTaskTag('task-crashed');
    const orphan = `mt_202001010000_${tag}_cohort`;
    await executor.query({ text: `CREATE TABLE ${RESULTS}."${orphan}" (person_id BIGINT)` });

    const scratch = new CdmResultsScratch(executor); // 新进程：内存里没有这张表的记账
    expect(await scratch.dropTask('task-crashed')).toEqual([orphan]);
  }, 60_000);

  it('周期兜底：删超过宽限期的孤儿表，但不碰本进程在跑的任务', async () => {
    const orphan = `mt_202001010000_${resultsTaskTag('task-dead')}_cohort`;
    await executor.query({ text: `CREATE TABLE ${RESULTS}."${orphan}" (person_id BIGINT)` });

    let now = Date.now();
    const scratch = new CdmResultsScratch(executor, () => new Date(now));
    const running = scratch.tableFor('task-running', 'cohort');
    await executor.query({ text: `CREATE TABLE ${running.qualified} (person_id BIGINT)` });

    // 时钟拨到两天后：两张表都「过期」了，但 task-running 还在本进程里跑。
    now += 2 * 86_400_000;
    const dropped = await scratch.sweep(86_400_000);
    expect(dropped).toEqual([orphan]);
    expect(await tablesInResults(executor)).toContain(running.table);

    await scratch.dropTask('task-running');
  }, 60_000);

  it('宽限期内的表不删（可能是另一个连接器实例刚建的）', async () => {
    const scratch = new CdmResultsScratch(executor);
    const fresh = scratch.tableFor('task-fresh', 'cohort');
    await executor.query({ text: `CREATE TABLE ${fresh.qualified} (person_id BIGINT)` });
    const other = new CdmResultsScratch(executor); // 不知道 task-fresh 在跑
    expect(await other.sweep(3_600_000)).toEqual([]);
    await scratch.dropTask('task-fresh');
  }, 60_000);

  it('医院放在 results 里的东西永远不动：命名不符的、别人拥有的，一概跳过', async () => {
    // ① 连接器账号自己建、但不符合命名约定的表（比如 DBA 让它手工建的）
    await executor.query({ text: `CREATE TABLE ${RESULTS}.cohort_manual (person_id BIGINT)` });
    // ② 医院管理员建的、名字碰巧像我们的表
    const lookalike = `mt_202001010000_${resultsTaskTag('task-dead')}_hospital`;
    await admin.query(`CREATE TABLE ${RESULTS}."${lookalike}" (x INT)`);
    await admin.query(`CREATE TABLE ${RESULTS}.hospital_notes (x INT)`);

    const scratch = new CdmResultsScratch(executor, () => new Date(Date.now() + 365 * 86_400_000));
    expect(await scratch.sweep(0)).toEqual([]);
    expect(await scratch.dropTask('task-dead')).toEqual([]);
    const remaining = await tablesInResults(executor);
    expect(remaining).toEqual(expect.arrayContaining(['cohort_manual', lookalike, 'hospital_notes']));

    await executor.query({ text: `DROP TABLE ${RESULTS}.cohort_manual` });
  }, 60_000);
});
