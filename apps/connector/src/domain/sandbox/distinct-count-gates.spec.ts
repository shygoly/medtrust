// 去重人数模块走 third-party-wasm-module-admission 的既有闸 3 / 闸 4 / 闸 5。
//
// 闸 0/1/2（源码预检 / 静态白名单 / 复现构建）在 packages/wasm-algorithms 的
// source-gate / static-gate / admission / check-reproducible 里对拍；
// 这里钉运行期：一致性 / 确定性 / 资源上限 / 防外泄 / 影子不释放 / 吊销即拒。
import {
  assertLowEntropyOutput,
  canaryLeakFields,
  deterministicPermutation,
  isReleasableStatus,
  outputsIdentical,
  staticGate,
  type RevocationList,
} from '@medtrust/wasm-algorithms';
import { ModuleVerificationError, verifyModule } from './module-verifier';
import { SandboxLimitError, WasmSandboxRunner } from './sandbox-runner';
import {
  DISTINCT_COUNT_MODULE_BYTES,
  DISTINCT_COUNT_MODULE_SM3,
} from './__fixtures__/distinct-count-module';
import {
  distinctCountFromSandboxOutput,
  projectDistinctCount,
} from '../../mdop/node/distinct-count-sandbox';
import type { DistinctCountRow } from '@medtrust/wasm-algorithms';

const STRATA = ['60-69|F', '70-79|M'];
const bytes = DISTINCT_COUNT_MODULE_BYTES;
const sm3 = DISTINCT_COUNT_MODULE_SM3;

function rows(): DistinctCountRow[] {
  return [
    { subjectKey: 's1', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's1', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's2', ageBand: '60-69', sex: 'F' },
    { subjectKey: 's3', ageBand: '70-79', sex: 'M' },
    { subjectKey: 's2', ageBand: '70-79', sex: 'M' },
    { subjectKey: 's4', ageBand: '70-79', sex: 'M' },
  ];
}

function permute(data: DistinctCountRow[], seed: number): DistinctCountRow[] {
  return deterministicPermutation(data.length, seed).map((i) => data[i]!);
}

async function run(data: DistinctCountRow[]) {
  const projection = projectDistinctCount({ rows: data, strataKeys: STRATA });
  const runner = new WasmSandboxRunner();
  const result = await runner.run({
    analysisType: 'distinct-count',
    moduleSm3: sm3,
    moduleBytes: bytes,
    input: projection.input,
    abi: 'distinct-count@1',
    n: projection.subjects,
    k: projection.strata,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
  });
  const counted = distinctCountFromSandboxOutput({ projection, output: result.output });
  return { result, counted, values: [counted.totalDistinct, ...counted.strata.map((s) => s.distinct)] };
}

describe('去重人数 —— 闸 1 静态白名单 + 闸 3 沙箱动态测试', () => {
  it('闸 1：入库产物过静态白名单（只导入 env.memory）', () => {
    const report = staticGate(bytes);
    expect(report.exports).toContain('run');
    expect(report.abiVersionExportKind).toBe('global');
  });

  it('闸 3：同一输入两次执行输出逐字节一致（确定性）', async () => {
    const a = await run(rows());
    const b = await run(rows());
    expect(outputsIdentical(a.result.output, b.result.output)).toBe(true);
  });

  it('闸 3：打乱行序后输出不变（一致性 / 行序不变）', async () => {
    const a = await run(rows());
    const b = await run(permute(rows(), 0x51));
    expect(outputsIdentical(a.result.output, b.result.output)).toBe(true);
  });

  it('闸 3：输出符合低熵 schema（计数字段、无主体键）', async () => {
    const { values, result } = await run(rows());
    assertLowEntropyOutput(values, {
      fieldCount: 3,
      range: [0, 1_000_000],
    });
    expect(Buffer.from(result.output).toString('utf8')).not.toContain('s1');
  });

  it('闸 3：注入的 canary 记录不可从输出复原', async () => {
    const base = rows();
    const without = await run(base);
    const withCanary = await run([
      ...base,
      { subjectKey: 'canary-secret-id', ageBand: '60-69', sex: 'F' },
    ]);
    const leaks = canaryLeakFields(without.values, withCanary.values, [0, 1]);
    expect(leaks).toEqual([]);
    expect(Buffer.from(withCanary.result.output).toString('utf8')).not.toContain('canary');
  });
});

describe('去重人数 —— 闸 3 资源上限 / 闸 4 影子 / 闸 5 吊销', () => {
  it('闸 3：所需内存超过沙箱上限 → 调用前拒（不给模块分配的机会）', () => {
    const runner = new WasmSandboxRunner();
    expect(() => runner.assertWithinMemoryLimit(Number.MAX_SAFE_INTEGER)).toThrow(SandboxLimitError);
  });

  it('闸 4：影子状态不得释放去重人数结果', () => {
    expect(isReleasableStatus('shadow')).toBe(false);
    expect(isReleasableStatus('active')).toBe(true);
  });

  it('闸 5：吊销名单命中 → 当场拒，且不回退到内置实现', () => {
    const revoked: RevocationList = {
      version: 3,
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
      verifyModule(bytes, {
        analysisType: 'distinct-count',
        expectedSm3: sm3,
        signature: 'unused',
        registryPublicKey: 'unused',
        revocationList: revoked,
      });
    } catch (e) {
      caught = e as ModuleVerificationError;
    }
    expect(caught?.reason).toBe('revoked');
    expect(caught?.message).toMatch(/不回退到内置实现/);
  });
});
