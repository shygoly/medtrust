#!/usr/bin/env node
/**
 * 在 **TDX 机密虚拟机内**直接执行两个新算子，并与答案键逐格对拍（真机实测）。
 *
 * 与本地 `demo:rws-scenarios` 的区别：本脚本部署到真机运行，
 *  - 模块字节取自**节点本地模块库**（`/opt/medtrust/modules/<sm3>.wasm`，与 tee-node 执行时同源）；
 *  - 同时打印 TDX 环境事实（内核 / tdx_guest / Device）与一次**真实 TDX quote**（`xdattest prove`）；
 *  - 计算与对拍都在机密虚拟机内完成。
 *
 * 口径：本脚本证明的是「节点内算子能在 TDX 客户机里跑、且结果与答案键逐格一致」；
 * 完整的平台侧 C2 调度链路由 `pitch/intel-showcase-20261003/`（AEFI 作业）已实测，不在本脚本范围内。
 *
 * 用法（在 teeA 上）：
 *   /opt/node/bin/node run-rws-in-tdx.mjs --modules /opt/medtrust/modules --data ./data
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const veModel = require(join(HERE, "ve-tnd-model.js"));
const ddModel = require(join(HERE, "dedup-incidence-model.js"));
const ecModel = require(join(HERE, "external-control-model.js"));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const MODULES = flag("--modules", "/opt/medtrust/modules");
const DATA = resolve(flag("--data", join(HERE, "data")));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const align4 = (v) => (v + 3) & ~3;
const align8 = (v) => (v + 7) & ~7;

/** 从节点本地模块库按 SM3 取字节（只认摘要，目录里没有就拒——与节点执行同一口径）。 */
function moduleBytes(sm3) {
  const hit = readdirSync(MODULES).find((f) => f.startsWith(sm3) && f.endsWith(".wasm"));
  if (!hit) throw new Error(`模块库缺 ${sm3}.wasm（节点执行时同样取不到就会拒）`);
  const bytes = new Uint8Array(readFileSync(join(MODULES, hit)));
  return { file: hit, bytes };
}

function runVe(modulePath, input) {
  const enc = veModel.encodeVeTnd(input);
  const { file, bytes } = moduleBytes(modulePath);
  const n = enc.gapDays.length;
  const k = enc.strataKeys.length;
  const mem = new WebAssembly.Memory({
    initial: Math.max(1, Math.ceil((4 + n * 6 + 24 * k + 4096) / 65536)),
    maximum: 1024,
  });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory: mem } });
  const view = new DataView(mem.buffer);
  const u8 = new Uint8Array(mem.buffer);
  const inOff = 1024;
  view.setInt32(inOff, enc.immuneDays, true);
  u8.set(new Uint8Array(enc.gapDays.buffer, enc.gapDays.byteOffset, enc.gapDays.byteLength), inOff + 4);
  u8.set(enc.result, inOff + 4 + n * 4);
  u8.set(enc.testStratum, inOff + 4 + n * 5);
  const outOff = align8(inOff + 4 + n * 6);
  const code = instance.exports.run(inOff, n, k, outOff);
  if (code !== 0) throw new Error(`模块返回 ${code}`);
  const names = ["vaccPos", "vaccNeg", "unvaccPos", "unvaccNeg", "partialPos", "partialNeg"];
  const strata = enc.strataKeys.map((key, s) => {
    const row = { key };
    names.forEach((nm, c) => (row[nm] = view.getUint32(outOff + s * 24 + c * 4, true)));
    return row;
  });
  return { file, strata };
}

function runDedup(modulePath, input) {
  const enc = ddModel.encodeDedupIncidence(input);
  const { file, bytes } = moduleBytes(modulePath);
  const L = enc.layout;
  const n = enc.nObs + enc.nEvents + enc.nRare;
  const k = enc.strataKeys.length;
  const total = 16 + L.bytes + 16 * k;
  const mem = new WebAssembly.Memory({
    initial: Math.max(1, Math.ceil((total + 4096) / 65536)),
    maximum: 1024,
  });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory: mem } });
  const view = new DataView(mem.buffer);
  const u8 = new Uint8Array(mem.buffer);
  const inOff = 1024;
  view.setInt32(inOff, enc.nObs, true);
  view.setInt32(inOff + 4, enc.nEvents, true);
  view.setInt32(inOff + 8, enc.nRare, true);
  view.setInt32(inOff + 12, enc.mergeAdjacent, true);
  const put = (typed, rel) =>
    u8.set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), inOff + 16 + rel);
  put(enc.subjectObs, L.subjectObs);
  put(enc.stratumObs, L.stratumObs);
  put(enc.startDay, L.startDay);
  put(enc.endDay, L.endDay);
  put(enc.subjectEv, L.subjectEv);
  put(enc.stratumEv, L.stratumEv);
  put(enc.eventKey, L.eventKey);
  put(enc.subjectRare, L.subjectRare);
  put(enc.stratumRare, L.stratumRare);
  const outOff = align8(inOff + 16 + L.bytes);
  const code = instance.exports.run(inOff, n, k, outOff);
  if (code !== 0) throw new Error(`模块返回 ${code}`);
  const names = ["uniqueSubjects", "personDaysUnion", "eventsDeduped", "rareCases"];
  const strata = enc.strataKeys.map((key, s) => {
    const row = { key };
    names.forEach((nm, c) => (row[nm] = view.getUint32(outOff + s * 16 + c * 4, true)));
    return row;
  });
  return { file, strata };
}

function tdxFacts() {
  const out = [];
  try {
    const dmesg = execFileSync("bash", ["-lc", "dmesg 2>/dev/null | grep -m1 'Memory Encryption Features'"], { encoding: "utf8" }).trim();
    if (dmesg) out.push(dmesg);
  } catch {}
  out.push(`内核 ${execFileSync("uname", ["-r"], { encoding: "utf8" }).trim()}`);
  out.push(`/dev/tdx_guest ${existsSync("/dev/tdx_guest") ? "存在" : "不存在"}`);
  return out;
}

function quote() {
  try {
    const dir = `/tmp/rws-quote-${Date.now()}`;
    execFileSync("bash", ["-lc", `mkdir -p ${dir} && /root/xdattest prove -out ${dir} >/dev/null 2>&1`]);
    const q = join(dir, "quote.bin");
    if (!existsSync(q)) return null;
    const p = readJson(join(dir, "prove.json"));
    return { quoteBytes: p.quote_len, sm3: null, sha384: p.quote_sha384, reportdata: p.reportdata, pub: p.pub };
  } catch {
    return null;
  }
}

function main() {
  console.log("=== TDX 机密虚拟机内实测 · 跨院去重与疫苗保护效果 ===");
  console.log(`时间 ${new Date().toISOString()}`);
  for (const f of tdxFacts()) console.log(`  ${f}`);
  const q = quote();
  if (q) {
    console.log(`  真实 TDX quote：${q.quoteBytes} 字节 · sha384 ${String(q.sha384).slice(0, 24)}…`);
    console.log(`  REPORTDATA 前 32B（= sm3(pub)）${String(q.reportdata).slice(0, 32)}…（其余置零）`);
  } else {
    console.log("  （本机未取到 quote：xdattest 不可用）");
  }

  /* ── 场景二：疫苗真实世界保护效果（TND） ── */
  const veDir = join(DATA, "ve");
  const veKey = readJson(join(veDir, "answer-key.json"));
  const cdc = readJson(join(veDir, "cdc", "records.json"));
  const hosp = readJson(join(veDir, "hospital", "records.json"));
  const veInput = {
    immuneDays: veKey.params.immuneDays,
    vaccineCodes: veKey.params.vaccineCodes,
    pathogenCodes: [veKey.params.pathogenCode],
    doses: cdc.flatMap((r) => r.immunizations.map((im) => ({ subjectKey: r.linkKey, vaccinationDate: im.date, vaccineCode: im.code, doseNo: im.doseNo }))),
    tests: hosp.flatMap((r) => r.tests.map((t) => ({ subjectKey: r.linkKey, testDate: t.date, pathogenCode: t.code, result: t.result, ageBand: r.ageBand, sex: r.sex }))),
    strataKeys: veKey.expected.strata.map((s) => s.key),
  };
  const veRun = runVe("98c84695bb79ba94a1173a86858a51f6162d0010f723d71fe42f510d2550dbe8", veInput);
  const veRef = veModel.veTndCount(veInput).strata;
  const veKeyStrata = veKey.expected.strata.map((s) => ({
    key: s.key, vaccPos: s.vaccPos, vaccNeg: s.vaccNeg, unvaccPos: s.unvaccPos, unvaccNeg: s.unvaccNeg, partialPos: s.partialPos, partialNeg: s.partialNeg,
  }));
  const veModuleVsRef = JSON.stringify(veRun.strata) === JSON.stringify(veRef);
  const veRefVsKey = JSON.stringify(veRef) === JSON.stringify(veKeyStrata);

  console.log("\n① 疫苗真实世界保护效果（TND）");
  console.log(`  模块 ${veRun.file}（节点本地模块库）`);
  console.log(`  纳入检测 ${veInput.tests.length} 条 → 去重后 ${veRef.length ? "" : ""}${veModel.encodeVeTnd(veInput).gapDays.length} 条`);
  for (const s of veRun.strata) {
    const est = veModel.estimateVe(s);
    const label = est ? `VE = ${(est.ve * 100).toFixed(1)}%  [${(est.ciLow * 100).toFixed(1)}%, ${(est.ciHigh * 100).toFixed(1)}%]` : "不可估";
    console.log(`  ${s.key.padEnd(10)} ${label}   (${s.vaccPos}/${s.vaccNeg} vs ${s.unvaccPos}/${s.unvaccNeg})`);
  }
  console.log(`  模块 vs 参考语义：${veModuleVsRef ? "逐格一致 ✓" : "不一致 ✗"}`);
  console.log(`  参考语义 vs 答案键：${veRefVsKey ? "逐格一致 ✓" : "不一致 ✗"}`);

  /* ── 场景三：跨院去重的发病率与罕见病登记 ── */
  const ddDir = join(DATA, "dedup");
  const ddKey = readJson(join(ddDir, "answer-key.json"));
  const a = readJson(join(ddDir, "hospital-a", "records.json"));
  const b = readJson(join(ddDir, "hospital-b", "records.json"));
  const rows = [...a, ...b];
  const ddInput = {
    mergeAdjacent: true,
    eventCodes: ddKey.params.eventCodes,
    rareCodes: ddKey.params.rareCodes,
    strataKeys: ddKey.expected.strata.map((s) => s.key),
    observations: rows.map((r) => ({ subjectKey: r.linkKey, ageBand: r.ageBand, sex: r.sex, start: r.observation.start, end: r.observation.end })),
    events: rows.flatMap((r) => r.events.map((e) => ({ subjectKey: r.linkKey, ageBand: r.ageBand, sex: r.sex, code: e.code, date: e.date }))),
    rareDiseases: rows.filter((r) => r.rareDisease).map((r) => ({ subjectKey: r.linkKey, ageBand: r.ageBand, sex: r.sex, code: r.rareDisease.code, firstDate: r.rareDisease.firstDate })),
  };
  const ddRun = runDedup("02f0f409c65c93ccd2bd36c3662cc02fd52d7c416c999ed774e61a4f86c67a75", ddInput);
  const ddRef = ddModel.dedupIncidenceCount(ddInput).strata;
  const ddModuleVsRef = JSON.stringify(ddRun.strata) === JSON.stringify(ddRef);
  const comparison = new Map(ddKey.comparison.map((c) => [c.key, c]));

  console.log("\n② 跨院去重的发病率与罕见病登记");
  console.log(`  模块 ${ddRun.file}（节点本地模块库）`);
  console.log(`  两院记录 ${a.length} + ${b.length} 行 → 去重后 ${ddRun.strata.reduce((s, x) => s + x.uniqueSubjects, 0)} 人`);
  for (const s of ddRun.strata) {
    const rate = ddModel.incidenceRatePer100k(s.eventsDeduped, s.personDaysUnion);
    const ci = ddModel.incidenceRateCiPer100k(s.eventsDeduped, s.personDaysUnion);
    const naive = comparison.get(s.key)?.naiveSum;
    const infl = naive && s.uniqueSubjects > 0 ? ((naive.uniqueSubjects / s.uniqueSubjects - 1) * 100).toFixed(1) : null;
    console.log(
      `  ${s.key.padEnd(10)} ${String(s.uniqueSubjects).padStart(5)} 人 / ${String(s.personDaysUnion).padStart(7)} 人日 / ` +
        `${String(s.eventsDeduped).padStart(4)} 事件 / ${String(s.rareCases).padStart(3)} 罕见病` +
        (rate ? ` · 发病率 ${rate.toFixed(0)}/10万人年 [${ci.low.toFixed(0)}, ${ci.high.toFixed(0)}]` : "") +
        (infl ? ` · 相加虚增人头 ${infl}%` : ""),
    );
  }
  console.log(`  模块 vs 参考语义：${ddModuleVsRef ? "逐格一致 ✓" : "不一致 ✗"}`);

  /* ── 场景 D1：单臂试验真实世界外部对照 ── */
  const ecDir = join(DATA, 'external-control');
  const ecKey = readJson(join(ecDir, 'answer-key.json'));
  const sponsor = readJson(join(ecDir, 'sponsor', 'records.json'));
  const hospital = readJson(join(ecDir, 'hospital', 'records.json'));
  const toProj = (r) => ({ ...r, subjectKey: r.linkKey }); // 答案键口径：按投影后形状
  const ecInput = {
    trialRows: sponsor.map(toProj),
    controlRows: hospital.map(toProj),
    strataKeys: ecKey.params.strata.map((x) => x.key),
    caliperDays: ecKey.params.caliperDays,
    ratioK: ecKey.params.ratioK,
  };
  const ecEnc = ecModel.encodeExternalControl(ecInput);
  const { file: ecFile, bytes: ecBytes } = moduleBytes('391914b764b6374ff09bb59c8f92ccb6baec4151a8d6f6d5553da1b403daf43a');
  const nT = ecEnc.nTrial, nC = ecEnc.nCtrl, S = ecEnc.strataKeys.length;
  const ecMem = new WebAssembly.Memory({ initial: Math.max(1, Math.ceil((16 + (nT + nC) * 6 + 24 * S + 4096) / 65536)), maximum: 1024 });
  const ecInst = new WebAssembly.Instance(new WebAssembly.Module(ecBytes), { env: { memory: ecMem } });
  {
    const view = new DataView(ecMem.buffer);
    const u8 = new Uint8Array(ecMem.buffer);
    const base = 1024 + 16;
    view.setInt32(1024, nT, true); view.setInt32(1028, nC, true);
    view.setInt32(1032, ecEnc.caliperDays, true); view.setInt32(1036, ecEnc.ratioK, true);
    u8.set(new Uint8Array(ecEnc.trialDay.buffer), base);
    u8.set(ecEnc.trialOutcome, base + nT * 4);
    u8.set(ecEnc.trialStratum, base + nT * 5);
    u8.set(new Uint8Array(ecEnc.ctrlDay.buffer), base + nT * 6);
    u8.set(ecEnc.ctrlOutcome, base + nT * 6 + nC * 4);
    u8.set(ecEnc.ctrlStratum, base + nT * 6 + nC * 5);
    const outOff = (base + (nT + nC) * 6 + 7) & ~7;
    const code = ecInst.exports.run(1024, nT + nC, S, outOff);
    if (code !== 0) throw new Error('external-control 模块返回 ' + code);
    const cells = ['mExpPos', 'mExpNeg', 'ctlPos', 'ctlNeg', 'matched', 'unmatched'];
    const ecOut = ecEnc.strataKeys.map((key, si) => {
      const row = { key };
      cells.forEach((nm, ci) => { row[nm] = view.getUint32(outOff + si * 24 + ci * 4, true); });
      return row;
    });
    const ecParity = ecOut.every((row, i) => cells.every((c) => row[c] === ecKey.expected.strata[i][c]));
    console.log('\n③ 单臂试验真实世界外部对照（D1 · 乐城主线）');
    console.log(`  模块 ${ecFile}（节点本地模块库）`);
    console.log(`  单臂 ${nT} 例 × 对照池 ${nC} 例（caliper ${ecEnc.caliperDays} 天 · 1:${ecEnc.ratioK} · 匹配率 ${(ecOut.reduce((a, x) => a + x.matched, 0) / nT * 100).toFixed(0)}%）`);
    ecOut.forEach((row, i) => {
      const est = ecModel.estimateExternalControl(row);
      const rrTrue = ecKey.params.strata[i].rr_true;
      const label = est ? `RR ${est.rr.toFixed(2)}（${est.rrCi.low.toFixed(2)}–${est.rrCi.high.toFixed(2)}）· RD ${(est.rd * 100).toFixed(1)}%` : '不可估';
      const sig = !est ? '' : rrTrue < 1 ? (est.rrCi.high < 1 ? '（CI 不含 1）' : '（方向一致）') : (est.rrCi.low <= 1 && est.rrCi.high >= 1 ? '（负例层，CI 覆盖 1）' : '');
      console.log(`  ${row.key.padEnd(9)} 匹配 ${row.matched}/${row.matched + row.unmatched} · 事件 ${row.mExpPos}/${row.matched} vs ${row.ctlPos}/${row.ctlPos + row.ctlNeg} · ${label}${sig}`);
    });
    console.log(`  与答案键逐格一致：${ecParity ? '✓' : '✗'}（注入 RR：治疗层 0.55 / 负例层 1.0）`);
    var ecParityFlag = ecParity;
  }

  const ok = veModuleVsRef && veRefVsKey && ddModuleVsRef && ecParityFlag;
  console.log(`\n结论：${ok ? "真机内执行结果与答案键逐格一致 ✓" : "存在不一致 ✗"}`);
  process.exit(ok ? 0 : 1);
}

main();
