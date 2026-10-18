// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力降密链环 `declassify.small_cell` 的出域闸。
 *
 * 重点守的是**小单元闸卡在放行对象上**：窃电链放行的是个体级记录，
 * 命中不足 minCell 时必须整表抑制，且载荷要与「零命中」不可区分
 * （spec `power-theft-detection`：「验证输出用户数 ≥ minCell」）。
 */

import type { ChainSystemHandler, StageExecutor, StageInput, WasmRunner } from "@medtrust/mdop";

import { registerPowerDeclassifyOperator, POWER_DECLASSIFY_OP } from "./power-declassify";
import type { PowerOperatorDeps } from "./register-power-ops";

class StubExecutor implements StageExecutor {
  readonly chains = new Map<string, ChainSystemHandler[]>();
  registerSystem(): void {
    throw new Error("电力包不得用覆盖式 registerSystem");
  }
  setWasmRunner(): void {
    throw new Error("电力包不得顶掉兜底 wasm runner");
  }
  appendSystemHandler(op: string, h: ChainSystemHandler): void {
    this.chains.set(op, [...(this.chains.get(op) ?? []), h]);
  }
  registerWasmOperator(_prefix: string, _runner: WasmRunner): void {
    throw new Error("本 spec 不涉及 wasm");
  }
  async system(op: string, input: StageInput) {
    for (const h of this.chains.get(op) ?? []) {
      const out = await h(input);
      if (out) return out;
    }
    return undefined;
  }
  async runWasm(): Promise<never> {
    throw new Error("本 spec 不涉及 wasm");
  }
}

const logged: string[] = [];
const logger = {
  log: () => undefined,
  warn: (m: string) => void logged.push(m),
  error: () => undefined,
};

const deps: PowerOperatorDeps = {
  readSeries: async () => null,
  runModule: async () => {
    throw new Error("本 spec 不涉及 wasm");
  },
  pseudonymize: (value, scope) => `ps_${scope}::${value}`,
};

function anomalyMeter(entityId: string, scorePermille: number, type = 1) {
  return {
    entityId,
    n: 24,
    scorePermille,
    type,
    method: 2,
    confidencePermille: 900,
    evidence: [0, 24] as const,
  };
}

function anomalyTable(meters: ReturnType<typeof anomalyMeter>[]) {
  return {
    analysisType: "power-anomaly",
    unitW: 1000,
    excludedMeters: 0,
    anomalyThreshold: 0.6,
    moduleSm3: "0".repeat(64),
    meters,
  };
}

function theftStage(params: Record<string, unknown> = {}): StageInput {
  return {
    jobId: "job-declassify-1",
    attempt: 1,
    stage: {
      id: "dec",
      node: "urn:tds:power:participant:gridA",
      op: POWER_DECLASSIFY_OP,
      op_digest: `sm3:${"0".repeat(64)}`,
      params: { minCell: 5, k: 5, contractId: "c-power", anomalyThreshold: 0.6, ...params },
      inputs: [{ from: "ana" }],
      input_labels: ["C0"],
      output_label: "C3",
      output_schema: "mdop.table/1.0",
    },
    inputs: new Map(),
    contractTerms: { publication: { minCell: 5 } },
  };
}

async function run(executor: StubExecutor, table: unknown, params?: Record<string, unknown>) {
  const input = theftStage(params);
  input.inputs = new Map([["ana", table as Record<string, unknown>]]);
  const out = await executor.system(POWER_DECLASSIFY_OP, input);
  if (!out) throw new Error("降密环婉拒了电力载荷");
  return out.payload as { results: unknown[]; nMeters: number };
}

describe("电力降密环：窃电个体列表的小单元闸", () => {
  let exec: StubExecutor;
  beforeEach(() => {
    exec = new StubExecutor();
    logged.length = 0;
    registerPowerDeclassifyOperator(exec, deps, logger);
  });

  it("命中 ≥ minCell 时按假名放行（标识不出现明文）", async () => {
    const meters = [
      anomalyMeter("m1", 950),
      anomalyMeter("m2", 900),
      anomalyMeter("m3", 880),
      anomalyMeter("m4", 850),
      anomalyMeter("m5", 800),
      anomalyMeter("m6", 100, 0),
    ];
    const payload = await run(exec, anomalyTable(meters));
    expect(payload.results).toHaveLength(5);
    const ids = payload.results.map((r) => (r as { entityId: string }).entityId);
    expect(ids.every((id) => id.startsWith("ps_contract:c-power::"))).toBe(true);
    expect(ids.some((id) => id.includes("m1"))).toBe(true);
  });

  it("命中 < minCell 时整表抑制，且载荷与「零命中」逐字节相同（不可区分）", async () => {
    const twoHits = [
      anomalyMeter("m1", 950),
      anomalyMeter("m2", 900),
      anomalyMeter("m3", 100, 0),
      anomalyMeter("m4", 100, 0),
      anomalyMeter("m5", 100, 0),
      anomalyMeter("m6", 100, 0),
    ];
    const noHits = [1, 2, 3, 4, 5, 6].map((i) => anomalyMeter(`m${i}`, 100, 0));

    const suppressed = await run(exec, anomalyTable(twoHits));
    const zero = await run(exec, anomalyTable(noHits));

    expect(suppressed.results).toHaveLength(0);
    expect(suppressed).toEqual(zero);
    // 真实命中数只留在节点本地日志里，不进载荷。
    expect(logged.join("\n")).toMatch(/抑制：命中 2 块 < minCell=5/);
  });

  it("输入表计数不足 minCell 时 fail-closed（抛错，不出空表）", async () => {
    const meters = [anomalyMeter("m1", 950), anomalyMeter("m2", 900)];
    await expect(run(exec, anomalyTable(meters))).rejects.toThrow(/小单元拒绝/);
  });

  it("参数 minCell 与合约取严（合约 8 > 参数 5 时按 8 卡）", async () => {
    // 9 块表过输入闸（≥8），其中 7 块命中 → 个体记录条数 7 < 8，整表抑制。
    const meters = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      i <= 7 ? anomalyMeter(`m${i}`, 950 - i) : anomalyMeter(`m${i}`, 100, 0),
    );
    const input = theftStage({ minCell: 5 });
    input.inputs = new Map([["ana", anomalyTable(meters) as unknown as Record<string, unknown>]]);
    input.contractTerms = { publication: { minCell: 8 } };
    const out = await exec.system(POWER_DECLASSIFY_OP, input);
    expect((out!.payload as { results: unknown[] }).results).toHaveLength(0);
    expect(logged.join("\n")).toMatch(/抑制：命中 7 块 < minCell=8/);
  });
});
