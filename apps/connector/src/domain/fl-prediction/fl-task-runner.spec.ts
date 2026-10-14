import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuditService } from '../audit';
import { ConnectorTaskRunner } from '../connector-task-runner';
import { CdmAnalysisNotOpenError, DataProductLocalSource } from '../data-product-local-source';
import { Deidentifier } from '../deidentifier';
import { FhirGateway } from '../fhir-gateway';
import { LocalDataLoader } from '../local-data-loader';
import { LocalStore } from '../local-store';
import { PolicyEnforcementPoint, PolicyViolation } from '../policy-enforcement';
import { ContractView } from '../contract-view';
import { ckdEsrdRiskFlPredictionSpec } from './fl-prediction-task-spec';
import { FlTaskRunner } from './fl-task-runner';
import { HttpFlAdapter } from './http-fl-adapter';

// 合约授权的数据产品在连接器本地的数据（两条 CKD 记录）。
const PRODUCT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-prediction-product-'));
fs.writeFileSync(
  path.join(PRODUCT_DIR, 'records.json'),
  JSON.stringify([
    {
      subjectKey: 'subj-a',
      ageBand: '50-59',
      conditions: ['Chronic kidney disease stage 3 (disorder)', 'Essential hypertension (disorder)'],
      medications: [],
      adverseEvents: [],
    },
    {
      subjectKey: 'subj-b',
      ageBand: '60-69',
      conditions: ['Chronic kidney disease stage 5 (disorder)'],
      medications: [],
      adverseEvents: [],
    },
  ]),
);
const EMPTY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-prediction-empty-'));
fs.writeFileSync(path.join(EMPTY_DIR, 'records.json'), '[]');
afterAll(() => {
  fs.rmSync(PRODUCT_DIR, { recursive: true, force: true });
  fs.rmSync(EMPTY_DIR, { recursive: true, force: true });
});

function productSource(audit: AuditService, store = new LocalStore(audit)) {
  const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
  const source = new DataProductLocalSource(store, loader, audit);
  source.registerProduct({
    id: 'dp-insulin-panc-demohospa',
    providerId: 'p-demohospa',
    fhirSchema: { localDataPath: PRODUCT_DIR },
  });
  source.registerProduct({
    id: 'dp-empty',
    providerId: 'p-demohospa',
    fhirSchema: { localDataPath: EMPTY_DIR },
  });
  source.registerProduct({
    id: 'dp-cdm',
    providerId: 'p-demohospa',
    fhirSchema: { dataSource: { type: 'omop-cdm', label: 'demohospa-cdm' } },
  });
  return { source, loadSpy: jest.spyOn(loader, 'loadFromDeclaredPath'), store };
}

const activeContract = (): ContractView => ({
  id: 'contract-fl-1',
  purpose: '胰岛素暴露·胰腺炎信号演示研究',
  retention: '阅后即焚',
  // L4 FL 产出模型 + 聚合指标，须走 model 出口授权（aggregate_only 会拒 L4）。
  output: '聚合 + 模型参数',
  outputPolicy: {
    preset: 'aggregate_and_model',
    allowedArtifacts: ['aggregate_stats', 'validation_metrics', 'model_params', 'model_update'],
    minCell: 5,
    dp: { mode: 'none' },
  },
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  dataProductId: 'dp-insulin-panc-demohospa',
});

describe('FlTaskRunner', () => {
  const originalParticipant = process.env.CONNECTOR_PARTICIPANT_ID;

  afterEach(() => {
    if (originalParticipant === undefined) {
      delete process.env.CONNECTOR_PARTICIPANT_ID;
    } else {
      process.env.CONNECTOR_PARTICIPANT_ID = originalParticipant;
    }
  });

  it('returns party-local FL result after PEP check', async () => {
    process.env.CONNECTOR_PARTICIPANT_ID = 'p-demohospa';
    const audit = new AuditService();
    const { source } = productSource(audit);
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), undefined, source);
    const spec = ckdEsrdRiskFlPredictionSpec();

    const result = await runner.run('fl-task-1', spec.purpose, spec, activeContract());

    expect(result.workloadType).toBe('federated_learning');
    expect(result.taskId).toBe('fl-task-1');
    expect(result.participantId).toBe('p-demohospa');
    expect(result.localModelHash).toMatch(/^LOCAL:/);
    // DP 闸门对每个指标加 Laplace 噪声（规格 dpEpsilon=1.0 → scale=1/1.0=1.0）并裁剪到 [0,1]：
    // **被噪声推到 0 的 AUC 是合法结果**，所以这里只能断言 DP 有效边界，不能断言 > 0
    //（2026-10-13：这条断言就是这么红的，探针实测 metrics={"auc":0,"f1":1,"precision":1,"recall":0}，
    //  即噪声把各值分别推到 0/1 两端；详见 docs/tech-debt.md TD-10）。
    // 「真训练出有效 AUC」由 local-logistic.spec.ts 的非 DP 用例覆盖。
    expect(result.dpApplied).toBe(true);
    expect(result.localMetrics.auc).toBeGreaterThanOrEqual(0);
    expect(result.localMetrics.auc).toBeLessThanOrEqual(1);
    expect(result.roundsCompleted).toBe(spec.rounds);
    // 样本数是合约数据产品的真实行数，不是没有数据时编出来的默认值
    expect(result.sampleCount).toBe(2);
  });

  it('passes materialized CKD tabular rows to connector-ml', async () => {
    process.env.CONNECTOR_PARTICIPANT_ID = 'p-demohospa';
    const audit = new AuditService();
    const { source } = productSource(audit);

    const fetchImpl = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/v1/fl/environment')) {
        return {
          ok: true,
          json: async () => ({ ready: true, runtime: 'connector-ml', details: 'test' }),
        };
      }
      const body = JSON.parse(String(init?.body));
      expect(body.tabularRows.length).toBeGreaterThanOrEqual(2);
      expect(body.tabularRows[0]).toHaveProperty('egfr');
      expect(body.tabularRows[0]).toHaveProperty('esrd_event');
      return {
        ok: true,
        json: async () => ({
          taskId: body.prepared.taskId,
          participantId: body.prepared.participantId,
          roundsCompleted: 5,
          sampleCount: body.tabularRows.length,
          localModelHash: 'LOCAL:sklearn-train',
          localMetrics: { auc: 0.79, f1: 0.71 },
        }),
      };
    });

    const adapter = new HttpFlAdapter({ baseUrl: 'http://127.0.0.1:5030', fetchImpl });
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), adapter, source);
    const spec = ckdEsrdRiskFlPredictionSpec();

    const result = await runner.run('fl-task-http', spec.purpose, spec, activeContract());
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.dpApplied).toBe(true);
    // 同第一处：DP 噪声可以合法地把 AUC 压到 0，断言只能用 DP 有效边界。
    expect(result.localMetrics.auc).toBeGreaterThanOrEqual(0);
    expect(result.localMetrics.auc).toBeLessThanOrEqual(1);
    expect(result.sampleCount).toBe(2);
  });

  describe('取数只认合约授权的数据产品', () => {
    beforeEach(() => {
      process.env.CONNECTOR_PARTICIPANT_ID = 'p-demohospa';
    });

    it('任务 spec 指向别的产品 → PEP 拒绝并留痕，一行数据都不读', async () => {
      const audit = new AuditService();
      const { source, loadSpy } = productSource(audit);
      const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), undefined, source);
      const spec = ckdEsrdRiskFlPredictionSpec();
      spec.parties = spec.parties.map((p) =>
        p.participantId === 'p-demohospa' ? { ...p, dataProductId: 'dp-empty' } : p,
      );

      await expect(runner.run('fl-swap', spec.purpose, spec, activeContract())).rejects.toBeInstanceOf(
        PolicyViolation,
      );
      expect(audit.blocked()[0].detail).toMatch(
        /数据产品不符:合约授权=dp-insulin-panc-demohospa,任务声明=dp-empty/,
      );
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('合约没指向数据产品 → 拒绝（任务 spec 不能替合约指定数据）', async () => {
      const audit = new AuditService();
      const { source, loadSpy } = productSource(audit);
      const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), undefined, source);
      const spec = ckdEsrdRiskFlPredictionSpec();
      const contract = { ...activeContract(), dataProductId: undefined };

      await expect(runner.run('fl-noprod', spec.purpose, spec, contract)).rejects.toThrow(
        /合约未指向数据产品/,
      );
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('没有装配数据产品源 → 拒绝（不拿本地存储里的残留数据训练）', async () => {
      const audit = new AuditService();
      const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit));
      const spec = ckdEsrdRiskFlPredictionSpec();
      await expect(runner.run('fl-nosource', spec.purpose, spec, activeContract())).rejects.toThrow(
        /未装配数据产品源/,
      );
    });

    it('合约指向 CDM 数据产品 → 拒绝（分析语义未开放），不读文件', async () => {
      const audit = new AuditService();
      const { source, loadSpy } = productSource(audit);
      const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), undefined, source);
      const spec = ckdEsrdRiskFlPredictionSpec();
      spec.parties = spec.parties.map((p) =>
        p.participantId === 'p-demohospa' ? { ...p, dataProductId: 'dp-cdm' } : p,
      );
      const contract = { ...activeContract(), dataProductId: 'dp-cdm' };

      await expect(runner.run('fl-cdm', spec.purpose, spec, contract)).rejects.toBeInstanceOf(
        CdmAnalysisNotOpenError,
      );
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('合约的数据产品没有记录 → 拒绝，不编样本数', async () => {
      const audit = new AuditService();
      const { source } = productSource(audit);
      const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), undefined, source);
      const spec = ckdEsrdRiskFlPredictionSpec();
      spec.parties = spec.parties.map((p) =>
        p.participantId === 'p-demohospa' ? { ...p, dataProductId: 'dp-empty' } : p,
      );
      const contract = { ...activeContract(), dataProductId: 'dp-empty' };

      // 空产品在装载层（认不出格式）或物化层（零行）被拒——哪一层都行，关键是不产出结果。
      await expect(runner.run('fl-empty', spec.purpose, spec, contract)).rejects.toThrow(
        /无法识别的本地数据格式|没有可用于训练的记录/,
      );
    });

    it('不动共享本地存储：并发在跑的其它任务的数据不会被换掉', async () => {
      const audit = new AuditService();
      const store = new LocalStore(audit);
      store.replaceAll([
        { subjectKey: 'other-task', ageBand: '40-49', conditions: [], medications: [], adverseEvents: [] },
      ]);
      const { source } = productSource(audit, store);
      const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit), undefined, source);
      const spec = ckdEsrdRiskFlPredictionSpec();

      const result = await runner.run('fl-iso', spec.purpose, spec, activeContract());
      expect(result.sampleCount).toBe(2);
      expect(store.count()).toBe(1);
    });
  });

  it('rejects invalid flPredictionSpec', async () => {
    process.env.CONNECTOR_PARTICIPANT_ID = 'p-demohospa';
    const audit = new AuditService();
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit));

    await expect(
      runner.run('fl-task-2', 'CKD', { parties: [] }, activeContract()),
    ).rejects.toThrow('FL prediction workload requires a valid flPredictionSpec');
  });

  it('rejects when CONNECTOR_PARTICIPANT_ID is missing', async () => {
    delete process.env.CONNECTOR_PARTICIPANT_ID;
    const audit = new AuditService();
    const runner = new FlTaskRunner(new PolicyEnforcementPoint(audit));
    const spec = ckdEsrdRiskFlPredictionSpec();

    await expect(runner.run('fl-task-3', spec.purpose, spec, activeContract())).rejects.toThrow(
      'CONNECTOR_PARTICIPANT_ID is required for FL prediction workload',
    );
  });
});

describe('ConnectorTaskRunner — FL prediction routing', () => {
  it('rejects sync run for federated_learning workloads', async () => {
    const audit = new AuditService();
    const connectorRunner = new ConnectorTaskRunner(
      new PolicyEnforcementPoint(audit),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const spec = ckdEsrdRiskFlPredictionSpec();

    await expect(
      connectorRunner.run(
        {
          taskId: 'fl-task-4',
          purpose: spec.purpose,
          workloadType: 'federated_learning',
          flPredictionSpec: spec,
        },
        activeContract(),
      ),
    ).rejects.toThrow('FL prediction workload is async');
  });
});
