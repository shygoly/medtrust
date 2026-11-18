import { AuditService } from '../audit';
import { ControlPlaneClient } from '../control-plane-client';
import { disproportionalityTables } from '../rws-executor';
import { sm3BytesHex } from '../sm3';
import { InternalRecord } from '../types';
import { AlgorithmSandboxExecutor } from './algorithm-sandbox-executor';
import {
  projectDisproportionality,
  projectionRequiredBytes,
} from './disproportionality-sandbox';
import { ConnectorModuleClient } from './module-client';
import {
  assertSupportedAbi,
  ModuleVerificationError,
  moduleSignaturePayload,
  verifyModule,
} from './module-verifier';
import { SandboxLimitError, WasmSandboxRunner } from './sandbox-runner';
import { buildFixtureWasm } from './wasm-fixtures';
import {
  PLATFORM_MODULE_ANALYSIS_TYPE,
  PLATFORM_MODULE_BYTES,
  PLATFORM_MODULE_SM3,
  TestCa,
  newTestCa,
} from './__fixtures__/platform-module';

const DRUG = '注射用紫杉醇';

function rec(over: Partial<InternalRecord> = {}): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random().toString(36).slice(2),
    ageBand: '40-49',
    sex: 'F',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    ...over,
  };
}

/** 确定性合成队列:暴露组事件率更高(注入信号)。 */
function syntheticCohort(n = 400): InternalRecord[] {
  const rows: InternalRecord[] = [];
  for (let i = 0; i < n; i++) {
    const exposed = i % 5 < 2; // 40% 暴露
    const events: InternalRecord['adverseEvents'] = [];
    if (exposed ? i % 3 !== 0 : i % 9 === 0) {
      events.push({ organSystem: '肝胆系统', term: 'ALT升高', serious: false });
    }
    if (i % 7 === 0) {
      events.push({ organSystem: '血液系统', term: '白细胞↓', serious: false });
    }
    // 两条并列词条(a 相同)用于验证稳定排序口径
    if (exposed ? i % 6 === 1 : i % 6 === 1) {
      events.push({ organSystem: '皮肤', term: '皮疹', serious: false });
    }
    rows.push(
      rec({
        subjectKey: `sk_${i}`,
        ageBand: i % 2 === 0 ? '40-49' : '60-69',
        sex: i % 3 === 0 ? 'M' : 'F',
        medications: exposed ? [DRUG, '二甲双胍'] : ['二甲双胍'],
        adverseEvents: events,
      }),
    );
  }
  return rows;
}

/** 用测试 CA 签名的模块分发桩(只替换 HTTP 层,校验逻辑是真的)。 */
function fakeControlPlane(ca: TestCa, bytes: Uint8Array, abiVersion = 1) {
  return {
    fetchModule: async () => ({
      analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
      sm3: sm3BytesHex(bytes),
      signature: ca.sign(bytes),
      abiVersion,
      bytes: Buffer.from(bytes).toString('base64'),
    }),
  } as unknown as ControlPlaneClient;
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('算法模块运行前双重校验 (algorithm-sandbox)', () => {
  let ca: TestCa;
  beforeEach(() => {
    ca = newTestCa();
    process.env.CONNECTOR_REGISTRY_PUBKEY = ca.publicKey;
  });

  it('SM3 与签名双双通过', () => {
    const verified = verifyModule(PLATFORM_MODULE_BYTES, {
      analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
      expectedSm3: PLATFORM_MODULE_SM3,
      signature: ca.sign(PLATFORM_MODULE_BYTES),
      registryPublicKey: ca.publicKey,
    });
    expect(verified.sm3).toBe(PLATFORM_MODULE_SM3);
  });

  it('SM3 与合约固定值不符 → 拒绝且不回退', () => {
    process.env.CONNECTOR_REGISTRY_PUBKEY = ca.publicKey;
    expect(() =>
      verifyModule(PLATFORM_MODULE_BYTES, {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        expectedSm3: 'f'.repeat(64),
        signature: ca.sign(PLATFORM_MODULE_BYTES),
        registryPublicKey: ca.publicKey,
      }),
    ).toThrow(/SM3 与合约固定值不符/);
  });

  it('签名无法验证 → 拒绝', () => {
    const other = newTestCa();
    let caught: ModuleVerificationError | undefined;
    try {
      verifyModule(PLATFORM_MODULE_BYTES, {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        expectedSm3: PLATFORM_MODULE_SM3,
        signature: other.sign(PLATFORM_MODULE_BYTES),
        registryPublicKey: ca.publicKey,
      });
    } catch (err) {
      caught = err as ModuleVerificationError;
    }
    expect(caught?.reason).toBe('signature-invalid');
  });

  it('未配置平台 CA 公钥 → fail-closed', () => {
    let caught: ModuleVerificationError | undefined;
    try {
      verifyModule(PLATFORM_MODULE_BYTES, {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        expectedSm3: PLATFORM_MODULE_SM3,
        signature: ca.sign(PLATFORM_MODULE_BYTES),
        registryPublicKey: '',
      });
    } catch (err) {
      caught = err as ModuleVerificationError;
    }
    expect(caught?.reason).toBe('no-registry-pubkey');
  });

  it('模块导入了函数 → 实例化前拒绝', () => {
    const hostile = buildFixtureWasm({ importFunc: 'log' });
    let caught: ModuleVerificationError | undefined;
    try {
      verifyModule(hostile, {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        expectedSm3: sm3BytesHex(hostile),
        signature: ca.sign(hostile),
        registryPublicKey: ca.publicKey,
      });
    } catch (err) {
      caught = err as ModuleVerificationError;
    }
    expect(caught?.reason).toBe('illegal-import');
    expect(caught?.message).toContain('env.log');
  });

  it('未导出 run / abi_version → 拒绝', () => {
    const noRun = buildFixtureWasm({ exportRun: false });
    expect(() =>
      verifyModule(noRun, {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        expectedSm3: sm3BytesHex(noRun),
        signature: ca.sign(noRun),
        registryPublicKey: ca.publicKey,
      }),
    ).toThrow(/未导出 run/);

    const noAbi = buildFixtureWasm({ exportAbi: false });
    expect(() =>
      verifyModule(noAbi, {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        expectedSm3: sm3BytesHex(noAbi),
        signature: ca.sign(noAbi),
        registryPublicKey: ca.publicKey,
      }),
    ).toThrow(/未导出 abi_version/);
  });

  it('ABI 版本不受支持 → 拒绝', () => {
    expect(() => assertSupportedAbi(2)).toThrow(/不受支持/);
    expect(() => assertSupportedAbi(1)).not.toThrow();
  });

  it('签名载荷口径固定(平台签发与连接器验签必须一致)', () => {
    expect(moduleSignaturePayload(PLATFORM_MODULE_SM3)).toBe(
      `medtrust.algorithm-module.v1:${PLATFORM_MODULE_SM3}`,
    );
  });
});

describe('零能力执行与资源上限 (worker)', () => {
  let ca: TestCa;
  beforeEach(() => {
    ca = newTestCa();
    process.env.CONNECTOR_REGISTRY_PUBKEY = ca.publicKey;
  });

  it('死循环在时限内被 terminate,连接器继续服务', async () => {
    process.env.CONNECTOR_SANDBOX_TIMEOUT_MS = '500';
    const audit = new AuditService();
    const runner = new WasmSandboxRunner(audit);
    const loop = buildFixtureWasm({ body: 'infinite-loop' });
    await expect(
      runner.run({
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        moduleSm3: sm3BytesHex(loop),
        moduleBytes: loop,
        input: new Uint8Array(64),
        n: 4,
        k: 1,
        outOff: 64,
        outBytes: 20,
        taskId: 't-loop',
      }),
    ).rejects.toThrow(/超时/);
    expect(
      audit.all().some((e) => e.action === 'sandbox-fail' && !e.allowed),
    ).toBe(true);
  }, 15_000);

  it('输入超过内存上限 → 调用模块之前拒绝', async () => {
    // 0.1 MB 上限:30k 行 × 3 词条的投影(约 150KB)必然超限,且不必造超大夹具。
    process.env.CONNECTOR_SANDBOX_MAX_MEMORY_MB = '0.1';
    const audit = new AuditService();
    const runner = new WasmSandboxRunner(audit);
    expect(() => runner.assertWithinMemoryLimit(200_000)).toThrow(
      SandboxLimitError,
    );

    const modules = new ConnectorModuleClient(
      fakeControlPlane(ca, PLATFORM_MODULE_BYTES),
      audit,
    );
    const executor = new AlgorithmSandboxExecutor(modules, runner, audit);
    const rows = syntheticCohort(30_000);
    const projection = projectDisproportionality(rows, DRUG);
    await expect(
      executor.runProjection(projection, {
        pinnedModule: {
          analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
          sm3: PLATFORM_MODULE_SM3,
        },
        taskId: 't-mem',
      }),
    ).rejects.toThrow(SandboxLimitError);
    expect(audit.all().some((e) => e.action === 'sandbox-module-verified')).toBe(
      false,
    );
  }, 20_000);

  it('worker 不继承宿主环境变量', async () => {
    process.env.CONNECTOR_PULL_TOKEN = 'host-token-should-not-leak';
    const audit = new AuditService();
    const runner = new WasmSandboxRunner(audit);
    // 用真实模块跑通一次,证明 worker 在 env={} 下仍能工作(密钥面收敛)。
    const projection = projectDisproportionality(syntheticCohort(50), DRUG);
    const result = await runner.run({
      analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
      moduleSm3: PLATFORM_MODULE_SM3,
      moduleBytes: PLATFORM_MODULE_BYTES,
      input: projection.input,
      n: projection.n,
      k: projection.k,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
    });
    expect(result.abiVersion).toBe(1);
    expect(result.envVarCount).toBe(0);
    expect(audit.all().find((e) => e.action === 'sandbox-run')?.detail).toContain(
      'envVars=0',
    );
  }, 20_000);
});

describe('最小列投影', () => {
  it('只传 0/1 标记:不出现词条文本、主体标识', () => {
    const rows = syntheticCohort(60);
    const projection = projectDisproportionality(rows, DRUG);
    expect(projection.terms).toContain('ALT升高');
    expect(projection.input.length).toBe(
      2 * projection.n + projection.n * projection.k,
    );
    expect([...projection.input].every((b) => b === 0 || b === 1)).toBe(true);

    const raw = Buffer.from(projection.input);
    expect(raw.includes(Buffer.from('ALT升高', 'utf8'))).toBe(false);
    expect(raw.includes(Buffer.from('sk_', 'utf8'))).toBe(false);
    expect(raw.includes(Buffer.from(DRUG, 'utf8'))).toBe(false);
    expect(raw.includes(Buffer.from('二甲双胍', 'utf8'))).toBe(false);
  });

  it('未入组行只贡献 0/1 位,不计入 cohortSize 与 2×2', () => {
    const rows = syntheticCohort(40);
    const projection = projectDisproportionality(
      rows,
      DRUG,
      (r) => r.ageBand === '40-49',
    );
    const included = rows.filter((r) => r.ageBand === '40-49');
    expect(projection.cohortSize).toBe(included.length);
    expect(projection.nDrug).toBe(
      included.filter((r) => r.medications.includes(DRUG)).length,
    );
  });
});

describe('沙箱输出不变量', () => {
  let ca: TestCa;
  beforeEach(() => {
    ca = newTestCa();
    process.env.CONNECTOR_REGISTRY_PUBKEY = ca.publicKey;
  });

  it('模块输出自相矛盾 → 任务失败,不返回结果', async () => {
    const audit = new AuditService();
    const runner = new WasmSandboxRunner(audit);
    // cohortSize=1; a=1,b=2,c=3,d=4 → a+b=3 ≠ 入组内用药人数
    const bogus = buildFixtureWasm({
      body: 'write-const',
      storeValues: [1, 1, 2, 3, 4],
    });
    const modules = new ConnectorModuleClient(
      fakeControlPlane(ca, bogus),
      audit,
    );
    const executor = new AlgorithmSandboxExecutor(modules, runner, audit);
    const rows = syntheticCohort(20);
    const projection = projectDisproportionality(rows, DRUG);
    await expect(
      executor.runProjection(projection, {
        pinnedModule: {
          analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
          sm3: sm3BytesHex(bogus),
        },
        taskId: 't-bogus',
      }),
    ).rejects.toThrow(/不变量违反/);
    expect(audit.all().some((e) => e.action === 'sandbox-fail')).toBe(true);
  }, 20_000);
});

describe('沙箱 vs 内置 TS 实现', () => {
  let ca: TestCa;
  beforeEach(() => {
    ca = newTestCa();
    process.env.CONNECTOR_REGISTRY_PUBKEY = ca.publicKey;
  });

  it('同一队列两条路径逐字段一致,且审计留痕', async () => {
    const audit = new AuditService();
    const runner = new WasmSandboxRunner(audit);
    const modules = new ConnectorModuleClient(
      fakeControlPlane(ca, PLATFORM_MODULE_BYTES),
      audit,
    );
    const executor = new AlgorithmSandboxExecutor(modules, runner);

    const rows = syntheticCohort(400);
    const projection = projectDisproportionality(rows, DRUG);
    const sandboxed = await executor.runProjection(projection, {
      pinnedModule: {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        sm3: PLATFORM_MODULE_SM3,
      },
      taskId: 't-consistency',
    });

    const builtin = disproportionalityTables(rows, DRUG).buckets;
    expect(sandboxed.buckets).toEqual(builtin);
    expect(sandboxed.moduleSm3).toBe(PLATFORM_MODULE_SM3);

    const run = audit.all().find((e) => e.action === 'sandbox-run');
    expect(run?.allowed).toBe(true);
    expect(run?.detail).toContain(PLATFORM_MODULE_SM3);
    expect(run?.detail).toContain('abi=1');
    expect(run?.detail).toContain('durationMs=');
    expect(run?.detail).toContain('memoryPages=');
  }, 30_000);

  it('需要的内存按投影规模先行计算', () => {
    expect(projectionRequiredBytes(10, 2)).toBe(Math.ceil((2 * 10 + 10 * 2) / 4) * 4 + 4 + 32);
  });

  it('宿主投影过滤药前事件、按患者去重，并支持无日期默认回退与严卡开关', () => {
    const datedRows: InternalRecord[] = [
      // 用药前发生的事件（2026-01-01 < 2026-02-01）不应计入暴露后不良反应；同词条重复两次应去重。
      {
        subjectKey: 's1',
        ageBand: '40-49',
        conditions: [],
        medications: ['insulin'],
        medicationExposures: [{ name: 'insulin', startDate: '2026-02-01' }],
        adverseEvents: [
          { organSystem: '肝胆系统', term: '既往转氨酶高', serious: false, onsetDate: '2026-01-01' },
          { organSystem: '胃肠系统', term: '急性胰腺炎', serious: true, onsetDate: '2026-02-15' },
          { organSystem: '胃肠系统', term: '急性胰腺炎', serious: true, onsetDate: '2026-02-20' },
        ],
      },
      {
        subjectKey: 's2',
        ageBand: '40-49',
        conditions: [],
        medications: ['insulin'],
        medicationExposures: [{ name: 'insulin', startDate: '2026-02-01' }],
        adverseEvents: [
          { organSystem: '胃肠系统', term: '超窗胰腺炎', serious: false, onsetDate: '2026-08-01' },
        ],
      },
      {
        subjectKey: 's3',
        ageBand: '40-49',
        conditions: [],
        medications: ['metformin'],
        adverseEvents: [
          { organSystem: '胃肠系统', term: '急性胰腺炎', serious: false, onsetDate: '2026-02-15' },
        ],
      },
    ];
    const proj = projectDisproportionality(datedRows, 'insulin', undefined, {
      maxDaysAfterStart: 30,
    });
    expect(proj.temporalMode).toBe('drug-before-event');
    expect(proj.terms).toEqual(['急性胰腺炎']);

    const undatedProj = projectDisproportionality(syntheticCohort(10), DRUG);
    expect(undatedProj.temporalMode).toBe('undated-cooccurrence');

    expect(() =>
      projectDisproportionality(syntheticCohort(10), DRUG, undefined, {
        requireTemporalOrder: true,
      }),
    ).toThrow(/严格时间序模式/);
  });
});
