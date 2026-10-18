// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * power.load-forecast-merge@1.0.0 的预测模型部分（任务 3.3.2，基线实现）。
 *
 * 当前使用季节朴素法（seasonal naive）作为确定性基线：未来第 h 点 = 历史中同相位的最近一个观测值。
 * 这是**唯一已实现**的模型，模板侧的 `LOAD_FORECAST_MODELS = ["baseline"]` 与之一致：
 * 计划里写 `baseline`，输出里就是 `baseline`；`lstm` / `transformer` 提交即被模板拒绝
 * （训练后端未接入，不用基线冒充）。
 *
 * 只做纯计算，不做 I/O。
 */

export const BASELINE_MODEL_ID = "baseline" as const;

export interface BaselineForecastResult {
  readonly model: typeof BASELINE_MODEL_ID;
  /** 预测曲线，长度 = horizon */
  readonly forecastCurve: readonly number[];
  /** 样本内回测误差（季节朴素残差） */
  readonly mape: number;
  readonly rmse: number;
}

/**
 * 季节朴素预测。
 *
 * - period < 1 或历史不足一个周期时退化为末值持平（last-value naive）。
 * - 历史为空时抛错（fail-closed）。
 *
 * @param history - 按时间顺序排列的有效观测值（非空，全部有限）
 * @param horizon - 预测步数（正整数）
 * @param period - 季节周期的采样点数
 * @returns 预测曲线（长度 = horizon）
 */
export function seasonalNaiveForecast(
  history: readonly number[],
  horizon: number,
  period: number,
): number[] {
  if (history.length === 0) throw new Error('预测历史为空');
  if (!Number.isInteger(horizon) || horizon <= 0) throw new Error('预测步数必须为正整数');
  if (!history.every((v) => Number.isFinite(v))) throw new Error('历史包含非有限数');

  const usePeriod = Number.isInteger(period) && period >= 1 && history.length >= period;
  const last = history[history.length - 1]!;
  const curve: number[] = [];
  for (let h = 0; h < horizon; h++) {
    if (!usePeriod) {
      curve.push(last);
    } else {
      // 同相位的最近观测：从末尾回退到与 h 同相位的位置
      const idx = history.length - period + (h % period);
      curve.push(history[idx]!);
    }
  }
  return curve;
}

/**
 * 平均绝对百分比误差（MAPE，百分数）。跳过实际值为 0 的点（避免除零）。
 *
 * @param actual - 实际值
 * @param predicted - 预测值（与 actual 等长）
 * @returns MAPE（0-∞，单位 %）；无有效点时为 0
 */
export function mape(actual: readonly number[], predicted: readonly number[]): number {
  if (actual.length !== predicted.length) throw new Error('MAPE 输入长度不一致');
  let sum = 0;
  let count = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]!;
    if (a === 0) continue;
    sum += Math.abs((a - predicted[i]!) / a);
    count++;
  }
  return count === 0 ? 0 : (sum / count) * 100;
}

/**
 * 均方根误差（RMSE）。
 *
 * @param actual - 实际值
 * @param predicted - 预测值（与 actual 等长）
 * @returns RMSE；空输入时为 0
 */
export function rmse(actual: readonly number[], predicted: readonly number[]): number {
  if (actual.length !== predicted.length) throw new Error('RMSE 输入长度不一致');
  if (actual.length === 0) return 0;
  const sq = actual.reduce((s, a, i) => s + (a - predicted[i]!) ** 2, 0);
  return Math.sqrt(sq / actual.length);
}

/**
 * 基线预测：生成未来曲线，并用季节朴素残差计算 MAPE / RMSE。
 *
 * 回测口径：对历史中 index >= period 的点，用 index - period 处的值作预测。
 * 历史不足一个周期时回测误差为 0（无可评估点）。
 *
 * @param history - 有效观测值
 * @param horizon - 预测步数
 * @param period - 季节周期采样点数
 * @returns 基线预测结果
 */
export function baselineForecast(
  history: readonly number[],
  horizon: number,
  period: number,
): BaselineForecastResult {
  const forecastCurve = seasonalNaiveForecast(history, horizon, period);
  const usePeriod = Number.isInteger(period) && period >= 1 && history.length > period;
  let mapeValue = 0;
  let rmseValue = 0;
  if (usePeriod) {
    const actual = history.slice(period);
    const predicted = history.slice(0, history.length - period);
    mapeValue = mape(actual, predicted);
    rmseValue = rmse(actual, predicted);
  }
  return { model: BASELINE_MODEL_ID, forecastCurve, mape: mapeValue, rmse: rmseValue };
}
