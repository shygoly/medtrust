// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * `rws.causal-psm@1.0.0` 的节点侧执行。
 *
 * 暴露臂、对照臂和结局的判定留在行业包。配对或加权在定点模块里完成，
 * 出域只有平均处理效应和标准误。低于最小格的层不进入效应量。
 */
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";
import {
  CAUSAL_ATE_Q,
  decodeCausalAte,
  encodeCausalAte,
} from "@medtrust/wasm-algorithms";
import type { InternalRecord } from "../records/internal-record";
import {
  matchesAdverseEvent,
  matchesCondition,
  matchesMedication,
} from "../analysis/clinical-matching";
import type { StratifyField } from "../analysis/comparative-effect";

export interface CausalPsmColumns {
  treated: number[];
  outcome: number[];
  stratum: number[];
  k: number;
  keys: string[];
}

export function columnsForCausalPsm(
  rows: readonly Partial<InternalRecord>[],
  drug: string,
  comparator: string,
  outcome: string,
  outcomeKind: "adverse_event" | "condition",
  stratifyBy: readonly StratifyField[],
): CausalPsmColumns {
  const kept: Array<Partial<InternalRecord>> = [];
  for (const row of rows) {
    const meds = row.medications ?? [];
    const onDrug = matchesMedication(meds, drug);
    const onComparator = matchesMedication(meds, comparator);
    if (onDrug === onComparator) continue;
    kept.push(row);
  }
  const keyOf = (row: Partial<InternalRecord>) =>
    stratifyBy
      .map((field) => (field === "sex" ? row.sex ?? "未知" : row.ageBand ?? "未知"))
      .join("|");
  const keys = [...new Set(kept.map(keyOf))].sort((a, b) => a.localeCompare(b));
  const index = new Map(keys.map((key, i) => [key, i]));
  const treated: number[] = [];
  const outcomeCol: number[] = [];
  const stratum: number[] = [];
  for (const row of kept) {
    const record = {
      subjectKey: "",
      ageBand: row.ageBand ?? "未知",
      sex: row.sex,
      conditions: row.conditions ?? [],
      medications: row.medications ?? [],
      adverseEvents: row.adverseEvents ?? [],
    } satisfies InternalRecord;
    treated.push(matchesMedication(record.medications, drug) ? 1 : 0);
    const hit =
      outcomeKind === "condition"
        ? matchesCondition(record.conditions, outcome)
        : matchesAdverseEvent(record.adverseEvents, outcome);
    outcomeCol.push(hit ? 1 : 0);
    stratum.push(index.get(keyOf(row)) ?? 0);
  }
  return { treated, outcome: outcomeCol, stratum, k: Math.max(keys.length, 1), keys };
}

export const causalPsmStageSandbox: StageSandbox = {
  opRef: "rws.causal-psm@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params ?? {};
    const drug = typeof params.drug === "string" ? params.drug : "";
    const comparator = typeof params.comparator === "string" ? params.comparator : "";
    const outcome = typeof params.outcome === "string" ? params.outcome : "";
    const outcomeKind = params.outcomeKind === "condition" ? "condition" : "adverse_event";
    const method = params.method === "iptw" ? 0 : 1;
    const minCell = typeof params.minCell === "number" && params.minCell >= 1 ? params.minCell : 5;
    const stratifyBy = Array.isArray(params.stratifyBy)
      ? (params.stratifyBy.filter((field) => field === "ageBand" || field === "sex") as StratifyField[])
      : (["ageBand", "sex"] as StratifyField[]);
    const tables = host.tables(host.stageInput);
    if (tables.length !== 1) {
      throw new Error(`因果阶段只接受本节点一份队列（收到 ${tables.length} 份）`);
    }
    const rows = tables[0].rows as Array<Partial<InternalRecord>>;
    if (rows.length === 0) throw new Error("因果阶段没有行");
    const columns = columnsForCausalPsm(rows, drug, comparator, outcome, outcomeKind, stratifyBy);
    if (columns.treated.length === 0) throw new Error("因果阶段没有落在暴露臂或对照臂上的行");
    const encoded = encodeCausalAte({
      method,
      minCell,
      treated: columns.treated,
      outcome: columns.outcome,
      stratum: columns.stratum,
      k: columns.k,
    });
    const ran = await host.runSandbox({
      analysisType: "causal-psm",
      input: encoded.input,
      abi: "causal-ate@1",
      n: encoded.n,
      k: encoded.k,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
    });
    const fitted = decodeCausalAte(ran.output);
    const payload: Record<string, unknown> = {
      analysisType: "causal-psm",
      cohortSize: columns.treated.length,
      method: fitted.method === 0 ? "iptw" : "psm",
      suppressed: fitted.suppressed === 1,
    };
    if (fitted.suppressed === 0) {
      payload.effectEstimate = {
        measure: "ate",
        method: fitted.method === 0 ? "iptw" : "psm",
        beta: fitted.ateQ / CAUSAL_ATE_Q,
        standardError: fitted.seQ / CAUSAL_ATE_Q,
      };
    }
    return { schema: stageInput.stage.output_schema, payload };
  },
};
