// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * `rws.vaccine-scri@1.0.0` 的节点侧整段执行（搬移自 wasm-runner#runVaccineScri，同函数体）。
 * 角色绑定与参数形状校验随分析逻辑进包；出域判据（编码白名单/分层键）仍调宿主的。
 */
import { MdopError } from "@medtrust/mdop";
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";

import {
  projectScri,
  scriFromSandboxOutput,
  scriPayload,
  scriRequiredBytes,
} from "./scri-sandbox";

export const vaccineScriStageSandbox: StageSandbox = {
  opRef: "rws.vaccine-scri@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params;
    const roles = (params.roles ?? {}) as { registry?: unknown; events?: unknown };
    const tables = host.tables(host.stageInput);
    const byNode = (node: unknown) => {
      const table = tables.find((t) => t.node === node);
      if (!table)
        throw new MdopError(
          'E_RUNTIME',
          {},
          `SCRI 阶段找不到角色对应的输入：${String(node)}`,
        );
      return table.rows as unknown[];
    };
    const window = (value: unknown, name: string): [number, number] => {
      if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isInteger))
        throw new MdopError(
          'E_RUNTIME',
          {},
          `SCRI 阶段参数 ${name} 必须是两个整数天`,
        );
      return [value[0] as number, value[1] as number];
    };
    const vaccineCodes = host.codeWhitelist(params, "vaccineCodes", "SCRI");
    const eventCodes = host.codeWhitelist(params, "eventCodes", "SCRI");
    const strataKeys = host.strataKeys(params.strataKeys, "SCRI 阶段参数");
    const projection = projectScri({
      registry: byNode(roles.registry) as never,
      events: byNode(roles.events) as never,
      windows: {
        risk: window(params.riskWindow, "riskWindow"),
        control: window(params.controlWindow, "controlWindow"),
      },
      ...(vaccineCodes ? { vaccineCodes } : {}),
      ...(eventCodes ? { eventCodes } : {}),
      ...(strataKeys ? { strataKeys } : {}),
    });
    const result = await host.runSandbox({
      analysisType: "vaccine-scri",
      input: projection.input,
      abi: "scri@1",
      n: projection.pairs,
      k: projection.strata,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
      requiredBytes: scriRequiredBytes({
        pairs: projection.pairs,
        doses: projection.doses,
        strata: projection.strata,
      }),
    });
    return {
      schema: stageInput.stage.output_schema,
      payload: scriPayload(
        scriFromSandboxOutput({ projection, output: result.output }),
      ),
    };
  },
};
