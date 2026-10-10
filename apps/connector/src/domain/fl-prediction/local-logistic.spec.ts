import { pancreatitisRiskFlPredictionSpec } from './fl-prediction-task-spec';
import {
  encodeTabularRows,
  scoreLogistic,
  trainLocalLogisticParty,
  trainLogisticRegression,
} from './local-logistic';
import { assertSafeFlPartyRunResult } from './fl-output-guard';

describe('local-logistic', () => {
  const spec = pancreatitisRiskFlPredictionSpec();

  it('trains on synthetic pancreatitis rows and yields modelParams', () => {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 200; i++) {
      const exposed = i % 2 === 0;
      const event = exposed ? i % 5 !== 0 : i % 20 === 0;
      rows.push({
        ageBand: '50-59',
        sex: i % 3 === 0 ? 'female' : 'male',
        exposed_insulin: exposed,
        pancreatitis_event: event,
      });
    }
    const trained = trainLocalLogisticParty({
      taskId: 't-demo',
      participantId: 'p-demohospa',
      rows,
      spec,
    });
    expect(trained.sampleCount).toBe(200);
    expect(trained.modelParams.theta.length).toBe(
      trained.modelParams.featureNames.length,
    );
    expect(trained.trainingMode).toBe('local-logistic');
    expect(trained.localMetrics.auc).toBeGreaterThan(0.5);

    const safe = assertSafeFlPartyRunResult({
      taskId: 't-demo',
      participantId: 'p-demohospa',
      roundsCompleted: 1,
      sampleCount: trained.sampleCount,
      localMetrics: trained.localMetrics,
      localModelHash: trained.localModelHash,
      trainingMode: trained.trainingMode,
      modelParams: trained.modelParams,
    });
    expect(safe.modelParams?.theta.length).toBeGreaterThan(0);
  });

  it('converges on a low-prevalence cohort with the preset hyperparameters', () => {
    // 回归：事件率 ~8%、暴露 OR≈2.5 的队列，固定 80 轮从零起步时截距还没降到位，
    // 各特征被一并压成负权重，暴露系数反号、AUC < 0.5（线上任务 10ca19d3 实测 0.418）。
    const bands = ['40-49', '50-59', '60-69', '70-79'];
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 4000; i++) {
      const exposed = i % 2 === 0;
      const event = exposed ? i % 16 === 0 : i % 40 === 1;
      rows.push({
        ageBand: bands[i % bands.length],
        sex: i % 3 === 0 ? 'female' : 'male',
        exposed_insulin: exposed,
        pancreatitis_event: event,
      });
    }
    const trained = trainLocalLogisticParty({
      taskId: 't-low-prevalence',
      participantId: 'p-demohospa',
      rows,
      spec,
    });
    const insulinIdx = trained.modelParams.featureNames.indexOf('exposed_insulin');
    expect(trained.modelParams.theta[insulinIdx]).toBeGreaterThan(0);
    expect(trained.localMetrics.auc).toBeGreaterThan(0.55);
    // 每个年龄段都要落到一个特征上，不得因分箱对不上而整段丢失
    for (const band of bands)
      expect(trained.modelParams.featureNames).toContain(`ageBand=${band}`);
  });

  it('scores monotonically for higher insulin exposure signal', () => {
    const encoded = encodeTabularRows(
      [
        {
          ageBand: '50-59',
          sex: 'male',
          exposed_insulin: false,
          pancreatitis_event: false,
        },
        {
          ageBand: '50-59',
          sex: 'male',
          exposed_insulin: true,
          pancreatitis_event: true,
        },
      ],
      spec,
    );
    // Hand-craft theta: large positive on exposed_insulin
    const insulinIdx = encoded.featureNames.indexOf('exposed_insulin');
    const theta = encoded.featureNames.map((_, i) => (i === insulinIdx ? 2 : 0));
    const p0 = scoreLogistic(encoded.X[0], theta, -1);
    const p1 = scoreLogistic(encoded.X[1], theta, -1);
    expect(p1).toBeGreaterThan(p0);
  });

  it('trainLogisticRegression fits separable data', () => {
    const X = [
      [0],
      [0],
      [1],
      [1],
      [1],
    ];
    const y = [0, 0, 1, 1, 1];
    const { theta, intercept } = trainLogisticRegression(X, y, {
      learningRate: 0.5,
      epochs: 200,
      l2: 0.001,
    });
    expect(scoreLogistic([1], theta, intercept)).toBeGreaterThan(
      scoreLogistic([0], theta, intercept),
    );
  });
});
