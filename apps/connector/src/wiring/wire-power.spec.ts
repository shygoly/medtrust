/**
 * 电力算子在连接器上的端到端（节点侧）：
 *   series-file 产品 → source.dataset 链（医疗 L1.5 环婉拒、电力环认领）
 *   → power.* wasm 算子（**真模块 + 真沙箱 worker**，仅模块下载用桩）
 *   → declassify.small_cell 链（电力环）→ C3 → 平台收集器合并。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parseOperatorManifest, type StageInput } from "@medtrust/mdop";
import {
  mergeLoadForecastDeliveries,
  mergeTheftDetectionDeliveries,
  POWER_NODE_OPERATOR_REFS,
} from "@medtrust/domain-power";

import { AuditService } from "../domain/audit";
import { DataProductLocalSource } from "../domain/data-product-local-source";
import { Deidentifier } from "../domain/deidentifier";
import { LocalDataLoader } from "../domain/local-data-loader";
import { LocalStore } from "../domain/local-store";
import { OutputGate } from "../domain/output-gate";
import { AlgorithmSandboxExecutor } from "../domain/sandbox/algorithm-sandbox-executor";
import type { ConnectorModuleClient } from "../domain/sandbox/module-client";
import { WasmSandboxRunner } from "../domain/sandbox/sandbox-runner";
import { MdopStageExecutor } from "../mdop/mdop-executor";
import { L15OperatorWiring } from "./wire-l15";
import { hmacSm3Hex, PowerOperatorWiring } from "./wire-power";

const BUILD = join(__dirname, "../../../../packages/wasm-algorithms/build");
const buildManifest = JSON.parse(readFileSync(join(BUILD, "manifest.json"), "utf-8")) as {
  modules: Array<{
    analysisType: string;
    file: string;
    sm3: string;
    abiVersion: number;
    operator?: { id: string; version: string; category: string; environments: string[]; inputs: unknown[]; outputs: unknown[] };
  }>;
};
const powerModules = buildManifest.modules.filter((m) => m.analysisType.startsWith("power-"));

function wasmManifest(m: (typeof powerModules)[number]) {
  return parseOperatorManifest({
    apiVersion: "mdop/v0.2",
    kind: "wasm",
    id: m.operator!.id,
    version: m.operator!.version,
    category: m.operator!.category,
    digest: `sm3:${m.sm3}`,
    publisher: "urn:tds:platform",
    inputs: m.operator!.inputs,
    outputs: m.operator!.outputs,
    params: {},
    environments: m.operator!.environments,
    security: { network: "none", writes: "artifact_store_only" },
    build: { source_digest: `sm3:${m.sm3}`, toolchain: "assemblyscript@0.27.37", reproducible: true },
  });
}

const systemManifest = (id: string, category: string, inSchema: string, outSchema: string, outRule: string) =>
  parseOperatorManifest({
    apiVersion: "mdop/v0.2",
    kind: "system",
    id,
    version: "1.0.0",
    category,
    digest: `component:${id}@1`,
    publisher: "urn:tds:platform",
    inputs: [{ name: "in", schema: inSchema, accept_labels: ["C0"] }],
    outputs: [{ name: "out", schema: outSchema, label_rule: outRule }],
    params: {},
    environments: ["plain"],
    security: { network: "none" },
    component: `${id}@1.0.0`,
  });

const SOURCE_MANIFEST = systemManifest("source.dataset", "source", "mdop.dataset/1.0", "mdop.dataset/1.0", "inherit");
const DECLASSIFY_MANIFEST = systemManifest("declassify.small_cell", "declassify", "mdop.table/1.0", "mdop.table/1.0", "C3");

const HOUR = 3_600_000;
const START = Date.parse("2026-01-01T16:00:00Z"); // 北京时间 0 点
const DAYS = 35;

/** 6 块表 × 35 天；zeroMeter（可选）末 10 天归零。15 分钟读数，验证按小时取均值。 */
function meterFile(prefix: string, scale: number, zeroMeter?: number): string {
  const rows: Array<Record<string, unknown>> = [];
  for (let m = 0; m < 6; m++) {
    for (let q = 0; q < DAYS * 24 * 4; q++) {
      const i = Math.floor(q / 4);
      const h = i % 24;
      const base = (20 + m * 3 + (h >= 9 && h <= 18 ? 15 : 0) + ((i * 7 + m) % 5) * 0.4) * scale;
      const zeroed = m === zeroMeter && i >= (DAYS - 10) * 24;
      rows.push({
        timestamp: new Date(START + q * (HOUR / 4)).toISOString(),
        entityId: `${prefix}-meter-${m}`,
        activePower: zeroed ? 0 : Math.round(base * 10) / 10,
      });
    }
  }
  return JSON.stringify(rows);
}

const KEY = "k".repeat(40);

describe("电力算子接线（连接器节点侧端到端）", () => {
  let dir: string;
  const prevKey = process.env.CONNECTOR_POWER_PSEUDONYM_KEY;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "power-wire-"));
    writeFileSync(join(dir, "grid-a.json"), meterFile("a", 1, 5));
    writeFileSync(join(dir, "grid-b.json"), meterFile("b", 2));
    process.env.CONNECTOR_POWER_PSEUDONYM_KEY = KEY;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.CONNECTOR_POWER_PSEUDONYM_KEY;
    else process.env.CONNECTOR_POWER_PSEUDONYM_KEY = prevKey;
  });

  function node() {
    const audit = new AuditService();
    const store = new LocalStore(audit);
    const deid = new Deidentifier();
    const source = new DataProductLocalSource(store, new LocalDataLoader(deid), audit);
    source.registerProduct({
      id: "p-grid-a",
      fhirSchema: { dataSource: { type: "series-file", path: join(dir, "grid-a.json"), schema: "power.interval-meter@1" } },
    } as never);
    source.registerProduct({
      id: "p-grid-b",
      fhirSchema: { dataSource: { type: "series-file", path: join(dir, "grid-b.json"), schema: "power.interval-meter@1" } },
    } as never);
    source.registerProduct({
      id: "p-med",
      fhirSchema: { dataSource: { type: "file", path: join(dir, "no-such-med-file.json") } },
    } as never);
    // 只把「下载已签名模块」换成桩：字节取自 build/，执行走真沙箱 worker
    const modules = {
      getVerifiedModule: async ({ analysisType, sm3 }: { analysisType: string; sm3: string }) => {
        const m = powerModules.find((x) => x.analysisType === analysisType && x.sm3 === sm3);
        if (!m) throw new Error(`模块未登记：${analysisType}/${sm3}`);
        return {
          analysisType,
          sm3,
          signature: "test",
          abiVersion: m.abiVersion,
          bytes: new Uint8Array(readFileSync(join(BUILD, m.file))),
          gate: {},
        };
      },
    } as unknown as ConnectorModuleClient;
    const sandbox = new AlgorithmSandboxExecutor(modules, new WasmSandboxRunner(audit), audit);
    const executor = new MdopStageExecutor();
    // 医疗环先登记（链上第一环），电力环其后：验证婉拒与认领各司其职
    new L15OperatorWiring(executor, source, store, new OutputGate(audit, deid)).onModuleInit();
    const power = new PowerOperatorWiring(executor, source, sandbox, modules);
    power.onModuleInit();
    return { executor, power, store };
  }

  const stage = (
    id: string,
    op: string,
    params: Record<string, unknown>,
    upstream?: Record<string, unknown>,
    digest = "",
  ): StageInput => ({
    jobId: "job-power-e2e",
    attempt: 1,
    contractTerms: { publication: { minCell: 5 } },
    stage: {
      id,
      node: "urn:tds:power:participant:grid",
      op,
      op_digest: digest,
      params,
      inputs: [],
      input_labels: ["C0"],
      output_label: op.startsWith("declassify") ? "C3" : "C0",
      output_schema: "mdop.table/1.0",
    },
    inputs: new Map(upstream ? [["up", upstream]] : []),
  });

  async function runChain(
    executor: MdopStageExecutor,
    productId: string,
    analysis: "power-features" | "power-anomaly",
    analysisParams: Record<string, unknown>,
    declassifyParams: Record<string, unknown>,
    contractMinCell = 5,
  ) {
    const src = await executor.execute(
      stage("src", "source.dataset@1.0.0", { uri: `ds://grid/${productId}` }),
      SOURCE_MANIFEST,
    );
    const mod = powerModules.find((m) => m.analysisType === analysis)!;
    const op = `${mod.operator!.id}@1.0.0`;
    const c0 = await executor.execute(stage("ana", op, analysisParams, src.payload, `sm3:${mod.sm3}`), wasmManifest(mod));
    const dec = stage("dec", "declassify.small_cell@1.0.0", { contractId: "c-power", ...declassifyParams }, c0.payload);
    dec.contractTerms = { publication: { minCell: contractMinCell } };
    const c3 = await executor.execute(dec, DECLASSIFY_MANIFEST);
    return { src, c0, c3 };
  }

  it("三个电力分析算子登记为 wasm（前缀分派），不占 system 覆盖位", () => {
    const { executor, power } = node();
    for (const ref of POWER_NODE_OPERATOR_REFS) expect(power.isWired(ref)).toBe(true);
    expect(executor.registeredSystemOps()).toEqual(
      expect.arrayContaining(["declassify.small_cell@1.0.0", "source.dataset@1.0.0"]),
    );
    expect(executor.registeredSystemOps().some((o) => o.startsWith("power."))).toBe(false);
  });

  it("source 链：医疗环婉拒时序产品、电力环认领；时序不进共享 LocalStore", async () => {
    const { executor, store } = node();
    const src = await executor.execute(
      stage("src", "source.dataset@1.0.0", { uri: "ds://grid/p-grid-a" }),
      SOURCE_MANIFEST,
    );
    expect(src.payload.schema).toBe("power.interval-meter@1");
    expect(src.payload.n).toBe(6 * DAYS * 24 * 4);
    expect(String(src.payload.snapshot)).toMatch(/^sm3:[0-9a-f]{64}$/);
    expect(store.count()).toBe(0);
    // 记录类产品仍由医疗环认领（这里路径不存在 → 医疗环报路径错，而不是「无人认领」）
    await expect(
      executor.execute(stage("src", "source.dataset@1.0.0", { uri: "ds://grid/p-med" }), SOURCE_MANIFEST),
    ).rejects.toThrow(/路径不存在/);
  });

  it("负荷预测：两节点各自聚合到节点级 → 平台按区域总剖面外推", async () => {
    const a = await runChain(node().executor, "p-grid-a", "power-features", {}, {});
    const b = await runChain(node().executor, "p-grid-b", "power-features", {}, {});
    expect(a.c0.label).toBe("C0");
    expect(a.c3.label).toBe("C3");
    for (const out of [a.c3, b.c3]) {
      expect(out.payload.analysisType).toBe("power.load-forecast");
      expect(JSON.stringify(out.payload)).not.toMatch(/meter-\d/);
    }
    const merged = mergeLoadForecastDeliveries({
      tables: [
        { node: "grid-a", aggregate: a.c3.payload as never },
        { node: "grid-b", aggregate: b.c3.payload as never },
      ],
      params: { spec: { forecastHorizon: 48 } },
    });
    expect(merged.totalMeters).toBe(12);
    expect(merged.forecastCurve).toHaveLength(48);
    // 区域剖面 = 两节点剖面逐小时相加；白天高于夜间
    const pa = a.c3.payload.loadProfileKw as number[];
    const pb = b.c3.payload.loadProfileKw as number[];
    merged.loadProfileKw.forEach((v, h) => expect(v).toBeCloseTo(pa[h]! + pb[h]!, 6));
    expect(merged.loadProfileKw[12]!).toBeGreaterThan(merged.loadProfileKw[3]!);
    expect(merged.forecastCurve[12]).toBe(merged.loadProfileKw[12]);
  }, 60_000);

  it("窃电：合约 minCell=5 时单块命中被整表抑制；放宽到 1 才出键控假名并可合并", async () => {
    // 夹具只命中 1 块表（meter-5）。缺省 minCell=5 下，个体级记录条数不足 → 整表不出域：
    // 平台看到的载荷与「零命中」一致（连条数都推不出来）。
    const suppressed = await runChain(
      node().executor,
      "p-grid-a",
      "power-anomaly",
      { anomalyThreshold: 0.1 },
      { anomalyThreshold: 0.1, topK: 5 },
    );
    expect((suppressed.c3.payload.results as unknown[]).length).toBe(0);
    const suppressedMerge = mergeTheftDetectionDeliveries({
      tables: [{ node: "grid-a", aggregate: suppressed.c3.payload as never }],
      params: { spec: { anomalyThreshold: 0.1, topK: 5, detectionPeriod: 30 } },
    });
    expect(suppressedMerge.totalUsers).toBe(6);
    expect(suppressedMerge.suspiciousUsers).toHaveLength(0);

    // 显式把合约 minCell 放到 1（场景自身的选择，不是缺省口径）后，同一夹具的那条记录出域，
    // 标识是节点密钥派生的 HMAC-SM3 假名，明文表计标识不出现在载荷里。
    const released = await runChain(
      node().executor,
      "p-grid-a",
      "power-anomaly",
      { anomalyThreshold: 0.1 },
      { anomalyThreshold: 0.1, topK: 5 },
      1,
    );
    const results = released.c3.payload.results as Array<{ entityId: string; anomalyType: string }>;
    const expected = `ps_${hmacSm3Hex(KEY, "contract:c-power\na-meter-5").slice(0, 32)}`;
    expect(results).toEqual([expect.objectContaining({ entityId: expected, anomalyType: "zero_power" })]);
    expect(JSON.stringify(released.c3.payload)).not.toMatch(/meter-\d/);
    const merged = mergeTheftDetectionDeliveries({
      tables: [{ node: "grid-a", aggregate: released.c3.payload as never }],
      params: { spec: { anomalyThreshold: 0.1, topK: 5, detectionPeriod: 30 } },
    });
    expect(merged.totalUsers).toBe(6);
    expect(merged.suspiciousUsers).toHaveLength(1);
    expect(merged.theftRate).toBe(17);
  }, 60_000);

  it("缺假名密钥时电力降密环拒绝出域（fail-closed）", async () => {
    const saved = process.env.CONNECTOR_POWER_PSEUDONYM_KEY;
    delete process.env.CONNECTOR_POWER_PSEUDONYM_KEY;
    try {
      await expect(runChain(node().executor, "p-grid-a", "power-features", {}, {})).rejects.toThrow(
        /CONNECTOR_POWER_PSEUDONYM_KEY/,
      );
    } finally {
      process.env.CONNECTOR_POWER_PSEUDONYM_KEY = saved;
    }
  }, 60_000);
});
