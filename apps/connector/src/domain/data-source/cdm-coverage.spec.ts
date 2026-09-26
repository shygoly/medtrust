// omop-data-source-access —— 覆盖元数据：库内统计（5.1）、只含统计量（5.2）、随校验上报（5.4）。
// 真实 PostgreSQL；起库：sh apps/connector/scripts/omop-test-db.sh ；缺省跳过。
//
// 本套件自带隔离的 schema 与账号（cdm_cov / connector_cov）：投影一致性测试会清空共享底表，
// 两个套件并行跑时不能共用数据。
import { Client } from 'pg';
import { validateCoverageReport, type CdmCoverageReport } from '@medtrust/database';
import { AuditService } from '../audit';
import type { ControlPlaneClient } from '../control-plane-client';
import { computeCdmCoverage } from './cdm-coverage';
import { CdmCoverageReporter } from './cdm-coverage-reporter';
import { CdmDataSourceRegistry, reverifyIntervalMs, DEFAULT_REVERIFY_MS } from './cdm-data-source-registry';
import { CdmExecutor } from './cdm-executor';
import { parseDataSourceConfig, type CdmDataSourceConfig } from './data-source-config';

const ADMIN_URL = process.env.CDM_TEST_DATABASE_URL;
const pgDescribe = ADMIN_URL ? describe : describe.skip;

function covConfig(overrides: Record<string, unknown> = {}): CdmDataSourceConfig {
  const url = new URL(ADMIN_URL ?? 'postgres://x@127.0.0.1:5025/omop');
  return parseDataSourceConfig({
    label: 'cov-cdm',
    type: 'omop-cdm',
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    user: 'connector_cov',
    passwordEnv: 'CDM_COV_PASSWORD',
    cdmVersion: '5.4',
    dbms: 'postgresql',
    schemas: { cdm: 'cdm_cov', vocabulary: 'cdm_cov', results: 'results' },
    statementTimeoutMs: 15_000,
    ...overrides,
  });
}

const ENV = { CDM_COV_PASSWORD: 'cov-pw', CDM_RO_PASSWORD: 'ro-pw' };

describe('周期复核间隔', () => {
  it('缺省 6 小时；0 关闭；非法值启动即报错', () => {
    expect(reverifyIntervalMs(undefined)).toBe(DEFAULT_REVERIFY_MS);
    expect(reverifyIntervalMs('')).toBe(DEFAULT_REVERIFY_MS);
    expect(reverifyIntervalMs('0')).toBe(0);
    expect(reverifyIntervalMs('60000')).toBe(60_000);
    expect(() => reverifyIntervalMs('-1')).toThrow(/非负整数/);
    expect(() => reverifyIntervalMs('6h')).toThrow(/非负整数/);
  });
});

pgDescribe('覆盖元数据（真实 PostgreSQL）', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS cdm_cov CASCADE');
    await admin.query('CREATE SCHEMA cdm_cov');
    // 列集合照抄医院视图层（契约合格：没有身份证号 / 姓名）。
    for (const t of ['person', 'observation_period', 'drug_exposure', 'condition_occurrence']) {
      await admin.query(`CREATE TABLE cdm_cov.${t} AS SELECT * FROM cdm.${t} WITH NO DATA`);
    }
    for (const t of ['concept', 'vocabulary', 'cdm_source']) {
      await admin.query(`CREATE TABLE cdm_cov.${t} AS SELECT * FROM cdm.${t}`);
    }
    // 1234 人（千级）、56 条用药（十级）、7 条诊断（个位）；观察期 2018-03-15 ~ 2024-11-02。
    await admin.query(
      `INSERT INTO cdm_cov.person (person_id, gender_concept_id, year_of_birth)
       SELECT g, 8507, 1950 + g % 50 FROM generate_series(1, 1234) g`,
    );
    await admin.query(
      `INSERT INTO cdm_cov.drug_exposure (drug_exposure_id, person_id, drug_concept_id, drug_exposure_start_date)
       SELECT g, g, 1308216, DATE '2020-01-01' FROM generate_series(1, 56) g`,
    );
    await admin.query(
      `INSERT INTO cdm_cov.condition_occurrence (condition_occurrence_id, person_id, condition_concept_id, condition_start_date)
       SELECT g, g, 201826, DATE '2021-06-01' FROM generate_series(1, 7) g`,
    );
    await admin.query(
      `INSERT INTO cdm_cov.observation_period (observation_period_id, person_id, observation_period_start_date, observation_period_end_date)
       VALUES (1, 1, DATE '2018-03-15', DATE '2022-01-01'), (2, 2, DATE '2019-07-01', DATE '2024-11-02')`,
    );
    // 规范内的可选表：一张有数据、一张空——空表不算「含数据」。
    await admin.query('CREATE TABLE cdm_cov.visit_occurrence (visit_occurrence_id BIGINT, person_id BIGINT)');
    await admin.query('INSERT INTO cdm_cov.visit_occurrence SELECT g, g FROM generate_series(1, 150) g');
    await admin.query('CREATE TABLE cdm_cov.measurement (measurement_id BIGINT, person_id BIGINT)');

    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'connector_cov') THEN
        CREATE ROLE connector_cov LOGIN PASSWORD 'cov-pw';
      END IF; END $$`);
    await admin.query('GRANT USAGE ON SCHEMA cdm_cov TO connector_cov');
    await admin.query('GRANT SELECT ON ALL TABLES IN SCHEMA cdm_cov TO connector_cov');
    await admin.query('GRANT USAGE, CREATE ON SCHEMA results TO connector_cov');
  }, 60_000);

  afterAll(async () => {
    await admin.query('DROP SCHEMA IF EXISTS cdm_cov CASCADE');
    await admin.end();
  });

  it('库内统计：含数据的表 + 数量级 + 月粒度时间跨度（5.1）', async () => {
    const executor = new CdmExecutor(covConfig(), undefined, ENV);
    try {
      const cov = await computeCdmCoverage(executor, () => new Date('2026-09-20T00:00:00Z'));
      expect(cov.tables).toEqual([
        { table: 'person', magnitude: 3 },
        { table: 'observation_period', magnitude: 0 },
        { table: 'visit_occurrence', magnitude: 2 },
        { table: 'condition_occurrence', magnitude: 0 },
        { table: 'drug_exposure', magnitude: 1 },
      ]);
      // measurement 是空表、death 等没提供——都不出现。
      expect(cov.timeSpan).toEqual({ from: '2018-03', to: '2024-11' });
      expect(cov.computedAt).toBe('2026-09-20T00:00:00.000Z');
    } finally {
      await executor.close();
    }
  }, 60_000);

  it('上报内容只含统计量：没有行、没有日、没有精确行数（5.2）', async () => {
    const executor = new CdmExecutor(covConfig(), undefined, ENV);
    try {
      const cov = await computeCdmCoverage(executor);
      const report = validateCoverageReport({
        passed: true,
        cdmVersion: '5.4',
        vocabularyVersion: 'v5.0 31-AUG-24',
        coverage: cov,
      });
      const wire = JSON.stringify(report);
      expect(wire).not.toContain('1234'); // 精确人数不外传，只有数量级
      expect(wire).not.toMatch(/2018-03-15|2024-11-02/); // 日粒度不外传
      expect(wire).not.toMatch(/person_id|concept_name|year_of_birth/);
      // 报文里任何多出来的字段都会被同一个校验器拒掉——行级数据没有落脚点。
      expect(() =>
        validateCoverageReport({ ...report, rows: [{ person_id: 1 }] }),
      ).toThrow(/不允许的字段/);
      expect(() =>
        validateCoverageReport({
          ...report,
          coverage: { ...cov, tables: [{ table: 'person', magnitude: 3, count: 1234 }] },
        }),
      ).toThrow(/不允许的字段/);
      expect(() =>
        validateCoverageReport({ ...report, coverage: { ...cov, timeSpan: { from: '2018-03-15', to: '2024-11' } } }),
      ).toThrow(/YYYY-MM/);
    } finally {
      await executor.close();
    }
  }, 60_000);

  it('某张表统计超时：记「统计失败」（null），不是「没有数据」', async () => {
    await admin.query(
      `CREATE VIEW cdm_cov.device_exposure AS
         SELECT g AS device_exposure_id, pg_sleep(0.05)::text AS slow FROM generate_series(1, 40) g`,
    );
    await admin.query('GRANT SELECT ON cdm_cov.device_exposure TO connector_cov');
    const executor = new CdmExecutor(covConfig({ statementTimeoutMs: 500 }), undefined, ENV);
    try {
      const cov = await computeCdmCoverage(executor);
      expect(cov.tables).toContainEqual({ table: 'device_exposure', magnitude: null });
      expect(cov.tables).toContainEqual({ table: 'person', magnitude: 3 });
    } finally {
      await executor.close();
      await admin.query('DROP VIEW cdm_cov.device_exposure');
    }
  }, 60_000);

  it('随接入校验上报：过了报版本 + 统计，没过只报一个布尔（5.4）', async () => {
    const sent: Array<{ label: string; report: CdmCoverageReport }> = [];
    const controlPlane = {
      reportDataSourceCoverage: async (label: string, report: CdmCoverageReport) => {
        sent.push({ label, report });
      },
    } as unknown as ControlPlaneClient;

    const audit = new AuditService();
    const registry = new CdmDataSourceRegistry(audit, undefined, new CdmCoverageReporter(controlPlane));
    registry.configure(
      [
        covConfig(),
        covConfig({
          label: 'readonly-cdm',
          user: 'connector_readonly',
          passwordEnv: 'CDM_RO_PASSWORD',
          schemas: { cdm: 'cdm', vocabulary: 'cdm', results: 'results' },
        }),
      ],
      ENV,
    );
    try {
      await registry.verifyAll();
    } finally {
      await registry.onModuleDestroy();
    }

    const good = sent.find((s) => s.label === 'cov-cdm')?.report;
    expect(good).toMatchObject({ passed: true, cdmVersion: '5.4', vocabularyVersion: 'v5.0 31-AUG-24' });
    expect(good?.passed && good.coverage?.tables).toContainEqual({ table: 'person', magnitude: 3 });

    const bad = sent.find((s) => s.label === 'readonly-cdm')?.report;
    expect(bad).toEqual({ passed: false }); // 失败细节（schema / 权限域）留在院内审计
    expect(audit.all().some((e) => e.action === 'data-source-rejected')).toBe(true);
  }, 90_000);

  it('上报失败不影响院内可用性判定', async () => {
    const controlPlane = {
      reportDataSourceCoverage: async () => {
        throw new Error('控制面不可达');
      },
    } as unknown as ControlPlaneClient;
    const registry = new CdmDataSourceRegistry(undefined, undefined, new CdmCoverageReporter(controlPlane));
    registry.configure([covConfig()], ENV);
    try {
      const [report] = await registry.verifyAll();
      expect(report.passed).toBe(true);
      expect(() => registry.requireAvailable('cov-cdm')).not.toThrow();
    } finally {
      await registry.onModuleDestroy();
    }
  }, 60_000);

  it('医院可单方面切断：DBA 撤销视图权限 → 下一条查询即失败，复核即不可用，无需平台配合', async () => {
    const registry = new CdmDataSourceRegistry();
    registry.configure([covConfig()], ENV);
    try {
      await registry.verifyAll();
      const executor = registry.requireAvailable('cov-cdm');
      await expect(
        executor.query({ text: 'SELECT count(*) FROM "cdm_cov"."person"' }),
      ).resolves.toHaveLength(1);

      // 医院侧一条 REVOKE，平台什么都不用做。
      await admin.query('REVOKE SELECT ON cdm_cov.person FROM connector_cov');
      await expect(
        executor.query({ text: 'SELECT count(*) FROM "cdm_cov"."person"' }),
      ).rejects.toMatchObject({ kind: 'permission-denied' });

      const [report] = await registry.verifyAll();
      expect(report.passed).toBe(false);
      expect(report.checks.find((c) => c.id === 'view-readable:person')?.domain).toBe('cdm-read');
      expect(() => registry.requireAvailable('cov-cdm')).toThrow(/不会改用本地文件数据/);
    } finally {
      await admin.query('GRANT SELECT ON cdm_cov.person TO connector_cov');
      await registry.onModuleDestroy();
    }
  }, 60_000);

  it('并发复核不叠加：同一轮进行中再触发，拿到的是同一个结果', async () => {
    const registry = new CdmDataSourceRegistry();
    registry.configure([covConfig()], ENV);
    try {
      const a = registry.verifyAll();
      const b = registry.verifyAll();
      expect(b).toBe(a);
      await a;
    } finally {
      await registry.onModuleDestroy();
    }
  }, 60_000);
});
