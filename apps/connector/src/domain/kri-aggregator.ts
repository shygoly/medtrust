import { InternalRecord } from './types';

/**
 * 站点级 KRI 聚合（rbqm-central-monitoring · data-space-connector delta）。
 *
 * RBQM 中心化监查要的是"质量信号"，不是个体数据。本模块在**院内**把本地脱敏
 * 明细算成一个站点的聚合三元组 `{numerator, denominator, value}`，只有这个三元组
 * （+ KRI code / 站点 / 周期）离开连接器。分母低于小格抑制阈值（硬底 5，与
 * OutputGate 同）时整条观测被抑制：numerator/denominator/value 全部置 0 且
 * `suppressed=true`，杜绝小样本反推。输出中永不含 subjectKey 等行级键。
 */

/** 硬底与 OutputGate.DEFAULT_MIN_CELL 一致（5.3 小格抑制）。 */
export const KRI_MIN_CELL = 5;

/** 指标方向：值越高越差 / 越低越差。 */
export type KriDirection = 'higher_worse' | 'lower_worse';

/**
 * KRI 指标口径（封闭集）。每一种都是"分母中满足分子条件的比例"，
 * 分子/分母都从本地明细算，绝不出域个体。
 */
export type KriMetric =
  | 'missing_sex_rate' // 数据完整性：性别缺失率（higher_worse）
  | 'ae_subject_rate' // 安全性：发生≥1例不良事件的受试者比例（higher_worse）
  | 'followup_incomplete_rate'; // 随访完整性：随访天数缺失/为0的比例（higher_worse）

export interface KriSpec {
  code: string;
  metric: KriMetric;
  direction: KriDirection;
}

/** 站点级聚合观测（仅此结构出域，无行级数据）。 */
export interface KriObservation {
  kriCode: string;
  /** 满足指标条件的例数（如缺失例数）。suppressed 时为 0。 */
  numerator: number;
  /** 参与计算的总例数。suppressed 时为 0。 */
  denominator: number;
  /** numerator/denominator（比例，0–1）。suppressed 时为 0。 */
  value: number;
  /** 站点队列规模（= 明细行数），用于监查台展示，非个体。 */
  cohortSize: number;
  suppressed: boolean;
}

function numeratorOf(records: readonly InternalRecord[], metric: KriMetric): number {
  switch (metric) {
    case 'missing_sex_rate':
      return records.filter((r) => r.sex === undefined || r.sex === '').length;
    case 'ae_subject_rate':
      return records.filter((r) => (r.adverseEvents?.length ?? 0) > 0).length;
    case 'followup_incomplete_rate':
      return records.filter((r) => r.followUpDays === undefined || r.followUpDays <= 0).length;
  }
}

/**
 * 从本地明细算出一个站点某 KRI 的聚合观测。
 * @param threshold 小格抑制阈值，默认 KRI_MIN_CELL（不得低于硬底 5 由调用方保证）。
 */
export function aggregateKri(
  records: readonly InternalRecord[],
  spec: KriSpec,
  threshold: number = KRI_MIN_CELL,
): KriObservation {
  const denominator = records.length;
  const cohortSize = denominator;

  // 5.3 小格抑制：分母过小 → 整条抑制，不出精确计数。
  if (denominator < Math.max(threshold, KRI_MIN_CELL)) {
    return {
      kriCode: spec.code,
      numerator: 0,
      denominator: 0,
      value: 0,
      cohortSize,
      suppressed: true,
    };
  }

  const numerator = numeratorOf(records, spec.metric);
  const value = denominator > 0 ? numerator / denominator : 0;
  return {
    kriCode: spec.code,
    numerator,
    denominator,
    value,
    cohortSize,
    suppressed: false,
  };
}
