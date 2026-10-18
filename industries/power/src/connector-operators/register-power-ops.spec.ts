// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力节点算子：source 链环 → **真 wasm 模块**（build/ 里已登记的产物）→ 降密链环。
 * 执行器用最小桩，语义与连接器 MdopStageExecutor 一致（前缀 wasm 分派 + 婉拒式链）。
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ChainSystemHandler, StageExecutor, StageInput, WasmRunner } from "@medtrust/mdop";

import { registerPowerOperators, type PowerModuleRun, type PowerOperatorDeps } from "./register-power-ops";
import { POWER_NODE_OPERATOR_REFS } from "./power-ops";

const BUILD = join(__dirname, "../../../../packages/wasm-algorithms/build");
const manifest = JSON.parse(readFileSync(join(BUILD, "manifest.json"), "utf-8")) as {
  modules: Array<{ analysisType: string; file: string; sm3: string }>;
};
const moduleOf = (analysisType: string) => manifest.modules.find((m) => m.analysisType === analysisType)!;

/** 与沙箱同一调用形状：输入写在偏移 0，只给 env.memory。 */
async function runRealModule(run: PowerModuleRun): Promise<{ output: Uint8Array; moduleSm3: string }> {
  const entry = moduleOf(run.analysisType);
  if (!entry) throw new Error(`没有登记的模块：${run.analysisType}`);
  if (entry.sm3 !== run.sm3) throw new Error("模块摘要与固定摘要不符");
  const bytes = readFileSync(join(BUILD, entry.file));
  // 包的 lib 不含 DOM；运行时 Node 自带 WebAssembly
  const WA = (globalThis as unknown as { WebAssembly: any }).WebAssembly;
  const memory = new WA.Memory({ initial: Math.ceil(run.requiredBytes / 65536), maximum: 1024 });
  const instance = new WA.Instance(new WA.Module(bytes), { env: { memory } });
  new Uint8Array(memory.buffer).set(run.input, 0);
  const code = (instance.exports.run as (a: number, b: number, c: number, d: number) => number)(
    0,
    run.m,
    run.k,
    run.outOff,
  );
  if (code !== 0) throw new Error(`模块返回错误码 ${code}`);
  return { output: new Uint8Array(memory.buffer, run.outOff, run.outBytes).slice(), moduleSm3: entry.sm3 };
}

class StubExecutor implements StageExecutor {
  readonly chains = new Map<string, ChainSystemHandler[]>();
  readonly wasm = new Map<string, WasmRunner>();
  registerSystem(): void {
    throw new Error("电力包不得用覆盖式 registerSystem");
  }
  setWasmRunner(): void {
    throw new Error("电力包不得顶掉兜底 wasm runner");
  }
  appendSystemHandler(op: string, h: ChainSystemHandler): void {
    this.chains.set(op, [...(this.chains.get(op) ?? []), h]);
  }
  registerWasmOperator(prefix: string, runner: WasmRunner): void {
    this.wasm.set(prefix, runner);
  }
  async system(op: string, input: StageInput) {
    for (const h of this.chains.get(op) ?? []) {
      const out = await h(input);
      if (out) return out;
    }
    return undefined;
  }
  async runWasm(op: string, digest: string, input: StageInput) {
    const runner = [...this.wasm].find(([p]) => op.startsWith(p))?.[1];
    if (!runner) throw new Error(`无 wasm 实现：${op}`);
    return runner(op, digest, input);
  }
}

function stage(op: string, params: Record<string, unknown>, upstream?: Record<string, unknown>, digest = ""): StageInput {
  return {
    jobId: "job-power-1",
    attempt: 1,
    stage: {
      id: `s-${op.split("@")[0]}`,
      node: "urn:tds:power:participant:gridA",
      op,
      op_digest: digest,
      params,
      inputs: [{ from: "ds://gridA/p-meter" }],
      input_labels: ["C0"],
      output_label: "C0",
      output_schema: "mdop.table/1.0",
    },
    inputs: new Map(upstream ? [["up", upstream]] : []),
  };
}

const HOUR = 3_600_000;
const START = Date.parse("2026-01-01T16:00:00Z"); // 北京时间 0 点
const DAYS = 35;

/** 6 块表 × 35 天逐小时；meter-5 末 10 天读数归零（窃电样态）。 */
function fixtureText(): string {
  const rows: Array<Record<string, unknown>> = [];
  for (let m = 0; m < 6; m++) {
    for (let i = 0; i < DAYS * 24; i++) {
      const h = i % 24;
      const base = 20 + m * 3 + (h >= 9 && h <= 18 ? 15 : 0) + ((i * 7 + m) % 5) * 0.4;
      const zeroed = m === 5 && i >= (DAYS - 10) * 24;
      rows.push({
        timestamp: new Date(START + i * HOUR).toISOString(),
        entityId: `meter-${m}`,
        activePower: zeroed ? 0 : Math.round(base * 10) / 10,
      });
    }
  }
  return JSON.stringify(rows);
}

const KEY = "consortium-test-key";
const deps: PowerOperatorDeps = {
  readSeries: async (productId) =>
    productId === "p-meter"
      ? {
          schema: "power.interval-meter@1",
          text: fixtureText(),
          snapshot: `sm3:${createHash("sha256").update(productId).digest("hex")}`,
        }
      : null,
  runModule: runRealModule,
  pseudonymize: (value, scope) => `ps_${createHmac("sha256", KEY).update(`${scope}\n${value}`).digest("hex").slice(0, 24)}`,
};

const CONTRACT = { publication: { minCell: 5 } };

async function sourced(ex: StubExecutor) {
  const src = await ex.system("source.dataset@1.0.0", stage("source.dataset@1.0.0", { uri: "ds://gridA/p-meter" }));
  return src!.payload;
}

describe("电力节点算子（source 链环 + 真 wasm + 降密链环）", () => {
  let ex: StubExecutor;
  beforeEach(() => {
    ex = new StubExecutor();
    registerPowerOperators(ex, deps);
  });

  it("三个分析算子按前缀登记为 wasm，source / declassify 走婉拒式链", () => {
    expect([...ex.wasm.keys()].sort()).toEqual(
      POWER_NODE_OPERATOR_REFS.map((r) => `${r.split("@")[0]}@`).sort(),
    );
    expect([...ex.chains.keys()].sort()).toEqual(["declassify.small_cell@1.0.0", "source.dataset@1.0.0"]);
  });

  it("source：非电力时序产品婉拒（交给链上下一环），电力产品解析为 C0 时序", async () => {
    await expect(
      ex.system("source.dataset@1.0.0", stage("source.dataset@1.0.0", { uri: "ds://gridA/p-other" })),
    ).resolves.toBeUndefined();
    const payload = await sourced(ex);
    expect(payload.schema).toBe("power.interval-meter@1");
    expect(payload.n).toBe(6 * DAYS * 24);
  });

  it("负荷预测：节点内聚合到节点级，C3 不含任何表计标识", async () => {
    const ds = await sourced(ex);
    const sm3 = moduleOf("power-features").sm3;
    const c0 = await ex.runWasm("power.feature-extraction@1.0.0", sm3, stage("power.feature-extraction@1.0.0", {}, ds, sm3));
    expect(c0.payload.meters).toHaveLength(6);
    const c3 = await ex.system(
      "declassify.small_cell@1.0.0",
      { ...stage("declassify.small_cell@1.0.0", { contractId: "c-1" }, c0.payload), contractTerms: CONTRACT },
    );
    expect(c3!.label).toBe("C3");
    const p = c3!.payload as Record<string, unknown>;
    expect(p.analysisType).toBe("power.load-forecast");
    expect(p.nMeters).toBe(6);
    expect((p.loadProfileKw as number[]).length).toBe(24);
    // 白天（9–18 点）总负荷高于夜间
    const profile = p.loadProfileKw as number[];
    expect(profile[12]!).toBeGreaterThan(profile[3]! + 6 * 10);
    expect(JSON.stringify(p)).not.toMatch(/meter-\d/);
  });

  it("负荷预测：表计数不足 minCell 即拒（fail-closed）", async () => {
    const ds = await sourced(ex);
    const sm3 = moduleOf("power-features").sm3;
    const c0 = await ex.runWasm("power.feature-extraction@1.0.0", sm3, stage("power.feature-extraction@1.0.0", {}, ds, sm3));
    await expect(
      ex.system("declassify.small_cell@1.0.0", {
        ...stage("declassify.small_cell@1.0.0", { contractId: "c-1", minCell: 10 }, c0.payload),
        contractTerms: CONTRACT,
      }),
    ).rejects.toThrow();
  });

  it("需求响应：节点级潜力曲线，参与方即合约主体", async () => {
    const ds = await sourced(ex);
    const sm3 = moduleOf("power-dr-potential").sm3;
    const c0 = await ex.runWasm(
      "power.dr-potential@1.0.0",
      sm3,
      stage("power.dr-potential@1.0.0", { userType: "commercial" }, ds, sm3),
    );
    const c3 = await ex.system("declassify.small_cell@1.0.0", {
      ...stage("declassify.small_cell@1.0.0", { contractId: "c-1" }, c0.payload),
      contractTerms: CONTRACT,
    });
    const p = c3!.payload as Record<string, unknown>;
    expect(p.analysisType).toBe("power.demand-response");
    expect(p.entityId).toBe("urn:tds:power:participant:gridA");
    expect((p.baselineCurve as number[]).length).toBe(24);
    expect((p.peakReduction as unknown[]).length).toBe(24);
    expect(JSON.stringify(p)).not.toMatch(/meter-\d/);
  });

  it("窃电检测：只放行超阈值表计，标识换成键控假名，证据泛化到日级", async () => {
    const ds = await sourced(ex);
    const sm3 = moduleOf("power-anomaly").sm3;
    const c0 = await ex.runWasm(
      "power.anomaly-detection@1.0.0",
      sm3,
      stage("power.anomaly-detection@1.0.0", { anomalyThreshold: 0.1 }, ds, sm3),
    );
    // 本夹具只命中 1 块表（meter-5）；缺省 minCell=5 会按「个体记录条数不足」整表抑制
    // （语义见 power-declassify.spec）。这里显式把合约与参数的 minCell 放到 1，
    // 目的是让管线真的把那条记录放出来，好验证假名化与证据泛化——不是放松缺省口径。
    const c3 = await ex.system("declassify.small_cell@1.0.0", {
      ...stage("declassify.small_cell@1.0.0", { contractId: "c-1", topK: 3, minCell: 1 }, c0.payload),
      contractTerms: { publication: { minCell: 1 } },
    });
    const p = c3!.payload as { analysisType: string; nMeters: number; results: Array<Record<string, unknown>> };
    expect(p.analysisType).toBe("power.theft-detection");
    expect(p.nMeters).toBe(6);
    expect(p.results.length).toBeGreaterThanOrEqual(1);
    const expected = deps.pseudonymize("meter-5", "contract:c-1");
    expect(p.results).toEqual([expect.objectContaining({ entityId: expected, anomalyType: "zero_power" })]);
    for (const r of p.results) {
      const [s, e] = r.evidencePeriod as [number, number];
      expect(s % 24).toBe(0);
      expect(e % 24).toBe(0);
    }
    expect(JSON.stringify(p)).not.toMatch(/meter-\d/);
  });

  it("降密链环婉拒非电力载荷；阶段摘要与清单不符即拒", async () => {
    await expect(
      ex.system("declassify.small_cell@1.0.0", stage("declassify.small_cell@1.0.0", {}, { buckets: [] })),
    ).resolves.toBeUndefined();
    const ds = await sourced(ex);
    const sm3 = moduleOf("power-features").sm3;
    await expect(
      ex.runWasm("power.feature-extraction@1.0.0", sm3, stage("power.feature-extraction@1.0.0", {}, ds, "0".repeat(64))),
    ).rejects.toThrow("模块摘要");
  });
});
