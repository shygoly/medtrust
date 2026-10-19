import assert from 'node:assert/strict';
import { test } from 'node:test';
import { c3InterpretPayload } from './c3-interpret-payload';

test('paired-cohort：只带四个聚合计数，清单与分层明细不透传', () => {
  const payload = c3InterpretPayload({
    analysisType: 'paired-cohort',
    cohortSize: 4420,
    exposed: 1240,
    outcome: 179,
    exposedWithOutcome: 37,
    rate: 0.03,
    strata: [{ key: 'age>=65', exposed: 400 }],
    release_manifest: { apiVersion: 'mdop.release/1.0' },
  });
  assert.deepEqual(payload, {
    analysisType: 'paired-cohort',
    cohortSize: 4420,
    exposed: 1240,
    outcome: 179,
    exposedWithOutcome: 37,
  });
});

test('disproportionality：逐格只留白名单字段', () => {
  const payload = c3InterpretPayload({
    analysisType: 'disproportionality',
    cohortSize: 900,
    warnings: [{ code: 'W', detail: 'x' }],
    buckets: [
      { key: '肝损伤', count: 30, rate: 0.03, b: 1, c: 2, d: 3, prr: 2.5, prrCi95: [1.4, 3.8], chiSqYates: 9, ic: 1.2, signal: true },
    ],
  });
  assert.deepEqual(payload, {
    analysisType: 'disproportionality',
    cohortSize: 900,
    buckets: [{ key: '肝损伤', count: 30, prr: 2.5, prrCi95: [1.4, 3.8], signal: true }],
  });
});

test('不支持的类型或缺字段 → null', () => {
  assert.equal(c3InterpretPayload(null), null);
  assert.equal(c3InterpretPayload({ analysisType: 'survival', cohortSize: 1 }), null);
  assert.equal(c3InterpretPayload({ analysisType: 'paired-cohort', cohortSize: 10 }), null);
});

test('vaccine-scri：只带窗口与分层三项计数，buckets 与清单不透传', () => {
  const payload = c3InterpretPayload({
    analysisType: 'vaccine-scri',
    windows: { risk: [1, 7], control: [-42, -22] },
    strata: [
      { key: '<40|M', doses: 1737, riskEvents: 43, controlEvents: 29 },
      { key: '40+|F', doses: 0, riskEvents: 0, controlEvents: 0, suppressed: true },
    ],
    buckets: [{ key: '<40|M', count: 29 }],
    release_manifest: { apiVersion: 'mdop.release/1.0' },
  });
  assert.deepEqual(payload, {
    analysisType: 'vaccine-scri',
    windows: { risk: [1, 7], control: [-42, -22] },
    strata: [
      { key: '<40|M', doses: 1737, riskEvents: 43, controlEvents: 29 },
      { key: '40+|F', doses: 0, riskEvents: 0, controlEvents: 0, suppressed: true },
    ],
  });
});

test('external-control-registration：只带白名单诊断，发布清单与行级字段不透传', () => {
  const payload = c3InterpretPayload({
    analysisType: 'external-control-registration',
    synthetic: true,
    estimand: 'ATT',
    estimator: 'IPTW-ATT',
    cohort: {
      trialN: 480,
      controlPoolN: 18000,
      analysisTrialN: 460,
      analysisControlN: 17500,
    },
    effect: { measure: 'risk-ratio', estimate: 0.61, ciLow: 0.48, ciHigh: 0.78 },
    balance: [{ covariate: 'age', smdBefore: 0.42, smdAfter: 0.03 }],
    overlap: {
      minPropensity: 0.02,
      maxPropensity: 0.91,
      trimmed: 12,
      eesTrial: 402.4,
      eesControl: 1190.7,
    },
    weights: {
      maxWeight: 4.8,
      p99Weight: 3.1,
      truncatedFraction: 0.013,
      effectiveSampleSize: 1593.1,
    },
    missingness: { mode: 'MAR', missingFraction: 0.061, imputedN: 1060 },
    censoring: { observedN: 17920, censoredN: 1140, competingRiskN: 19 },
    sensitivity: [
      {
        id: 'overlap-trimming',
        estimate: 0.64,
        ciLow: 0.51,
        ciHigh: 0.8,
        direction: 'same-direction',
      },
    ],
    truthComparison: {
      rrTrue: 0.6,
      rrEstimated: 0.61,
      absoluteError: 0.01,
      withinExpectedRange: true,
    },
    study: {
      profileVersion: 'registration-eca/1.0.0',
      timeZero: 'treatment-start',
      estimandSapVersion: 'sap-3',
    },
    release_manifest: { apiVersion: 'mdop.release/1.0' },
    subjectKey: 'lk-should-not-egress',
  });
  assert.equal(payload?.analysisType, 'external-control-registration');
  assert.equal('release_manifest' in (payload ?? {}), false);
  assert.equal('subjectKey' in (payload ?? {}), false);
  assert.deepEqual(payload?.balance, [
    { covariate: 'age', smdBefore: 0.42, smdAfter: 0.03 },
  ]);
});

test('external-control-registration：诊断对象缺失 → null', () => {
  assert.equal(
    c3InterpretPayload({
      analysisType: 'external-control-registration',
      synthetic: true,
      estimand: 'ATT',
      estimator: 'IPTW-ATT',
      cohort: {},
      effect: {},
      balance: [],
      sensitivity: [],
    }),
    null,
  );
});
