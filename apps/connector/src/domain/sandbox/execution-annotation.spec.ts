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
    const rows = cohort();
    store.ingest(rows);
    const executor = createTestMdopExecutor({ id: 'spec-exec-annotation', store, localL15: true });
    const out = await Promise.resolve(
      executor.run({ type: 'disproportionality', level: 'L1.5', drug: DRUG }),
    );
    const builtin = disproportionalityTables(
      store.aggregateInternal({ origin: 'internal', actor: 'spec' }, (r) => r) as never,
      DRUG,
    );
    // 只比结构语义（键 + 计数 + 2×2 单元格）：`rate` 的分母两侧口径不同（参照用全队列，
    // 适配器用 C3 载荷里的队列规模），不是同一件事。
    const slim = (b: Array<Record<string, unknown>>) =>
      b.map((x) => ({ key: x.key, count: x.count, b: x.b, c: x.c, d: x.d }));
    expect(slim(out.buckets as never)).toEqual(slim(builtin.buckets as never));
    expect(out.cohortSize).toBe(builtin.cohortSize);
  }, 30_000);

  it('模块库缺该模块：拒绝执行，不回退 TS（fail-closed）', async () => {
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
