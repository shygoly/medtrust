// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import {
  isPowerTimeSeriesRecord,
  isPowerFeatures,
  type PowerTimeSeriesRecord,
  type PowerFeatures,
} from './power-timeseries';
import {
  checkMonotonicity,
  calculateMissingRatio,
  detectOutliers,
  detectDuplicates,
  estimateSamplingInterval,
  checkDataQuality,
} from './data-quality';
import { fromCSV, fromJSON, deduplicateByTimestamp } from './data-conversion';
import { upsample, downsample, resample } from './resampling';
import { minimalExample, anomalyExample } from './__fixtures__/sample-data';

describe('PowerTimeSeriesRecord 类型守卫', () => {
  it('验证有效记录', () => {
    const record: PowerTimeSeriesRecord = {
      timestamp: '2026-10-15T00:00:00.000Z',
      entityId: 'user-001',
      activePower: 5.2,
    };
    expect(isPowerTimeSeriesRecord(record)).toBe(true);
  });

  it('拒绝无效时间戳', () => {
    expect(isPowerTimeSeriesRecord({ timestamp: 'invalid', entityId: 'u1' })).toBe(false);
  });

  it('拒绝空 entityId', () => {
    expect(isPowerTimeSeriesRecord({ timestamp: '2026-10-15T00:00:00Z', entityId: '' })).toBe(false);
  });

  it('拒绝非有限数值', () => {
    expect(
      isPowerTimeSeriesRecord({
        timestamp: '2026-10-15T00:00:00Z',
        entityId: 'u1',
        activePower: NaN,
      })
    ).toBe(false);
  });
});

describe('PowerFeatures 类型守卫', () => {
  it('验证有效特征', () => {
    const features: PowerFeatures = {
      entityId: 'user-001',
      windowStart: '2026-10-15T00:00:00.000Z',
      windowEnd: '2026-10-15T01:00:00.000Z',
      mean: 5.5,
      std: 0.8,
      max: 7.0,
      min: 4.5,
      hourOfDay: 0,
      dayOfWeek: 2,
      isWeekend: false,
      trend: 0.1,
      seasonality: 0.05,
      nSamples: 100,
    };
    expect(isPowerFeatures(features)).toBe(true);
  });

  it('拒绝缺失必填字段', () => {
    expect(
      isPowerFeatures({
        entityId: 'u1',
        windowStart: '2026-10-15T00:00:00Z',
        // 缺失 windowEnd
      })
    ).toBe(false);
  });
});

describe('数据质量检查', () => {
  it('检测时间戳单调性', () => {
    expect(checkMonotonicity(minimalExample)).toBe(true);
    expect(checkMonotonicity(anomalyExample)).toBe(false);
  });

  it('计算缺失值比例', () => {
    const ratio = calculateMissingRatio(minimalExample);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('检测异常值', () => {
    const outliers = detectOutliers(anomalyExample, 'activePower');
    expect(outliers).toBeGreaterThan(0);
  });

  it('检测重复记录', () => {
    const duplicates = detectDuplicates(anomalyExample);
    expect(duplicates).toBeGreaterThan(0);
  });

  it('估计采样频率', () => {
    const interval = estimateSamplingInterval(minimalExample);
    expect(interval).toBe(15 * 60 * 1000); // 15 分钟
  });

  it('执行完整质量检查', () => {
    const report = checkDataQuality(minimalExample);
    expect(report.totalRecords).toBe(minimalExample.length);
    expect(report.quality).toBe('good');
  });

  it('识别低质量数据', () => {
    const report = checkDataQuality(anomalyExample);
    expect(report.quality).toBe('poor');
  });
});

describe('数据转换', () => {
  it('从 CSV 转换', () => {
    const csv = `timestamp,entityId,activePower,voltage
2026-10-15T00:00:00.000Z,user-001,5.2,220
2026-10-15T00:15:00.000Z,user-001,5.8,221`;

    const records = fromCSV(csv, {
      timestamp: 'timestamp',
      entityId: 'entityId',
      activePower: 'activePower',
      voltage: 'voltage',
    });

    expect(records).toHaveLength(2);
    expect(records[0]!.activePower).toBe(5.2);
  });

  it('从 JSON 转换', () => {
    const json = [
      { timestamp: '2026-10-15T00:00:00.000Z', entityId: 'user-001', activePower: 5.2 },
      { timestamp: '2026-10-15T00:15:00.000Z', entityId: 'user-001', activePower: 5.8 },
    ];

    const records = fromJSON(json);
    expect(records).toHaveLength(2);
    expect(records[0]!.activePower).toBe(5.2);
  });

  it('去除重复记录', () => {
    const duplicated = [
      { timestamp: '2026-10-15T00:00:00.000Z', entityId: 'u1', activePower: 5.0 },
      { timestamp: '2026-10-15T00:00:00.000Z', entityId: 'u1', activePower: 6.0 }, // 重复
      { timestamp: '2026-10-15T00:15:00.000Z', entityId: 'u1', activePower: 7.0 },
    ];

    const deduplicated = deduplicateByTimestamp(duplicated);
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated[0]!.activePower).toBe(6.0); // 保留最后一条
  });
});

describe('重采样', () => {
  it('上采样（插值）', () => {
    const records: PowerTimeSeriesRecord[] = [
      { timestamp: '2026-10-15T00:00:00.000Z', entityId: 'u1', activePower: 5.0 },
      { timestamp: '2026-10-15T01:00:00.000Z', entityId: 'u1', activePower: 10.0 },
    ];

    const upsampled = upsample(records, 30 * 60 * 1000); // 30 分钟
    expect(upsampled.length).toBeGreaterThan(2);

    // 检查插值点在原始点之间
    const midPoint = upsampled[1];
    if (midPoint && midPoint.activePower !== undefined) {
      expect(midPoint.activePower).toBeGreaterThan(5.0);
      expect(midPoint.activePower).toBeLessThan(10.0);
    }
  });

  it('下采样（聚合）', () => {
    const downsampled = downsample(minimalExample, 60 * 60 * 1000); // 1 小时
    expect(downsampled.length).toBeLessThan(minimalExample.length);
  });

  it('自动重采样', () => {
    const resampled = resample(minimalExample, 30 * 60 * 1000); // 30 分钟
    expect(resampled.length).toBeGreaterThan(0);
  });
});

describe('示例数据集', () => {
  it('最小示例数据有效', () => {
    expect(minimalExample).toHaveLength(10);
    minimalExample.forEach((record) => {
      expect(isPowerTimeSeriesRecord(record)).toBe(true);
    });
  });

  it('异常数据包含预期的异常', () => {
    expect(anomalyExample.length).toBeGreaterThan(0);

    const hasNegativePower = anomalyExample.some(
      (r) => r.activePower !== undefined && r.activePower < 0
    );
    expect(hasNegativePower).toBe(true);
  });
});
