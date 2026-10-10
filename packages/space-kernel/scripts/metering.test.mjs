// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyMeteringProvider, contributionTotal, extractProxyContributions } from '../dist/index.js';

test('兜底口径：聚合量转贡献度并如实标注 proxy', () => {
  const p = new ProxyMeteringProvider();
  const m = p.measure({ spaceId: 's1' }, {
    taskId: 't1',
    outputs: [{ subjectId: 'p-a', quantity: 30 }, { participantId: 'p-b', count: 10 }],
  });
  assert.equal(m.engine.mode, 'proxy');
  assert.equal(m.engine.digest, 'n/a');
  assert.deepEqual(m.contributions, [
    { subjectId: 'p-a', quantity: 30, unit: 'count' },
    { subjectId: 'p-b', quantity: 10, unit: 'count' },
  ]);
  assert.equal(contributionTotal(m), 40);
});

test('负例：行级/畸形输入被丢弃，不进贡献度', () => {
  const out = extractProxyContributions([
    null,
    'raw-row',
    { subjectId: 'p-a' },
    { subjectId: 'p-b', quantity: -1 },
    { subjectId: 'p-c', quantity: Number.POSITIVE_INFINITY },
    { quantity: 5 },
  ]);
  assert.deepEqual(out, []);
});

test('负例：兜底口径 MUST NOT 自报为算法口径', () => {
  const m = new ProxyMeteringProvider().measure({ spaceId: 's1' }, { taskId: 't', outputs: [] });
  assert.notEqual(m.engine.mode, 'authoritative');
});
