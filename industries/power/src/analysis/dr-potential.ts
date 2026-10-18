// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.dr-potential@1.0.0 的领域逻辑（任务 4.1，spec: power-demand-response）。
 *
 * 评估单用户可调节负荷潜力：峰时可削减容量、谷时可转移容量，并遵守舒适度约束。
 * 只做纯计算，不做 I/O。
 */

export const HOURS_PER_DAY = 24;
/** 历史负荷至少覆盖的整天数（spec） */
export const MIN_HISTORY_DAYS = 7;
/** 默认可持续时长（分钟） */
export const DEFAULT_DURATION_MINUTES = 60;

export type DrUserType = "industrial" | "commercial" | "residential";

export interface ComfortConstraints {
  /** 温度下限（℃），可选 */
  readonly tempMin?: number;
  /** 温度上限（℃），可选 */
  readonly tempMax?: number;
  /** 最低照明要求（相对 0–1），可选 */
  readonly lightingMin?: number;
  /** 设备额定容量上限（kW），可选；缺省不额外截断 */
  readonly ratedCapacityKw?: number;
}

export interface DrDevice {
  readonly id: string;
  /** 额定功率（kW） */
  readonly ratedKw: number;
  /** 是否可削减 */
  readonly curtailable?: boolean;
  /** 是否可转移（谷时增加） */
  readonly shiftable?: boolean;
}

export interface DrPotentialInput {
  readonly entityId: string;
  /** 历史有功功率序列（至少 7×24 个有效点）；按时间顺序 */
  readonly historyKw: readonly number[];
  readonly userType: DrUserType;
  readonly devices?: readonly DrDevice[];
  readonly comfort?: ComfortConstraints;
}

/** 单时段潜力三元组：[时段 0–23, 容量 kW, 成本 元/kWh 或意愿权重] */
export type HourTriple = readonly [hour: number, capacityKw: number, costOrWeight: number];

export interface DrPotentialResult {
  readonly entityId: string;
  readonly peakReduction: readonly HourTriple[];
  readonly valleyShift: readonly HourTriple[];
  readonly baselineCurve: readonly number[];
  readonly constraints: ComfortConstraints;
}

/** 用户类型默认削减成本（元/kWh）与转移意愿 */
const USER_TYPE_DEFAULTS: Record<
  DrUserType,
  { curtailCost: number; shiftWillingness: number; curtailFraction: number; shiftFraction: number }
> = {
  industrial: { curtailCost: 0.8, shiftWillingness: 0.7, curtailFraction: 0.25, shiftFraction: 0.2 },
  commercial: { curtailCost: 1.2, shiftWillingness: 0.5, curtailFraction: 0.15, shiftFraction: 0.15 },
  residential: { curtailCost: 2.0, shiftWillingness: 0.3, curtailFraction: 0.1, shiftFraction: 0.1 },
};

/** 用户类型的默认参数（节点侧定点模块与浮点实现共用同一组系数）。 */
export function drUserTypeDefaults(userType: DrUserType): Readonly<{
  curtailCost: number;
  shiftWillingness: number;
  curtailFraction: number;
  shiftFraction: number;
}> {
  const d = USER_TYPE_DEFAULTS[userType];
  if (!d) throw new Error("用户类型须为 industrial / commercial / residential");
  return d;
}

function assertFiniteNonNeg(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必须为非负有限数`);
  }
}

/**
 * 按小时聚合历史曲线为 24 点基准负荷（日均）。
 * 波动剧烈时取保守下界：用各时段均值与 P25 的较小者。
 */
export function buildBaselineCurve(historyKw: readonly number[]): number[] {
  if (historyKw.length < MIN_HISTORY_DAYS * HOURS_PER_DAY) {
    throw new Error(`历史负荷至少需要 ${MIN_HISTORY_DAYS} 天（${MIN_HISTORY_DAYS * HOURS_PER_DAY} 点）`);
  }
  if (!historyKw.every((v) => Number.isFinite(v) && v >= 0)) {
    throw new Error("历史负荷包含非法值（须为非负有限数）");
  }

  const buckets: number[][] = Array.from({ length: HOURS_PER_DAY }, () => []);
  for (let i = 0; i < historyKw.length; i++) {
    buckets[i % HOURS_PER_DAY]!.push(historyKw[i]!);
  }

  return buckets.map((vals) => {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a - b);
    const p25 = sorted[Math.floor((sorted.length - 1) * 0.25)]!;
    // 保守估计：取均值与下四分位的较小者，避免高估可调空间
    return Math.min(mean, p25);
  });
}

function deviceCurtailCap(devices: readonly DrDevice[] | undefined): number | undefined {
  if (!devices || devices.length === 0) return undefined;
  let sum = 0;
  let any = false;
  for (const d of devices) {
    if (d.curtailable === false) continue;
    assertFiniteNonNeg(d.ratedKw, "设备额定功率");
    sum += d.ratedKw;
    any = true;
  }
  return any ? sum : undefined;
}

function deviceShiftCap(devices: readonly DrDevice[] | undefined): number | undefined {
  if (!devices || devices.length === 0) return undefined;
  let sum = 0;
  let any = false;
  for (const d of devices) {
    if (d.shiftable === false) continue;
    assertFiniteNonNeg(d.ratedKw, "设备额定功率");
    sum += d.ratedKw;
    any = true;
  }
  return any ? sum : undefined;
}

function applyComfortCap(capacity: number, comfort: ComfortConstraints | undefined): number {
  if (!comfort) return capacity;
  let capped = capacity;
  if (typeof comfort.ratedCapacityKw === "number") {
    assertFiniteNonNeg(comfort.ratedCapacityKw, "额定容量");
    capped = Math.min(capped, comfort.ratedCapacityKw);
  }
  // 照明下限越高，可削减空间越小：lightingMin=1 → 削减为 0
  if (typeof comfort.lightingMin === "number") {
    if (!(comfort.lightingMin >= 0 && comfort.lightingMin <= 1)) {
      throw new Error("照明要求 lightingMin 应在 0–1");
    }
    capped *= 1 - comfort.lightingMin;
  }
  // 温度带宽越窄，可调空间越小（简单代理）
  if (
    typeof comfort.tempMin === "number" &&
    typeof comfort.tempMax === "number" &&
    Number.isFinite(comfort.tempMin) &&
    Number.isFinite(comfort.tempMax)
  ) {
    const span = Math.max(0, comfort.tempMax - comfort.tempMin);
    const factor = Math.min(1, span / 8); // 8℃ 带宽视为满额
    capped *= factor;
  }
  return Math.max(0, capped);
}

/**
 * 评估可调节负荷潜力。
 *
 * @throws Error 历史不足、非法用户类型或非法数值时
 */
export function assessDrPotential(input: DrPotentialInput): DrPotentialResult {
  if (typeof input.entityId !== "string" || input.entityId.length === 0) {
    throw new Error("缺少 entityId");
  }
  if (!(input.userType in USER_TYPE_DEFAULTS)) {
    throw new Error("用户类型须为 industrial / commercial / residential");
  }

  const baseline = buildBaselineCurve(input.historyKw);
  const defaults = USER_TYPE_DEFAULTS[input.userType];
  const comfort = input.comfort ?? {};
  const peakMean = baseline.reduce((s, v) => s + v, 0) / HOURS_PER_DAY;
  const curtailDeviceCap = deviceCurtailCap(input.devices);
  const shiftDeviceCap = deviceShiftCap(input.devices);

  // 满负荷：基准已贴近历史峰值且无可削减余量 → peakReduction 全 0
  const historyMax = Math.max(...input.historyKw);
  const fullLoad = baseline.every((v) => v >= historyMax * 0.98);

  const peakReduction: HourTriple[] = [];
  const valleyShift: HourTriple[] = [];

  for (let h = 0; h < HOURS_PER_DAY; h++) {
    const load = baseline[h]!;
    if (fullLoad) {
      peakReduction.push([h, 0, defaults.curtailCost]);
    } else {
      let cap = Math.max(0, load * defaults.curtailFraction);
      // 高于日均的时段才有峰时削减意义
      if (load < peakMean) cap *= 0.3;
      if (curtailDeviceCap !== undefined) cap = Math.min(cap, curtailDeviceCap);
      cap = applyComfortCap(cap, comfort);
      peakReduction.push([h, cap, defaults.curtailCost]);
    }

    let shiftCap = Math.max(0, peakMean * defaults.shiftFraction);
    // 低于日均的时段填谷空间更大
    if (load > peakMean) shiftCap *= 0.3;
    if (shiftDeviceCap !== undefined) shiftCap = Math.min(shiftCap, shiftDeviceCap);
    shiftCap = applyComfortCap(shiftCap, comfort);
    valleyShift.push([h, shiftCap, defaults.shiftWillingness]);
  }

  // 零潜力：无可调设备且削减/转移分数被舒适度压到接近 0
  const totalPeak = peakReduction.reduce((s, t) => s + t[1], 0);
  const totalValley = valleyShift.reduce((s, t) => s + t[1], 0);
  if (totalPeak === 0 && totalValley === 0) {
    return {
      entityId: input.entityId,
      peakReduction: [],
      valleyShift: [],
      baselineCurve: baseline,
      constraints: comfort,
    };
  }

  return {
    entityId: input.entityId,
    peakReduction,
    valleyShift,
    baselineCurve: baseline,
    constraints: comfort,
  };
}
