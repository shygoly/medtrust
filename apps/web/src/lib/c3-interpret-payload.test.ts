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
