import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseManifestView } from './release-manifest-view';

const AT = '2026-09-25T10:00:00.000Z';

function manifest() {
  return {
    apiVersion: 'mdop.release/1.0',
    parties: [
      {
        node: 'urn:tds:sh-med:participant:tee-1',
        minCell: 10,
        suppressed: 3,
        dp: { mode: 'none' },
        budget: { dataset: 'dp-1', snapshot: 'sm3:aa', unit: 'queries', spent: 2, limit: 20 },
        at: AT,
      },
    ],
    suppressedTotal: 3,
    dp: { mode: 'none' },
    minCell: 10,
    at: AT,
  };
}

test('没有清单 → absent（不冒充「审查过」）', () => {
  assert.deepEqual(releaseManifestView({ analysisType: 'x' }), { status: 'absent' });
  assert.deepEqual(releaseManifestView(null), { status: 'absent' });
});

test('清单非法 → invalid，并给出原因（不猜内容）', () => {
  const bad = releaseManifestView({ release_manifest: { apiVersion: 'x', parties: [] } });
  assert.equal(bad.status, 'invalid');
  assert.match(bad.status === 'invalid' ? bad.reason : '', /parties|版本/);
  const notObj = releaseManifestView({ release_manifest: 42 });
  assert.equal(notObj.status, 'invalid');
});

test('清单合法 → 汇总数与逐方明细可读（含预算与 DP 说明）', () => {
  const view = releaseManifestView({ release_manifest: manifest() });
  assert.equal(view.status, 'ok');
  if (view.status !== 'ok') return;
  assert.equal(view.suppressedTotal, 3);
  assert.equal(view.minCell, 10);
  assert.equal(view.dp, '未加噪（如实记录：本期节点内不加噪）');
  assert.equal(view.parties.length, 1);
  assert.equal(view.parties[0].secondarySuppression, false);
  assert.equal(view.parties[0].budget, 'dp-1：2 / 20 queries');
});

test('加噪声明 → 显示 ε；二次抑制标记如实显示', () => {
  const view = releaseManifestView({
    release_manifest: {
      ...manifest(),
      dp: { mode: 'epsilon', epsilon: 1.5 },
      parties: [{ ...manifest().parties[0], dp: { mode: 'epsilon', epsilon: 1.5 }, secondarySuppression: true }],
    },
  });
  assert.equal(view.status, 'ok');
  if (view.status !== 'ok') return;
  assert.equal(view.dp, 'ε = 1.5');
  assert.equal(view.parties[0].secondarySuppression, true);
});
