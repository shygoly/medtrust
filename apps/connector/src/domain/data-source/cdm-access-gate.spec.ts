// omop-data-source-access —— 接入一致性校验：正例 + 负例总验收（tasks 3.1–3.7）。
//
// 全部跑在真实 PostgreSQL 上：权限、视图、角色属性这些东西内存模拟做不了真。
// 起库：sh apps/connector/scripts/omop-test-db.sh ；缺省跳过。
import { CdmExecutor } from './cdm-executor';
import { CdmAccessGate, summarizeFailures, type AccessGateReport } from './cdm-access-gate';
import { parseDataSourceConfig } from './data-source-config';

const ADMIN_URL = process.env.CDM_TEST_DATABASE_URL;
const pgDescribe = ADMIN_URL ? describe : describe.skip;

function gateFor(
  user: string,
  password: string,
  cdmSchema = 'cdm',
  opts: { port?: number } = {},
): { gate: CdmAccessGate; executor: CdmExecutor } {
  const url = new URL(ADMIN_URL ?? 'postgres://x@127.0.0.1:5025/omop');
  const config = parseDataSourceConfig({
    label: `gate-${user.replace(/_/g, '-')}`,
    type: 'omop-cdm',
    host: url.hostname,
    port: opts.port ?? Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    user,
    passwordEnv: 'CDM_TEST_PASSWORD',
    cdmVersion: '5.4',
    dbms: 'postgresql',
    schemas: { cdm: cdmSchema, vocabulary: cdmSchema, results: 'results' },
    statementTimeoutMs: 15_000,
  });
  const executor = new CdmExecutor(config, undefined, { CDM_TEST_PASSWORD: password });
  return { gate: new CdmAccessGate(executor), executor };
}

async function runGate(
  user: string,
  password: string,
  cdmSchema?: string,
  opts?: { port?: number },
): Promise<AccessGateReport> {
  const { gate, executor } = gateFor(user, password, cdmSchema, opts);
  try {
    return await gate.run();
  } finally {
    await executor.close();
  }
}

function failed(report: AccessGateReport, domain?: string) {
  return report.checks.filter((c) => !c.passed && (!domain || c.domain === domain));
}

pgDescribe('接入一致性校验（真实 PostgreSQL）', () => {
  it('正确的双权限域账号：全部通过，并读出语义版本留痕（3.1–3.4）', async () => {
    const r = await runGate('connector_ok', 'ok-pw');
    expect(failed(r)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.cdmVersion).toBe('5.4');
    expect(r.vocabularyVersion).toBe('v5.0 31-AUG-24');
    // 每个必需视图都查过可读性、契约、不可写。
    for (const t of ['person', 'drug_exposure', 'condition_occurrence', 'concept', 'cdm_source']) {
      expect(r.checks.find((c) => c.id === `view-readable:${t}`)?.passed).toBe(true);
      expect(r.checks.find((c) => c.id === `view-contract:${t}`)?.passed).toBe(true);
      expect(r.checks.find((c) => c.id === `view-not-writable:${t}`)?.passed).toBe(true);
    }
  }, 60_000);

  describe('负例总验收（3.7）：每一类违规都 fail-closed，且归因到正确的权限域', () => {
    it('纯只读账号 → results 可写域失败，明说「纯只读不满足契约」', async () => {
      const r = await runGate('connector_readonly', 'ro-pw');
      expect(r.passed).toBe(false);
      const [f] = failed(r, 'results-write');
      expect(f?.detail).toMatch(/纯只读账号不满足接入契约/);
      // 其它域都是好的——失败被精确归因，不是一锅端。
      expect(failed(r, 'cdm-read')).toEqual([]);
      expect(failed(r, 'least-privilege')).toEqual([]);
    }, 60_000);

    it('能读底表 → 最小权限域失败，并点名越权的关系', async () => {
      const r = await runGate('connector_overpriv', 'op-pw');
      expect(r.passed).toBe(false);
      const [f] = failed(r, 'least-privilege');
      expect(f?.detail).toMatch(/底表可达/);
      // 按 schema 分组、不截断：带直接标识的 person 不会被藏在「等 N 个」后面。
      expect(f?.detail).toMatch(/cdm_raw\.person/);
      expect(f?.detail).toMatch(/请撤销 cdm_raw 的权限/);
    }, 60_000);

    it('视图多出规范外的列（身份证号）→ 视图契约域失败', async () => {
      const r = await runGate('connector_leaky', 'lk-pw', 'cdm_leaky');
      expect(r.passed).toBe(false);
      const [f] = failed(r, 'contract');
      expect(f?.id).toBe('view-contract:person');
      expect(f?.detail).toMatch(/national_id/);
      expect(f?.detail).toMatch(/不在 CDM v5\.4 规范内/);
    }, 60_000);

    it('规范内的列也会是直接标识：person_source_value（病案号）→ 视图契约域失败', async () => {
      const r = await runGate('connector_mrn', 'mrn-pw', 'cdm_mrn');
      expect(r.passed).toBe(false);
      const [f] = failed(r, 'contract');
      expect(f?.detail).toMatch(/person_source_value/);
      expect(f?.detail).toMatch(/病案号/);
    }, 60_000);

    it('缺必需视图 → CDM 视图只读域失败，明说缺哪张', async () => {
      const r = await runGate('connector_missing', 'ms-pw', 'cdm_missing');
      expect(r.passed).toBe(false);
      const f = failed(r, 'cdm-read').find((c) => c.id === 'view-readable:drug_exposure');
      expect(f?.detail).toMatch(/缺少必需的 CDM 视图 cdm_missing\.drug_exposure/);
    }, 60_000);

    it('元数据读不到 → 元数据域失败（且区分「存在但无权限」与「不存在」）', async () => {
      const r = await runGate('connector_nometa', 'nm-pw', 'cdm_nometa');
      expect(r.passed).toBe(false);
      expect(failed(r, 'metadata').length).toBeGreaterThan(0);
      const readable = r.checks.find((c) => c.id === 'view-readable:cdm_source');
      expect(readable?.detail).toMatch(/存在但连接器账号无 SELECT 权限/);
    }, 60_000);

    it('超级用户账号 → 账号属性域失败（超级用户绕过全部视图与权限）', async () => {
      const r = await runGate('postgres', 'admin');
      expect(r.passed).toBe(false);
      const [f] = failed(r, 'role');
      expect(f?.detail).toMatch(/rolsuper/);
      expect(f?.detail).toMatch(/形同虚设/);
      // 超级用户也必然「能读底表」——两个独立判据同时报警。
      expect(failed(r, 'least-privilege').length).toBe(1);
    }, 60_000);

    it('数据源不可达 → 全部失败但不崩溃，原因写明不可达', async () => {
      const r = await runGate('connector_ok', 'ok-pw', 'cdm', { port: 1 });
      expect(r.passed).toBe(false);
      expect(r.checks.every((c) => !c.passed)).toBe(true);
      expect(r.checks[0].detail).toMatch(/数据源不可达/);
    }, 60_000);

    it('错误口令 → 认证失败，且报告里不含口令', async () => {
      const r = await runGate('connector_ok', 'definitely-wrong-口令');
      expect(r.passed).toBe(false);
      expect(r.checks[0].detail).toMatch(/认证失败/);
      expect(JSON.stringify(r)).not.toContain('definitely-wrong-口令');
    }, 60_000);
  });

  it('错误汇总按权限域分组，医院 DBA 能直接定位（3.5）', async () => {
    const r = await runGate('connector_readonly', 'ro-pw');
    const summary = summarizeFailures(r);
    expect(summary).toMatch(/【results 可写域】/);
    expect(summary).not.toMatch(/【CDM 视图只读域】/);
  }, 60_000);

  it('反复校验不在 results 里残留探针表', async () => {
    for (let i = 0; i < 3; i += 1) await runGate('connector_ok', 'ok-pw');
    const { executor } = gateFor('connector_ok', 'ok-pw');
    try {
      const rows = await executor.query<{ n: number }>({
        text: `SELECT count(*)::int AS n FROM pg_catalog.pg_tables
               WHERE schemaname = 'results' AND tablename LIKE 'mt\\_%\\_probe'
                 AND tableowner = current_user`,
      });
      expect(rows[0].n).toBe(0);
    } finally {
      await executor.close();
    }
  }, 60_000);
});
