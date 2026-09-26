// TEE 表述红线的**负例自检**：把文件内容改坏，逐条断言「改坏会被抓住」，并断言合法写法不被误伤。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTeeClaimCheck } from './check-tee-claims.mjs';

const scan = (path, text) => runTeeClaimCheck({ files: [{ path, text }] });
const caught = (result, needle) => result.errors.some((e) => e.includes(needle));

test('R1 违规：把 attestationLevel 写成 hardware → 抓住（含显式改值写法）', () => {
  assert.ok(caught(scan('apps/api/src/x.ts', "const row = { attestationLevel: 'hardware' };"), 'attestationLevel'));
  assert.ok(caught(scan('apps/connector/src/domain/x.ts', 'row.attestationLevel = "hardware";'), 'attestationLevel'));
  // 测试文件也不豁免：它描述的是「对外自述口径」，不是夹具值
  assert.ok(caught(scan('apps/web/src/x.spec.ts', "const row = { attestationLevel: 'hardware' };"), 'attestationLevel'));
});

test('R1 合法：software 值、类型联合、比较判定都不误伤', () => {
  assert.deepEqual(scan('apps/api/src/x.ts', "const row = { attestationLevel: 'software' };").errors, []);
  assert.deepEqual(scan('packages/database/src/x.ts', "attestationLevel: 'software' | 'hardware';").errors, []);
  assert.deepEqual(scan('apps/web/src/x.ts', "if (row.attestationLevel === 'hardware') render();").errors, []);
});

test('R2 违规：证明契约之外的生产代码写 level: hardware → 抓住', () => {
  const result = scan('apps/web/src/lib/whatever.ts', "const report = { level: 'hardware' };");
  assert.ok(caught(result, "level: 'hardware'"));
  // 医院侧连接器域内同样不许（那是数据持有方，不是可信空间节点）
  assert.ok(caught(scan('apps/connector/src/domain/tee.ts', "level: 'hardware',"), 'level'));
});

test('R2 合法：证明契约与测试夹具可以产出 hardware 级结论', () => {
  assert.deepEqual(
    scan('packages/mdop/src/attestation/provider.ts', "    level: 'hardware',").errors,
    [],
  );
  assert.deepEqual(
    scan('apps/connector/src/mdop/mdop-node.spec.ts', "  level: 'hardware',").errors,
    [],
  );
});

test('R2 不误伤：类型联合与「判定硬件级」的比较写法', () => {
  assert.deepEqual(scan('packages/mdop/src/x.ts', "level: 'software' | 'hardware';").errors, []);
  assert.deepEqual(
    scan('apps/connector/src/tee-node/providers.ts', "if (report.level === 'hardware') return tee;").errors,
    [],
  );
});

test('R3 违规：医院侧执行环境声明 hardware-enclave → 抓住（agent 同理）', () => {
  assert.ok(caught(scan('apps/connector/src/domain/tee.ts', "isolation: 'hardware-enclave',"), 'isolation'));
  assert.ok(caught(scan('apps/agent/src/x.ts', 'isolation: "hardware-enclave",'), 'isolation'));
});

test('R3 合法：证明契约与节点组件可以有硬件飞地结论；类型联合不误伤', () => {
  assert.deepEqual(scan('packages/mdop/src/attestation/provider.ts', "isolation: 'hardware-enclave',").errors, []);
  assert.deepEqual(scan('apps/connector/src/tee-node/providers.ts', "isolation: 'hardware-enclave',").errors, []);
  assert.deepEqual(scan('apps/connector/src/domain/tee.ts', "isolation: 'none' | 'hardware-enclave';").errors, []);
});

test('多文件一次扫描：逐文件逐行报，且行号可用', () => {
  const result = runTeeClaimCheck({
    files: [
      { path: 'apps/api/src/a.ts', text: 'const x = 1;\nconst row = { attestationLevel: "hardware" };\n' },
      { path: 'apps/web/src/b.ts', text: "const report = { level: 'hardware' };\n" },
    ],
  });
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors[0].includes('apps/api/src/a.ts:2'));
  assert.ok(result.errors[1].includes('apps/web/src/b.ts:1'));
  assert.equal(result.fileCount, 2);
});
