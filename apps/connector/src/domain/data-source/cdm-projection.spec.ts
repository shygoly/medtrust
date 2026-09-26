// omop-data-source-access —— 投影下推 + 双路径等价 + 注册表 fail-closed（tasks 2b / 3.6）。
//
// 核心用例（2b.3）：**同一份数据**分别走文件路径（InternalRecord[]）与 CDM 路径
// （真实 PostgreSQL 视图层 → 下推 SQL），喂进**同一个**真实 Wasm 沙箱模块，
// 输出必须逐字节一致。这证明两条路径真的在投影载荷处汇合、沙箱链路完全不变。
import { Client } from 'pg';
import { staticGate } from '@medtrust/wasm-algorithms';
import { AuditService } from '../audit';
import { InternalRecord } from '../types';
import {
  bucketsFromSandboxOutput,
  projectDisproportionality,
  type DisproportionalityProjection,
} from '../sandbox/disproportionality-sandbox';
import { WasmSandboxRunner } from '../sandbox/sandbox-runner';
import {
  PLATFORM_MODULE_BYTES,
  PLATFORM_MODULE_SM3,
} from '../sandbox/__fixtures__/platform-module';
import { CdmExecutor, type SqlStatement } from './cdm-executor';
import {
  CdmProjectionError,
  projectDisproportionalityFromCdm,
  resolveDrugConcepts,
} from './cdm-projection';
import {
  CdmDataSourceRegistry,
  DataSourceNotAvailableError,
} from './cdm-data-source-registry';
import { parseDataSourceConfig } from './data-source-config';

const DRUG = '注射用紫杉醇';
const CONCEPTS: Array<[number, string, string]> = [
  [900001, DRUG, 'Drug'],
  [900002, '二甲双胍', 'Drug'],
  [800001, 'ALT升高', 'Condition'],
  [800002, '白细胞↓', 'Condition'],
  [800003, '皮疹', 'Condition'],
];
const CONCEPT_ID = new Map(CONCEPTS.map(([id, name]) => [name, id]));

/** 确定性合成队列（暴露组事件率更高 = 已知信号）。 */
function cohort(n = 60): InternalRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const exposed = i % 5 < 2;
    const events: InternalRecord['adverseEvents'] = [];
    if (exposed ? i % 3 !== 0 : i % 9 === 0) {
      events.push({ organSystem: '肝胆系统', term: 'ALT升高', serious: false });
    }
    if (i % 7 === 0) events.push({ organSystem: '血液系统', term: '白细胞↓', serious: false });
    if (i % 6 === 1) events.push({ organSystem: '皮肤', term: '皮疹', serious: false });
    return {
      subjectKey: `sk_${i}`,
      ageBand: '40-49',
      sex: 'F',
      conditions: [],
      medications: exposed ? [DRUG, '二甲双胍'] : ['二甲双胍'],
      adverseEvents: events,
    } as InternalRecord;
  });
}

async function runSandbox(p: DisproportionalityProjection): Promise<Uint8Array> {
  const result = await new WasmSandboxRunner().run({
    analysisType: 'disproportionality',
    moduleSm3: PLATFORM_MODULE_SM3,
    moduleBytes: PLATFORM_MODULE_BYTES,
    input: p.input,
    n: p.n,
    k: p.k,
    outOff: p.outOff,
    outBytes: p.outBytes,
    minMemoryPages: staticGate(PLATFORM_MODULE_BYTES).memoryPages.min,
  });
  return result.output;
}

// ── 纯逻辑（无需数据库）───────────────────────────────────────────────────────

/** 记录语句、按脚本回结果的假执行器。 */
function scriptedExecutor(responses: unknown[][]): {
  executor: CdmExecutor;
  sent: SqlStatement[];
} {
  const sent: SqlStatement[] = [];
  let i = 0;
  const config = parseDataSourceConfig({
    label: 'scripted',
    type: 'omop-cdm',
    host: 'h',
    database: 'd',
    user: 'u',
    passwordEnv: 'P',
    cdmVersion: '5.4',
    dbms: 'postgresql',
    schemas: { cdm: 'cdm', vocabulary: 'cdm', results: 'results' },
  });
  const executor = new CdmExecutor(
    config,
    () => ({
      query: async (text: string, values?: unknown[]) => {
        sent.push({ text, values });
        return { rows: (responses[i++] ?? []) as never[], rowCount: 0 };
      },
      end: async () => undefined,
      on: () => undefined,
    }),
    { P: 'x' },
  );
  return { executor, sent };
}

describe('药物概念解析（omop-data-source-access D8）', () => {
  it('找不到药物 → fail-closed，不把所有人当作未暴露继续算', async () => {
    const { executor } = scriptedExecutor([[]]);
    await expect(resolveDrugConcepts(executor, { name: '不存在的药' })).rejects.toThrow(
      CdmProjectionError,
    );
  });

  it('按名称查词汇表时名称走绑定参数，不进 SQL 文本', async () => {
    const { executor, sent } = scriptedExecutor([[{ concept_id: 900001 }]]);
    const evil = "x' OR '1'='1";
    await resolveDrugConcepts(executor, { name: evil });
    expect(sent[0].text).not.toContain(evil);
    expect(sent[0].values).toEqual([evil]);
  });

  it('直接给 concept_id 时不查库，且拒绝非法 id', async () => {
    const { executor, sent } = scriptedExecutor([]);
    expect(await resolveDrugConcepts(executor, { conceptIds: [3, 1, 3] })).toEqual([1, 3]);
    expect(sent).toHaveLength(0);
    await expect(resolveDrugConcepts(executor, { conceptIds: [-1] })).rejects.toThrow();
  });
});

describe('不得全量拉取（task 2b.4）', () => {
  it('每条下推语句都带显式列清单，没有 SELECT *', async () => {
    const { executor, sent } = scriptedExecutor([
      [{ concept_id: 900001 }],
      [{ person_id: 1, exposed: true }],
      [{ person_id: 1, term: 'ALT升高' }],
    ]);
    await projectDisproportionalityFromCdm(executor, { name: DRUG });
    expect(sent).toHaveLength(3);
    for (const s of sent) {
      expect(s.text).not.toMatch(/SELECT\s+\*/i);
    }
    // 药物过滤在 SQL 里（EXISTS + ANY 绑定参数），而不是取回全部用药记录再在内存里筛。
    expect(sent[1].text).toMatch(/EXISTS/);
    expect(sent[1].text).toMatch(/ANY\(\$1\)/);
    // 人员查询只回 person_id 与暴露标记，不回出生年、性别、日期等无关列。
    expect(sent[1].text).not.toMatch(/year_of_birth|gender_concept_id|_date/);
  });
});

// ── 真实 PostgreSQL ─────────────────────────────────────────────────────────────

const ADMIN_URL = process.env.CDM_TEST_DATABASE_URL;
const pgDescribe = ADMIN_URL ? describe : describe.skip;

pgDescribe('双路径等价：同一份数据，文件路径 vs CDM 路径（task 2b.3）', () => {
  const rows = cohort(60);
  let executor: CdmExecutor;

  beforeAll(async () => {
    // 用管理员把同一份合成数据写进 cdm_raw 底表（医院侧的真实数据），
    // 连接器只通过 cdm 视图层读。
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(
        'TRUNCATE cdm_raw.person, cdm_raw.drug_exposure, cdm_raw.condition_occurrence, cdm_raw.concept',
      );
      for (const [id, name, domain] of CONCEPTS) {
        await admin.query(
          'INSERT INTO cdm_raw.concept (concept_id, concept_name, domain_id, standard_concept) VALUES ($1,$2,$3,$4)',
          [id, name, domain, 'S'],
        );
      }
      let deId = 1;
      let coId = 1;
      for (let i = 0; i < rows.length; i += 1) {
        const personId = i + 1;
        await admin.query(
          `INSERT INTO cdm_raw.person (person_id, gender_concept_id, year_of_birth, national_id, patient_name)
           VALUES ($1, 8532, 1980, $2, $3)`,
          [personId, `31010119800101${String(personId).padStart(4, '0')}`, `患者${personId}`],
        );
        for (const med of rows[i].medications) {
          await admin.query(
            'INSERT INTO cdm_raw.drug_exposure VALUES ($1,$2,$3,$4)',
            [deId++, personId, CONCEPT_ID.get(med), '2023-01-01'],
          );
        }
        for (const ev of rows[i].adverseEvents) {
          await admin.query(
            'INSERT INTO cdm_raw.condition_occurrence VALUES ($1,$2,$3,$4)',
            [coId++, personId, CONCEPT_ID.get(ev.term), '2023-02-01'],
          );
        }
      }
    } finally {
      await admin.end();
    }

    const url = new URL(ADMIN_URL!);
    executor = new CdmExecutor(
      parseDataSourceConfig({
        label: 'parity-cdm',
        type: 'omop-cdm',
        host: url.hostname,
        port: Number(url.port || 5432),
        database: url.pathname.replace(/^\//, ''),
        user: 'connector_ok',
        passwordEnv: 'CDM_TEST_PASSWORD',
        cdmVersion: '5.4',
        dbms: 'postgresql',
        schemas: { cdm: 'cdm', vocabulary: 'cdm', results: 'results' },
      }),
      undefined,
      { CDM_TEST_PASSWORD: 'ok-pw' },
    );
  }, 120_000);

  afterAll(() => executor?.close());

  it('投影载荷逐字节一致，沙箱输出逐字节一致，最终分桶逐字段一致', async () => {
    const fromFile = projectDisproportionality(rows, DRUG);
    const { projection: fromCdm, drugConceptIds } = await projectDisproportionalityFromCdm(
      executor,
      { name: DRUG },
    );

    expect(drugConceptIds).toEqual([900001]);
    // ① 投影载荷：同一个构造器、同一份数据 → 字节完全相同。
    expect(fromCdm.terms).toEqual(fromFile.terms);
    expect(fromCdm.cohortSize).toBe(fromFile.cohortSize);
    expect(fromCdm.nDrug).toBe(fromFile.nDrug);
    expect(Buffer.from(fromCdm.input).equals(Buffer.from(fromFile.input))).toBe(true);

    // ② 真实 Wasm 沙箱：输出逐字节一致。
    const outFile = await runSandbox(fromFile);
    const outCdm = await runSandbox(fromCdm);
    expect(Buffer.from(outCdm).equals(Buffer.from(outFile))).toBe(true);

    // ③ 回填后的分桶逐字段一致（含并列时的稳定顺序）。
    expect(bucketsFromSandboxOutput(outCdm, fromCdm)).toEqual(
      bucketsFromSandboxOutput(outFile, fromFile),
    );
  }, 120_000);

  it('进入沙箱的只有 0/1 标记位——CDM 路径的身份证号与姓名物理上进不来', async () => {
    const { projection } = await projectDisproportionalityFromCdm(executor, { name: DRUG });
    expect(projection.input.every((b) => b === 0 || b === 1)).toBe(true);
    const asText = Buffer.from(projection.input).toString('utf8');
    expect(asText).not.toMatch(/3101011980/);
    expect(asText).not.toMatch(/患者/);
  }, 60_000);

  it('按 concept_id 指定与按名称指定得到同一投影', async () => {
    const byName = await projectDisproportionalityFromCdm(executor, { name: DRUG });
    const byId = await projectDisproportionalityFromCdm(executor, { conceptIds: [900001] });
    expect(Buffer.from(byId.projection.input).equals(Buffer.from(byName.projection.input))).toBe(true);
  }, 60_000);
});

pgDescribe('注册表：未通过的数据源不可用，且不回退到文件（task 3.6）', () => {
  const url = new URL(ADMIN_URL ?? 'postgres://x@127.0.0.1:5025/omop');
  const base = {
    type: 'omop-cdm',
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    passwordEnv: 'CDM_TEST_PASSWORD',
    cdmVersion: '5.4',
    dbms: 'postgresql',
    schemas: { cdm: 'cdm', vocabulary: 'cdm', results: 'results' },
  };

  it('通过 → 可取用；未通过 → requireAvailable 抛，且明说不改用文件数据', async () => {
    const audit = new AuditService();
    const registry = new CdmDataSourceRegistry(audit);
    registry.configure(
      [
        parseDataSourceConfig({ ...base, label: 'good-cdm', user: 'connector_ok' }),
        parseDataSourceConfig({
          ...base,
          label: 'readonly-cdm',
          user: 'connector_readonly',
          passwordEnv: 'CDM_RO_PASSWORD',
        }),
      ],
      // 各数据源按自己的 passwordEnv 取口令。
      { CDM_TEST_PASSWORD: 'ok-pw', CDM_RO_PASSWORD: 'ro-pw' },
    );
    const reports = await registry.verifyAll();
    try {
      expect(reports.find((r) => r.label === 'good-cdm')?.passed).toBe(true);
      expect(registry.requireAvailable('good-cdm')).toBeInstanceOf(CdmExecutor);

      expect(() => registry.requireAvailable('readonly-cdm')).toThrow(DataSourceNotAvailableError);
      expect(() => registry.requireAvailable('readonly-cdm')).toThrow(/不会改用本地文件数据/);
      // 失败原因是精确的「纯只读」，而不是被口令问题混淆。
      expect(() => registry.requireAvailable('readonly-cdm')).toThrow(/纯只读账号不满足接入契约/);
      expect(() => registry.requireAvailable('nope')).toThrow(/未配置/);

      // 审计留痕：通过的记版本，没通过的记按权限域分组的原因；都不含口令。
      const entries = audit.all();
      expect(entries.some((e) => e.action === 'data-source-verified')).toBe(true);
      expect(entries.some((e) => e.action === 'data-source-rejected' && !e.allowed)).toBe(true);
      const log = JSON.stringify(entries);
      expect(log).not.toContain('ok-pw');
      expect(log).not.toContain('ro-pw');

      // 状态视图对外可见、不含凭据。
      const view = registry.statusOf('good-cdm');
      expect(view?.passed).toBe(true);
      expect(view?.vocabularyVersion).toBe('v5.0 31-AUG-24');
      expect(JSON.stringify(registry.list())).not.toContain('ok-pw');
    } finally {
      await registry.onModuleDestroy();
    }
  }, 120_000);

  it('尚未校验的数据源也不可用', () => {
    const registry = new CdmDataSourceRegistry();
    registry.configure([parseDataSourceConfig({ ...base, label: 'fresh-cdm', user: 'connector_ok' })], {
      CDM_TEST_PASSWORD: 'ok-pw',
    });
    expect(() => registry.requireAvailable('fresh-cdm')).toThrow(/尚未完成接入校验/);
  });
});
