import { z } from "zod";

// rws-study-protocol-spec — client-side zod schema mirroring the backend
// `validateRwsAnalysisLadder` (apps/api/src/compute-task/dto/rws-analysis-spec.ts).
// The backend is the authority; this schema gives instant UX feedback so the
// user sees "designType required" before the HTTP 400 round-trip.
//
// D-UI-1: this is the canonical zod schema for RWS protocol forms. Both the
// submit form (`tasks/new/rws/page.tsx`) and the revise panel share it.

export const RWS_DESIGN_TYPES = [
  "cross-sectional",
  "cohort",
  "case-control",
  "nested-case-control",
  "case-cohort",
  "case-crossover",
] as const;

export const MISSINGNESS_MECHANISMS = ["MCAR", "MAR", "MNAR"] as const;

/** D-RWS-10 / P-EVD-11 — L3 因果匹配策略封闭枚举（镜像后端
 * MATCHING_STRATEGIES；后端 validateRwsAnalysisLadder 是权威）。 */
export const MATCHING_STRATEGIES = [
  "within-stratum",
  "cross-stratum-nearest",
] as const;

/**
 * Frozen-set per rws-study-protocol-spec D3. After first dispatch these
 * fields are immutable; only `/revise` (which creates a new version) can
 * change them. Used by the 🔒 field markers in the submit form.
 */
export const FROZEN_FIELDS = [
  "designType",
  "rationale",
  "tte",
  "matchingCovariates",
  // D-RWS-10: 匹配策略决定估计量口径，冻结后不可改（与 tte 同级）。
  "matchingStrategy",
  "allowedArtifacts",
  "sap",
  "missingness",
  "sensitivityAnalyses",
  "outcomeAlgorithm",
  "exposureAlgorithm",
  "comparatorAlgorithm",
  "algorithm",
  "variableDefinitionId",
  "goldStandardSetVersion",
] as const;

const sapSchema = z
  .object({
    significanceLevel: z.number().gt(0).lt(1),
    power: z.number().gt(0).lt(1).optional(),
    sampleSizeAssumption: z.number().positive().finite().optional(),
    sampleSizeJustification: z.string().optional(),
    multiplicityAlphaAdjustment: z.string().optional(),
  })
  .strict();

const missingnessSchema = z
  .object({
    mechanism: z.enum(MISSINGNESS_MECHANISMS),
    imputationStrategy: z.string().min(1, "缺失值填补策略不能为空"),
  })
  .strict();

const sensitivityAnalysisSchema = z
  .object({
    id: z.string().min(1, "敏感性分析 id 不能为空"),
    description: z.string().min(1, "敏感性分析描述不能为空"),
  })
  .strict();

const algorithmRefSchema = z
  .object({
    id: z.string(),
    version: z.string(),
    expression: z.unknown(),
  })
  .strict();

/**
 * The full RWS analysis-spec schema. Field-level shape is here; the
 * required-by-level + designType-paired rules are in `superRefine` below
 * (mirroring the backend validator's structure).
 */
export const rwsAnalysisSchema = z
  .object({
    type: z.string().min(1),
    level: z.string().optional(),
    drug: z.string().optional(),
    outcome: z.string().optional(),
    method: z.string().optional(),
    matchingStrategy: z.enum(MATCHING_STRATEGIES).optional(),
    tte: z
      .object({
        exposureArm: z.string(),
        comparatorArm: z.string(),
        timeZeroRule: z.string(),
        inclusion: z.preprocess(
          (v) =>
            typeof v === "string"
              ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
              : v,
          z.array(z.string()),
        ),
        exclusion: z.preprocess(
          (v) =>
            typeof v === "string"
              ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
              : v,
          z.array(z.string()),
        ),
        outcome: z.object({
          type: z.enum(["time_to_event", "binary"]),
          event: z.string(),
          censoring: z.string().optional(),
        }),
        graceDays: z.preprocess(
          (v) => (typeof v === "number" && Number.isNaN(v) ? undefined : v),
          z.number().optional(),
        ),
        washoutDays: z.preprocess(
          (v) => (typeof v === "number" && Number.isNaN(v) ? undefined : v),
          z.number().optional(),
        ),
        matchingCovariates: z.preprocess(
          (v) =>
            typeof v === "string"
              ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
              : v,
          z.array(z.string()).optional(),
        ),
      })
      .optional(),
    allowedArtifacts: z.array(z.string()).optional(),
    algorithm: algorithmRefSchema.optional(),
    variableDefinitionId: z.string().optional(),
    goldStandardSetVersion: z.string().optional(),
    designType: z.enum(RWS_DESIGN_TYPES).optional(),
    rationale: z.string().optional(),
    sap: sapSchema.optional(),
    missingness: missingnessSchema.optional(),
    sensitivityAnalyses: z.array(sensitivityAnalysisSchema).optional(),
    outcomeAlgorithm: algorithmRefSchema.optional(),
    exposureAlgorithm: algorithmRefSchema.optional(),
    comparatorAlgorithm: algorithmRefSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const isL0 = data.type === "algorithm-validation";

    // designType + rationale: required for all real study types (L0 exempt).
    if (!isL0) {
      if (!data.designType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["designType"],
          message: "必须声明流行病学设计类型（§2.5）",
        });
      }
      if (data.designType && (!data.rationale || !data.rationale.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rationale"],
          message: "选了设计类型就必须填写选型理由（§2.5）",
        });
      }
    }

    // SAP required for L2/L3/L4 (D4).
    const level = data.level;
    const requiresSap = level === "L2" || level === "L3" || level === "L4";
    if (requiresSap && !data.sap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sap"],
        message: `层级 ${level} 必须声明 SAP（§3.1/§3.2）`,
      });
    }

    if (data.type === "comparative-effect") {
      if (!data.drug?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["drug"],
          message: "L2 比较效果必须指定药物",
        });
      }
      if (!data.outcome?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome"],
          message: "L2 比较效果必须指定结局",
        });
      }
    }
    // D-RWS-10 / P-EVD-11 — 匹配策略：L3 因果必填，其他类型给了即拒。
    // 「声明值 vs 通道实际配对行为」的一致性由后端按迁移台账 fail-closed
    // 校验——客户端看不到台账，不在此复制台账逻辑（后端 400 文案会说明原因）。
    const isL3Causal =
      data.type === "causal-psm" || data.type === "causal-survival";
    if (data.matchingStrategy && !isL3Causal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["matchingStrategy"],
        message:
          "只有 L3 因果类型（causal-psm / causal-survival）接受匹配策略声明，其他类型给了即拒",
      });
    }
    if (isL3Causal && !data.matchingStrategy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["matchingStrategy"],
        message:
          "L3 因果必须预先声明匹配策略（within-stratum / cross-stratum-nearest，D-RWS-10 / P-EVD-11）",
      });
    }
    if (data.type === "causal-psm" || data.type === "causal-survival") {
      if (!data.tte) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tte"],
          message: "L3 因果必须声明 TTE 块",
        });
      } else {
        if (!data.tte.exposureArm?.trim() || !data.tte.comparatorArm?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tte", "exposureArm"],
            message: "TTE 暴露臂与对照臂必填",
          });
        }
        if (!data.tte.timeZeroRule?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tte", "timeZeroRule"],
            message: "TTE timeZeroRule 必填",
          });
        }
        if (!data.tte.outcome?.event?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tte", "outcome", "event"],
            message: "TTE 结局事件必填",
          });
        }
      }
    }
    if (data.sensitivityAnalyses && data.sensitivityAnalyses.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sensitivityAnalyses"],
        message: "敏感性分析执行器尚未接线，禁止声明（EVD-10 fail-closed）",
      });
    }

    // Multiplicity α-adjustment: required for multi-comparison tasks.
    // Heuristic mirrors the backend — multi-subgroup TTE or L1.5 scan without
    // drug+outcome pinning.
    const multiSubgroup =
      Array.isArray(data.tte?.matchingCovariates) &&
      (data.tte!.matchingCovariates!.length > 1);
    const l15ScanWithoutPin =
      level === "L1.5" &&
      (!data.drug || !(data.outcome ?? data.tte?.outcome?.event));
    if (
      (multiSubgroup || l15ScanWithoutPin) &&
      !data.sap?.multiplicityAlphaAdjustment
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sap", "multiplicityAlphaAdjustment"],
        message: "多重比较任务必须声明 α 校正方式（§3.1）",
      });
    }

    // Outcome-exposure independence (structured path only; free-text is a
    // backend warning, not a zod rejection — it's not actionable client-side).
    const collectCodes = (expr: unknown, acc: Set<string>): void => {
      if (!expr || typeof expr !== "object") return;
      const e = expr as Record<string, unknown>;
      if (e.kind === "codeset" && e.codeset && typeof e.codeset === "object") {
        const cs = e.codeset as Record<string, unknown>;
        if (Array.isArray(cs.codes)) {
          for (const c of cs.codes) if (typeof c === "string") acc.add(c);
        }
      }
      if (Array.isArray(e.children)) for (const c of e.children) collectCodes(c, acc);
      if (e.child) collectAlgorithmCodesForRefine(e.child, acc);
    };
    const collectAlgorithmCodesForRefine = collectCodes; // alias for recursion readability
    if (data.outcomeAlgorithm && (data.exposureAlgorithm || data.comparatorAlgorithm)) {
      const outcomeCodes = new Set<string>();
      collectCodes(data.outcomeAlgorithm.expression, outcomeCodes);
      const exposureCodes = new Set<string>();
      if (data.exposureAlgorithm) collectCodes(data.exposureAlgorithm.expression, exposureCodes);
      if (data.comparatorAlgorithm) collectCodes(data.comparatorAlgorithm.expression, exposureCodes);
      const intersection = [...outcomeCodes].filter((c) => exposureCodes.has(c));
      if (intersection.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeAlgorithm"],
          message: `结局与暴露存在编码交集（§2.7.4）：${intersection.slice(0, 5).join(", ")}`,
        });
      }
    }
  });

export type RwsAnalysisFormData = z.infer<typeof rwsAnalysisSchema>;

/**
 * The full submit-form schema: wraps the analysis with the outer fields the
 * form manages (title, contractIds, L0 algorithmJson as a raw string).
 */
export const rwsSubmitFormSchema = z.object({
  title: z.string().optional(),
  analysis: rwsAnalysisSchema,
  contractIds: z.array(z.string().min(1)).min(1, "至少选择一份合约"),
});

export type RwsSubmitFormData = z.infer<typeof rwsSubmitFormSchema>;

/**
 * The revise-form schema: adds the required `revisionReason`. The analysis
 * part reuses `rwsAnalysisSchema` so shape validation is identical to submit.
 */
export const rwsReviseFormSchema = z.object({
  analysis: rwsAnalysisSchema,
  revisionReason: z.string().min(1, "修订必须填写原因（§1.2 留痕）"),
  contractIds: z.array(z.string().min(1)).optional(),
});

export type RwsReviseFormData = z.infer<typeof rwsReviseFormSchema>;
