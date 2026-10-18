// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 电力节点侧算子接线（批次 6）：挂到 StageExecutor。
 *
 * - `source.dataset` 链环（D-CN-8）：只认领 schema 为电力时序的 `series-file` 产品，别的婉拒；
 *   时序只在阶段内存里存在，不替换共享 LocalStore。
 * - 三个分析算子是 **wasm 类**（D-MDOP-5：system 只许 source / declassify / merge）：宿主按电表
 *   分组、整理为逐小时序列、缩放为整数后交给已登记模块（零能力沙箱）；表计标识不进模块。
 * - `declassify.small_cell` 链环见 `power-declassify.ts`。
 */

import type { StageExecutor, StageInput, WasmRunner } from "@medtrust/mdop";
import {
  POWER_ANOMALY_ANALYSIS_TYPE,
  POWER_DR_MIN_N,
  POWER_DR_POTENTIAL_ANALYSIS_TYPE,
  POWER_FEATURES_ANALYSIS_TYPE,
  POWER_FEATURES_MIN_N,
  choosePowerUnitW,
  decodePowerAnomalyOutput,
  decodePowerDrPotentialOutput,
  decodePowerFeaturesOutput,
  encodePowerAnomaly,
  encodePowerDrPotential,
  encodePowerFeatures,
  kwToUnits,
  powerAnomalySeed,
  type PowerDrParamsFixed,
} from "@medtrust/wasm-algorithms";

import { drUserTypeDefaults, type ComfortConstraints, type DrUserType } from "../analysis/dr-potential";
import type { PowerTimeSeriesRecord } from "../records/power-timeseries";
import {
  isPowerSeriesSchema,
  parsePowerSeriesText,
  toHourlyMeterSeries,
  type HourlyMeterSeries,
} from "./power-series";
import { POWER_NODE_OPERATOR_REFS } from "./power-ops";
import { registerPowerDeclassifyOperator } from "./power-declassify";

export interface PowerOperatorLogger {
  log(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export const silentPowerOperatorLogger: PowerOperatorLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** 连接器读出的时序文件（字节解码后的文本 + 快照）。 */
export interface PowerSeriesFile {
  readonly schema: string;
  readonly text: string;
  /** 文件字节的 SM3（`sm3:<hex>`）。 */
  readonly snapshot: string;
}

/** 已登记 wasm 模块的一次定点执行（连接器侧的零能力沙箱）。 */
export interface PowerModuleRun {
  readonly analysisType: string;
  /** 阶段清单固定的模块摘要（64 位小写十六进制，无前缀）。 */
  readonly sm3: string;
  readonly input: Uint8Array;
  /** `run` 第二参：表计数。 */
  readonly m: number;
  /** `run` 第三参：周期（features 为 period，其余为 24）。 */
  readonly k: number;
  readonly outOff: number;
  readonly outBytes: number;
  readonly requiredBytes: number;
  readonly taskId: string;
}

export interface PowerOperatorDeps {
  /**
   * 读时序文件产品；**不是**时序文件产品返回 null（链环据此婉拒）。
   * 声明非法、文件不可读照抛（fail-closed）。
   */
  readSeries(dataProductId: string): Promise<PowerSeriesFile | null>;
  runModule(run: PowerModuleRun): Promise<{ output: Uint8Array; moduleSm3: string }>;
  /**
   * 键控假名（降密环用）：同一 scope 下同一明文得同一假名；密钥只在节点（与同联盟节点）持有，
   * 平台无从反查。
   */
  pseudonymize(value: string, scope: string): string;
}

export const POWER_SOURCE_OP = "source.dataset@1.0.0";
const DATASET_URI_PREFIX = "ds://";

/** `ds://<node>/<dataProductId>` → dataProductId（段数不符即拒）。 */
export function powerDataProductIdFromUri(uri: string): string {
  const rest = (uri ?? "").startsWith(DATASET_URI_PREFIX) ? uri.slice(DATASET_URI_PREFIX.length) : "";
  const slash = rest.indexOf("/");
  const productId = slash >= 0 ? rest.slice(slash + 1) : "";
  if (!productId) throw new Error(`数据源句柄非法（应为 ds://<node>/<dataProductId>）：${uri}`);
  return productId;
}

/** source 阶段产出（C0，永不出节点）。 */
export interface PowerDatasetPayload {
  readonly productId: string;
  readonly schema: string;
  readonly n: number;
  readonly snapshot: string;
  readonly rows: readonly PowerTimeSeriesRecord[];
}

function upstreamDataset(input: StageInput, op: string): PowerDatasetPayload {
  const first = [...input.inputs.values()][0] as Partial<PowerDatasetPayload> | undefined;
  if (!first || !Array.isArray(first.rows) || typeof first.schema !== "string" || !isPowerSeriesSchema(first.schema)) {
    throw new Error(`${op} 缺上游电力时序数据集（source.dataset 未产出电力时序 schema）`);
  }
  return first as PowerDatasetPayload;
}

function pinnedSm3(input: StageInput, moduleDigest: string): string {
  const bare = (v: string) => v.replace(/^sm3:/, "").toLowerCase();
  const declared = bare(String(input.stage.op_digest ?? ""));
  if (declared && declared !== bare(moduleDigest)) {
    throw new Error("阶段声明的模块摘要与清单不符（拒绝执行）");
  }
  const sm3 = declared || bare(moduleDigest);
  if (!/^[0-9a-f]{64}$/.test(sm3)) throw new Error(`阶段没有可用的 wasm 模块摘要：${input.stage.op_digest}`);
  return sm3;
}

function optionalInt(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${label} 须为整数`);
  return v;
}

function hourly(input: StageInput, rows: readonly PowerTimeSeriesRecord[], minHours: number) {
  const utcOffsetHours = optionalInt(input.stage.params.utcOffsetHours, "utcOffsetHours");
  return toHourlyMeterSeries(rows, {
    minHours,
    ...(utcOffsetHours !== undefined ? { utcOffsetHours } : {}),
  });
}

function requireMeters(meters: readonly HourlyMeterSeries[], op: string, excluded: number): void {
  if (meters.length === 0) {
    throw new Error(`${op}：没有满足样本要求的表计（剔除 ${excluded} 块），不产出结果`);
  }
}

/** C0 节点表（逐表计，永不出节点；出域只经降密环）。 */
export interface PowerFeaturesTable {
  readonly analysisType: typeof POWER_FEATURES_ANALYSIS_TYPE;
  readonly unitW: number;
  readonly period: number;
  readonly excludedMeters: number;
  readonly moduleSm3: string;
  readonly meters: ReadonlyArray<{
    readonly entityId: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly n: number;
    readonly mean: number;
    readonly std: number;
    readonly max: number;
    readonly min: number;
    readonly trendMilli: number;
    readonly seasonality: number;
    readonly phaseMeans: readonly number[];
  }>;
}

export interface PowerDrPotentialTable {
  readonly analysisType: typeof POWER_DR_POTENTIAL_ANALYSIS_TYPE;
  readonly unitW: number;
  readonly userType: DrUserType;
  readonly excludedMeters: number;
  readonly moduleSm3: string;
  readonly meters: ReadonlyArray<{
    readonly entityId: string;
    readonly baseline: readonly number[];
    readonly peakCap: readonly number[];
    readonly valleyCap: readonly number[];
    readonly fullLoad: boolean;
  }>;
}

export interface PowerAnomalyTable {
  readonly analysisType: typeof POWER_ANOMALY_ANALYSIS_TYPE;
  readonly unitW: number;
  readonly excludedMeters: number;
  readonly anomalyThreshold?: number;
  readonly moduleSm3: string;
  readonly meters: ReadonlyArray<{
    readonly entityId: string;
    readonly n: number;
    readonly scorePermille: number;
    readonly type: number;
    readonly method: number;
    readonly confidencePermille: number;
    readonly evidence: readonly [number, number];
  }>;
}

const USER_TYPES: readonly DrUserType[] = ["industrial", "commercial", "residential"];

/** 浮点实现的舒适度折算（applyComfortCap 的乘性部分）→ 千分比。 */
function comfortPermille(c: ComfortConstraints): number {
  let f = 1;
  if (typeof c.lightingMin === "number") {
    if (!(c.lightingMin >= 0 && c.lightingMin <= 1)) throw new Error("照明要求 lightingMin 应在 0–1");
    f *= 1 - c.lightingMin;
  }
  if (typeof c.tempMin === "number" && typeof c.tempMax === "number") {
    f *= Math.min(1, Math.max(0, c.tempMax - c.tempMin) / 8);
  }
  return Math.round(f * 1000);
}

/**
 * 把电力节点算子接到执行器：source 链环 + 三个 wasm 算子（按前缀登记）+ 降密链环。
 */
export function registerPowerOperators(
  executor: StageExecutor,
  deps: PowerOperatorDeps,
  logger: PowerOperatorLogger = silentPowerOperatorLogger,
): void {
  executor.appendSystemHandler(POWER_SOURCE_OP, async (input) => {
    const uri = String(input.stage.params.uri ?? input.stage.inputs[0]?.from ?? "");
    const productId = powerDataProductIdFromUri(uri);
    const file = await deps.readSeries(productId);
    if (!file || !isPowerSeriesSchema(file.schema)) return undefined;
    const rows = parsePowerSeriesText(file.text);
    logger.log(`source.dataset 载入电力时序 product=${productId} schema=${file.schema} rows=${rows.length}`);
    const payload: PowerDatasetPayload = {
      productId,
      schema: file.schema,
      n: rows.length,
      snapshot: file.snapshot,
      rows,
    };
    return { label: "C0", schema: "mdop.dataset/1.0", payload: payload as unknown as Record<string, unknown> };
  });

  const features: WasmRunner = async (opRef, moduleDigest, input) => {
    const sm3 = pinnedSm3(input, moduleDigest);
    const dataset = upstreamDataset(input, opRef);
    const period = optionalInt(input.stage.params.period, "period") ?? 24;
    const { meters, excludedMeters } = hourly(input, dataset.rows, Math.max(POWER_FEATURES_MIN_N, period));
    requireMeters(meters, opRef, excludedMeters);
    const unitW = choosePowerUnitW(meters.flatMap((s) => s.valuesKw));
    const encoded = encodePowerFeatures(
      meters.map((s) => kwToUnits(s.valuesKw, unitW)),
      period,
    );
    const { output, moduleSm3 } = await deps.runModule({
      analysisType: POWER_FEATURES_ANALYSIS_TYPE,
      sm3,
      input: encoded.bytes,
      m: encoded.m,
      k: period,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
      taskId: input.jobId,
    });
    const decoded = decodePowerFeaturesOutput(output, encoded.m, period);
    const table: PowerFeaturesTable = {
      analysisType: POWER_FEATURES_ANALYSIS_TYPE,
      unitW,
      period,
      excludedMeters,
      moduleSm3,
      meters: meters.map((s, i) => ({
        entityId: s.entityId,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
        ...decoded[i]!,
      })),
    };
    logger.log(`${opRef} 完成 meters=${meters.length} excluded=${excludedMeters} module=${moduleSm3.slice(0, 16)}…`);
    return { label: "C0", schema: "mdop.table/1.0", payload: table as unknown as Record<string, unknown> };
  };

  const drPotential: WasmRunner = async (opRef, moduleDigest, input) => {
    const sm3 = pinnedSm3(input, moduleDigest);
    const dataset = upstreamDataset(input, opRef);
    const userType = String(input.stage.params.userType ?? "industrial") as DrUserType;
    if (!USER_TYPES.includes(userType)) throw new Error("用户类型须为 industrial / commercial / residential");
    const comfort = (input.stage.params.comfort ?? {}) as ComfortConstraints;
    const series = hourly(input, dataset.rows, POWER_DR_MIN_N);
    // 负读数（反送 / 表计故障）不满足潜力评估的前提：整表剔除并计数
    const meters = series.meters.filter((s) => s.valuesKw.every((v) => v >= 0));
    const excludedMeters = series.excludedMeters + (series.meters.length - meters.length);
    requireMeters(meters, opRef, excludedMeters);
    const unitW = choosePowerUnitW(meters.flatMap((s) => s.valuesKw));
    const defaults = drUserTypeDefaults(userType);
    const params: PowerDrParamsFixed = {
      curtailPermille: Math.round(defaults.curtailFraction * 1000),
      shiftPermille: Math.round(defaults.shiftFraction * 1000),
      offPeakPermille: 300,
      comfortPermille: comfortPermille(comfort),
      ratedCapUnits:
        typeof comfort.ratedCapacityKw === "number" ? kwToUnits([comfort.ratedCapacityKw], unitW)[0]! : -1,
      curtailDeviceCapUnits: -1,
      shiftDeviceCapUnits: -1,
    };
    const encoded = encodePowerDrPotential(
      meters.map((s) => kwToUnits(s.valuesKw, unitW)),
      params,
    );
    const { output, moduleSm3 } = await deps.runModule({
      analysisType: POWER_DR_POTENTIAL_ANALYSIS_TYPE,
      sm3,
      input: encoded.bytes,
      m: encoded.m,
      k: 24,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
      taskId: input.jobId,
    });
    const decoded = decodePowerDrPotentialOutput(output, encoded.m);
    const table: PowerDrPotentialTable = {
      analysisType: POWER_DR_POTENTIAL_ANALYSIS_TYPE,
      unitW,
      userType,
      excludedMeters,
      moduleSm3,
      meters: meters.map((s, i) => ({ entityId: s.entityId, ...decoded[i]! })),
    };
    logger.log(`${opRef} 完成 meters=${meters.length} excluded=${excludedMeters} module=${moduleSm3.slice(0, 16)}…`);
    return { label: "C0", schema: "mdop.table/1.0", payload: table as unknown as Record<string, unknown> };
  };

  const anomaly: WasmRunner = async (opRef, moduleDigest, input) => {
    const sm3 = pinnedSm3(input, moduleDigest);
    const dataset = upstreamDataset(input, opRef);
    const { meters, excludedMeters } = hourly(input, dataset.rows, 24);
    requireMeters(meters, opRef, excludedMeters);
    const peerMeanKw = input.stage.params.peerMeanKw;
    const unitW = choosePowerUnitW([
      ...meters.flatMap((s) => s.valuesKw),
      ...(typeof peerMeanKw === "number" ? [peerMeanKw] : []),
    ]);
    const peerMean = typeof peerMeanKw === "number" ? kwToUnits([peerMeanKw], unitW)[0]! : -1;
    // 孤立森林种子由表计标识的**假名**派生：明文标识不进模块
    const scope = `${input.jobId}:${input.stage.id}`;
    const encoded = encodePowerAnomaly(
      meters.map((s) => ({
        values: kwToUnits(s.valuesKw, unitW),
        seed: powerAnomalySeed(deps.pseudonymize(s.entityId, scope)),
      })),
      peerMean,
    );
    const { output, moduleSm3 } = await deps.runModule({
      analysisType: POWER_ANOMALY_ANALYSIS_TYPE,
      sm3,
      input: encoded.bytes,
      m: encoded.m,
      k: 24,
      outOff: encoded.outOff,
      outBytes: encoded.outBytes,
      requiredBytes: encoded.requiredBytes,
      taskId: input.jobId,
    });
    const decoded = decodePowerAnomalyOutput(output, encoded.m);
    const threshold = input.stage.params.anomalyThreshold;
    const table: PowerAnomalyTable = {
      analysisType: POWER_ANOMALY_ANALYSIS_TYPE,
      unitW,
      excludedMeters,
      ...(typeof threshold === "number" ? { anomalyThreshold: threshold } : {}),
      moduleSm3,
      meters: meters.map((s, i) => ({ entityId: s.entityId, n: s.valuesKw.length, ...decoded[i]! })),
    };
    logger.log(`${opRef} 完成 meters=${meters.length} excluded=${excludedMeters} module=${moduleSm3.slice(0, 16)}…`);
    return { label: "C0", schema: "mdop.table/1.0", payload: table as unknown as Record<string, unknown> };
  };

  const prefixAware = executor as unknown as {
    registerWasmOperator?: (opPrefix: string, runner: WasmRunner) => void;
  };
  if (!prefixAware.registerWasmOperator) {
    // 兜底 runner 归组装根（其它包的阶段沙箱在那里），电力包不得顶掉它
    throw new Error("执行器不支持按前缀登记 wasm 算子：电力算子无法接入（fail-closed）");
  }
  const [featureRef, drRef, anomalyRef] = POWER_NODE_OPERATOR_REFS;
  const prefix = (ref: string) => `${ref.split("@")[0]}@`;
  prefixAware.registerWasmOperator(prefix(featureRef), features);
  prefixAware.registerWasmOperator(prefix(drRef), drPotential);
  prefixAware.registerWasmOperator(prefix(anomalyRef), anomaly);

  registerPowerDeclassifyOperator(executor, deps, logger);
  logger.log(`电力节点算子已注册：${POWER_NODE_OPERATOR_REFS.join(", ")}（wasm）+ source/declassify 链环`);
}
