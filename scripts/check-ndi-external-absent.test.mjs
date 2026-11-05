// ndi-external-absent 总闸的**负例自检**：逐条改坏文件，断言会被抓住；并断言当前仓库基线通过。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runNdiExternalAbsentCheck } from './check-ndi-external-absent.mjs';

const FILES = {
  migration: 'packages/database/src/migrations/control-plane/1762400000000-AddCatalogUpstreamListing.ts',
  regionService: 'apps/api/src/runtime/region-reporting/region-reporting.service.ts',
  regionReporter: 'apps/api/src/runtime/region-reporting/region-reporter.ts',
  silkRoad: 'apps/api/src/runtime/silk-road/silk-road.service.ts',
  catalog: 'apps/api/src/runtime/catalog/catalog.service.ts',
  pep: 'apps/connector/src/domain/policy-enforcement.ts',
  catalogQuery: 'apps/connector/src/domain/catalog-query/catalog-query.service.ts',
  worker: 'apps/connector/src/domain/connector-worker.service.ts',
};

const base = Object.fromEntries(
  Object.entries(FILES).map(([key, path]) => [path, readFileSync(path, 'utf8')]),
);

const run = (override = {}) =>
  runNdiExternalAbsentCheck({ files: { ...base, ...override } });

const caught = (result, needle) => result.errors.some((error) => error.includes(needle));

test('基线：当前仓库六条契约全过', () => {
  assert.deepEqual(run().errors, []);
});

test('C1：迁移 up() 里出现 DROP COLUMN → 抓住', () => {
  const text = base[FILES.migration].replace(
    'for (const sql of statements) await queryRunner.query(sql);',
    'for (const sql of statements) await queryRunner.query(sql);\n    await queryRunner.query(`ALTER TABLE "cp_data_product" DROP COLUMN "legacy"`);',
  );
  assert.ok(caught(run({ [FILES.migration]: text }), 'C1'));
});

test('C2：onModuleInit 里抛错 → 抓住', () => {
  const text = base[FILES.regionService].replace(
    'if (this.reporter.mode === "noop") {',
    'if (!process.env.SILKROAD_NODE_ENDPOINT) throw new Error("missing endpoint");\n    if (this.reporter.mode === "noop") {',
  );
  assert.ok(caught(run({ [FILES.regionService]: text }), 'C2'));
});

test('C3：未配置时不再装 Noop → 抓住', () => {
  const text = base[FILES.regionReporter].replace(
    'if (!endpoint) return new NoopRegionStateReporter();',
    'if (!endpoint) return new HttpRegionStateReporter("http://localhost", nodeId);',
  );
  assert.ok(caught(run({ [FILES.regionReporter]: text }), 'C3'));
});

test('C4：定时器不 unref → 抓住', () => {
  const text = base[FILES.regionService].replace('this.timer.unref?.();', '');
  assert.ok(caught(run({ [FILES.regionService]: text }), 'C4'));
});

test('C5：去掉 grandfather 判据 → 抓住', () => {
  const text = base[FILES.catalog].replaceAll('declaringSpec', 'alwaysStrict');
  assert.ok(caught(run({ [FILES.catalog]: text }), 'C5'));
});

test('C6：引擎缺省改成 v1 / 推送不再限定 regional → 抓住', () => {
  const pep = base[FILES.pep].replace(
    "process.env.USAGE_CONTROL_ENGINE ?? 'legacy'",
    "process.env.USAGE_CONTROL_ENGINE ?? 'v1'",
  );
  assert.ok(caught(run({ [FILES.pep]: pep }), 'C6'));

  const silk = base[FILES.silkRoad].replace('listingScope: "regional"', 'status: "active"');
  assert.ok(caught(run({ [FILES.silkRoad]: silk }), 'C6'));

  const query = base[FILES.catalogQuery].replace(
    "process.env.CONNECTOR_CATALOG_SERVICE ?? 'off'",
    "process.env.CONNECTOR_CATALOG_SERVICE ?? 'on'",
  );
  assert.ok(caught(run({ [FILES.catalogQuery]: query }), 'C6'));
});
