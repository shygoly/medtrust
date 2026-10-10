import type {
  KriDefinitionEntity,
  KriObservationEntity,
} from "@medtrust/database";

/**
 * 标准 KRI 定义 + 演示种子观测（rbqm-central-monitoring D5）。
 * 全部用 `seed:` 前缀 id，随 onModuleInit 幂等种子——线上库易失（deploy 清空
 * 非种子数据），演示不依赖实时连接器也能展示完整的 KRI→越限→存证信号链。
 * 阈值方向：本期 KRI 皆为比例（0–1），direction=higher_worse，op=gte。
 */

export const SEED_STUDY_ID = "seed:study-ckd";

export const SEED_KRI_DEFINITIONS: Array<
  Pick<
    KriDefinitionEntity,
    | "id"
    | "code"
    | "name"
    | "unit"
    | "category"
    | "riskTier"
    | "direction"
    | "windowKind"
    | "thresholds"
    | "description"
    | "status"
  >
> = [
  {
    id: "seed:kri-ae-subject-rate",
    code: "AE_SUBJECT_RATE",
    name: "不良事件受试者比例",
    unit: "%",
    category: "safety",
    riskTier: "intensive",
    direction: "higher_worse",
    windowKind: "cumulative",
    thresholds: [
      { level: "warning", op: "gte", value: 0.25 },
      { level: "critical", op: "gte", value: 0.4 },
    ],
    description: "站点内发生≥1例不良事件的受试者占比；安全性风险信号。",
    status: "active",
  },
  {
    id: "seed:kri-missing-key-field",
    code: "MISSING_KEY_FIELD_RATE",
    name: "关键字段缺失率",
    unit: "%",
    category: "data-quality",
    riskTier: "routine",
    direction: "higher_worse",
    windowKind: "rolling-30d",
    thresholds: [
      { level: "warning", op: "gte", value: 0.1 },
      { level: "critical", op: "gte", value: 0.2 },
    ],
    description: "关键随访字段（如性别/基线指标）缺失比例；数据完整性信号。",
    status: "active",
  },
  {
    id: "seed:kri-followup-incomplete",
    code: "FOLLOWUP_INCOMPLETE_RATE",
    name: "随访完整性缺口",
    unit: "%",
    category: "data-quality",
    riskTier: "elevated",
    direction: "higher_worse",
    windowKind: "cumulative",
    thresholds: [
      { level: "warning", op: "gte", value: 0.15 },
      { level: "critical", op: "gte", value: 0.3 },
    ],
    description: "随访天数缺失或为0的受试者占比；随访依从性信号。",
    status: "active",
  },
  {
    id: "seed:kri-query-rate",
    code: "QUERY_RATE",
    name: "数据质疑率",
    unit: "%",
    category: "data-quality",
    riskTier: "routine",
    direction: "higher_worse",
    windowKind: "rolling-30d",
    thresholds: [
      { level: "warning", op: "gte", value: 0.2 },
      { level: "critical", op: "gte", value: 0.35 },
    ],
    description: "录入后被质疑（query）的记录占比；数据录入质量信号。",
    status: "active",
  },
];

type SeedObs = Pick<
  KriObservationEntity,
  | "id"
  | "kriCode"
  | "siteId"
  | "siteName"
  | "studyId"
  | "periodStart"
  | "periodEnd"
  | "numerator"
  | "denominator"
  | "value"
  | "cohortSize"
  | "suppressed"
  | "submittedAt"
>;

function obs(
  id: string,
  kriCode: string,
  siteId: string,
  siteName: string,
  numerator: number,
  denominator: number,
  suppressed = false,
): SeedObs {
  return {
    id,
    kriCode,
    siteId,
    siteName,
    studyId: SEED_STUDY_ID,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    numerator: suppressed ? 0 : numerator,
    denominator: suppressed ? 0 : denominator,
    value: suppressed || denominator === 0 ? 0 : numerator / denominator,
    cohortSize: denominator,
    suppressed,
    submittedAt: "2026-09-01T00:00:00.000Z",
  };
}

// 两个合成站点（示范甲/示范乙）。示范甲 AE 率越 critical、随访越 warning；
// 示范乙 AE 率越 warning、缺失率越 warning。一条 suppressed 演示小样本抑制。
export const SEED_KRI_OBSERVATIONS: SeedObs[] = [
  // 示范甲
  obs("seed:obs-hs-ae", "AE_SUBJECT_RATE", "p-demohospa", "示范甲医院", 53, 126), // 0.42 → critical
  obs(
    "seed:obs-hs-missing",
    "MISSING_KEY_FIELD_RATE",
    "p-demohospa",
    "示范甲医院",
    8,
    126,
  ), // 0.063 ok
  obs(
    "seed:obs-hs-followup",
    "FOLLOWUP_INCOMPLETE_RATE",
    "p-demohospa",
    "示范甲医院",
    23,
    126,
  ), // 0.183 → warning
  obs("seed:obs-hs-query", "QUERY_RATE", "p-demohospa", "示范甲医院", 15, 126), // 0.119 ok
  // 示范乙
  obs("seed:obs-rj-ae", "AE_SUBJECT_RATE", "p-demohospb", "示范乙医院", 27, 98), // 0.276 → warning
  obs(
    "seed:obs-rj-missing",
    "MISSING_KEY_FIELD_RATE",
    "p-demohospb",
    "示范乙医院",
    13,
    98,
  ), // 0.133 → warning
  obs(
    "seed:obs-rj-followup",
    "FOLLOWUP_INCOMPLETE_RATE",
    "p-demohospb",
    "示范乙医院",
    8,
    98,
  ), // 0.082 ok
  // 小样本抑制演示（分母 < 5）
  obs(
    "seed:obs-rj-query-suppressed",
    "QUERY_RATE",
    "p-demohospb",
    "示范乙医院",
    0,
    0,
    true,
  ),
];
