// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * `rws.ve-tnd@1.0.0` 的**节点侧整段执行**（change `pack-med-sandboxes` design D2 的 S-B 形态）。
 *
 * 搬移自 `apps/connector/src/tee-node/wasm-runner.ts#runVeTnd`（同函数体），差别只有三点：
 *  1. 输入与模块字节经 `SandboxHost` 取（凭证/白名单/摘要/内存上限已由基座判据放行）；
 *  2. 编码白名单与分层键校验**调宿主的**（判据留在基座，包不自己实现一遍）；
 *  3. 结果层键仍由基座的统一入口复校（本文件不负责出域判据）。
 */
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";
import type { VeTndInput } from "@medtrust/wasm-algorithms";

import {
  projectVeTnd,
  veTndFromSandboxOutput,
  veTndPayload,
  veTndRequiredBytes,
} from "./ve-tnd-sandbox";

export const veTndStageSandbox: StageSandbox = {
  opRef: "rws.ve-tnd@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params;
    const roles = (params.roles ?? {}) as {
      registry?: unknown;
      tests?: unknown;
    };
    const rows = host.rowsByRole(
      host.stageInput,
      { registry: roles.registry, tests: roles.tests },
      "VE(TND)",
    );
    const immuneDays = Number(params.immuneDays ?? 14);
    const vaccineCodes = host.codeWhitelist(params, "vaccineCodes", "VE(TND)");
    const pathogenCodes = host.codeWhitelist(params, "pathogenCodes", "VE(TND)");
    const strataKeys = host.strataKeys(params.strataKeys, "VE(TND) 阶段参数");
    const projection = projectVeTnd({
      doses: rows.get("registry") as never,
      tests: rows.get("tests") as never,
      immuneDays,
      ...(vaccineCodes ? { vaccineCodes } : {}),
      ...(pathogenCodes ? { pathogenCodes } : {}),
      ...(strataKeys ? { strataKeys } : {}),
    } satisfies VeTndInput);
    const result = await host.runSandbox({
      analysisType: "ve-tnd",
      input: projection.input,
      abi: "ve-tnd@1",
      n: projection.tests,
      k: projection.strata,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
      requiredBytes: veTndRequiredBytes({
        tests: projection.tests,
        strata: projection.strata,
      }),
    });
    return {
      schema: stageInput.stage.output_schema,
      payload: veTndPayload(
        veTndFromSandboxOutput({ projection, output: result.output }),
      ),
    };
  },
};
