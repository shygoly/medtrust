// algorithm-sandbox 4.4/4.5/4.6:执行路径选择、执行隔离标注、结果哈希一致性。
import { AuditService } from '../audit';
import { ConnectorTaskRunner } from '../connector-task-runner';
import { ContractView } from '../contract-view';
import { ControlPlaneClient } from '../control-plane-client';
import { Deidentifier } from '../deidentifier';
import { LocalStore } from '../local-store';
import { OutputGate } from '../output-gate';
import { PolicyEnforcementPoint, PolicyViolation } from '../policy-enforcement';
import { RetentionEnforcer } from '../retention';
import { createTestMdopExecutor } from '../../test/mdop-local-executor';
import { RwsExecutor, disproportionalityTables } from '../rws-executor';
import { sm3Hex } from '../sm3';
import { TaskScratch } from '../task-scratch';
import { SoftwareSealedCompute } from '../tee';
import { InternalRecord } from '../types';
import { AlgorithmSandboxExecutor } from './algorithm-sandbox-executor';
import { ConnectorModuleClient } from './module-client';
import { WasmSandboxRunner } from './sandbox-runner';
import {
  PLATFORM_MODULE_ANALYSIS_TYPE,
  PLATFORM_MODULE_BYTES,
  PLATFORM_MODULE_SM3,
  newTestCa,
} from './__fixtures__/platform-module';

const DRUG = '注射用紫杉醇';
const PURPOSE = '药物警戒';

function rec(over: Partial<InternalRecord> = {}): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random().toString(36).slice(2),
    ageBand: '40-49',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    ...over,
  };
}

function cohort(): InternalRecord[] {
  const rows: InternalRecord[] = [];
  for (let i = 0; i < 120; i++) {
    const exposed = i % 3 !== 0;
    const events: InternalRecord['adverseEvents'] = [];
    if (exposed ? i % 4 === 0 : i % 12 === 0) {
      events.push({ organSystem: '肝胆系统', term: 'ALT升高', serious: false });
    }
    if (i % 5 === 0) {
      events.push({ organSystem: '血液系统', term: '白细胞↓', serious: false });
    }
    rows.push(
      rec({
        subjectKey: `sk_${i}`,
        medications: exposed ? [DRUG] : ['安慰剂'],
        adverseEvents: events,
      }),
    );
  }
  return rows;
}

function buildExecutor(audit: AuditService, ca: ReturnType<typeof newTestCa>) {
  const controlPlane = {
    fetchModule: async () => ({
      analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
      sm3: PLATFORM_MODULE_SM3,
      signature: ca.sign(PLATFORM_MODULE_BYTES),
      abiVersion: 1,
      bytes: Buffer.from(PLATFORM_MODULE_BYTES).toString('base64'),
    }),
  } as unknown as ControlPlaneClient;
  const modules = new ConnectorModuleClient(controlPlane, audit);
  const runner = new WasmSandboxRunner(audit);
  return new AlgorithmSandboxExecutor(modules, runner, audit);
}

const contract = (pinned = true): ContractView => ({
  id: 'c-l15-sandbox',
  dataProductId: 'dp-pv',
  providerId: 'p-demohospa',
  consumerId: 'p-meddata',
  purpose: PURPOSE,
  retention: '阅后即焚',
  output: '仅聚合统计',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  ...(pinned ? { pinnedModules: { [PLATFORM_MODULE_ANALYSIS_TYPE]: PLATFORM_MODULE_SM3 } } : {}),
});

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('执行路径选择 (algorithm-sandbox D8 → 4.3 后由 MDOP 承接)', () => {
  // 旧链的 `pinnedModule` 沙箱分支已随 L1.5 迁移删除：新路径下**模块恒由计划固定**（算子摘要来自模块库），
  // 且**没有内置 TS 回退**（fail-closed）。下面两条把 D8 的意图（固定模块执行 / 缺模块即拒）落在新路径上。
  it('计划固定模块执行：结果与保留的参照实现逐字段一致', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest(cohort());
    const executor = createTestMdopExecutor({ id: 'spec-exec-annotation', store, localL15: true });
    const out = await Promise.resolve(
      executor.run({ type: 'disproportionality', level: 'L1.5', drug: DRUG }),
    );
    const builtin = disproportionalityTables(
      store.aggregateInternal({ origin: 'internal', actor: 'spec' }, (r) => r) as never,
      DRUG,
    );
    // 只比结构语义（键/计数/2×2 单元格）：`rate` 分母两侧口径不同（参照用全队列，适配器用 C3 载荷队列规模）。
    const slim = (b: Array<Record<string, unknown>>) =>
      b.map((x) => ({ key: x.key, count: x.count, b: x.b, c: x.c, d: x.d }));
    expect(slim(out.buckets as never)).toEqual(slim(builtin.buckets as never));
    expect(out.cohortSize).toBe(builtin.cohortSize);
  }, 30_000);

  it('模块库缺该模块：装配即拒，不回退 TS（fail-closed）', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    store.ingest(cohort());
    // 指向空模块目录：装配期读不到模块清单即抛（同步），不得回退到内置 TS 实现。
    expect(() =>
      createTestMdopExecutor({
        id: 'spec-exec-annotation-missing',
        store,
        localL15: true,
        moduleDir: '/nonexistent-module-dir',
      }),
    ).toThrow();
  }, 30_000);
});
describe('PEP 固定模块校验 (usage-control)', () => {
  const task = (moduleSm3?: string) => ({
    taskId: 't-pep',
    purpose: PURPOSE,
    analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
    moduleSm3,
  });

  it('模块一致 → 放行', () => {
    const audit = new AuditService();
    expect(() =>
      new PolicyEnforcementPoint(audit).check(task(PLATFORM_MODULE_SM3), contract()),
    ).not.toThrow();
  });

  it('模块不符 → pep-deny', () => {
    const audit = new AuditService();
    expect(() =>
      new PolicyEnforcementPoint(audit).check(task('a'.repeat(64)), contract()),
    ).toThrow(PolicyViolation);
    expect(
      audit.all().some((e) => e.action === 'pep-deny' && !e.allowed),
    ).toBe(true);
  });

  it('合约固定了模块但任务未携带 → 拒绝(不以内置实现代替)', () => {
    const audit = new AuditService();
    expect(() =>
      new PolicyEnforcementPoint(audit).check(task(undefined), contract()),
    ).toThrow(/未携带模块引用/);
  });

  it('合约未固定模块 → 不校验模块', () => {
    const audit = new AuditService();
    expect(() =>
      new PolicyEnforcementPoint(audit).check(task(undefined), contract(false)),
    ).not.toThrow();
  });
});

describe('任务层:标注在闸门之后、算哈希之前写入 (4.4)', () => {
  it('MDOP 路径:聚合过闸后仍完整（执行标注缺口见注释）', async () => {
    const ca = newTestCa();
    process.env.CONNECTOR_REGISTRY_PUBKEY = ca.publicKey;
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const deid = new Deidentifier();
    store.ingest(cohort());
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      createTestMdopExecutor({ id: 'spec-exec-annotation-2', store, localL15: true }),
      new OutputGate(audit, deid),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );

    const out = await runner.run(
      {
        taskId: 't-runner-1',
        purpose: PURPOSE,
        workloadType: 'rws',
        analysis: { type: 'disproportionality', level: 'L1.5', drug: DRUG },
        module: { analysisType: PLATFORM_MODULE_ANALYSIS_TYPE, sm3: PLATFORM_MODULE_SM3 },
      },
      contract(),
    );
    // 缺口（D10.7）：MDOP 路径尚未回发 `wasm-sandbox` 执行标注（moduleSm3/abiVersion），
    // 这里如实断言当前行为；补标注属于 change `mdop-node-parity-enrichments` 的后续项。
    expect(out.execution).toEqual({ isolation: 'none' });
  }, 30_000);

  it('MDOP 路径:模块恒由计划固定,任务标注 isolation=none(适配器当前口径)', async () => {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const deid = new Deidentifier();
    store.ingest(cohort());
    const runner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      createTestMdopExecutor({ id: 'spec-exec-annotation-4', store, localL15: true }),
      new OutputGate(audit, deid),
      new TaskScratch(),
      new RetentionEnforcer(new TaskScratch(), audit),
    );
    const out = await runner.run(
      {
        taskId: 't-runner-2',
        purpose: PURPOSE,
        workloadType: 'rws',
        analysis: { type: 'disproportionality', level: 'L1.5', drug: DRUG },
      },
      contract(false),
    );
    expect(out.execution).toEqual({ isolation: 'none' });
  });
});

describe('回传哈希回归(09-15 故障重演)', () => {
  // 平台口径:对 JSON 解析后的对象做键排序稳定序列化再 SM3(platformStableStringify)。
  function platformStableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((v) => platformStableStringify(v)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${platformStableStringify(obj[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  it('带 execution 标注的聚合结果,两侧哈希一致', async () => {
    const realFetch = global.fetch;
    let sent: { aggregate: unknown; aggregateHash: string } | undefined;
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return { ok: true, status: 201, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    try {
      const client = new ControlPlaneClient({
        baseUrl: 'http://cp.test/api/v1',
        participantId: 'p-demohospa',
        connectorToken: 't',
      });
      await client.completeAssignment('a-1', {
        aggregate: {
          analysisType: 'disproportionality',
          cohortSize: 120,
          buckets: [{ key: 'ALT升高', count: 7, rate: 0.0583, b: 31, c: 9, d: 73 }],
          execution: {
            isolation: 'wasm-sandbox',
            moduleSm3: PLATFORM_MODULE_SM3,
            abiVersion: 1,
          },
        },
      });
      expect(sent).toBeDefined();
      expect(sent!.aggregateHash).toBe(
        sm3Hex(platformStableStringify(sent!.aggregate)),
      );
      expect(
        (sent!.aggregate as { execution: { isolation: string } }).execution.isolation,
      ).toBe('wasm-sandbox');
    } finally {
      global.fetch = realFetch;
    }
  });
});
