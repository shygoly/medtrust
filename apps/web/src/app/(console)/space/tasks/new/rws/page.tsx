"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, Info } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader, Panel } from "@/components/console/ui";
import {
  ContractMultiSelect,
  ContractPolicyPreview,
  OrchestrationSubmitPanel,
} from "@/components/console/orchestration";
import { FreezeLabel } from "@/components/console/orchestration/field-freeze-marker";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";
import { compactPayload } from "@/lib/compact-payload";
import { workloadMeta } from "@/lib/orchestration-workloads";
import {
  rwsSubmitFormSchema,
  RwsSubmitFormData,
  RWS_DESIGN_TYPES,
  MISSINGNESS_MECHANISMS,
} from "@/lib/rws-protocol-schema";

const analysisTypes = [
  { value: "condition-prevalence", label: "慢病/服务谱分布" },
  { value: "cohort-count", label: "队列规模（年龄带）" },
  { value: "adverse-event-signal", label: "不良反应信号" },
  { value: "disproportionality", label: "L1.5 失衡信号（PRR/ROR）" },
  { value: "comparative-effect", label: "L2 比较效果" },
  { value: "causal-survival", label: "L3 因果（Cox/KM）" },
  { value: "algorithm-validation", label: "L0 · 算法准确性验证" },
] as const;

// Default analysisType → level mapping (the spec ties certain types to levels).
const typeToLevel: Record<string, string> = {
  disproportionality: "L1.5",
  "comparative-effect": "L2",
  "causal-survival": "L3",
  "causal-psm": "L3",
  "algorithm-validation": "L0",
};

const meta = workloadMeta("rws");

const DEFAULT_ALGORITHM_JSON = JSON.stringify(
  {
    id: "panc-ae-term-v1",
    version: "1.0.0",
    expression: {
      kind: "codeset",
      codeset: {
        codeSystem: "MedDRA",
        codeSystemVersion: "26.1",
        codes: ["acute pancreatitis"],
        valueSource: "discharge_dx",
        diagnosisOrder: "any",
      },
    },
  },
  null,
  2,
);

const DEFAULT_VALUES: RwsSubmitFormData = {
  title: "",
  contractIds: [],
  analysis: {
    type: "cohort-count",
    designType: "cross-sectional",
    rationale: "",
  },
};

export default function NewRwsTaskPage() {
  const [msg, setMsg] = useState("");
  const [taskId, setTaskId] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const searchParams = useSearchParams();

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RwsSubmitFormData>({
    resolver: zodResolver(rwsSubmitFormSchema) as never,
    defaultValues: DEFAULT_VALUES,
    mode: "onBlur",
  });

  const { data: contracts } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => api.listContracts(),
  });

  const activeContracts = useMemo(
    () =>
      ((contracts as any[]) ?? []).filter(
        (c) => (c.effectiveStatus ?? c.status) === "active",
      ),
    [contracts],
  );

  const analysisType = watch("analysis.type");
  const contractIds = watch("contractIds");
  const selected = activeContracts.find((c) => c.id === contractIds[0]);
  const isL0 = analysisType === "algorithm-validation";
  const isL3 = analysisType === "causal-survival" || analysisType === "causal-psm";
  const showDrugOutcome =
    analysisType === "disproportionality" ||
    analysisType === "comparative-effect" ||
    analysisType === "adverse-event-signal";
  const level = typeToLevel[analysisType] ?? "";
  const requiresSap = level === "L2" || level === "L3" || level === "L4";

  const onAnalysisTypeChange = (newType: string) => {
    setValue("analysis.type", newType);
    const newLevel = typeToLevel[newType];
    if (newLevel) setValue("analysis.level", newLevel);
    // L0 is exempt from designType — clear it to avoid spurious validation.
    if (newType === "algorithm-validation") {
      setValue("analysis.designType", undefined as never);
      setValue("analysis.rationale", undefined as never);
      setValue("analysis.tte", undefined as never);
      setValue("variableDefinitionId" as never, "acute-pancreatitis" as never);
      setValue("goldStandardSetVersion" as never, "injected-v1" as never);
      if (!(watch as any)("algorithmJson")) {
        setValue("algorithmJson" as never, DEFAULT_ALGORITHM_JSON as never);
      }
    } else if (newType === "comparative-effect" || newType === "causal-survival" || newType === "causal-psm") {
      setValue("analysis.designType", "cohort");
      setValue(
        "analysis.rationale",
        watch("analysis.rationale") ||
          "New-user TTE：insulin vs metformin 急性胰腺炎（注入真值 HR=2.5）",
      );
      setValue("analysis.drug", watch("analysis.drug") || "insulin");
      setValue("analysis.sap" as never, {
        significanceLevel: 0.05,
        power: 0.8,
        sampleSizeAssumption: 5000,
        sampleSizeJustification: "injected insulin–metformin pancreatitis cohort ≈5k/site",
      } as never);
      if (newType === "causal-survival" || newType === "causal-psm") {
        setValue("analysis.method", newType === "causal-survival" ? "cox" : "psm");
        setValue("analysis.tte" as never, {
          exposureArm: "drug:insulin",
          comparatorArm: "drug:metformin",
          timeZeroRule: "index_prescription",
          inclusion: [],
          exclusion: [],
          outcome: { type: "time_to_event", event: "acute pancreatitis" },
          matchingCovariates: ["ageBand", "sex"],
        } as never);
      } else {
        setValue("analysis.outcome", watch("analysis.outcome") || "acute pancreatitis");
        setValue("analysis.tte", undefined as never);
      }
    } else {
      setValue("analysis.tte", undefined as never);
      if (!watch("analysis.designType")) {
        setValue("analysis.designType", "cross-sectional");
      }
    }
  };


  // Deep-link from /space/tasks/new L0 card: ?analysis=algorithm-validation
  useEffect(() => {
    const analysis = searchParams.get("analysis");
    if (analysis === "algorithm-validation") {
      onAnalysisTypeChange("algorithm-validation");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / query only
  }, [searchParams]);

  const submit = handleSubmit(async (data) => {
    setMsg("提交中…");
    try {
      if (!data.contractIds.length) throw new Error("请选择生效数字合约");
      const purpose = selected?.purpose;
      if (!purpose) throw new Error("合约缺少目的字段");

      // Build the analysis payload. L0 carries the algorithm JSON; non-L0
      // carries the protocol fields. Omit empty optionals.
      let analysisPayload: Record<string, unknown>;
      if (isL0) {
        const algoRaw = (watch as any)("algorithmJson") ?? DEFAULT_ALGORITHM_JSON;
        let parsedAlgo: unknown;
        try {
          parsedAlgo = JSON.parse(algoRaw);
        } catch (e: any) {
          throw new Error(`算法 JSON 解析失败：${e?.message ?? "语法错误"}`);
        }
        analysisPayload = {
          type: "algorithm-validation",
          level: "L0",
          algorithm: parsedAlgo,
          variableDefinitionId: (watch as any)("variableDefinitionId") || "acute-pancreatitis",
          goldStandardSetVersion: (watch as any)("goldStandardSetVersion") || "injected-v1",
          allowedArtifacts: ["validation_metrics"],
        };
      } else {
        // Strip undefined / empty-string optionals at every depth (e.g. an empty
        // sap.multiplicityAlphaAdjustment) — the backend rejects present-but-empty fields.
        analysisPayload = compactPayload(data.analysis as Record<string, unknown>);
      }

      const r = await api.submitRwsTask({
        title: data.title || `RWS ${analysisType}`,
        purpose,
        analysis: analysisPayload as any,
        contractIds: data.contractIds,
      });
      setTaskId(r.taskId);
      setMsg("已提交 ✓ 等待连接器执行");
    } catch (e: any) {
      setMsg(`失败: ${e?.message ?? "请求错误"}`);
    }
  });

  return (
    <div>
      <PageHeader
        kicker={`${meta.shortLabel} TASK · 新建`}
        title="发起 RWS 任务"
        desc="提交后控制面校验数字合约与研究方案完备性（§3.1 SAP、§2.5 设计类型），各院连接器出站拉取任务并执行。"
      />
      <div className="p-8">
        <Link
          href="/space/tasks/new"
          className="inline-flex items-center gap-1.5 text-sm mb-6"
          style={{ color: "var(--cs-dim)" }}
        >
          <ArrowLeft size={14} /> 切换任务类型
        </Link>

        {/* §6.5 boundary text — system checks form, not scientific soundness. */}
        <div
          className="mb-4 p-3 text-[0.72rem] flex items-start gap-2"
          style={{
            color: "var(--cs-amber)",
            border: "1px solid var(--cs-amber)",
          }}
        >
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            系统只校验要素完备性与形式一致性（字段必填、闭合语法、结局-暴露独立性），
            方法学合理性由研究者与伦理审查负责。
          </span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <form onSubmit={submit} className="xl:col-span-2 space-y-6">
            {/* Group 1: 基本信息 */}
            <Panel className="p-6 space-y-5">
              <div className="cs-label">基本信息</div>
              <div>
                <FreezeLabel field="title">任务标题</FreezeLabel>
                <input
                  className="cs-input"
                  placeholder="如: 肾内科病历文本队列分析"
                  {...register("title")}
                />
              </div>
              <Controller
                control={control}
                name="contractIds"
                render={({ field }) => (
                  <ContractMultiSelect
                    multiple
                    contracts={activeContracts}
                    selectedIds={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <div>
                <FreezeLabel field="designType">分析类型</FreezeLabel>
                <select
                  className="cs-input"
                  value={analysisType}
                  onChange={(e) => onAnalysisTypeChange(e.target.value)}
                >
                  {analysisTypes.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {!isL0 && (showDrugOutcome || analysisType === "cohort-count" || analysisType === "condition-prevalence") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FreezeLabel field="drug">
                      {showDrugOutcome ? "药物 / 暴露" : "用药过滤（可选）"}
                    </FreezeLabel>
                    <input
                      className="cs-input"
                      placeholder="如 insulin"
                      {...register("analysis.drug")}
                    />
                    {errors.analysis?.drug && (
                      <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                        {errors.analysis.drug.message as string}
                      </span>
                    )}
                  </div>
                  {showDrugOutcome && (
                    <div>
                      <FreezeLabel field="outcome">结局</FreezeLabel>
                      <input
                        className="cs-input"
                        placeholder="如 MI / AKI"
                        {...register("analysis.outcome")}
                      />
                      {errors.analysis?.outcome && (
                        <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                          {errors.analysis.outcome.message as string}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Panel>

            {/* Group 2: 研究设计 (non-L0 only) */}
            {!isL0 && (
              <Panel className="p-6 space-y-5">
                <div className="cs-label">研究设计（§2.5）</div>
                <div>
                  <FreezeLabel field="designType">
                    流行病学设计类型
                  </FreezeLabel>
                  <select
                    className="cs-input"
                    {...register("analysis.designType")}
                  >
                    <option value="">— 请选择 —</option>
                    {RWS_DESIGN_TYPES.map((dt) => (
                      <option key={dt} value={dt}>
                        {dt}
                      </option>
                    ))}
                  </select>
                  {errors.analysis?.designType && (
                    <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                      {errors.analysis.designType.message as string}
                    </span>
                  )}
                </div>
                <div>
                  <FreezeLabel field="rationale">选型理由</FreezeLabel>
                  <textarea
                    className="cs-input"
                    rows={3}
                    placeholder="说明为何选此设计类型（规范 §2.5：不推荐认定某设计一定优于其他，按研究问题选择）"
                    {...register("analysis.rationale")}
                  />
                  {errors.analysis?.rationale && (
                    <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                      {errors.analysis.rationale.message as string}
                    </span>
                  )}
                </div>
              </Panel>
            )}

            {/* Group 3: SAP (L2/L3/L4 only) */}
            {requiresSap && (
              <Panel className="p-6 space-y-5">
                <div className="cs-label">统计分析计划 SAP（§3.1/§3.2）</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FreezeLabel field="sap">显著性水平 α</FreezeLabel>
                    <input
                      type="number"
                      step="0.001"
                      className="cs-input"
                      placeholder="0.05"
                      {...register("analysis.sap.significanceLevel", {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="sap">检验效能</FreezeLabel>
                    <input
                      type="number"
                      step="0.01"
                      className="cs-input"
                      placeholder="0.8"
                      {...register("analysis.sap.power", { valueAsNumber: true })}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="sap">样本量假设</FreezeLabel>
                    <input
                      type="number"
                      className="cs-input"
                      placeholder="如 1200"
                      {...register("analysis.sap.sampleSizeAssumption", {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="sap">多重性 α 校正</FreezeLabel>
                    <input
                      className="cs-input"
                      placeholder="如 Bonferroni α/3（多重比较时必填）"
                      {...register("analysis.sap.multiplicityAlphaAdjustment")}
                    />
                  </div>
                </div>
                <div>
                  <FreezeLabel field="sap">样本量依据</FreezeLabel>
                  <textarea
                    className="cs-input"
                    rows={2}
                    placeholder="如：按目标药暴露频率估算，powered for HR=0.7"
                    {...register("analysis.sap.sampleSizeJustification")}
                  />
                </div>
                {errors.analysis?.sap && (
                  <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                    {(errors.analysis.sap as any).message?.toString() ||
                      "SAP 字段有误"}
                  </span>
                )}
              </Panel>
            )}

            {/* Group 3b: L3 TTE (EVD / §2.6) */}
            {isL3 && (
              <Panel className="p-6 space-y-5">
                <div className="cs-label">L3 生存 / TTE 规格</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FreezeLabel field="tte">暴露臂</FreezeLabel>
                    <input
                      className="cs-input"
                      placeholder="如 insulin"
                      {...register("analysis.tte.exposureArm")}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="tte">对照臂</FreezeLabel>
                    <input
                      className="cs-input"
                      placeholder="如 metformin"
                      {...register("analysis.tte.comparatorArm")}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="tte">Time-zero 规则</FreezeLabel>
                    <input
                      className="cs-input"
                      placeholder="如 index_prescription"
                      {...register("analysis.tte.timeZeroRule")}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="tte">结局类型</FreezeLabel>
                    <select className="cs-input" {...register("analysis.tte.outcome.type")}>
                      <option value="time_to_event">time_to_event</option>
                      <option value="binary">binary</option>
                    </select>
                  </div>
                  <div>
                    <FreezeLabel field="tte">结局事件</FreezeLabel>
                    <input
                      className="cs-input"
                      placeholder="如 AKI / death"
                      {...register("analysis.tte.outcome.event")}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="tte">删失</FreezeLabel>
                    <select className="cs-input" {...register("analysis.tte.outcome.censoring")}>
                      <option value="">— 不声明 —</option>
                      <option value="administrative">administrative</option>
                      <option value="loss_to_followup">loss_to_followup</option>
                    </select>
                  </div>
                  <div>
                    <FreezeLabel field="tte">宽限期（天）</FreezeLabel>
                    <input
                      type="number"
                      className="cs-input"
                      {...register("analysis.tte.graceDays", { valueAsNumber: true })}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="tte">清洗期（天）</FreezeLabel>
                    <input
                      type="number"
                      className="cs-input"
                      {...register("analysis.tte.washoutDays", { valueAsNumber: true })}
                    />
                  </div>
                </div>
                <div>
                  <FreezeLabel field="tte">纳入标准（逗号或换行分隔）</FreezeLabel>
                  <textarea
                    className="cs-input"
                    rows={2}
                    placeholder="如 new-user, first exposure"
                    {...register("analysis.tte.inclusion" as never)}
                  />
                </div>
                <div>
                  <FreezeLabel field="tte">排除标准（逗号或换行分隔）</FreezeLabel>
                  <textarea
                    className="cs-input"
                    rows={2}
                    {...register("analysis.tte.exclusion" as never)}
                  />
                </div>
                {errors.analysis?.tte && (
                  <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                    {(errors.analysis.tte as { message?: string }).message ??
                      "TTE 字段不完整"}
                  </span>
                )}
              </Panel>
            )}

            {/* Group 4: L0 algorithm-validation */}
            {isL0 && (
              <Panel className="p-6 space-y-5">
                <div className="cs-label" style={{ color: "var(--cs-cyan)" }}>
                  L0 算法验证 · 操作性定义
                </div>
                <div>
                  <FreezeLabel field="algorithm">识别算法 JSON（闭合语法 AST）</FreezeLabel>
                  <textarea
                    className="cs-input cs-mono"
                    rows={14}
                    spellCheck={false}
                    defaultValue={DEFAULT_ALGORITHM_JSON}
                    {...register("algorithmJson" as never)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FreezeLabel field="variableDefinitionId">
                      变量定义标识
                    </FreezeLabel>
                    <input
                      className="cs-input"
                      defaultValue="acute-pancreatitis"
                      {...register("variableDefinitionId" as never)}
                    />
                  </div>
                  <div>
                    <FreezeLabel field="goldStandardSetVersion">
                      金标准标注集版本
                    </FreezeLabel>
                    <input
                      className="cs-input"
                      defaultValue="injected-v1"
                      {...register("goldStandardSetVersion" as never)}
                    />
                  </div>
                </div>
                <p className="text-[0.72rem]" style={{ color: "var(--cs-amber)" }}>
                  合成数据（Synthea）金标准的验证结果 MUST NOT 用于监管申报。
                </p>
              </Panel>
            )}

            {/* Group 5: Optional (missingness + sensitivity) — collapsible */}
            {!isL0 && (
              <Panel className="p-6 space-y-4">
                <button
                  type="button"
                  onClick={() => setShowOptional((s) => !s)}
                  className="cs-label flex items-center gap-1.5"
                >
                  {showOptional ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  可选声明（缺失值）
                </button>
                {showOptional && (
                  <div className="space-y-5">
                    <div>
                      <FreezeLabel field="missingness">缺失值机制</FreezeLabel>
                      <select
                        className="cs-input"
                        {...register("analysis.missingness.mechanism")}
                      >
                        <option value="">— 不声明 —</option>
                        {MISSINGNESS_MECHANISMS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FreezeLabel field="missingness">填补策略</FreezeLabel>
                      <input
                        className="cs-input"
                        placeholder="如 multiple imputation"
                        {...register("analysis.missingness.imputationStrategy")}
                      />
                      {errors.analysis?.missingness && (
                        <span className="text-xs" style={{ color: "var(--cs-red)" }}>
                          机制与填补策略必须同时声明
                        </span>
                      )}
                    </div>

                    <div
                      className="p-3 text-[0.72rem]"
                      style={{
                        color: "var(--cs-amber)",
                        border: "1px solid var(--cs-amber)",
                      }}
                    >
                      敏感性分析执行器尚未接线，禁止声明（EVD-10 fail-closed）。
                      接线后将开启声明入口，并依旧对账 sensitivityResults。
                    </div>
                  </div>
                )}
              </Panel>
            )}
          </form>

          <ContractPolicyPreview
            contract={selected}
            requiredArtifacts={isL0 ? ["validation_metrics"] : undefined}
            requiredLevels={isL0 ? ["L0"] : level ? [level] : undefined}
          >
            <OrchestrationSubmitPanel
              disabled={!contractIds.length}
              onSubmit={submit}
              msg={msg}
              taskId={taskId}
              taskHref={
                taskId ? `/space/tasks/${taskId}?workload=rws` : undefined
              }
            />
          </ContractPolicyPreview>
        </div>
      </div>
    </div>
  );
}
