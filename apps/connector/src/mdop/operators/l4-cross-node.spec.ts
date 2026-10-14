import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeFlLogisticOutput, FL_LOGISTIC_Q } from '@medtrust/wasm-algorithms';
import { AuditService } from '../../domain/audit';
import {
  FL_LOGISTIC_MODULE_BYTES,
  FL_LOGISTIC_MODULE_SM3,
} from '../../domain/sandbox/__fixtures__/fl-logistic-module';
import { WasmSandboxRunner } from '../../domain/sandbox/sandbox-runner';
import { ckdEsrdRiskFlPredictionSpec } from '../../domain/fl-prediction/fl-prediction-task-spec';
import { buildL4PartyResult, encodeTrainingRows } from './l4';

/**
 * 4.x 跨节点闭环的**连接器这一半**：真 wasm 模块 + 真零能力沙箱 → C3 参与方结果，
 * 并与提交进版本库的黄金夹具 `evidence/l4-equivalence/c3-payloads.json` **逐字段相等**。
 *
 * 为什么要夹具：平台侧（apps/api）的合并测试要消费**真实字节**，而两个 workspace 不能互相 import。
 * 夹具就是那条边界上的契约：连接器产出它、平台消费它，两边各自钉住。
 */

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../../../openspec/changes/mdop-fl-migration/evidence/l4-equivalence/c3-payloads.json',
);

interface Fixture {
  minCell: number;
  moduleSm3: string;
  parties: Array<Record<string, unknown>>;
}

const rowsA = () => [
  { egfr: 55, scr: 1.2, uacr: 30, ckd_stage: 'G3', bp_systolic: 140, esrd_event: false },
  { egfr: 20, scr: 3.1, uacr: 300, ckd_stage: 'G4', bp_systolic: 155, esrd_event: true },
  { egfr: 75, scr: 0.9, uacr: 10, ckd_stage: 'G2', bp_systolic: 128, esrd_event: false },
  { egfr: 15, scr: 4.0, uacr: 500, ckd_stage: 'G5', bp_systolic: 160, esrd_event: true },
  { egfr: 48, scr: 1.4, uacr: 60, ckd_stage: 'G3', bp_systolic: 138, esrd_event: true },
  { egfr: 90, scr: 0.7, uacr: 5, ckd_stage: 'G1', bp_systolic: 120, esrd_event: false },
];

const rowsB = () => [
  { egfr: 62, scr: 1.0, uacr: 20, ckd_stage: 'G2', bp_systolic: 132, esrd_event: false },
  { egfr: 25, scr: 2.6, uacr: 220, ckd_stage: 'G4', bp_systolic: 150, esrd_event: true },
  { egfr: 70, scr: 1.1, uacr: 15, ckd_stage: 'G2', bp_systolic: 126, esrd_event: false },
  { egfr: 18, scr: 3.6, uacr: 420, ckd_stage: 'G5', bp_systolic: 158, esrd_event: true },
  { egfr: 52, scr: 1.3, uacr: 45, ckd_stage: 'G3', bp_systolic: 142, esrd_event: false },
  { egfr: 35, scr: 2.0, uacr: 120, ckd_stage: 'G4', bp_systolic: 148, esrd_event: true },
];

async function runRealModule(
  rows: ReturnType<typeof rowsA>,
  spec: ReturnType<typeof ckdEsrdRiskFlPredictionSpec>,
) {
  const { encoded, featureNames } = encodeTrainingRows(rows, spec);
  const d = encoded.d;
  const align8 = (v: number) => (v + 7) & ~7;
  const outOff = align8(encoded.bytes.length) + d * 8 + 64;
  const outBytes = d * 4 + 12;
  const runner = new WasmSandboxRunner(new AuditService());
  assertMemory(runner, outOff + outBytes);
  const result = await runner.run({
    analysisType: 'fl-logistic',
    moduleSm3: FL_LOGISTIC_MODULE_SM3,
    moduleBytes: FL_LOGISTIC_MODULE_BYTES,
    input: encoded.bytes,
    n: encoded.n,
    k: d,
    outOff,
    outBytes,
    taskId: 'l4-cross-node',
  });
  const decoded = decodeFlLogisticOutput(result.output, d);
  return {
    analysisType: 'fl-logistic' as const,
    featureNames,
    thetaQ: decoded.thetaQ,
    interceptQ: decoded.interceptQ,
    theta: decoded.thetaQ.map((v) => v / FL_LOGISTIC_Q),
    intercept: decoded.interceptQ / FL_LOGISTIC_Q,
    nSamples: decoded.nSamples,
    positives: decoded.positives,
    // 沙箱 runner 不回传摘要（摘要是调用方声明的）；这里用夹具常量（= manifest 里的 SM3）
    moduleSm3: FL_LOGISTIC_MODULE_SM3,
  };
}

function assertMemory(runner: WasmSandboxRunner, bytes: number) {
  runner.assertWithinMemoryLimit(bytes);
}

describe('L4 跨节点夹具：真模块 + 真沙箱产出的 C3 可复现', () => {
  const spec = ckdEsrdRiskFlPredictionSpec();

  it('两个参与方的 C3 与提交进库的黄金夹具逐字段相等（含队列门槛与产物策略）', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
    expect(fixture.moduleSm3).toBe(FL_LOGISTIC_MODULE_SM3);

    const cases = [
      { participantId: 'p-demohospa', rows: rowsA() },
      { participantId: 'p-demohospb', rows: rowsB() },
    ];
    for (let i = 0; i < cases.length; i++) {
      const { participantId, rows } = cases[i];
      const model = await runRealModule(rows, spec);
      const c3 = buildL4PartyResult(
        { taskId: 'job-l4-cross', participantId, rows, spec, model },
        { minCell: fixture.minCell, allowedArtifacts: spec.outputPolicy.allowedArtifacts },
      );
      expect(c3).toEqual(fixture.parties[i]);
    }
  });

  it('夹具里的 C3 是平台合并需要的形状（无本地行/规格，字段齐备）', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
    for (const p of fixture.parties) {
      expect(Object.keys(p).sort()).toEqual(
        expect.arrayContaining([
          'localMetrics',
          'localModelHash',
          'participantId',
          'roundsCompleted',
          'sampleCount',
          'taskId',
        ]),
      );
      // 本地行与规格**不得**出现在 C3（它们是 C0、只在节点内传递）
      expect(p.rows).toBeUndefined();
      expect(p.spec).toBeUndefined();
    }
  });
});
