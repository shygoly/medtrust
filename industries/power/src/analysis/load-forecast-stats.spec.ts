// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import {
  DEFAULT_Z,
  meanConfidenceInterval,
  rankFeatureImportance,
} from './load-forecast-stats';

describe('meanConfidenceInterval', () => {
  it('对常数样本，区间退化为该常数', () => {
    const ci = meanConfidenceInterval([5, 5, 5, 5]);
    expect(ci.lower).toBeCloseTo(5, 10);
    expect(ci.upper).toBeCloseTo(5, 10);
  });

  it('区间以样本均值为中心且对称', () => {
    const values = [1, 2, 3, 4, 5];
    const ci = meanConfidenceInterval(values);
    const mean = 3;
    expect((ci.lower + ci.upper) / 2).toBeCloseTo(mean, 10);
    expect(mean - ci.lower).toBeCloseTo(ci.upper - mean, 10);
  });

  it('按正态近似计算半宽：z·σ/√n（总体方差）', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    // 均值 5，总体方差 4，σ=2，n=8
    const ci = meanConfidenceInterval(values);
    const expectedHalf = (DEFAULT_Z * 2) / Math.sqrt(8);
    expect(ci.upper - 5).toBeCloseTo(expectedHalf, 10);
    expect(5 - ci.lower).toBeCloseTo(expectedHalf, 10);
  });

  it('可通过 z 参数改变置信水平', () => {
    const values = [1, 2, 3, 4];
    const narrow = meanConfidenceInterval(values, 1);
    const wide = meanConfidenceInterval(values, 2.58);
    expect(wide.upper - wide.lower).toBeGreaterThan(narrow.upper - narrow.lower);
  });

  it('默认 z 为 95% 双侧分位数 1.96', () => {
    expect(DEFAULT_Z).toBe(1.96);
  });

  it('空样本抛出错误', () => {
    expect(() => meanConfidenceInterval([])).toThrow('置信区间需要至少一个样本');
  });

  it('含非有限数时抛出错误', () => {
    expect(() => meanConfidenceInterval([1, NaN, 3])).toThrow('样本包含非有限数');
    expect(() => meanConfidenceInterval([1, Infinity])).toThrow('样本包含非有限数');
  });
});

describe('rankFeatureImportance', () => {
  it('按绝对值占比降序排列，且重要性之和为 1', () => {
    const result = rankFeatureImportance({ a: 1, b: -3, c: 2 });
    expect(result.map((e) => e.feature)).toEqual(['b', 'c', 'a']);
    const sum = result.reduce((s, e) => s + e.importance, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(result[0].importance).toBeCloseTo(0.5, 10);
  });

  it('全为 0 时所有重要性均为 0', () => {
    const result = rankFeatureImportance({ a: 0, b: 0 });
    expect(result.every((e) => e.importance === 0)).toBe(true);
  });

  it('非有限值按 0 处理', () => {
    const result = rankFeatureImportance({ a: NaN, b: 4, c: Infinity });
    const byName = Object.fromEntries(result.map((e) => [e.feature, e.importance]));
    expect(byName.a).toBe(0);
    expect(byName.c).toBe(0);
    expect(byName.b).toBeCloseTo(1, 10);
  });

  it('空对象返回空数组', () => {
    expect(rankFeatureImportance({})).toEqual([]);
  });
});
