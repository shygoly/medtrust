// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";
import {
  decodeRegistrationKernel,
  encodeRegistrationKernel,
  externalControlRegistrationReference,
  prepareExternalControlRegistration,
  type ExternalControlRegistrationInput,
  type ExternalControlRegistrationRow,
  type RegistrationEffectMeasure,
  type RegistrationMissingness,
} from "@medtrust/wasm-algorithms";

const DEFAULT_COVARIATES = [
  "age",
  "severity",
  "diseaseDuration",
  "comorbidityIndex",
  "priorTreatment",
  "keyBiomarker",
  "calendarYear",
] as const;

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${name} must be a non-empty string array`);
  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim() || /[\u0000-\u001f\u007f]/.test(item))
      throw new Error(`${name} contains an invalid column`);
    const normalized = item.trim();
    if (seen.has(normalized)) throw new Error(`${name} contains a duplicate column`);
    seen.add(normalized);
    return normalized;
  });
}

function roles(value: unknown): {
  bindings: Record<string, string>;
  trial: string;
  controlRoles: string[];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("registration operator requires explicit trial/controls role bindings");
  const raw = value as Record<string, unknown>;
  if (typeof raw.trial !== "string")
    throw new Error("registration roles must bind trial and controls");
  const controls = Array.isArray(raw.controls) ? raw.controls : [raw.controls];
  if (
    controls.length < 1 ||
    controls.length > 2 ||
    !controls.every((item) => typeof item === "string" && item.startsWith("urn:"))
  )
    throw new Error("registration roles.controls must bind one or two participant URNs");
  const controlRoles = controls.map((_, index) =>
    index === 0 ? "controlsPrimary" : "controlsSecondary",
  );
  return {
    bindings: {
      trial: raw.trial,
      ...Object.fromEntries(
        controlRoles.map((role, index) => [role, controls[index] as string]),
      ),
    },
    trial: raw.trial,
    controlRoles,
  };
}

function study(value: unknown): ExternalControlRegistrationInput["study"] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("registration study profile is required");
  const raw = value as Record<string, unknown>;
  for (const field of ["profileVersion", "timeZero", "estimandSapVersion"])
    if (typeof raw[field] !== "string" || !(raw[field] as string).trim())
      throw new Error(`registration study.${field} is required`);
  return {
    profileVersion: (raw.profileVersion as string).trim(),
    timeZero: (raw.timeZero as string).trim(),
    estimandSapVersion: (raw.estimandSapVersion as string).trim(),
  };
}

export const externalControlRegistrationSandbox: StageSandbox = {
  opRef: "rws.external-control-registration@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params ?? {};
    const roleBindings = roles(params.roles);
    const rowsByRole = host.rowsByRole(
      stageInput,
      roleBindings.bindings,
      "rws.external-control-registration",
    );
    const trialRows = (rowsByRole.get("trial") ?? []) as ExternalControlRegistrationRow[];
    const controlRows = roleBindings.controlRoles.flatMap(
      (role) => (rowsByRole.get(role) ?? []) as ExternalControlRegistrationRow[],
    );
    if (trialRows.length === 0 || controlRows.length === 0)
      throw new Error("registration operator requires non-empty trial and control projections");

    const effectRaw = params.effectMeasure ?? "risk-ratio";
    if (effectRaw !== "risk-ratio" && effectRaw !== "risk-difference")
      throw new Error("registration effectMeasure must be risk-ratio or risk-difference");
    const effectMeasure = effectRaw;
    const missingness = params.missingness;
    if (missingness !== "MCAR" && missingness !== "MAR" && missingness !== "MNAR")
      throw new Error("registration missingness must be MCAR, MAR, or MNAR");
    const synthetic = params.synthetic === true;
    if (params.synthetic !== undefined && typeof params.synthetic !== "boolean")
      throw new Error("registration synthetic must be boolean");
    const truthRr = params.truthRr;
    if (synthetic && !(typeof truthRr === "number" && truthRr > 0))
      throw new Error("synthetic registration stages require a positive answer-key RR");

    const input: ExternalControlRegistrationInput = {
      trialRows,
      controlRows,
      covariates: stringArray(params.covariates ?? [...DEFAULT_COVARIATES], "covariates"),
      effectMeasure: effectMeasure as RegistrationEffectMeasure,
      missingness: missingness as RegistrationMissingness,
      synthetic,
      ...(typeof truthRr === "number" ? { truthRr } : {}),
      study: study(params.study),
      ...(typeof params.trimLow === "number" ? { trimLow: params.trimLow } : {}),
      ...(typeof params.trimHigh === "number" ? { trimHigh: params.trimHigh } : {}),
      ...(typeof params.maxWeight === "number" ? { maxWeight: params.maxWeight } : {}),
      ...(typeof params.minEffectiveSampleSize === "number"
        ? { minEffectiveSampleSize: params.minEffectiveSampleSize }
        : {}),
    };

    const prepared = prepareExternalControlRegistration(input);
    const encoded = encodeRegistrationKernel(prepared.rows);
    const ran = await host.runSandbox({
      analysisType: "external-control-registration",
      input: encoded.input,
      abi: "causal-ate@1",
      n: encoded.n,
      k: 1,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
    });
    const kernel = decodeRegistrationKernel(ran.output);
    const reference = externalControlRegistrationReference(input);
    const tolerance = 1e-3;
    if (
      Math.abs(kernel.riskRatio - reference.riskRatio) > tolerance ||
      Math.abs(kernel.riskDifference - reference.riskDifference) > tolerance
    )
      throw new Error("registration wasm kernel drifted from the TypeScript reference");

    const effect =
      effectMeasure === "risk-ratio"
        ? {
            measure: effectMeasure,
            estimate: kernel.riskRatio,
            ciLow: kernel.riskRatioCi[0],
            ciHigh: kernel.riskRatioCi[1],
          }
        : {
            measure: effectMeasure,
            estimate: kernel.riskDifference,
            ciLow: kernel.riskDifferenceCi[0],
            ciHigh: kernel.riskDifferenceCi[1],
          };
    if (![effect.estimate, effect.ciLow, effect.ciHigh].every(Number.isFinite))
      throw new Error("registration effect is not estimable");

    return {
      schema: stageInput.stage.output_schema,
      payload: {
        analysisType: "external-control-registration",
        synthetic,
        estimand: "ATT",
        estimator: "IPTW-ATT",
        cohort: prepared.diagnostics.cohort,
        effect,
        balance: prepared.diagnostics.balance,
        overlap: prepared.diagnostics.overlap,
        weights: prepared.diagnostics.weights,
        missingness: prepared.diagnostics.missingness,
        censoring: prepared.diagnostics.censoring,
        sensitivity: reference.sensitivity,
        ...(synthetic
          ? {
              truthComparison: {
                rrTrue: truthRr as number,
                rrEstimated: kernel.riskRatio,
                absoluteError: Math.abs(kernel.riskRatio - (truthRr as number)),
                withinExpectedRange:
                  kernel.riskRatio >= (truthRr as number) * 0.75 &&
                  kernel.riskRatio <= (truthRr as number) * 1.25,
              },
            }
          : {}),
        study: input.study,
      },
    };
  },
};
