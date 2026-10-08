// 生成的数据集 ↔ 真实 Wasm 模块 ↔ 答案键 —— 三者逐格对拍（整体测试的第一道）。
//
// 为什么要有这一道：对拍测试（*-parity）证明「模块 ≡ TS 参考语义」，构建脚本的答案键用 TS 参考语义算；
// 但**数据文件本身**（Synthea 基座 + 注入层）与模块能否对上，只有把真实数据喂进真实模块才知道。
//
// 数据集不存在时**跳过**（不把「没生成数据」判成失败），但一旦存在就必须逐格一致。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';
import { BUILD_DIR, PACKAGE_ROOT, readManifest } from './wasm-utils.mjs';
import { encodeDedupIncidence, encodeExternalControl, encodeVeTnd, estimateExternalControl, estimateVe } from '../dist/index.js';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const VE_DIR = join(REPO_ROOT, 'data', 'demo', 've');
const DEDUP_DIR = join(REPO_ROOT, 'data', 'demo', 'dedup');
const EC_DIR = join(REPO_ROOT, 'data', 'demo', 'external-control');

function instanceOf(analysisType, initialPages = 1) {
  const manifest = readManifest();
  const entry = manifest.modules.find((m) => m.analysisType === analysisType);
  assert.ok(entry, `清单缺模块 ${analysisType}`);
  const bytes = readFileSync(join(BUILD_DIR, entry.file));
  // 真实数据集比单测夹具大得多（dedup 编码后 >100KB），按需分配页数
  const memory = new WebAssembly.Memory({ initial: initialPages, maximum: 1024 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  return { instance, memory };
}

/** 按编码后的布局算需要多少页内存（含头部、列与输出区）。 */
function pagesFor(bytesNeeded) {
  return Math.max(1, Math.ceil((bytesNeeded + 4096) / 65536));
}

const put = (bytes, typed, offset) =>
  bytes.set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), offset);

/** 跑 ve-tnd 模块：布局与 scripts/ve-tnd-parity.test.mjs 完全一致。 */
function runVeTnd(input) {
  const enc = encodeVeTnd(input);
  const { instance, memory } = instanceOf('ve-tnd');
  const n = enc.gapDays.length;
  const k = enc.strataKeys.length;
  const inOff = 1024;
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  view.setInt32(inOff, enc.immuneDays, true);
  const gapOff = inOff + 4;
  const resultOff = gapOff + n * 4;
  const stratumOff = resultOff + n;
  put(bytes, enc.gapDays, gapOff);
  bytes.set(enc.result, resultOff);
  bytes.set(enc.testStratum, stratumOff);
  const outOff = (stratumOff + n + 7) & ~7;
  assert.equal(instance.exports.run(inOff, n, k, outOff), 0);
  const names = ['vaccPos', 'vaccNeg', 'unvaccPos', 'unvaccNeg', 'partialPos', 'partialNeg'];
  return enc.strataKeys.map((key, s) => {
    const row = { key };
    names.forEach((name, c) => { row[name] = view.getUint32(outOff + s * 24 + c * 4, true); });
    return row;
  });
}

/** 跑 dedup-incidence 模块：布局与 scripts/dedup-incidence-parity.test.mjs 完全一致。 */
function runDedupIncidence(input) {
  const enc = encodeDedupIncidence(input);
  const { instance, memory } = instanceOf('dedup-incidence', pagesFor(16 + enc.layout.bytes + enc.strataKeys.length * 16));
  const n = enc.nObs + enc.nEvents + enc.nRare;
  const k = enc.strataKeys.length;
  const inOff = 1024;
  const base = inOff + 16;
  const L = enc.layout;
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  view.setInt32(inOff, enc.nObs, true);
  view.setInt32(inOff + 4, enc.nEvents, true);
  view.setInt32(inOff + 8, enc.nRare, true);
  view.setInt32(inOff + 12, enc.mergeAdjacent, true);
  put(bytes, enc.subjectObs, base + L.subjectObs);
  put(bytes, enc.stratumObs, base + L.stratumObs);
  put(bytes, enc.startDay, base + L.startDay);
  put(bytes, enc.endDay, base + L.endDay);
  put(bytes, enc.subjectEv, base + L.subjectEv);
  put(bytes, enc.stratumEv, base + L.stratumEv);
  put(bytes, enc.eventKey, base + L.eventKey);
  put(bytes, enc.subjectRare, base + L.subjectRare);
  put(bytes, enc.stratumRare, base + L.stratumRare);
  const outOff = (base + L.bytes + 7) & ~7;
  assert.equal(instance.exports.run(inOff, n, k, outOff), 0);
  const names = ['uniqueSubjects', 'personDaysUnion', 'eventsDeduped', 'rareCases'];
  return enc.strataKeys.map((key, s) => {
    const row = { key };
    names.forEach((name, c) => { row[name] = view.getUint32(outOff + s * 16 + c * 4, true); });
    return row;
  });
}


/** 跑 external-control 模块：布局与 scripts/external-control-parity.test.mjs 完全一致。 */
function runExternalControl(input) {
  const enc = encodeExternalControl(input);
  const nT = enc.nTrial, nC = enc.nCtrl;
  const { instance, memory } = instanceOf('external-control', pagesFor(16 + (nT + nC) * 6 + enc.strataKeys.length * 24));
  const S = enc.strataKeys.length;
  const inOff = 1024;
  const base = inOff + 16;
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  view.setInt32(inOff, nT, true);
  view.setInt32(inOff + 4, nC, true);
  view.setInt32(inOff + 8, enc.caliperDays, true);
  view.setInt32(inOff + 12, enc.ratioK, true);
  put(bytes, enc.trialDay, base);
  bytes.set(enc.trialOutcome, base + nT * 4);
  bytes.set(enc.trialStratum, base + nT * 5);
  put(bytes, enc.ctrlDay, base + nT * 6);
  bytes.set(enc.ctrlOutcome, base + nT * 6 + nC * 4);
  bytes.set(enc.ctrlStratum, base + nT * 6 + nC * 5);
  const outOff = (base + (nT + nC) * 6 + 7) & ~7;
  assert.equal(instance.exports.run(inOff, nT + nC, S, outOff), 0);
  const names = ['mExpPos', 'mExpNeg', 'ctlPos', 'ctlNeg', 'matched', 'unmatched'];
  return enc.strataKeys.map((key, s) => {
    const row = { key };
    names.forEach((name, c) => { row[name] = view.getUint32(outOff + s * 24 + c * 4, true); });
    return row;
  });
}

test('VE 数据集：真实模块输出与答案键逐格一致（且重复检测已被去重）', (t) => {
  const keyPath = join(VE_DIR, 'answer-key.json');
  if (!existsSync(keyPath)) return t.skip('未生成 data/demo/ve（先跑 scripts/build-ve-records.mjs）');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const cdc = JSON.parse(readFileSync(join(VE_DIR, 'cdc', 'records.json'), 'utf8'));
  const hospital = JSON.parse(readFileSync(join(VE_DIR, 'hospital', 'records.json'), 'utf8'));

  const doses = cdc.flatMap((r) =>
    r.immunizations.map((im) => ({
      subjectKey: r.linkKey, vaccinationDate: im.date, vaccineCode: im.code, doseNo: im.doseNo,
    })),
  );
  const rawTests = hospital.flatMap((r) =>
    r.tests.map((x) => ({
      subjectKey: r.linkKey, testDate: x.date, pathogenCode: x.code, result: x.result,
      ageBand: r.ageBand, sex: r.sex,
    })),
  );
  const input = {
    immuneDays: key.params.immuneDays,
    vaccineCodes: key.params.vaccineCodes,
    pathogenCodes: [key.params.pathogenCode],
    doses,
    tests: rawTests,
    strataKeys: key.expected.strata.map((s) => s.key),
  };

  const actual = runVeTnd(input);
  const expected = key.expected.strata.map((s) => ({
    key: s.key, vaccPos: s.vaccPos, vaccNeg: s.vaccNeg,
    unvaccPos: s.unvaccPos, unvaccNeg: s.unvaccNeg,
    partialPos: s.partialPos, partialNeg: s.partialNeg,
  }));
  assert.deepEqual(actual, expected, '模块输出必须与答案键逐格一致');

  // 重复检测注入确实被去重（否则说明投影层去重失效）
  const encoded = encodeVeTnd(input).gapDays.length;
  assert.ok(
    rawTests.length > encoded,
    `注入的 ${rawTests.length - encoded} 条同人同日重复检测必须被去重（原始 ${rawTests.length} → 纳入 ${encoded}）`,
  );
  assert.equal(key.counts.injected.duplicates, rawTests.length - encoded, '重复条数必须与答案键记录一致');

  // 不可估层必须仍为「不可估」：不得出现 vaccPos=0 却被当成有效 VE
  for (const s of key.expected.strata) {
    const est = estimateVe(s);
    if (s.vaccPos === 0 || s.unvaccPos === 0) assert.equal(est, null, `${s.key} 应不可估`);
    else assert.ok(est && Number.isFinite(est.ve), `${s.key} 应可估`);
  }
  console.log(`VE 数据集校验：${expected.length} 层逐格一致（原始检测 ${rawTests.length} → 去重后 ${encoded}）`);
});

test('dedup 数据集：真实模块输出与答案键逐格一致（且虚增比例方向正确）', (t) => {
  const keyPath = join(DEDUP_DIR, 'answer-key.json');
  if (!existsSync(keyPath)) return t.skip('未生成 data/demo/dedup（先跑 scripts/build-dedup-records.mjs）');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const a = JSON.parse(readFileSync(join(DEDUP_DIR, 'hospital-a', 'records.json'), 'utf8'));
  const b = JSON.parse(readFileSync(join(DEDUP_DIR, 'hospital-b', 'records.json'), 'utf8'));

  const records = [...a, ...b];
  const input = {
    observations: records.map((r) => ({
      subjectKey: r.linkKey, ageBand: r.ageBand, sex: r.sex, start: r.observation.start, end: r.observation.end,
    })),
    events: records.flatMap((r) =>
      r.events.map((e) => ({ subjectKey: r.linkKey, ageBand: r.ageBand, sex: r.sex, code: e.code, date: e.date })),
    ),
    rareDiseases: records.filter((r) => r.rareDisease).map((r) => ({
      subjectKey: r.linkKey, ageBand: r.ageBand, sex: r.sex,
      code: r.rareDisease.code, firstDate: r.rareDisease.firstDate,
    })),
    mergeAdjacent: true,
    strataKeys: key.expected.strata.map((s) => s.key),
  };

  const actual = runDedupIncidence(input);
  assert.deepEqual(actual, key.expected.strata, '模块输出必须与答案键逐格一致');

  // 去重前后对比：人头与人日必须严格「去重后 ≤ 直接相加」（否则说明并集没生效）
  for (const c of key.comparison) {
    assert.ok(
      c.deduped.uniqueSubjects <= c.naiveSum.uniqueSubjects,
      `${c.key} 去重人数不得大于直接相加`,
    );
    assert.ok(
      c.deduped.personDaysUnion <= c.naiveSum.personDays,
      `${c.key} 并集人日不得大于直接相加（重叠期不得重复计）`,
    );
    assert.ok(c.deduped.eventsDeduped <= c.naiveSum.events, `${c.key} 去重事件不得大于直接相加`);
  }
  const dupEvents = key.counts.injected.duplicatedEvents;
  assert.ok(dupEvents >= 1, `必须注入跨院重复事件（当前 ${dupEvents}）`);
  console.log(
    `dedup 数据集校验：${actual.length} 层逐格一致（注入重复事件 ${dupEvents} 起、跨院重叠/空 1 天观察期 ` +
      `${key.counts.injected.overlappingWindows}/${key.counts.injected.oneDayGapWindows} 例）`,
  );
});

test('external-control 数据集：真实模块输出与答案键逐格一致（且注入方向被还原）', (t) => {
  t.assert.ok(existsSync(join(EC_DIR, 'answer-key.json')), '先生成数据：node scripts/../../build-external-control-records.mjs');
  const key = JSON.parse(readFileSync(join(EC_DIR, 'answer-key.json'), 'utf8'));
  const sponsor = JSON.parse(readFileSync(join(EC_DIR, 'sponsor', 'records.json'), 'utf8'));
  const hospital = JSON.parse(readFileSync(join(EC_DIR, 'hospital', 'records.json'), 'utf8'));
  const toProjectionShape = (r) => ({ ...r, subjectKey: r.linkKey });
  const out = runExternalControl({
    trialRows: sponsor.map(toProjectionShape),
    controlRows: hospital.map(toProjectionShape),
    strataKeys: key.params.strata.map((x) => x.key),
    caliperDays: key.params.caliperDays,
    ratioK: key.params.ratioK,
  });
  const cells = ['mExpPos', 'mExpNeg', 'ctlPos', 'ctlNeg', 'matched', 'unmatched'];
  t.assert.deepEqual(out, key.expected.strata.map((e) => ({ key: e.key, ...Object.fromEntries(cells.map((c) => [c, e[c]])) })));
  // 方向：注入 RR<1 的层，模块估计的 RR 必须 < 1；负例层 CI 覆盖 1
  for (let i = 0; i < out.length; i++) {
    const est = estimateExternalControl(out[i]);
    t.assert.ok(est, `${out[i].key} 应可估计`);
    const rrTrue = key.params.strata[i].rr_true;
    if (rrTrue < 1) t.assert.ok(est.rr < 1, `${out[i].key} RR ${est.rr} 方向应 < 1`);
    else t.assert.ok(est.rrCi.low <= 1 && est.rrCi.high >= 1, `${out[i].key} 负例层 CI 应覆盖 1`);
  }
});
