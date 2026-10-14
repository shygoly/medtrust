import { FL_LOGISTIC_Q, FL_LOGISTIC_LUT_LEN } from '@medtrust/wasm-algorithms';
import { ckdEsrdRiskFlPredictionSpec } from '../../domain/fl-prediction/fl-prediction-task-spec';
import { MdopStageExecutor } from '../mdop-executor';
import { registerL15Operators } from '@medtrust/domain-med';
import {
  buildL4PartyResult,
  encodeTrainingRows,
  registerL4DeclassifyOperator,
  registerL4TrainOperator,
} from './l4';

/**
 * 批次 1A：L4 的**院内定点训练**算子（wasm 类）接线。
 *
 * 这个 spec 钉三件事：
 * ① 执行器能**同时**承载多个 wasm 算子 —— L1.5 的兜底 runner（setWasmRunner）与 L4 的
 *    前缀 runner（registerWasmOperator）互不顶掉；
 * ② 编码：行 → Q16.16 整数特征（乘比例取整），输入块头部与模块 ABI 对得上；
 * ③ fail-closed：摘要不符 / 缺 spec / 缺上游数据都拒，不回退。
 */

const SM3 = 'a'.repeat(64);

const rows = () => [
  { egfr: 55, scr: 1.2, uacr: 30, ckd_stage: 'G3', bp_systolic: 140, esrd_event: false },
  { egfr: 20, scr: 3.1, uacr: 300, ckd_stage: 'G4', bp_systolic: 155, esrd_event: true },
  { egfr: 75, scr: 0.9, uacr: 10, ckd_stage: 'G2', bp_systolic: 128, esrd_event: false },
  { egfr: 15, scr: 4.0, uacr: 500, ckd_stage: 'G5', bp_systolic: 160, esrd_event: true },
  { egfr: 48, scr: 1.4, uacr: 60, ckd_stage: 'G3', bp_systolic: 138, esrd_event: true },
  { egfr: 90, scr: 0.7, uacr: 5, ckd_stage: 'G1', bp_systolic: 120, esrd_event: false },
];

const stage = (id: string, op: string, params: Record<string, unknown> = {}) =>
  ({
    id,
    node: 'urn:tds:sh-med:participant:p-demohospa',
    op,
    op_digest: `sm3:${SM3}`,
    params,
    inputs: [],
    input_labels: [],
    output_label: 'C0',
    output_schema: 'mdop.table/1.0',
  }) as never;

const wasmManifest = (id: string) => ({
  apiVersion: 'mdop/v0.2',
  kind: 'wasm',
  id,
  version: '1.0.0',
  category: 'local',
  digest: `sm3:${SM3}`,
  publisher: 'urn:tds:platform',
  inputs: [],
  outputs: [{ name: 'o', schema: 'mdop.table/1.0', label_rule: 'inherit' }],
  params: {},
  environments: ['plain'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${SM3}`, toolchain: 'asc@0.27.37', reproducible: true },
});

function buildExecutor() {
  const executor = new MdopStageExecutor();
  // L1.5 式兜底 runner：只认失衡检测；被 L4 阶段调到就说明分派错了
  executor.setWasmRunner(async (op) => {
    if (!op.startsWith('rws.disproportionality@'))
      throw new Error(`兜底 runner 不该被调用：${op}`);
    return {
      label: 'C0',
      schema: 'mdop.table/1.0',
      payload: { analysisType: 'disproportionality', buckets: [] },
    };
  });
  registerL4TrainOperator(executor, {
    runLogistic: async ({ rows: r }) => ({
      featureNames: ['egfr', 'scr'],
      thetaQ: [Math.round(0.25 * FL_LOGISTIC_Q), Math.round(-0.5 * FL_LOGISTIC_Q)],
      interceptQ: Math.round(-0.1 * FL_LOGISTIC_Q),
      nSamples: r.length,
      positives: r.filter((x) => x.esrd_event === true).length,
      moduleSm3: SM3,
    }),
  });
  return executor;
}

describe('L4 院内定点训练算子（批次 1A / 3.1）', () => {
  it('编码：行 → Q16.16 整数特征，输入块头部与模块 ABI 一致', () => {
    const spec = ckdEsrdRiskFlPredictionSpec();
    const { encoded, featureNames } = encodeTrainingRows(rows(), spec);
    expect(encoded.n).toBe(6);
    expect(encoded.d).toBe(featureNames.length);
    const view = new DataView(
      encoded.bytes.buffer,
      encoded.bytes.byteOffset,
      encoded.bytes.byteLength,
    );
    expect(view.getInt32(0, true)).toBe(-8 * FL_LOGISTIC_Q); // zMinQ
    expect(view.getInt32(4, true)).toBe(8 * FL_LOGISTIC_Q); // zMaxQ
    expect(view.getUint32(20, true)).toBe(FL_LOGISTIC_LUT_LEN); // lutLen
    // 特征全为整数（Q16.16）——整数字段是「可逐字节对拍」的前提
    const firstFeature = view.getInt32(32 + FL_LOGISTIC_LUT_LEN * 4, true);
    expect(Number.isInteger(firstFeature)).toBe(true);
  });

  it('执行器同时承载多个 wasm 算子：L4 走前缀 runner，L1.5 走兜底，互不顶掉', async () => {
    const executor = buildExecutor();
    expect(executor.registeredWasmOps()).toContain('rws.l4-train@');
    const spec = ckdEsrdRiskFlPredictionSpec();

    const l4 = await executor.execute(
      {
        jobId: 'job-l4',
        stage: stage('l4', 'rws.l4-train@1.0.0', { spec }),
        inputs: new Map([['src', { rows: rows() }]]),
        attempt: 1,
      },
      wasmManifest('rws.l4-train'),
    );
    expect(l4.label).toBe('C0');
    expect(l4.schema).toBe('mdop.table/1.0');
    const payload = l4.payload as unknown as {
      analysisType: string;
      thetaQ: number[];
      theta: number[];
      interceptQ: number;
      nSamples: number;
      positives: number;
    };
    expect(payload.analysisType).toBe('fl-logistic');
    expect(payload.thetaQ).toHaveLength(2);
    expect(payload.nSamples).toBe(6);
    expect(payload.positives).toBe(3);
    // 浮点口径 = 定点 / Q（同一份数字，不另算一遍）
    expect(payload.theta[0]).toBeCloseTo(payload.thetaQ[0] / FL_LOGISTIC_Q, 12);

    // L1.5 的算子仍走它自己的兜底 runner（没被 L4 顶掉）
    const l15 = await executor.execute(
      {
        jobId: 'job-l15',
        stage: stage('l15', 'rws.disproportionality@1.0.0', { drug: 'MEM' }),
        inputs: new Map(),
        attempt: 1,
      },
      { ...wasmManifest('rws.disproportionality') },
    );
    expect((l15.payload as { analysisType?: string }).analysisType).toBe(
      'disproportionality',
    );
  });

  it('fail-closed：摘要不符 / 缺 spec / 缺上游数据都拒', async () => {
    const executor = buildExecutor();
    const spec = ckdEsrdRiskFlPredictionSpec();
    const base = {
      jobId: 'job-l4',
      inputs: new Map<string, Record<string, unknown>>([['src', { rows: rows() }]]),
      attempt: 1,
    };
    // 摘要不符
    await expect(
      executor.execute(
        {
          ...base,
          stage: {
            ...(stage('l4', 'rws.l4-train@1.0.0', { spec }) as object),
            op_digest: `sm3:${'b'.repeat(64)}`,
          } as never,
        },
        wasmManifest('rws.l4-train'),
      ),
    ).rejects.toThrow(/模块摘要与清单不符/);
    // 缺 spec
    await expect(
      executor.execute(
        { ...base, stage: stage('l4', 'rws.l4-train@1.0.0', {}) },
        wasmManifest('rws.l4-train'),
      ),
    ).rejects.toThrow(/需要阶段参数 spec/);
    // 缺上游数据
    await expect(
      executor.execute(
        {
          jobId: 'job-l4',
          stage: stage('l4', 'rws.l4-train@1.0.0', { spec }),
          inputs: new Map(),
          attempt: 1,
        },
        wasmManifest('rws.l4-train'),
      ),
    ).rejects.toThrow(/缺上游数据集/);
  });
});

describe('L4 出域（declassify 语义）：队列门槛 + 指标 + 哈希 + 产物策略', () => {
  const mkModel = (thetaQ: number[], interceptQ: number) => ({
    analysisType: 'fl-logistic' as const,
    featureNames: ['egfr', 'scr'],
    thetaQ,
    interceptQ,
    theta: thetaQ.map((v) => v / FL_LOGISTIC_Q),
    intercept: interceptQ / FL_LOGISTIC_Q,
    nSamples: 6,
    positives: 3,
    moduleSm3: SM3,
  });

  it('正常出域：C3 参与方结果（含指标/哈希/模块摘要），model_weights 允许时才带权重', () => {
    const spec = ckdEsrdRiskFlPredictionSpec();
    const model = mkModel([Math.round(0.1 * FL_LOGISTIC_Q)], Math.round(-0.5 * FL_LOGISTIC_Q));
    const withWeights = buildL4PartyResult(
      { taskId: 't1', participantId: 'p-demohospa', rows: rows(), spec, model },
      { minCell: 5, allowedArtifacts: ['model_weights', 'aggregate_metrics'] },
    );
    expect(withWeights.sampleCount).toBe(6);
    expect(withWeights.roundsCompleted).toBe(spec.rounds);
    expect(withWeights.localModelHash.startsWith('LOCAL:')).toBe(true);
    expect(withWeights.moduleSm3).toBe(SM3);
    expect(withWeights.modelParams?.theta).toEqual(model.theta);
    expect(typeof withWeights.localMetrics.auc === 'number' || withWeights.localMetrics.auc === undefined).toBe(true);

    const withoutWeights = buildL4PartyResult(
      { taskId: 't2', participantId: 'p-demohospa', rows: rows(), spec, model },
      { minCell: 5, allowedArtifacts: ['aggregate_metrics'] },
    );
    expect(withoutWeights.modelParams).toBeUndefined();
  });

  it('fail-closed：队列小于 minCell（或没给 minCell）一律拒绝出域', () => {
    const spec = ckdEsrdRiskFlPredictionSpec();
    const model = mkModel([Math.round(0.1 * FL_LOGISTIC_Q)], Math.round(-0.5 * FL_LOGISTIC_Q));
    const input = { taskId: 't3', participantId: 'p-demohospa', rows: rows(), spec, model };
    expect(() => buildL4PartyResult(input, { minCell: 10, allowedArtifacts: [] })).toThrow(
      /拒绝出域/,
    );
    expect(() => buildL4PartyResult(input, { minCell: 0, allowedArtifacts: [] })).toThrow(
      /需要合约或参数给出 minCell/,
    );
  });
});

describe('单节点 L4 链路：source → l4-train → declassify（链式分派）', () => {
  const systemManifest = (id: string, digest = 'component:x@1') => ({
    apiVersion: 'mdop/v0.2',
    kind: 'system',
    id,
    version: '1.0.0',
    category: id === 'declassify.small_cell' ? 'declassify' : 'source',
    digest,
    publisher: 'urn:tds:platform',
    inputs: [],
    outputs: [{ name: 'o', schema: 'mdop.table/1.0', label_rule: 'inherit' }],
    params: {},
    environments: ['plain'],
    security: { network: 'none' },
    component: 'connector@1',
  });

  function buildWithRings() {
    const executor = buildExecutor();
    // 真实 L1.5 三算子（含婉拒式 declassify 环）；wasm runner 用兜底即可
    registerL15Operators(executor, {
      loadRows: async () => rows() as never,
      snapshotOf: () => 'sm3:' + '9'.repeat(64),
      runProportionality: async () => ({ buckets: [], moduleSm3: SM3 }),
      gate: (candidate) => ({ ...(candidate as object), gatedByL15: true }),
    });
    registerL4DeclassifyOperator(executor);
    return executor;
  }

  it('L4 模型载荷被 L4 环认领 → C3；L1.5 四格表仍被 L1.5 环认领', async () => {
    const executor = buildWithRings();
    const spec = ckdEsrdRiskFlPredictionSpec();

    const src = await executor.execute(
      {
        jobId: 'job-1',
        stage: stage('src', 'source.dataset@1.0.0', { uri: 'ds://p-demohospa/dp-x' }),
        inputs: new Map(),
        attempt: 1,
      },
      systemManifest('source.dataset', 'component:connector-datasource@1'),
    );
    expect(src.label).toBe('C0');

    const trained = await executor.execute(
      {
        jobId: 'job-1',
        stage: stage('l4', 'rws.l4-train@1.0.0', { spec }),
        inputs: new Map([['src', src.payload]]),
        attempt: 1,
      },
      wasmManifest('rws.l4-train'),
    );
    expect(trained.label).toBe('C0');
    expect((trained.payload as { rows?: unknown[] }).rows).toHaveLength(6);

    // 出域：链上第一环（L1.5）看到的是模型载荷 → 婉拒；第二环（L4）认领
    const released = await executor.execute(
      {
        jobId: 'job-1',
        stage: stage('dec', 'declassify.small_cell@1.0.0', { minCell: 5 }),
        inputs: new Map([['l4', trained.payload]]),
        contractTerms: { publication: { minCell: 5 } },
        attempt: 1,
      },
      systemManifest('declassify.small_cell', 'component:connector-output-gate@1'),
    );
    expect(released.label).toBe('C3');
    const payload = released.payload as {
      analysisType?: string;
      sampleCount?: number;
      localModelHash?: string;
      moduleSm3?: string;
      gatedByL15?: boolean;
    };
    expect(payload.sampleCount).toBe(6);
    expect(payload.localModelHash?.startsWith('LOCAL:')).toBe(true);
    expect(payload.moduleSm3).toBe(SM3);
    // 关键：**没有**被 L1.5 那环处理（否则会出现 gatedByL15 标记）
    expect(payload.gatedByL15).toBeUndefined();

    // L1.5 载荷仍走 L1.5 环
    const l15Released = await executor.execute(
      {
        jobId: 'job-2',
        stage: stage('dec', 'declassify.small_cell@1.0.0', { minCell: 1 }),
        inputs: new Map([
          [
            'l15',
            { analysisType: 'disproportionality', cohortSize: 4, buckets: [{ key: 'x', count: 2 }] },
          ],
        ]),
        contractTerms: { publication: { minCell: 1 } },
        attempt: 1,
      },
      systemManifest('declassify.small_cell', 'component:connector-output-gate@1'),
    );
    expect((l15Released.payload as { gatedByL15?: boolean }).gatedByL15).toBe(true);
  });
});
