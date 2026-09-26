import assert from 'node:assert/strict';
import { test } from 'node:test';
import { witnessStatusView } from './witness-status-view';

const row = (holderVerification: unknown) => ({
  node: 'urn:tds:sh-med:participant:tee-1',
  kind: 'tdx',
  measurement: 'sm3:aa',
  tcb: '3.1.2',
  quoteDigest: 'sm3:bb',
  keyId: 'k-1',
  expiresAt: '2026-09-25T10:10:00.000Z',
  verifiedBy: 'kms://hospital',
  holderVerification,
});

test('没有核验回执 → unverified（**不显示成通过**）', () => {
  const view = witnessStatusView({
    witnesses: [row(null)],
    nodesWithoutVerification: ['urn:tds:sh-med:participant:tee-1'],
    nodesWithoutWitness: [],
  });
  assert.equal(view.rows[0].verification.status, 'unverified');
  assert.equal(view.rows[0].verification.label, '尚未核验');
  assert.deepEqual(view.nodesWithoutVerification, ['urn:tds:sh-med:participant:tee-1']);
});

test('核验通过 → verified，带上核验方与时间', () => {
  const view = witnessStatusView({
    witnesses: [
      row({ status: 'verified', verifier: 'urn:tds:sh-med:participant:p-huashan', at: '2026-09-25T10:00:00.000Z' }),
    ],
  });
  assert.equal(view.rows[0].verification.status, 'verified');
  assert.match(view.rows[0].verification.verifier ?? '', /p-huashan/);
  assert.equal(view.rows[0].verification.at, '2026-09-25T10:00:00.000Z');
});

test('核验失败 → rejected 且如实带原因', () => {
  const view = witnessStatusView({
    witnesses: [row({ status: 'rejected', reason: 'E_MEASUREMENT_NOT_ALLOWED: 换了代码' })],
  });
  assert.equal(view.rows[0].verification.status, 'rejected');
  assert.match(view.rows[0].verification.reason ?? '', /E_MEASUREMENT_NOT_ALLOWED/);
});

test('形状不对 → 空视图（不抛、不猜）', () => {
  const view = witnessStatusView(undefined);
  assert.deepEqual(view, { rows: [], nodesWithoutWitness: [], nodesWithoutVerification: [] });
  const odd = witnessStatusView({ witnesses: [1, 'x'], holderVerification: 'no' });
  assert.deepEqual(odd.rows, []);
});
