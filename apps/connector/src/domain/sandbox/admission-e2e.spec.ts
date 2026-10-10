// third-party-module-admission —— 端到端验收（tasks 8.2 / 8.3）。
//
// 8.2 正例：一个 **Tier B Rust 模块**（平台从第三方源码复现构建出来的真字节）
//     走完「入册 → 合约固定（带层级 + 审查背书）→ PEP 放行 → 沙箱执行 → 结果合法」。
// 8.3 负例总验收：不透明二进制 / 复现不出 SM3 / 静态违规 / 资源超限 / 外泄探针 / 吊销，
//     全部 fail-closed，且**任何一条都不回退到内置实现**。
//
// 这一支跑的是真字节 + 真沙箱 + 真 SM2 签名；构建侧的「双构建器复现」由
// packages/wasm-algorithms/scripts/admission.test.mjs 覆盖（那里真跑两遍 cargo）。
import {
  STATIC_REJECTION_FIXTURES,
  StaticGateError,
  buildFixtureWasm,
  staticGate,
  type RevocationList,
} from '@medtrust/wasm-algorithms';
import { AuditService } from '../audit';
import { ContractView } from '../contract-view';
import { PolicyEnforcementPoint, PolicyViolation } from '../policy-enforcement';
import { disproportionalityTables } from '../rws-executor';
import { InternalRecord } from '../types';
import {
  bucketsFromSandboxOutput,
  projectDisproportionality,
} from './disproportionality-sandbox';
import { ModuleVerificationError, verifyModule } from './module-verifier';
// 连接器侧的本地夹具(带可执行的 body:'infinite-loop'),与包内静态拒绝集夹具并用。
import { buildFixtureWasm as buildRunnableFixture } from './wasm-fixtures';
import { SandboxLimitError, WasmSandboxRunner } from './sandbox-runner';
import {
  TIER_B_MODULE_BYTES,
  TIER_B_MODULE_SM3,
  newTestCa,
} from './__fixtures__/platform-module';

const DRUG = '注射用紫杉醇';
const TIER_B = TIER_B_MODULE_BYTES;

/** 平台完成闸 2 后写进合约条款的那份审查背书。 */
const REVIEW = {
  reviewer: 'reviewer-zhang',
  reviewedAt: '2026-09-20T00:00:00.000Z',
  reproducibleBuildRef: `repro:rust:1.95.0:${TIER_B_MODULE_SM3 ?? ''}`,
  confidential: true,
};

function cohort(n = 120): InternalRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    subjectKey: `sk_${i}`,
    ageBand: i % 2 === 0 ? '40-49' : '60-69',
    sex: (i % 3 === 0 ? 'M' : 'F') as InternalRecord['sex'],
    conditions: [],
    medications: i % 5 < 2 ? [DRUG, '二甲双胍'] : ['二甲双胍'],
    adverseEvents:
      i % 3 !== 0
        ? [{ organSystem: '肝胆系统', term: 'ALT升高', serious: false }]
        : [],
  }));
}

function contractWith(
  pinned: Record<string, unknown> | undefined,
): ContractView {
  return {
    id: 'c1',
    providerId: 'p-demohospa',
    consumerId: 'pharma-acme',
    purpose: 'PV',
    retention: '阅后即焚',
    output: '仅聚合',
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'active',
    ...(pinned ? { pinnedModules: pinned } : {}),
  } as ContractView;
}

const maybe = TIER_B ? describe : describe.skip;

maybe('端到端 8.2 —— Tier B Rust 模块走完五道闸到生产', () => {
  const bytes = TIER_B as Uint8Array;
  const sm3 = TIER_B_MODULE_SM3 as string;
  const ca = newTestCa();
  const runner = new WasmSandboxRunner();

  it('入册 → 合约固定 → PEP 放行 → 沙箱执行 → 结果与参考实现一致', async () => {
    // 闸 1：静态白名单（平台侧与连接器侧同一份实现）
    const gate = staticGate(bytes);
    expect(gate.abiVersionExportKind).toBe('function'); // Rust 形态
    expect(gate.exports).toContain('run');

    // 闸 2 的产物：平台 CA 对复现出的 SM3 签名
    const signature = ca.sign(bytes);

    // 合约固定该模块，条款带准入层级 + 平台审查背书
    const contract = contractWith({
      disproportionality: { sm3, tier: 'B', review: REVIEW },
    });

    // 闸 5（PEP）：未吊销 + 条款完整 → 放行
    const pep = new PolicyEnforcementPoint(new AuditService(), {
      revocationList: () => ({ version: 1, issuedAt: '', revoked: [] }),
    });
    expect(() =>
      pep.check(
        {
          taskId: 't1',
          purpose: 'PV',
          analysisType: 'disproportionality',
          moduleSm3: sm3,
        },
        contract,
      ),
    ).not.toThrow();

    // 闸 5（运行前）：吊销检查 + SM3 == 合约固定值 + SM2 验签 + 闸 1
    const verified = verifyModule(bytes, {
      analysisType: 'disproportionality',
      expectedSm3: sm3,
      signature,
      registryPublicKey: ca.publicKey,
      revocationList: { version: 1, issuedAt: '', revoked: [] },
    });
    expect(verified.sm3).toBe(sm3);

    // 执行：零导入 + 资源上限 + 最小列投影
    const rows = cohort();
    const projection = projectDisproportionality(rows, DRUG);
    const result = await runner.run({
      analysisType: 'disproportionality',
      moduleSm3: sm3,
      moduleBytes: bytes,
      input: projection.input,
      n: projection.n,
      k: projection.k,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
      minMemoryPages: verified.gate.memoryPages.min,
    });

    // 结果：过不变量校验，且与独立参考实现逐字段一致
    const buckets = bucketsFromSandboxOutput(result.output, projection);
    const reference = disproportionalityTables(rows, DRUG).buckets;
    expect(buckets.map((b) => [b.key, b.count, b.b, b.c, b.d])).toEqual(
      reference.map((b) => [b.key, b.count, b.b, b.c, b.d]),
    );
  }, 60_000);
});

maybe('端到端 8.3 —— 负例总验收：全部 fail-closed，且不回退到内置实现', () => {
  const bytes = TIER_B as Uint8Array;
  const sm3 = TIER_B_MODULE_SM3 as string;
  const ca = newTestCa();
  const runner = new WasmSandboxRunner();

  const baseOpts = () => ({
    analysisType: 'disproportionality',
    expectedSm3: sm3,
    signature: ca.sign(bytes),
    registryPublicKey: ca.publicKey,
  });

  it('不透明二进制：随手造的 .wasm 过不了闸 1（更不必说复现 SM3）', () => {
    const opaque = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0, 0xff]);
    expect(() => staticGate(opaque)).toThrow(StaticGateError);
  });

  it('复现不出 SM3：字节被改一位 → SM3 不符，当场拒', () => {
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] ^= 0x01;
    let caught: ModuleVerificationError | undefined;
    try {
      verifyModule(tampered, baseOpts());
    } catch (e) {
      caught = e as ModuleVerificationError;
    }
    expect(caught?.reason).toBe('sm3-mismatch');
  });

  it('静态违规集：每类违规都被闸 1 拒（19 类，逐条）', () => {
    for (const { label, spec } of STATIC_REJECTION_FIXTURES) {
      expect(() => staticGate(buildFixtureWasm(spec))).toThrow(
        // 只断言「被拒」；具体原因码在 packages 的用例里逐条对过。
        StaticGateError,
      );
      expect(typeof label).toBe('string');
    }
  });

  it('资源超限：死循环被超时终止，抛 SandboxLimitError（任务失败，连接器不倒）', async () => {
    const original = process.env.CONNECTOR_SANDBOX_TIMEOUT_MS;
    process.env.CONNECTOR_SANDBOX_TIMEOUT_MS = '500';
    try {
      await expect(
        runner.run({
          analysisType: 'disproportionality',
          moduleSm3: 'a'.repeat(64),
          moduleBytes: buildRunnableFixture({ body: 'infinite-loop' }),
          input: new Uint8Array(8),
          n: 1,
          k: 1,
          outOff: 8,
          outBytes: 20,
        }),
      ).rejects.toThrow(SandboxLimitError);
    } finally {
      if (original === undefined) delete process.env.CONNECTOR_SANDBOX_TIMEOUT_MS;
      else process.env.CONNECTOR_SANDBOX_TIMEOUT_MS = original;
    }
  }, 30_000);

  it('外泄探针：原始标识根本不进模块（投影只含 0/1）', () => {
    const rows = cohort(40);
    const projection = projectDisproportionality(rows, DRUG);
    expect(projection.input.every((b) => b === 0 || b === 1)).toBe(true);
    const text = Buffer.from(projection.input).toString('utf8');
    expect(rows.some((r) => text.includes(r.subjectKey))).toBe(false);
  });

  it('吊销：名单命中 → 当场拒，且错误里明说不回退到内置实现', () => {
    const revoked: RevocationList = {
      version: 9,
      issuedAt: new Date().toISOString(),
      revoked: [
        {
          sm3,
          reason: 'security-incident',
          revokedAt: new Date().toISOString(),
          revokedBy: 'platform-review',
        },
      ],
    };
    let caught: ModuleVerificationError | undefined;
    try {
      verifyModule(bytes, { ...baseOpts(), revocationList: revoked });
    } catch (e) {
      caught = e as ModuleVerificationError;
    }
    expect(caught?.reason).toBe('revoked');
    expect(caught?.message).toMatch(/不回退到内置实现/);

    // PEP 那一层同样拒 —— 两道独立检查，任一命中即止。
    const pep = new PolicyEnforcementPoint(new AuditService(), {
      revocationList: () => revoked,
    });
    expect(() =>
      pep.check(
        {
          taskId: 't1',
          purpose: 'PV',
          analysisType: 'disproportionality',
          moduleSm3: sm3,
        },
        contractWith({
          disproportionality: { sm3, tier: 'B', review: REVIEW },
        }),
      ),
    ).toThrow(PolicyViolation);
  });

  it('来路不明的固定条款（缺层级/缺背书）→ PEP 拒，不以内置实现代替', () => {
    const pep = new PolicyEnforcementPoint(new AuditService());
    const task = {
      taskId: 't1',
      purpose: 'PV',
      analysisType: 'disproportionality',
      moduleSm3: sm3,
    };
    expect(() =>
      pep.check(task, contractWith({ disproportionality: { sm3 } })),
    ).toThrow(/缺少准入层级/);
    expect(() =>
      pep.check(task, contractWith({ disproportionality: { sm3, tier: 'B' } })),
    ).toThrow(/缺少平台审查背书/);
  });
});
