// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.dr-optimize@1.0.0 的领域逻辑（任务 4.2，spec: power-demand-response）。
 *
 * 用贪心启发式求解削峰填谷：在激励预算内，优先调度低成本削减与高意愿填谷，
 * 并限制单用户主导。只做纯计算，不做 I/O。
 */

import { HOURS_PER_DAY, type DrPotentialResult, type HourTriple } from "./dr-potential";

export interface DrOptimizeSpec {
  /** 目标负荷曲线（24 点，kW）——用作参考；实际优化在各方 baseline 之和上做 */
  readonly targetLoad: readonly number[];
  /** 激励预算（元） */
  readonly incentiveBudget: number;
  /** 调节时间窗口 [startHour, endHour)，0–24 */
  readonly timeWindow: readonly [number, number];
}

export interface DrOptimizeInput {
  readonly potentials: readonly DrPotentialResult[];
  readonly spec: DrOptimizeSpec;
}

export interface IncentiveAllocationEntry {
  /** 脱敏后的用户组标识（不暴露原始 entityId） */
  readonly groupId: string;
  readonly incentiveYuan: number;
  readonly adjustmentKwh: number;
}

export interface DrOptimizeResult {
  /** 各时段网侧调节目标（负=削减，正=填谷），kW */
  readonly adjustmentPlan: readonly number[];
  readonly incentiveAllocation: readonly IncentiveAllocationEntry[];
  readonly peakValleyDiff: number;
  readonly totalIncentive: number;
  readonly participationRate: number;
}

const MAX_USER_SHARE = 0.35; // 单用户主导上限：占总调节电量比例

function validateSpec(spec: DrOptimizeSpec): void {
  if (!Array.isArray(spec.targetLoad) || spec.targetLoad.length !== HOURS_PER_DAY) {
    throw new Error("目标负荷曲线应包含 24 小时数据");
  }
  if (!(typeof spec.incentiveBudget === "number" && spec.incentiveBudget > 0)) {
    throw new Error("激励预算必须为正数");
  }
  const [start, end] = spec.timeWindow;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > HOURS_PER_DAY ||
    start >= end
  ) {
    throw new Error("调节时间窗口无效");
  }
}

function capacityAt(triples: readonly HourTriple[], hour: number): number {
  const hit = triples.find((t) => t[0] === hour);
  return hit ? hit[1] : 0;
}

function costAt(triples: readonly HourTriple[], hour: number): number {
  const hit = triples.find((t) => t[0] === hour);
  return hit ? hit[2] : 0;
}

function peakValley(curve: readonly number[]): number {
  return Math.max(...curve) - Math.min(...curve);
}

/**
 * 求解需求响应削峰填谷方案（贪心启发式）。
 *
 * @throws Error 无可行解或入参非法时
 */
export function optimizeDemandResponse(input: DrOptimizeInput): DrOptimizeResult {
  validateSpec(input.spec);
  if (!Array.isArray(input.potentials) || input.potentials.length === 0) {
    throw new Error("无法满足约束条件");
  }

  const [winStart, winEnd] = input.spec.timeWindow;
  const n = input.potentials.length;

  // 聚合基准负荷
  const baseline: number[] = Array.from({ length: HOURS_PER_DAY }, (_, h) =>
    input.potentials.reduce((s, p) => s + (p.baselineCurve[h] ?? 0), 0),
  );

  const adjustmentPlan = Array.from({ length: HOURS_PER_DAY }, () => 0);
  const userAdjKwh = new Array<number>(n).fill(0);
  const userIncentive = new Array<number>(n).fill(0);
  let totalIncentive = 0;
  let budget = input.spec.incentiveBudget;

  // 剩余可调容量（按用户 × 时段）
  const remainPeak = input.potentials.map((p) =>
    Array.from({ length: HOURS_PER_DAY }, (_, h) => capacityAt(p.peakReduction, h)),
  );
  const remainValley = input.potentials.map((p) =>
    Array.from({ length: HOURS_PER_DAY }, (_, h) => capacityAt(p.valleyShift, h)),
  );

  const meanLoad = baseline.reduce((s, v) => s + v, 0) / HOURS_PER_DAY;

  /** 在预算与单用户份额约束下分配调节量（首笔不卡份额，避免冷启动死锁）。 */
  const tryAllocate = (
    userIdx: number,
    deltaKw: number,
    unitCost: number,
  ): boolean => {
    if (!(deltaKw > 0) || !(unitCost >= 0) || !Number.isFinite(unitCost)) return false;
    const cost = deltaKw * unitCost; // 1 小时 → kWh ≈ kW
    if (cost > budget) return false;
    const currentTotal = userAdjKwh.reduce((s, v) => s + v, 0);
    if (currentTotal > 0) {
      const projectedShare = (userAdjKwh[userIdx]! + deltaKw) / (currentTotal + deltaKw);
      if (projectedShare > MAX_USER_SHARE) return false;
    }
    budget -= cost;
    totalIncentive += cost;
    userAdjKwh[userIdx]! += deltaKw;
    userIncentive[userIdx]! += cost;
    return true;
  };

  // 多轮贪心：每轮找窗口内偏离均值最大的峰/谷时段，按成本/意愿排序分配
  const maxRounds = HOURS_PER_DAY * 4;
  for (let round = 0; round < maxRounds; round++) {
    const adjusted = baseline.map((v, h) => v + adjustmentPlan[h]!);
    const pv = peakValley(adjusted);
    if (pv <= meanLoad * 0.05) break; // 已足够平坦
    if (budget <= 0) break;

    let peakH = winStart;
    let valleyH = winStart;
    for (let h = winStart; h < winEnd; h++) {
      if (adjusted[h]! > adjusted[peakH]!) peakH = h;
      if (adjusted[h]! < adjusted[valleyH]!) valleyH = h;
    }

    // 峰时削减：按单位成本升序
    const curtailOrder = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) =>
        costAt(input.potentials[a]!.peakReduction, peakH) -
        costAt(input.potentials[b]!.peakReduction, peakH),
    );
    let progressed = false;
    for (const i of curtailOrder) {
      const avail = remainPeak[i]![peakH]!;
      if (avail <= 0) continue;
      const step = Math.min(avail, Math.max(0.1, (adjusted[peakH]! - meanLoad) / n));
      const unitCost = costAt(input.potentials[i]!.peakReduction, peakH);
      if (!tryAllocate(i, step, unitCost)) continue;
      remainPeak[i]![peakH]! -= step;
      adjustmentPlan[peakH]! -= step;
      progressed = true;
      break;
    }

    // 谷时填谷：按意愿降序
    const shiftOrder = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) =>
        costAt(input.potentials[b]!.valleyShift, valleyH) -
        costAt(input.potentials[a]!.valleyShift, valleyH),
    );
    for (const i of shiftOrder) {
      const avail = remainValley[i]![valleyH]!;
      if (avail <= 0) continue;
      const step = Math.min(avail, Math.max(0.1, (meanLoad - adjusted[valleyH]!) / n));
      // 填谷激励用意愿的逆作为成本代理（意愿高 → 成本低）
      const willingness = costAt(input.potentials[i]!.valleyShift, valleyH);
      const unitCost = willingness > 0 ? 1 / willingness : Number.POSITIVE_INFINITY;
      if (!tryAllocate(i, step, unitCost)) continue;
      remainValley[i]![valleyH]! -= step;
      adjustmentPlan[valleyH]! += step;
      progressed = true;
      break;
    }

    if (!progressed) break;
  }

  const finalCurve = baseline.map((v, h) => v + adjustmentPlan[h]!);
  const totalAdj = userAdjKwh.reduce((s, v) => s + v, 0);
  const participants = userAdjKwh.filter((v) => v > 0).length;

  // 预算不足且完全无调节 → 视为无可行解
  if (totalAdj === 0) {
    throw new Error("无法满足约束条件");
  }

  // 激励分配按用户组聚合（脱敏序号）
  const incentiveAllocation: IncentiveAllocationEntry[] = userAdjKwh
    .map((kwh, i) => ({
      groupId: `user-group-${i + 1}`,
      incentiveYuan: userIncentive[i]!,
      adjustmentKwh: kwh,
    }))
    .filter((e) => e.adjustmentKwh > 0);

  return {
    adjustmentPlan,
    incentiveAllocation,
    peakValleyDiff: peakValley(finalCurve),
    totalIncentive,
    participationRate: (participants / n) * 100,
  };
}
