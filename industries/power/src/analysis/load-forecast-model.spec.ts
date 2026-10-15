// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import {
  BASELINE_MODEL_ID,
  baselineForecast,
  mape,
  rmse,
  seasonalNaiveForecast,
} from "./load-forecast-model";

describe("负荷预测基线模型（3.3.2）", () => {
  describe("seasonalNaiveForecast", () => {
    it("按周期同相位取历史值", () => {
      // period=3，历史末尾三点为 [4,5,6]，未来按相位循环
      expect(seasonalNaiveForecast([1, 2, 3, 4, 5, 6], 4, 3)).toEqual([4, 5, 6, 4]);
    });

    it("period 小于 1 时退化为末值持平", () => {
      expect(seasonalNaiveForecast([1, 2, 6], 2, 0)).toEqual([6, 6]);
    });

    it("period 非整数时退化为末值持平", () => {
      expect(seasonalNaiveForecast([1, 2, 6], 2, 1.5)).toEqual([6, 6]);
    });

    it("历史不足一个周期时退化为末值持平", () => {
      expect(seasonalNaiveForecast([1, 2], 2, 5)).toEqual([2, 2]);
    });

    it("历史为空时抛错（fail-closed）", () => {
      expect(() => seasonalNaiveForecast([], 2, 1)).toThrow("预测历史为空");
    });

    it("预测步数非正整数时抛错", () => {
      expect(() => seasonalNaiveForecast([1, 2], 0, 1)).toThrow("预测步数必须为正整数");
      expect(() => seasonalNaiveForecast([1, 2], 1.5, 1)).toThrow("预测步数必须为正整数");
    });

    it("历史包含非有限数时抛错", () => {
      expect(() => seasonalNaiveForecast([1, Number.NaN], 1, 1)).toThrow("历史包含非有限数");
      expect(() => seasonalNaiveForecast([1, Number.POSITIVE_INFINITY], 1, 1)).toThrow(
        "历史包含非有限数",
      );
    });
  });

  describe("mape", () => {
    it("计算百分数形式的平均绝对百分比误差", () => {
      // |10/100| = 0.1, |-20/200| = 0.1 → 均值 0.1 → 10%
      expect(mape([100, 200], [90, 220])).toBeCloseTo(10, 10);
    });

    it("跳过实际值为 0 的点", () => {
      expect(mape([0, 100], [5, 90])).toBeCloseTo(10, 10);
    });

    it("全部实际值为 0 时返回 0", () => {
      expect(mape([0, 0], [1, 2])).toBe(0);
    });

    it("空输入返回 0", () => {
      expect(mape([], [])).toBe(0);
    });

    it("长度不一致时抛错", () => {
      expect(() => mape([1, 2], [1])).toThrow("MAPE 输入长度不一致");
    });
  });

  describe("rmse", () => {
    it("计算均方根误差", () => {
      expect(rmse([3, 4], [0, 0])).toBeCloseTo(Math.sqrt(12.5), 10);
    });

    it("完全一致时为 0", () => {
      expect(rmse([1, 2, 3], [1, 2, 3])).toBe(0);
    });

    it("空输入返回 0", () => {
      expect(rmse([], [])).toBe(0);
    });

    it("长度不一致时抛错", () => {
      expect(() => rmse([1], [1, 2])).toThrow("RMSE 输入长度不一致");
    });
  });

  describe("baselineForecast", () => {
    it("返回基线标识、预测曲线与回测误差", () => {
      const result = baselineForecast([1, 2, 3, 4, 5, 6], 4, 3);

      expect(result.model).toBe(BASELINE_MODEL_ID);
      expect(result.model).toBe("baseline");
      expect(result.forecastCurve).toEqual([4, 5, 6, 4]);
      // 回测：actual=[4,5,6]，predicted=[1,2,3]
      // MAPE = (0.75 + 0.6 + 0.5) / 3 * 100 ≈ 61.667
      expect(result.mape).toBeCloseTo((1.85 / 3) * 100, 10);
      // RMSE = sqrt((9 + 9 + 9) / 3) = 3
      expect(result.rmse).toBeCloseTo(3, 10);
    });

    it("历史长度等于周期时无回测点，误差为 0", () => {
      const result = baselineForecast([1, 2, 3], 2, 3);

      expect(result.forecastCurve).toEqual([1, 2]);
      expect(result.mape).toBe(0);
      expect(result.rmse).toBe(0);
    });

    it("周期非法时退化为末值持平且误差为 0", () => {
      const result = baselineForecast([1, 2, 5], 2, 0);

      expect(result.forecastCurve).toEqual([5, 5]);
      expect(result.mape).toBe(0);
      expect(result.rmse).toBe(0);
    });

    it("空历史时抛错", () => {
      expect(() => baselineForecast([], 1, 1)).toThrow("预测历史为空");
    });
  });
});
