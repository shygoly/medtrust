// `check-crypto-imports.mjs` 的**负例自检**：不会红的守护等于没有守护。
//
// 造一棵最小 fixture 仓：把白名单里的目录/文件与三条在册偏离都真实落盘（默认让偏离仍在直引），
// 再按用例注入违规或还清。这样 R1（未登记直引）、R2（还清却在册）、R3（名单悬空）各有一条红例，
// 另有一条「真仓 0 error」把当前现状钉住。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { REGISTERED_DEVIATIONS, SANCTIONED, runCryptoImportCheck } from './check-crypto-imports.mjs';

const IMPORTS_SM3 = "import { sm3 } from 'sm-crypto';\nexport const x = sm3('a');\n";

/** 落盘 fixture：白名单条目 + 三条在册偏离（默认仍在直引），再叠加 `extra`。 */
function buildFixture(extra = {}, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'crypto-imports-'));
  const write = (rel, text) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  };
  for (const s of SANCTIONED) {
    if (opts.skipSanctioned === s.match) continue;
    if (s.match.endsWith('/')) mkdirSync(join(root, s.match), { recursive: true });
    else write(s.match, '');
  }
  for (const d of REGISTERED_DEVIATIONS) {
    write(d.path, opts.repaid?.includes(d.path) ? 'export const y = 1;\n' : IMPORTS_SM3);
  }
  for (const [rel, text] of Object.entries(extra)) write(rel, text);
  return root;
}

const withFixture = (fn, extra, opts) => {
  const root = buildFixture(extra, opts);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('真仓：0 error（9 个直引文件全部落在白名单或在册偏离里）', () => {
  const r = runCryptoImportCheck();
  assert.deepEqual(r.errors, []);
  assert.equal(r.directImporters.length, r.sanctioned.length + r.deviations.length);
  assert.equal(r.deviations.length, REGISTERED_DEVIATIONS.length);
});

test('未登记的文件直引 sm-crypto → 红（R1）', () => {
  withFixture(
    (root) => {
      const r = runCryptoImportCheck({ root });
      assert.ok(r.errors.some((e) => e.includes('未登记直引') && e.includes('apps/api/src/foo/bar.ts')));
    },
    { 'apps/api/src/foo/bar.ts': IMPORTS_SM3 },
  );
});

test('注释里的 sm-crypto 不算引用 → 绿（否则文档与注释会把守护弄红）', () => {
  withFixture(
    (root) => {
      const r = runCryptoImportCheck({ root });
      assert.deepEqual(r.errors, []);
    },
    { 'apps/api/src/foo/notes.ts': "// 以前这里是 import { sm3 } from 'sm-crypto'; 已收敛\nexport const z = 1;\n" },
  );
});

test('构建备份目录 dist.bak-* 不参与扫描 → 绿', () => {
  withFixture(
    (root) => {
      const r = runCryptoImportCheck({ root });
      assert.deepEqual(r.errors, []);
    },
    { 'apps/api/dist.bak-local/src/generated.ts': IMPORTS_SM3 },
  );
});

test('测试与夹具直引不算违规 → 绿（spec / __fixtures__ 不是信任路径）', () => {
  withFixture((root) => {
    const r = runCryptoImportCheck({ root });
    assert.deepEqual(r.errors, []);
  }, {
    'apps/api/src/foo/bar.spec.ts': IMPORTS_SM3,
    'apps/connector/src/domain/__fixtures__/mod.ts': IMPORTS_SM3,
  });
});

test('在册偏离已还清却仍留在名单里 → 红（R2：名单不许变成永久豁免）', () => {
  const repaid = REGISTERED_DEVIATIONS[0].path;
  withFixture(
    (root) => {
      const r = runCryptoImportCheck({ root });
      assert.ok(r.errors.some((e) => e.includes('已还清') && e.includes(repaid)));
    },
    {},
    { repaid: [repaid] },
  );
});

test('名单条目路径不存在 → 红（R3：文件改名/删除后名单没跟着改）', () => {
  const missing = SANCTIONED.find((s) => s.match.endsWith('/'))?.match;
  assert.ok(missing, '需要一条目录型白名单条目来做本用例');
  withFixture(
    (root) => {
      const r = runCryptoImportCheck({ root });
      assert.ok(r.errors.some((e) => e.includes('路径不存在') && e.includes(missing)));
    },
    {},
    { skipSanctioned: missing },
  );
});
