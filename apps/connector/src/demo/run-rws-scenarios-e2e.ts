/* eslint-disable no-console */
/**
 * 本地端到端：Synthea 合成数据 → **持有方封存投影** → **节点内真实 wasm 算子** →
 * **发布审查（含罕见病双阈值）** → **C3 出域载荷**，并落证据文件。
 *
 * 覆盖两个新场景：
 *  ① 疫苗真实世界保护效果（检测阴性设计 TND）：疾控接种 + 医院检测；
 *  ② 跨院去重的发病率与罕见病登记：两家医院队列 → 人头并集 / 观察期并集 / 事件去重 / 罕见病按人计数。
 *
 * 前置：`node scripts/build-ve-records.mjs` 与 `node scripts/build-dedup-records.mjs` 生成数据；
 *      `pnpm --filter @medtrust/wasm-algorithms build` 产出模块字节。
 * 运行：`pnpm --filter @medtrust/connector demo:rws-scenarios`
 *
 * 说明：本脚本**只跑本地链路**（不连 TDX 节点、不连平台），用途是给对外物料提供**真实运行画面**
 * （C2 → C3 的逐层计数、VE 与区间、发病率与区间、双阈值抑制明细）与可复核证据文件。
 * 全部数据为合成数据；效应量、跨院重复比例与罕见病率均为注入。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  estimateVe,
  incidenceRateCiPer100k,
  estimateExternalControl,
  incidenceRatePer100k,
  type VeTndStratum,
} from '@medtrust/wasm-algorithms';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { NodePublicationReview } from '../mdop/node/publication-review';
import {
  dedupCohortProjection,
  sponsorTrialProjection,
  hospitalControlProjection,
  veRegistryProjection,
  veTestProjection,
} from '../mdop/operators/seal';
import { NODE_DECLASSIFY_OP, registerNodeDeclassifyOperator } from '../tee-node/declassify-op';
import { NODE_WASM_OPS, registerNodeWasmOps } from '../tee-node/wasm-runner';

const REPO = path.resolve(__dirname, '../../../..');
const EVIDENCE_ROOT = path.join(REPO, 'openspec', 'changes');
const BUILD = path.join(REPO, 'packages', 'wasm-algorithms', 'build');

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const manifest = readJson(path.join(BUILD, 'manifest.json')) as {
  modules: Array<{ analysisType: string; file: string; sm3: string; sizeBytes: number }>;
};
const moduleOf = (analysisType: string) => {
  const entry = manifest.modules.find((m) => m.analysisType === analysisType);
  if (!entry) throw new Error(`清单缺模块：${analysisType}`);
  return {
    entry,
    digest: `sm3:${entry.sm3}`,
    bytes: new Uint8Array(fs.readFileSync(path.join(BUILD, entry.file))),
  };
};

const VE = moduleOf('ve-tnd');
const DEDUP = moduleOf('dedup-incidence');
const EC = moduleOf('external-control');

const MIN_CELL = 5;
const MIN_CELL_RARE = 10;

/**
 * 终端文本行直接从未取整的值格式化。证据 JSON 里存的是三到四位小数，再从它取一两位会二次取整
 * （RR 0.5246 → 0.525 → 0.53；区间上界 43.15% → 43.1%），与答案键、真机日志的末位对不上。
 */
const rawForText = {
  ve: new Map<string, NonNullable<ReturnType<typeof estimateVe>>>(),
  inflation: new Map<string, { uniqueSubjects: number | null; rareCases: number | null }>(),
  externalControl: new Map<string, NonNullable<ReturnType<typeof estimateExternalControl>>>(),
};
const CDC = 'urn:tds:sh-med:participant:p-cdc-demo';
const HOSP_A = 'urn:tds:sh-med:participant:p-huashan';
const HOSP_B = 'urn:tds:sh-med:participant:p-ruijin';
const TEE_NODE = 'urn:tds:sh-med:participant:tee-node-a';

const review = new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));

function wasmManifest(id: string, digest: string, schema: string, inputNames: string[]) {
  return {
    apiVersion: 'mdop/v1',
    kind: 'wasm',
    id,
    version: '1.0.0',
    category: 'collab',
    digest,
    publisher: 'urn:tds:sh-med:operator-registry',
    inputs: inputNames.map((name) => ({
      name,
      schema: 'mdop.projection/1.0',
      accept_labels: ['C2'],
    })),
    outputs: [{ name: id.replace('rws.', ''), schema, label_rule: 'inherit' }],
    params: {},
    environments: ['tee'],
    security: { network: 'none' },
    build: { source_digest: `sm3:${'a'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
  };
}

const systemManifest = (schema: string) => ({
  apiVersion: 'mdop/v1',
  kind: 'system',
  id: 'declassify.small_cell',
  version: '1.0.0',
  category: 'declassify',
  digest: 'component:node-publication-review@1',
  publisher: 'urn:tds:platform',
  inputs: [{ name: 'in', schema, accept_labels: ['C2'] }],
  outputs: [{ name: 'out', schema, label_rule: 'C3' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  component: 'node-publication-review@1.0.0',
});

/** 节点内算子阶段 → C2；随后降密阶段（发布审查 + 罕见病双阈值）→ C3。 */
async function runStageChain(options: {
  jobId: string;
  wasmOp: string;
  wasmBytes: Uint8Array;
  wasmSm3: string;
  manifestId: string;
  schema: string;
  params: Record<string, unknown>;
  parties: Array<{ ref: string; node: string }>;
  inputs: Record<string, unknown>;
}) {
  const executor = new MdopStageExecutor();
  registerNodeWasmOps(executor, {
    moduleBytes: (digest) => (digest === options.wasmSm3 ? options.wasmBytes : undefined),
  });
  registerNodeDeclassifyOperator(executor, {
    review,
    contractTerms: () => ({ publication: { minCell: MIN_CELL, minCellRare: MIN_CELL_RARE } }),
  });

  const c2 = await executor.execute(
    {
      jobId: options.jobId,
      stage: {
        id: 'op',
        node: TEE_NODE,
        op: options.wasmOp,
        op_digest: `sm3:${options.wasmSm3}`,
        params: { parties: options.parties, ...options.params },
        inputs: options.parties.map((p) => ({ from: p.ref })),
        input_labels: options.parties.map(() => 'C2'),
        output_label: 'C2',
        output_schema: options.schema,
      } as never,
      inputs: new Map(Object.entries(options.inputs)) as never,
      attempt: 1,
    },
    wasmManifest(options.manifestId, `sm3:${options.wasmSm3}`, options.schema, options.parties.map((p) => p.ref)) as never,
  );

  const c3 = await executor.execute(
    {
      jobId: options.jobId,
      stage: {
        id: 'decTee',
        node: TEE_NODE,
        op: NODE_DECLASSIFY_OP,
        op_digest: 'component:node-publication-review@1',
        params: { contractId: 'c-rws', minCell: MIN_CELL, minCellRare: MIN_CELL_RARE },
        inputs: [{ from: 'op' }],
        input_labels: ['C2'],
        output_label: 'C3',
        output_schema: options.schema,
      } as never,
      inputs: new Map([['op', c2.payload as unknown]]) as never,
      attempt: 1,
    },
    systemManifest(options.schema) as never,
  );
  return { c2: c2.payload as Record<string, unknown>, c3: c3.payload as Record<string, unknown>, c3Label: c3.label };
}

/** ① 疫苗真实世界保护效果（TND） */
async function runVeTnd() {
  const dir = path.join(REPO, 'data', 'demo', 've');
  const answerKey = readJson(path.join(dir, 'answer-key.json'));
  const vaccineCodes: string[] = answerKey.params.vaccineCodes;
  const pathogenCodes: string[] = [answerKey.params.pathogenCode];

  const cdcRaw = readJson(path.join(dir, 'cdc', 'records.json'));
  const hospRaw = readJson(path.join(dir, 'hospital', 'records.json'));

  // 持有方本地：最小投影（白名单过滤 + 同人同日重复检测去重）
  const cdcRows = veRegistryProjection({ rows: cdcRaw }, vaccineCodes).rows as unknown[];
  const hospRows = veTestProjection({ rows: hospRaw }, pathogenCodes).rows as unknown[];
  const rawTests = (hospRaw as Array<{ tests?: unknown[] }>).reduce((s, r) => s + (r.tests?.length ?? 0), 0);

  const { c2, c3 } = await runStageChain({
    jobId: 'local-ve-tnd',
    wasmOp: NODE_WASM_OPS.veTnd,
    wasmBytes: VE.bytes,
    wasmSm3: VE.entry.sm3,
    manifestId: 'rws.ve-tnd',
    schema: 'rws.ve-tnd/1.0',
    params: {
      roles: { registry: CDC, tests: HOSP_A },
      immuneDays: answerKey.params.immuneDays,
      vaccineCodes,
      pathogenCodes,
    },
    parties: [
      { ref: 'registry', node: CDC },
      { ref: 'tests', node: HOSP_A },
    ],
    inputs: { registry: { rows: cdcRows }, tests: { rows: hospRows } },
  });

  const strata = (c3.strata ?? []) as Array<VeTndStratum & { suppressed?: boolean; rareSuppressed?: boolean }>;
  const withVe = strata.map((s) => {
    if (s.suppressed) return { key: s.key, suppressed: true, ve: null, note: '被 minCell 抑制' };
    const est = estimateVe(s as VeTndStratum);
    if (est) rawForText.ve.set(String(s.key), est);
    return {
      key: s.key,
      vaccPos: s.vaccPos,
      vaccNeg: s.vaccNeg,
      unvaccPos: s.unvaccPos,
      unvaccNeg: s.unvaccNeg,
      partialPos: s.partialPos,
      partialNeg: s.partialNeg,
      ve: est ? Number(est.ve.toFixed(4)) : null,
      veCi: est ? [Number(est.ciLow.toFixed(4)), Number(est.ciHigh.toFixed(4))] : null,
      corrected: est ? est.corrected : null,
      note: est ? null : '不可估（已接种或未接种者无阳性）',
    };
  });

  return {
    scenario: 'vaccine-effectiveness-tnd',
    dataset: {
      syntheaPatients: answerKey.counts.syntheaPatients,
      registryPersons: answerKey.counts.registryPersons,
      rawTests,
      testsAfterProjection: hospRows.length,
      duplicatesRemoved: rawTests - hospRows.length,
    },
    operator: { id: 'rws.ve-tnd@1.0.0', wasm: VE.entry.file, sm3: VE.entry.sm3, sizeBytes: VE.entry.sizeBytes },
    thresholds: { minCell: MIN_CELL, minCellRare: MIN_CELL_RARE },
    c2: { strata: ((c2.strata as unknown[] | undefined) ?? []).length, buckets: c2.buckets },
    c3: { strata: withVe, buckets: c3.buckets },
    expected: answerKey.expected.strata,
  };
}

/** ② 跨院去重的发病率与罕见病登记 */
async function runDedupIncidence() {
  const dir = path.join(REPO, 'data', 'demo', 'dedup');
  const answerKey = readJson(path.join(dir, 'answer-key.json'));
  const eventCodes: string[] = answerKey.params.eventCodes;
  const rareCodes: string[] = answerKey.params.rareCodes;

  const aRaw = readJson(path.join(dir, 'hospital-a', 'records.json'));
  const bRaw = readJson(path.join(dir, 'hospital-b', 'records.json'));
  const aRows = dedupCohortProjection({ rows: aRaw }, eventCodes, rareCodes).rows as unknown[];
  const bRows = dedupCohortProjection({ rows: bRaw }, eventCodes, rareCodes).rows as unknown[];

  const { c2, c3 } = await runStageChain({
    jobId: 'local-dedup-incidence',
    wasmOp: NODE_WASM_OPS.dedupIncidence,
    wasmBytes: DEDUP.bytes,
    wasmSm3: DEDUP.entry.sm3,
    manifestId: 'rws.dedup-incidence',
    schema: 'rws.dedup-incidence/1.0',
    params: {
      roles: { cohorts: [HOSP_A, HOSP_B] },
      eventCodes,
      rareCodes,
      mergeAdjacent: true,
      strataKeys: answerKey.expected.strata.map((s: { key: string }) => s.key),
    },
    parties: [
      { ref: 'a', node: HOSP_A },
      { ref: 'b', node: HOSP_B },
    ],
    inputs: { a: { rows: aRows }, b: { rows: bRows } },
  });

  const strata = (c3.strata ?? []) as Array<{
    key: string;
    uniqueSubjects: number;
    personDaysUnion: number;
    eventsDeduped: number;
    rareCases: number;
    suppressed?: boolean;
    rareSuppressed?: boolean;
  }>;
  const comparison = new Map(
    (answerKey.comparison as Array<{ key: string }>).map((c) => [c.key, c as never]),
  );
  const withRates = strata.map((s) => {
    const naive = comparison.get(s.key) as
      | { naiveSum: { uniqueSubjects: number; personDays: number; events: number; rareCases: number } }
      | undefined;
    if (naive)
      rawForText.inflation.set(String(s.key), {
        uniqueSubjects: s.uniqueSubjects > 0 ? naive.naiveSum.uniqueSubjects / s.uniqueSubjects - 1 : null,
        rareCases: s.rareCases > 0 ? naive.naiveSum.rareCases / s.rareCases - 1 : null,
      });
    return {
      key: s.key,
      suppressed: s.suppressed ?? false,
      rareSuppressed: s.rareSuppressed ?? false,
      uniqueSubjects: s.uniqueSubjects,
      personDaysUnion: s.personDaysUnion,
      eventsDeduped: s.eventsDeduped,
      rareCases: s.rareCases,
      ratePer100k: incidenceRatePer100k(s.eventsDeduped, s.personDaysUnion),
      rateCiPer100k: incidenceRateCiPer100k(s.eventsDeduped, s.personDaysUnion),
      naiveSum: naive?.naiveSum ?? null,
      inflation: naive
        ? {
            uniqueSubjects:
              s.uniqueSubjects > 0
                ? Number((naive.naiveSum.uniqueSubjects / s.uniqueSubjects - 1).toFixed(4))
                : null,
            personDays:
              s.personDaysUnion > 0
                ? Number((naive.naiveSum.personDays / s.personDaysUnion - 1).toFixed(4))
                : null,
            rareCases:
              s.rareCases > 0 ? Number((naive.naiveSum.rareCases / s.rareCases - 1).toFixed(4)) : null,
          }
        : null,
    };
  });

  return {
    scenario: 'cross-hospital-dedup-incidence',
    dataset: {
      syntheaPatients: answerKey.counts.syntheaPatients,
      hospitalAPersons: answerKey.counts.hospitalAPersons,
      hospitalBPersons: answerKey.counts.hospitalBPersons,
      projectA: aRows.length,
      projectB: bRows.length,
      injectedDuplicateEvents: answerKey.counts.injected.duplicatedEvents,
      injectedOverlappingWindows: answerKey.counts.injected.overlappingWindows,
      injectedOneDayGapWindows: answerKey.counts.injected.oneDayGapWindows,
    },
    operator: {
      id: 'rws.dedup-incidence@1.0.0',
      wasm: DEDUP.entry.file,
      sm3: DEDUP.entry.sm3,
      sizeBytes: DEDUP.entry.sizeBytes,
    },
    thresholds: { minCell: MIN_CELL, minCellRare: MIN_CELL_RARE },
    c2: { buckets: c2.buckets, rareBuckets: c2.rareBuckets },
    c3: { strata: withRates, buckets: c3.buckets, rareBuckets: c3.rareBuckets },
  };
}

/** ③ 单臂试验真实世界外部对照（D1 · 乐城主线场景）。 */
async function runExternalControlScenario() {
  const dir = path.join(REPO, 'data', 'demo', 'external-control');
  const answerKey = readJson(path.join(dir, 'answer-key.json'));
  const caliperDays = answerKey.params.caliperDays as number;
  const ratioK = answerKey.params.ratioK as number;
  const strataKeys = (answerKey.params.strata as Array<{ key: string }>).map((x) => x.key);

  const sponsorRaw = readJson(path.join(dir, 'sponsor', 'records.json'));
  const hospitalRaw = readJson(path.join(dir, 'hospital', 'records.json'));
  const sponsorRows = sponsorTrialProjection({ rows: sponsorRaw }).rows as unknown[];
  const hospitalRows = hospitalControlProjection({ rows: hospitalRaw }).rows as unknown[];

  const SPONSOR = 'urn:tds:sh-med:participant:p-sponsor-demo';
  const HOSPITAL = 'urn:tds:sh-med:participant:p-hospital-a';
  const { c2, c3 } = await runStageChain({
    jobId: 'local-external-control',
    wasmOp: NODE_WASM_OPS.externalControl,
    wasmBytes: EC.bytes,
    wasmSm3: EC.entry.sm3,
    manifestId: 'rws.external-control',
    schema: 'rws.external-control/1.0',
    params: { roles: { trial: SPONSOR, controls: HOSPITAL }, caliperDays, ratioK, strataKeys },
    parties: [
      { ref: 'trial', node: SPONSOR },
      { ref: 'controls', node: HOSPITAL },
    ],
    inputs: { trial: { rows: sponsorRows }, controls: { rows: hospitalRows } },
  });

  const cells = ['mExpPos', 'mExpNeg', 'ctlPos', 'ctlNeg', 'matched', 'unmatched'] as const;
  const c2Strata = (c2.strata ?? []) as Array<Record<string, number | string>>;
  const parity = c2Strata.every((s, i) =>
    cells.every((c) => s[c] === (answerKey.expected.strata[i] as Record<string, unknown>)[c]),
  );
  const suppressed = new Set(
    (((c3.buckets ?? []) as Array<{ key: string; count: number }>)).filter((b) => b.count < MIN_CELL).map((b) => b.key),
  );
  const strata = c2Strata.map((s, i) => {
    const plan = (answerKey.params.strata as Array<{ key: string; rr_true: number }>)[i]!;
    const est = estimateExternalControl(s as never);
    if (est) rawForText.externalControl.set(String(s.key), est);
    return {
      key: s.key,
      rrTrue: plan.rr_true,
      matched: s.matched as number,
      unmatched: s.unmatched as number,
      trialEvents: s.mExpPos as number,
      controlEvents: s.ctlPos as number,
      controlN: ((s.ctlPos as number) + (s.ctlNeg as number)),
      suppressed: suppressed.has(s.key as string),
      estimate: est
        ? {
            rr: Number(est.rr.toFixed(3)),
            rrCi: [Number(est.rrCi.low.toFixed(3)), Number(est.rrCi.high.toFixed(3))],
            rd: Number(est.rd.toFixed(4)),
            rdCi: [Number(est.rdCi.low.toFixed(4)), Number(est.rdCi.high.toFixed(4))],
          }
        : null,
    };
  });
  return {
    scenario: 'external-control-arm',
    dataset: {
      trialSubjects: answerKey.counts.trialSubjects,
      controlPool: answerKey.counts.controlPool,
      caliperDays,
      ratioK,
      matchRate: Number((strata.reduce((a, x) => a + x.matched, 0) / answerKey.counts.trialSubjects).toFixed(3)),
    },
    operator: { id: 'rws.external-control@1.0.0', wasm: EC.entry.file, sm3: EC.entry.sm3, sizeBytes: EC.entry.sizeBytes },
    thresholds: { minCell: MIN_CELL },
    strata,
    parityWithAnswerKey: parity,
  };
}

function est_text(st: { key: unknown; rrTrue: number }): string {
  const est = rawForText.externalControl.get(String(st.key));
  if (!est) return '不可估';
  const { low, high } = est.rrCi;
  const sig = low < 1 && high < 1 ? '（CI 不含 1）' : st.rrTrue === 1 ? '（负例层，CI 覆盖 1）' : '（CI 含 1）';
  return `RR ${est.rr.toFixed(2)}（${low.toFixed(2)}–${high.toFixed(2)}）· RD ${(est.rd * 100).toFixed(1)}% ${sig}`;
}

async function main() {
  const startedAt = new Date().toISOString();
  const ve = await runVeTnd();
  const dedup = await runDedupIncidence();
  const ec = await runExternalControlScenario();

  const stamp = startedAt.slice(0, 10).replace(/-/g, '');
  const outDirs = {
    ve: path.join(EVIDENCE_ROOT, 'vaccine-effectiveness-tnd', 'evidence', `local-run-${stamp}`),
    dedup: path.join(EVIDENCE_ROOT, 'cross-hospital-dedup-incidence', 'evidence', `local-run-${stamp}`),
  };
  for (const dir of Object.values(outDirs)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(outDirs.ve, 've-tnd-run.json'), JSON.stringify(ve, null, 2) + '\n');
  fs.writeFileSync(path.join(outDirs.dedup, 'dedup-incidence-run.json'), JSON.stringify(dedup, null, 2) + '\n');
  const drDir = path.join(EVIDENCE_ROOT, '..', '..', 'pitch', 'dr-showcase-20261003');
  fs.mkdirSync(drDir, { recursive: true });
  fs.writeFileSync(path.join(drDir, 'external-control-run.json'), JSON.stringify(ec, null, 2) + '\n');

  const lines: string[] = [];
  lines.push(`本地端到端运行 @ ${startedAt}`);
  lines.push(`模块：${VE.entry.file} SM3=${VE.entry.sm3}（${VE.entry.sizeBytes}B）`);
  lines.push('');
  lines.push('① 疫苗真实世界保护效果（TND）');
  lines.push(
    `   数据：Synthea ${ve.dataset.syntheaPatients} 人 / 受种者 ${ve.dataset.registryPersons} / ` +
      `检测 ${ve.dataset.rawTests} 条 → 封存投影后 ${ve.dataset.testsAfterProjection} 条` +
      `（同人同日重复 ${ve.dataset.duplicatesRemoved} 条被本地去重）`,
  );
  lines.push(`   C2 → C3：${(ve.c3.strata as unknown[]).length} 个分层`);
  for (const s of ve.c3.strata as Array<Record<string, unknown>>) {
    if (s.suppressed) lines.push(`   ${String(s.key).padEnd(10)} 被 minCell=${MIN_CELL} 抑制`);
    else if (s.ve === null)
      lines.push(`   ${String(s.key).padEnd(10)} 不可估（${String(s.note)}）`);
    else {
      const raw = rawForText.ve.get(String(s.key))!;
      const ci = [raw.ciLow, raw.ciHigh].map((v) => `${(v * 100).toFixed(1)}%`).join(' ~ ');
      lines.push(
        `   ${String(s.key).padEnd(10)} VE = ${(raw.ve * 100).toFixed(1)}%  95% CI [${ci}]` +
          `  （${String(s.vaccPos)}/${String(s.vaccNeg)} vs ${String(s.unvaccPos)}/${String(s.unvaccNeg)}）`,
      );
    }
  }
  lines.push('');
  lines.push('② 跨院去重的发病率与罕见病登记');
  lines.push(
    `   数据：甲院 ${dedup.dataset.hospitalAPersons} 人 / 乙院 ${dedup.dataset.hospitalBPersons} 人；` +
      `注入跨院重复事件 ${dedup.dataset.injectedDuplicateEvents} 起、重叠观察期 ${dedup.dataset.injectedOverlappingWindows} 例、` +
      `空 1 天 ${dedup.dataset.injectedOneDayGapWindows} 例`,
  );
  for (const s of dedup.c3.strata as Array<Record<string, unknown>>) {
    const rate = s.ratePer100k as number | null;
    const ci = s.rateCiPer100k as { low: number; high: number } | null;
    const infl = rawForText.inflation.get(String(s.key)) ?? null;
    lines.push(
      `   ${String(s.key).padEnd(10)} 去重 ${String(s.uniqueSubjects)} 人 / ${String(s.personDaysUnion)} 人日 / ` +
        `${String(s.eventsDeduped)} 事件 / ${String(s.rareCases)} 罕见病例` +
        (s.rareSuppressed ? `（罕见病列被 minCellRare=${MIN_CELL_RARE} 抑制）` : '') +
        (rate !== null && ci
          ? `\n              粗发病率 ${rate.toFixed(1)}/10 万人年（95% CI ${ci.low.toFixed(1)} ~ ${ci.high.toFixed(1)}）`
          : ''),
    );
    if (infl && infl.uniqueSubjects !== null)
      lines.push(
        `              直接相加会虚增：人头 ${(infl.uniqueSubjects * 100).toFixed(1)}%` +
          (infl.rareCases !== null ? `、罕见病 ${(infl.rareCases * 100).toFixed(1)}%` : ''),
      );
  }
  lines.push('');
  lines.push(`证据：${path.relative(REPO, outDirs.ve)}/ve-tnd-run.json`);
  lines.push('');
  lines.push('③ 单臂试验真实世界外部对照（D1 · 乐城主线）');
  lines.push(
    `   数据：单臂试验 ${ec.dataset.trialSubjects} 例 × 医院对照池 ${ec.dataset.controlPool} 例` +
      `（caliper ${ec.dataset.caliperDays} 天 · 1:${ec.dataset.ratioK} 匹配 · 匹配率 ${(ec.dataset.matchRate * 100).toFixed(0)}%）`,
  );
  for (const st of ec.strata) {
    const est = est_text(st);
    lines.push(
      `   ${String(st.key).padEnd(9)} 匹配 ${st.matched}/${st.matched + st.unmatched} · 事件 ${st.trialEvents}/${st.matched} vs ${st.controlEvents}/${st.controlN}` +
        (st.suppressed ? '（被 minCell 抑制）' : ` · ${est}`),
    );
  }
  lines.push(`   与答案键逐格一致：${ec.parityWithAnswerKey ? '✓' : '✗'}（注入 RR：治疗层 0.55 / 负例层 1.0）`);
  lines.push('');
  lines.push(`证据：${path.relative(REPO, outDirs.dedup)}/dedup-incidence-run.json`);
  lines.push(`证据：pitch/dr-showcase-20261003/external-control-run.json`);
  const report = lines.join('\n');
  fs.writeFileSync(path.join(outDirs.ve, 'run.log'), report + '\n');
  fs.writeFileSync(path.join(outDirs.dedup, 'run.log'), report + '\n');
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
