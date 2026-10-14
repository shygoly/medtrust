// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * `rws.paired-cohort@1.0.0` 的节点侧整段执行（搬移自 wasm-runner 的内联分支，同函数体）。
 * 只经 `SandboxHost` 取已放行输入与执行原语；出域判据仍全在基座。
 */
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";

import {
  pairedCohortFromSandboxOutput,
  pairedCohortPayload,
  pairingRequiredBytes,
  projectPairing,
} from "./pairing-sandbox";

export const pairedCohortStageSandbox: StageSandbox = {
  opRef: "rws.paired-cohort@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { output_schema: string };
    };
    const tables = host.tables(host.stageInput) as Array<{
      node: string;
      rows: readonly unknown[];
    }>;
    const fixedStrata = host.configuredStrataKeys("节点配置的");
    const projection = projectPairing({
      tables: tables as never,
      ...(fixedStrata ? { strataKeys: fixedStrata } : {}),
    });
    const result = await host.runSandbox({
      analysisType: "paired-cohort",
      input: projection.input,
      abi: "pairing@1",
      parties: projection.parties,
      n: projection.subjects,
      strata: projection.strata,
      k: projection.strata,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
      requiredBytes: pairingRequiredBytes({
        parties: projection.parties,
        subjects: projection.subjects,
        strata: projection.strata,
      }),
    });
    const paired = pairedCohortFromSandboxOutput({
      projection,
      output: result.output,
      parties: tables.map((t) => t.node),
    });
    return {
      // 等级不给：由阶段声明决定（模块无权给自己定等级），执行器取 stage.output_label。
      schema: stageInput.stage.output_schema,
      payload: pairedCohortPayload(paired),
    };
  },
};
