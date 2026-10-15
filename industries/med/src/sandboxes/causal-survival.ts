// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * `rws.causal-survival@1.0.0` 的节点侧执行。
 *
 * 暴露臂、对照臂和结局留在行业包。Cox 与分箱生存曲线由定点模块计算。
 * 在险人数低于阈值的箱不交出生存率，也不交出真实人数。
 */
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";
import {
  SURVIVAL_EFFECT_Q,
  decodeSurvivalEffect,
  encodeSurvivalEffect,
} from "@medtrust/wasm-algorithms";
import type { InternalRecord } from "../records/internal-record";
import {
  matchesAdverseEvent,
  matchesCondition,
  matchesMedication,
} from "../analysis/clinical-matching";

export interface SurvivalColumns {
  treated: number[];
  event: number[];
  duration: number[];
}

const DEFAULT_FOLLOW_UP_DAYS = 365;

export function columnsForCausalSurvival(
  rows: readonly Partial<InternalRecord>[],
  drug: string,
  comparator: string,
  outcome: string,
  outcomeKind: "adverse_event" | "condition",
): SurvivalColumns {
  const treated: number[] = [];
  const event: number[] = [];
  const duration: number[] = [];
  for (const row of rows) {
    const meds = row.medications ?? [];
    const onDrug = matchesMedication(meds, drug);
    const onComparator = matchesMedication(meds, comparator);
    if (onDrug === onComparator) continue;
    const record = {
      subjectKey: "",
      ageBand: row.ageBand ?? "未知",
      sex: row.sex,
      conditions: row.conditions ?? [],
      medications: row.medications ?? [],
      adverseEvents: row.adverseEvents ?? [],
    } satisfies InternalRecord;
    const hit =
      outcomeKind === "condition"
        ? matchesCondition(record.conditions, outcome)
        : matchesAdverseEvent(record.adverseEvents, outcome);
    const days = row.followUpDays;
    treated.push(onDrug ? 1 : 0);
    event.push(hit ? 1 : 0);
    duration.push(typeof days === "number" && Number.isInteger(days) ? days : DEFAULT_FOLLOW_UP_DAYS);
  }
  return { treated, event, duration };
}

export const causalSurvivalStageSandbox: StageSandbox = {
  opRef: "rws.causal-survival@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params ?? {};
    const drug = typeof params.drug === "string" ? params.drug : "";
    const comparator = typeof params.comparator === "string" ? params.comparator : "";
    const outcome = typeof params.outcome === "string" ? params.outcome : "";
    const outcomeKind = params.outcomeKind === "condition" ? "condition" : "adverse_event";
    const minCell = typeof params.minCell === "number" && params.minCell >= 1 ? params.minCell : 5;
    const binWidth =
      typeof params.binWidthDays === "number" && params.binWidthDays >= 1 ? params.binWidthDays : 30;
    const tables = host.tables(host.stageInput);
    if (tables.length !== 1) {
      throw new Error(`生存分析阶段只接受本节点一份队列（收到 ${tables.length} 份）`);
    }
    const rows = tables[0].rows as Array<Partial<InternalRecord>>;
    if (rows.length === 0) throw new Error("生存分析阶段没有行");
    const columns = columnsForCausalSurvival(rows, drug, comparator, outcome, outcomeKind);
    if (columns.treated.length === 0) throw new Error("生存分析阶段没有落在暴露臂或对照臂上的行");
    const encoded = encodeSurvivalEffect({
      minCell,
      binWidth,
      treated: columns.treated,
      event: columns.event,
      duration: columns.duration,
    });
    const ran = await host.runSandbox({
      analysisType: "causal-survival",
      input: encoded.input,
      abi: "survival-effect@1",
      n: encoded.n,
      k: encoded.k,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
    });
    const fitted = decodeSurvivalEffect(ran.output);
    const payload: Record<string, unknown> = {
      analysisType: "causal-survival",
      cohortSize: columns.treated.length,
      suppressed: fitted.suppressed === 1,
      kmCurve: {
        binWidthDays: binWidth,
        minCell,
        bins: fitted.bins.map((bin) => ({
          t: bin.t,
          survival: bin.suppressed === 1 ? 0 : bin.survQ / SURVIVAL_EFFECT_Q,
          atRisk: bin.atRisk,
          ...(bin.suppressed === 1 ? { suppressed: true } : {}),
        })),
      },
    };
    if (fitted.suppressed === 0) {
      payload.effectEstimate = {
        measure: "log_hr",
        method: "cox",
        beta: fitted.logHrQ / SURVIVAL_EFFECT_Q,
        standardError: fitted.seQ / SURVIVAL_EFFECT_Q,
      };
    }
    return { schema: stageInput.stage.output_schema, payload };
  },
};
