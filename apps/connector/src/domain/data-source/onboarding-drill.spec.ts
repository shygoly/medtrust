// omop-data-source-access 8.3 —— 按接入手册在干净环境走一遍：
//   医院既有 CDM 库 → 医院 DBA 原样执行 docs/omop-cdm-onboarding.sql → 连接器接入 →
//   接入校验通过 → 跑真实查询 → 医院单方面切断。
//
// 由 apps/connector/scripts/omop-onboarding-drill.sh 起一个全新的 PostgreSQL、灌医院库、
// 执行手册 SQL，再以 CDM_DRILL_DATABASE_URL 运行本文件；缺省跳过。
import { Client } from 'pg';
import { CdmAccessGate } from './cdm-access-gate';
import { computeCdmCoverage } from './cdm-coverage';
import { CdmExecutor } from './cdm-executor';
import { projectDisproportionalityFromCdm } from './cdm-projection';
import { CdmResultsScratch } from './cdm-results-scratch';
import { parseDataSourceConfig } from './data-source-config';

const ADMIN_URL = process.env.CDM_DRILL_DATABASE_URL;
const drillDescribe = ADMIN_URL ? describe : describe.skip;

// 与演练脚本传给手册 SQL 的变量一致（演练专用，非生产凭证）。
const CONNECTOR_ROLE = 'medtrust_connector';
const CONNECTOR_PASSWORD = 'drill-connector-pw';

function drillExecutor(): CdmExecutor {
  const url = new URL(ADMIN_URL ?? 'postgres://x@127.0.0.1:5028/hospital');
  const config = parseDataSourceConfig({
    label: 'drill-hospital-cdm',
    type: 'omop-cdm',
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    user: CONNECTOR_ROLE,
    passwordEnv: 'DRILL_CDM_PASSWORD',
    cdmVersion: '5.4',
    dbms: 'postgresql',
    schemas: { cdm: 'medtrust_cdm', vocabulary: 'medtrust_cdm', results: 'medtrust_results' },
    statementTimeoutMs: 15_000,
  });
  return new CdmExecutor(config, undefined, { DRILL_CDM_PASSWORD: CONNECTOR_PASSWORD });
}

drillDescribe('接入手册干净环境演练（8.3）', () => {
  let admin: Client;
  let executor: CdmExecutor;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    executor = drillExecutor();
  });

  afterAll(async () => {
    await executor.close();
    await admin.end();
  });

  it('按手册建好的视图层 + 账号：接入校验六个权限域全部通过', async () => {
    const report = await new CdmAccessGate(executor).run();
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.cdmVersion).toBe('5.4');
    expect(report.vocabularyVersion).toBe('v5.0 31-AUG-24');
  }, 60_000);

  it('底表不可达、视图不可写——由数据库强制，不靠连接器自觉', async () => {
    await expect(
      executor.query({ text: 'SELECT id_card_no FROM omop.person LIMIT 1' }),
    ).rejects.toMatchObject({ kind: 'permission-denied' });
    await expect(
      executor.query({
        text: `INSERT INTO medtrust_cdm.condition_occurrence
               (condition_occurrence_id, person_id, condition_concept_id, condition_start_date, condition_type_concept_id)
               VALUES (999999, 1, 201826, DATE '2024-01-01', 32817)`,
      }),
    ).rejects.toMatchObject({ kind: 'permission-denied' });
  }, 60_000);

  it('视图挡住了医院自加的标识列与规范内的标识列', async () => {
    const cols = await executor.columns({ text: 'SELECT * FROM medtrust_cdm.person LIMIT 0' });
    for (const hidden of [
      'id_card_no',
      'patient_name',
      'person_source_value',
      'month_of_birth',
      'day_of_birth',
      'birth_datetime',
    ]) {
      expect(cols).not.toContain(hidden);
    }
    const drugCols = await executor.columns({ text: 'SELECT * FROM medtrust_cdm.drug_exposure LIMIT 0' });
    expect(drugCols).not.toContain('sig');
  }, 60_000);

  it('跑真实查询：投影下推 + 覆盖统计', async () => {
    const { projection, drugConceptIds, statements } = await projectDisproportionalityFromCdm(executor, {
      name: 'lisinopril',
    });
    expect(drugConceptIds).toEqual([1308216]);
    expect(projection.n).toBe(60);
    expect(projection.cohortSize).toBe(60);
    expect(projection.terms).toEqual(
      expect.arrayContaining(['Type 2 diabetes mellitus', 'Angioedema', 'Cough']),
    );
    // 查询带列清单、不带 SELECT *（不全量拉取）。
    for (const st of statements) expect(st.text).not.toMatch(/SELECT\s+\*/i);

    const coverage = await computeCdmCoverage(executor);
    expect(coverage.tables).toEqual(
      expect.arrayContaining([
        { table: 'person', magnitude: 1 },
        { table: 'observation_period', magnitude: 1 },
        { table: 'drug_exposure', magnitude: 1 },
        { table: 'condition_occurrence', magnitude: 1 },
      ]),
    );
    expect(coverage.timeSpan).toEqual({ from: '2019-01', to: '2024-06' });
  }, 60_000);

  it('results 区：连接器建的中间表任务结束即删', async () => {
    const scratch = new CdmResultsScratch(executor);
    const t = scratch.tableFor('drill-task', 'cohort');
    await executor.query({
      text: `CREATE TABLE ${t.qualified} AS SELECT person_id FROM medtrust_cdm.person WHERE year_of_birth < 1960`,
    });
    expect(await scratch.dropTask('drill-task')).toEqual([t.table]);
  }, 60_000);

  it('医院单方面切断：手册末尾那条 REVOKE 之后，连接器下一条查询即被拒', async () => {
    await admin.query(`REVOKE SELECT ON ALL TABLES IN SCHEMA medtrust_cdm FROM ${CONNECTOR_ROLE}`);
    try {
      await expect(
        executor.query({ text: 'SELECT count(*) FROM medtrust_cdm.person' }),
      ).rejects.toMatchObject({ kind: 'permission-denied' });
      const report = await new CdmAccessGate(executor).run();
      expect(report.passed).toBe(false);
    } finally {
      await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA medtrust_cdm TO ${CONNECTOR_ROLE}`);
    }
  }, 60_000);
});
