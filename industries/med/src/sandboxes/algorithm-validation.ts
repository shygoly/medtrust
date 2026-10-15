// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * `rws.algorithm-validation@1.0.0` 的节点侧执行。
 *
 * 标签和分数留在本节点。AUC、校准箱和决策曲线由定点模块计算。
 * 样本量、校准箱或某一阈值的预测阳性数低于阈值时，该指标不带出人数。
 */
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";
import {
  VALIDATION_Q,
  decodeValidationMetrics,
  encodeValidationMetrics,
} from "@medtrust/wasm-algorithms";

export interface ScoreLabelColumns {
  label: number[];
  score: number[];
}

function readScore(row: Record<string, unknown>, scoreField: string): number | undefined {
  if (typeof row.score === "number") return row.score;
  const obs = row.observations;
  if (obs && typeof obs === "object" && typeof (obs as Record<string, unknown>)[scoreField] === "number") {
    return (obs as Record<string, number>)[scoreField];
  }
  return typeof row[scoreField] === "number" ? (row[scoreField] as number) : undefined;
}

function readLabel(row: Record<string, unknown>, labelField: string): number {
  if (typeof row.label === "number") return row.label === 1 ? 1 : 0;
  const raw = row[labelField];
  return raw === true || raw === 1 ? 1 : 0;
}

export function columnsForAlgorithmValidation(
  rows: readonly Record<string, unknown>[],
  scoreField: string,
  labelField: string,
): ScoreLabelColumns {
  const label: number[] = [];
  const score: number[] = [];
  for (const row of rows) {
    const value = readScore(row, scoreField);
    if (value === undefined || value < 0 || value > 1) {
      throw new Error("校验分数必须落在 0 到 1");
    }
    label.push(readLabel(row, labelField));
    score.push(Math.round(value * VALIDATION_Q));
  }
  return { label, score };
}

export const algorithmValidationStageSandbox: StageSandbox = {
  opRef: "rws.algorithm-validation@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params ?? {};
    const scoreField = typeof params.scoreField === "string" && params.scoreField ? params.scoreField : "score";
    const labelField = typeof params.labelField === "string" && params.labelField ? params.labelField : "eventOccurred";
    const minCell = typeof params.minCell === "number" && params.minCell >= 1 ? params.minCell : 5;
    const tables = host.tables(host.stageInput);
    if (tables.length !== 1) {
      throw new Error(`校验阶段只接受本节点一份队列（收到 ${tables.length} 份）`);
    }
    const rows = tables[0].rows as Array<Record<string, unknown>>;
    if (rows.length === 0) throw new Error("校验阶段没有行");
    const columns = columnsForAlgorithmValidation(rows, scoreField, labelField);
    const encoded = encodeValidationMetrics({ minCell, label: columns.label, score: columns.score });
    const ran = await host.runSandbox({
      analysisType: "algorithm-validation",
      input: encoded.input,
      abi: "validation-metrics@1",
      n: encoded.n,
      k: encoded.k,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
    });
    const fitted = decodeValidationMetrics(ran.output);
    const payload: Record<string, unknown> = {
      analysisType: "algorithm-validation",
      cohortSize: columns.label.length,
      suppressed: fitted.suppressed === 1,
      minCell,
      calibration: fitted.calibration.map((bin, index) => ({
        bin: index,
        n: bin.n,
        events: bin.events,
        meanScore: bin.suppressed === 1 ? 0 : bin.meanQ / VALIDATION_Q,
        suppressed: bin.suppressed === 1,
      })),
      decisionCurve: fitted.decision.map((point) => ({
        threshold: point.threshold / 10,
        netBenefit: point.suppressed === 1 ? 0 : point.netBenefitQ / VALIDATION_Q,
        suppressed: point.suppressed === 1,
      })),
    };
    if (fitted.suppressed === 0) {
      payload.effectEstimate = {
        measure: "auc",
        beta: fitted.aucQ / VALIDATION_Q,
        standardError: fitted.seQ / VALIDATION_Q,
        nPos: fitted.nPos,
        nNeg: fitted.nNeg,
      };
    }
    return { schema: stageInput.stage.output_schema, payload };
  },
};
