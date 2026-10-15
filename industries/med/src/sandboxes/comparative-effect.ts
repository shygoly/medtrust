// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * `rws.comparative-effect@1.0.0` 的节点侧执行。
 *
 * 暴露/结局/分层的判定留在行业包（与 legacy 同一套匹配）。效应量和标准误由定点 wasm
 * 模块算出（Q16.16，与 `siteEffectQ16` 逐字段一致）。分层四格也由模块计数，
 * Mantel–Haenszel 用既有浮点函数在这些格子上重算。
 */
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";
import {
  SITE_EFFECT_Q,
  decodeSiteEffect,
  encodeSiteEffect,
} from "@medtrust/wasm-algorithms";
import type { InternalRecord } from "../records/internal-record";
import {
  matchesAdverseEvent,
  matchesCondition,
  matchesMedication,
} from "../analysis/clinical-matching";
import { mantelHaenszelPooledOr, type StratifyField } from "../analysis/comparative-effect";

export interface ComparativeEffectColumns {
  exposed: number[];
  event: number[];
  stratum: number[];
  k: number;
  keys: string[];
}

export function columnsForComparativeEffect(
  rows: readonly Partial<InternalRecord>[],
  drug: string,
  outcome: string,
  outcomeKind: "adverse_event" | "condition",
  stratifyBy: readonly StratifyField[],
): ComparativeEffectColumns {
  const keyOf = (row: Partial<InternalRecord>) =>
    stratifyBy
      .map((field) => (field === "sex" ? row.sex ?? "未知" : row.ageBand ?? "未知"))
      .join("|");
  const keys = [...new Set(rows.map(keyOf))].sort((a, b) => a.localeCompare(b));
  const index = new Map(keys.map((key, i) => [key, i]));
  const exposed: number[] = [];
  const event: number[] = [];
  const stratum: number[] = [];
  for (const row of rows) {
    const record = {
      subjectKey: "",
      ageBand: row.ageBand ?? "未知",
      sex: row.sex,
      conditions: row.conditions ?? [],
      medications: row.medications ?? [],
      adverseEvents: row.adverseEvents ?? [],
    } satisfies InternalRecord;
    exposed.push(matchesMedication(record.medications, drug) ? 1 : 0);
    const hit =
      outcomeKind === "condition"
        ? matchesCondition(record.conditions, outcome)
        : matchesAdverseEvent(record.adverseEvents, outcome);
    event.push(hit ? 1 : 0);
    stratum.push(index.get(keyOf(row)) ?? 0);
  }
  return { exposed, event, stratum, k: Math.max(keys.length, 1), keys };
}

/** 分层人数低于阈值的层不进入效应量，也不带出该层人数。 */
export function gateComparativeEffectColumns(
  columns: ComparativeEffectColumns,
  minCell: number,
): { columns: ComparativeEffectColumns; dropped: string[] } {
  if (minCell < 1) return { columns, dropped: [] };
  const counts = Array.from({ length: columns.k }, () => 0);
  for (const index of columns.stratum) counts[index] += 1;
  const keys: string[] = [];
  const dropped: string[] = [];
  const remap = new Map<number, number>();
  columns.keys.forEach((key, index) => {
    if (counts[index] >= minCell) {
      remap.set(index, keys.length);
      keys.push(key);
    } else {
      dropped.push(key);
    }
  });
  const exposed: number[] = [];
  const event: number[] = [];
  const stratum: number[] = [];
  for (let i = 0; i < columns.exposed.length; i++) {
    const next = remap.get(columns.stratum[i]);
    if (next === undefined) continue;
    exposed.push(columns.exposed[i]);
    event.push(columns.event[i]);
    stratum.push(next);
  }
  return { columns: { exposed, event, stratum, k: keys.length, keys }, dropped };
}

export const comparativeEffectStageSandbox: StageSandbox = {
  opRef: "rws.comparative-effect@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params ?? {};
    const drug = typeof params.drug === "string" ? params.drug : "";
    const outcome = typeof params.outcome === "string" ? params.outcome : "";
    const outcomeKind = params.outcomeKind === "condition" ? "condition" : "adverse_event";
    const stratifyBy = Array.isArray(params.stratifyBy)
      ? (params.stratifyBy.filter((field) => field === "ageBand" || field === "sex") as StratifyField[])
      : (["ageBand"] as StratifyField[]);
    const minCell = typeof params.minCell === "number" && params.minCell >= 1 ? params.minCell : 0;
    const tables = host.tables(host.stageInput);
    if (tables.length !== 1) {
      throw new Error(`比较效果阶段只接受本节点一份队列（收到 ${tables.length} 份）`);
    }
    const rows = tables[0].rows as Array<Partial<InternalRecord>>;
    if (rows.length === 0) throw new Error("比较效果阶段没有行");
    const columns = columnsForComparativeEffect(rows, drug, outcome, outcomeKind, stratifyBy);
    const gated = gateComparativeEffectColumns(columns, minCell);
    const droppedBuckets = gated.dropped.map((key) => ({
      key,
      count: 0,
      n: 0,
      suppressed: true,
    }));
    if (gated.columns.exposed.length === 0) {
      return {
        schema: stageInput.stage.output_schema,
        payload: {
          analysisType: "comparative-effect",
          cohortSize: 0,
          outcome,
          minCell,
          suppressed: true,
          buckets: droppedBuckets,
        },
      };
    }
    const encoded = encodeSiteEffect(gated.columns);
    const ran = await host.runSandbox({
      analysisType: "comparative-effect",
      input: encoded.input,
      abi: "site-effect@1",
      n: encoded.n,
      k: encoded.k,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
    });
    const fitted = decodeSiteEffect(ran.output, gated.columns.k);
    const q = SITE_EFFECT_Q;
    const mh = mantelHaenszelPooledOr(
      fitted.cells.map((cell) => ({ a: cell.a, b: cell.b, c: cell.c, d: cell.d })),
    );
    const keptBuckets = gated.columns.keys.map((key, i) => {
      const cell = fitted.cells[i] ?? { a: 0, b: 0, c: 0, d: 0 };
      const total = cell.a + cell.b + cell.c + cell.d || 1;
      return {
        key,
        count: cell.a,
        n: cell.a + cell.b + cell.c + cell.d,
        rate: +(cell.a / total).toFixed(4),
        b: cell.b,
        c: cell.c,
        d: cell.d,
        suppressed: false,
      };
    });
    return {
      schema: stageInput.stage.output_schema,
      payload: {
        analysisType: "comparative-effect",
        cohortSize: gated.columns.exposed.length,
        outcome,
        ...(minCell >= 1 ? { minCell } : {}),
        suppressed: false,
        buckets: [...keptBuckets, ...droppedBuckets],
        effectEstimate: {
          measure: "log_or",
          method: fitted.method === 1 ? "firth" : "logistic",
          beta: fitted.logOrQ / q,
          standardError: fitted.seQ / q,
          covariance: [
            [fitted.cov00Q / q, fitted.cov01Q / q],
            [fitted.cov01Q / q, fitted.cov11Q / q],
          ],
          ci95: [fitted.ci0Q / q, fitted.ci1Q / q],
          mantelHaenszel: {
            logOr: +mh.logOr.toFixed(6),
            or: +mh.or.toFixed(6),
            standardError: +mh.standardError.toFixed(6),
            ci95: mh.ci95.map((x) => +x.toFixed(6)),
          },
        },
      },
    };
  },
};
