// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * 节点内解封后的**医疗记录**形状（下移自 `apps/connector/src/domain/types.ts`，change `kernel-stage-contract`）。
 *
 * 为什么下行：它是医疗领域知识（接种史 / 诊断 / 用药 / 不良事件 / 观测），按 D-SPD-18 纯度判据它的字段名
 * 不该出现在基座；基座契约只用中立的 `Record<string, unknown>`。连接器的**非基座**代码（`src/domain/*` 等）
 * 可以直接引用本包；基座目录做不了这件事（守护会报红）。
 */

export interface AdverseEvent {
  organSystem: string;
  term: string;
  serious: boolean;
  /** 不良事件发生日期（ISO 日期串，可选；用于先用药后发病时间窗判定）。 */
  onsetDate?: string;
}

export interface MedicationExposure {
  name: string;
  startDate?: string;
  endDate?: string;
}

export interface InternalRecord {
  subjectKey: string;
  /**
   * 跨院关联假名（可选）：同一主体在不同机构间可对齐的假名（真实场景由空间级加盐摘要得出）。
   * `subjectKey` 是院内假名、各院互不相同；跨院配对只认这个字段，没有它的记录不参与配对。
   */
  linkKey?: string;
  /** 接种史（免疫规划数据产品才有）：CVX 疫苗编码 + 接种日期（ISO）。 */
  immunizations?: Array<{ code: string; date: string }>;
  /** 带日期的就诊事件（医院结局数据产品才有）：诊断编码 + 发生日期（ISO）。 */
  datedEvents?: Array<{ code: string; date: string }>;
  /** 带起止日期的用药暴露明细（可选；保留 medications[] 向后兼容）。 */
  medicationExposures?: MedicationExposure[];
  ageBand: string;
  sex?: string;
  conditions: string[];
  medications: string[];
  adverseEvents: AdverseEvent[];
  followUpDays?: number;
  eventOccurred?: boolean;
  treated?: boolean;
  /** 数值观测（检验 / 体征），按观测名取值；联邦训练切片的特征来源。 */
  observations?: Record<string, number>;
}
