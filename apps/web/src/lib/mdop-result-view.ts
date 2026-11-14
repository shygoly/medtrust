/**
 * MDOP C3 合并结果 → 详情结果区视图（task-detail / mdop-result-readability）。
 * 纯函数：只挑展示字段，缺列回退「—」，不丢已有指标。
 */

import {
  scriRelativeIncidence,
  scriStratumLabel,
  scriWindowLabel,
  windowDaySpan,
} from "./scri-relative-incidence";

export type MdopResultKind =
  | "disproportionality"
  | "vaccine-scri"
  | "fl-prediction"
  | "external-control-registration"
  | "paired-cohort"
  | "generic"
  | "empty";

export interface MdopResultMetricRow {
  /** 原始结局键（多为英文术语）。 */
  key: string;
  /** 面向研究者的结局显示名。 */
  outcomeLabel: string;
  count: string;
  prr: string;
  ror: string;
  prrCi: string;
  rorCi: string;
  signal: boolean | null;
  signalLabel: string;
}

/** 配对队列等键值指标行。 */
export interface MdopKvRow {
  label: string;
  value: string;
  help?: string;
}

export interface MdopScriStratumRow {
  key: string;
  keyLabel: string;
  doses: string;
  riskEvents: string;
  controlEvents: string;
  suppressed: boolean;
  ri: string;
  riCi: string;
}

export interface MdopFlMetricRow {
  label: string;
  value: string;
}

export interface MdopResultView {
  kind: MdopResultKind;
  analysisType: string | null;
  analysisLabel: string;
  summaryLine: string;
  hasSignal: boolean;
  rows: MdopResultMetricRow[];
  kvRows: MdopKvRow[];
  scriStrata: MdopScriStratumRow[];
  flMetrics: MdopFlMetricRow[];
  modelHash: string | null;
}

const ANALYSIS_LABELS: Record<string, string> = {
  disproportionality: "失衡信号（L1.5）",
  "vaccine-scri": "疫苗 SCRI",
  "paired-cohort": "配对队列",
  "external-control-registration": "外对照注册研究",
  "fl-prediction": "联邦预测（L4）",
  "condition-prevalence": "患病率",
  "cohort-count": "队列计数",
  "comparative-effect": "比较效果",
  "causal-psm": "因果 PSM",
  "causal-survival": "因果生存",
  "algorithm-validation": "算法验证（L0）",
  "adverse-event-signal": "不良事件信号",
};

/** 常见结局键 → 中文；未登记则原样返回。 */
const OUTCOME_LABELS: Record<string, string> = {
  "acute pancreatitis": "急性胰腺炎",
  pancreatitis: "胰腺炎",
  "myocardial infarction": "心肌梗死",
  "acute kidney injury": "急性肾损伤",
  anaphylaxis: "过敏性休克",
  "liver injury": "肝损伤",
  "hepatic failure": "肝衰竭",
  stroke: "卒中",
  seizure: "癫痫发作",
  thrombocytopenia: "血小板减少",
};

/** L1.5 四格表 / 指标说明（表下图例与表头 title 共用）。 */
export const L15_METRIC_HELP = {
  outcome: "要评估的不良事件或临床结局（相对研究用药/暴露）。",
  countA: "四格表格子 a：同时具备「暴露（用药）」与「该结局」的例数。",
  prr: "比例报告比：暴露人群中该结局报告比例，相对非暴露人群的比值；>1 表示报告偏多。",
  ror: "报告比值比：暴露与结局关联的另一种比值指标；解读方向与 PRR 类似。",
  signal:
    "是否达到预设安全信号阈值（如 Evans：PRR≥2 且 χ²≥4 且 a≥3）。「检出」= 达到阈值，不等于已确认因果关系。",
} as const;

export const PAIRED_METRIC_HELP = {
  cohortSize: "配对后纳入分析的总人数。",
  exposed: "暴露（用药/干预）侧人数。",
  outcome: "出现研究结局的人数（暴露与未暴露合计）。",
  exposedWithOutcome: "既暴露又出现结局的人数。",
  direction: "由四计数推出的粗率比较；未做混杂调整与显著性检验。",
} as const;

export const FL_METRIC_LABELS: Record<string, string> = {
  auc: "AUC（区分度）",
  f1: "F1",
  precision: "精确率",
  recall: "召回率",
  accuracy: "准确率",
};

export const SCRI_METRIC_HELP = {
  ri: "相对发生率（RI）：按窗口长度校正后，风险期相对对照期的事件发生率比值；>1 表示风险期更高。",
  inestimable: "总事件为 0、对照期无事件或窗口缺失时不可估计，不用 0 或 ∞ 冒充。",
} as const;

export function outcomeEventLabel(key: string): string {
  const k = key.trim();
  if (!k) return DASH;
  const mapped = OUTCOME_LABELS[k.toLowerCase()];
  return mapped ?? k;
}

const DASH = "—";

function emptyExtras(): Pick<
  MdopResultView,
  "kvRows" | "scriStrata" | "flMetrics" | "modelHash"
> {
  return { kvRows: [], scriStrata: [], flMetrics: [], modelHash: null };
}

function num(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : DASH;
}

function ci(v: unknown): string {
  if (!Array.isArray(v) || v.length < 2) return DASH;
  const a = typeof v[0] === "number" ? v[0].toFixed(3) : DASH;
  const b = typeof v[1] === "number" ? v[1].toFixed(3) : DASH;
  if (a === DASH && b === DASH) return DASH;
  return `[${a}, ${b}]`;
}

function fmtMetric(v: unknown, digits = 3): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : DASH;
}

function fmtRi(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "无上限";
}

export function analysisTypeLabel(analysisType: string | null | undefined): string {
  const t = analysisType?.trim();
  if (!t) return "未标注分析类型";
  return ANALYSIS_LABELS[t] ?? t;
}

/** 从节点 URN 或短 id 抽出参与方 id，供 participantLabel。 */
export function nodeParticipantId(node: string): string {
  const urn = /participant:([^:/]+)/.exec(node);
  if (urn?.[1]) return urn[1];
  const short = /(?:^|[/:])(p-[\w-]+)$/.exec(node);
  if (short?.[1]) return short[1];
  if (node === "platform" || node.endsWith(":platform") || node.includes("participant:platform")) {
    return "platform";
  }
  const tail = node.split(":").pop();
  return tail && tail.length > 0 ? tail : node;
}

export function mdopResultEmptyHint(jobStatus: string | undefined): string {
  const s = (jobStatus ?? "").toUpperCase();
  if (
    /^(SUBMITTED|COMPILED|NEGOTIATING|TICKETED|RUNNING|RELEASING)$/.test(s) ||
    !s
  ) {
    return "合并结果尚未就绪：作业仍在执行或等待投递。";
  }
  if (s === "PURGED") {
    return "无平台侧合并交付物：作业已销毁中间制品，且未保留可读的 C3 结果。";
  }
  return "无平台侧合并交付物：终态作业未返回可展示的合并结果。";
}

function pairedDirectionSummary(
  cohortSize: number,
  exposed: number,
  outcome: number,
  exposedWithOutcome: number,
): string {
  const unexposed = cohortSize - exposed;
  const unexposedWithOutcome = outcome - exposedWithOutcome;
  if (exposed === 0 || unexposed <= 0 || unexposedWithOutcome < 0) {
    return "暴露组或未暴露组为空，无法比较两组发生率";
  }
  const exposedRate = exposedWithOutcome / exposed;
  const unexposedRate = unexposedWithOutcome / unexposed;
  if (exposedRate === unexposedRate) return "粗率：暴露者结局发生率与未暴露者相同";
  if (exposedRate > unexposedRate) return "粗率：暴露者结局发生率高于未暴露者";
  return "粗率：暴露者结局发生率低于未暴露者";
}

function flSummaryLine(r: Record<string, unknown>): string {
  const parts: string[] = [];
  if (r.roundsCompleted != null) {
    parts.push(`训练轮次 ${r.roundsCompleted}/${r.totalRounds ?? DASH}`);
  }
  const metrics = r.aggregateMetrics;
  if (metrics && typeof metrics === "object") {
    const m = metrics as Record<string, unknown>;
    if (typeof m.auc === "number" && Number.isFinite(m.auc)) {
      parts.push(`合并 AUC ${m.auc.toFixed(3)}`);
    } else if (typeof m.f1 === "number" && Number.isFinite(m.f1)) {
      parts.push(`合并 F1 ${m.f1.toFixed(3)}`);
    }
  }
  if (parts.length === 0 && typeof r.modelType === "string") {
    parts.push(r.modelType);
  }
  return parts.join(" · ");
}

function flMetricRows(r: Record<string, unknown>): MdopFlMetricRow[] {
  const metrics = r.aggregateMetrics;
  if (!metrics || typeof metrics !== "object") return [];
  const m = metrics as Record<string, unknown>;
  const order = ["auc", "f1", "precision", "recall", "accuracy"];
  const rows: MdopFlMetricRow[] = [];
  for (const k of order) {
    if (typeof m[k] === "number" && Number.isFinite(m[k] as number)) {
      rows.push({
        label: FL_METRIC_LABELS[k] ?? k,
        value: (m[k] as number).toFixed(3),
      });
    }
  }
  return rows;
}

function scriSummaryAndStrata(r: Record<string, unknown>): {
  summaryLine: string;
  scriStrata: MdopScriStratumRow[];
} {
  const w = r.windows as { risk?: unknown; control?: unknown } | undefined;
  const riskWin = Array.isArray(w?.risk) && w!.risk.length >= 2 ? (w!.risk as [number, number]) : null;
  const controlWin =
    Array.isArray(w?.control) && w!.control.length >= 2 ? (w!.control as [number, number]) : null;
  const riskDays = riskWin ? windowDaySpan(riskWin) : null;
  const controlDays = controlWin ? windowDaySpan(controlWin) : null;

  const windowPart =
    riskWin && controlWin
      ? `风险期 ${scriWindowLabel(riskWin)} · 对照期 ${scriWindowLabel(controlWin)}`
      : null;

  const strataRaw = Array.isArray(r.strata) ? (r.strata as Array<Record<string, unknown>>) : [];
  const scriStrata: MdopScriStratumRow[] = strataRaw.map((s) => {
    const key = String(s.key ?? DASH);
    const suppressed = s.suppressed === true;
    const riskEvents = typeof s.riskEvents === "number" ? s.riskEvents : null;
    const controlEvents = typeof s.controlEvents === "number" ? s.controlEvents : null;
    let ri = DASH;
    let riCi = DASH;
    if (!suppressed && riskEvents != null && controlEvents != null && riskDays && controlDays) {
      const est = scriRelativeIncidence({
        riskEvents,
        controlEvents,
        riskDays,
        controlDays,
      });
      if (!est) {
        ri = "不可估计";
        riCi = DASH;
      } else {
        ri = fmtRi(est.ri);
        riCi = `[${fmtRi(est.lower)}, ${fmtRi(est.upper)}]`;
      }
    } else if (!suppressed) {
      ri = "不可估计";
    }
    return {
      key,
      keyLabel: scriStratumLabel(key === DASH ? "" : key) || key,
      doses: num(s.doses),
      riskEvents: num(s.riskEvents),
      controlEvents: num(s.controlEvents),
      suppressed,
      ri,
      riCi,
    };
  });

  const summaryLine = [
    windowPart,
    strataRaw.length ? `${strataRaw.length} 个分层` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { summaryLine: summaryLine || analysisTypeLabel("vaccine-scri"), scriStrata };
}

/**
 * @param result `getMdopJob().result`；null/undefined → empty kind
 */
export function mdopResultView(result: unknown): MdopResultView {
  if (result == null || typeof result !== "object") {
    return {
      kind: "empty",
      analysisType: null,
      analysisLabel: "无合并结果",
      summaryLine: "",
      hasSignal: false,
      rows: [],
      ...emptyExtras(),
    };
  }
  const r = result as Record<string, unknown>;
  const analysisType =
    typeof r.analysisType === "string"
      ? r.analysisType
      : r.modelHash
        ? "fl-prediction"
        : null;
  const label = analysisTypeLabel(analysisType);

  if (analysisType === "disproportionality" && Array.isArray(r.buckets)) {
    const rows: MdopResultMetricRow[] = (r.buckets as Array<Record<string, unknown>>).map((b) => {
      const signal = typeof b.signal === "boolean" ? b.signal : null;
      const key = String(b.key ?? DASH);
      return {
        key,
        outcomeLabel: outcomeEventLabel(key === DASH ? "" : key),
        count: num(b.count),
        prr: fmtMetric(b.prr),
        ror: fmtMetric(b.ror),
        prrCi: ci(b.prrCi95),
        rorCi: ci(b.rorCi95),
        signal,
        signalLabel: signal === true ? "检出" : signal === false ? "未检出" : DASH,
      };
    });
    const hasSignal = rows.some((row) => row.signal === true);
    const n = typeof r.cohortSize === "number" ? r.cohortSize : null;
    return {
      kind: "disproportionality",
      analysisType,
      analysisLabel: label,
      summaryLine: [
        n != null ? `分析队列共 ${n} 人` : null,
        `${rows.length} 个不良结局`,
        hasSignal ? "至少一项达到安全信号阈值" : "均未达到安全信号阈值",
      ]
        .filter(Boolean)
        .join(" · "),
      hasSignal,
      rows,
      ...emptyExtras(),
    };
  }

  if (analysisType === "vaccine-scri") {
    const { summaryLine, scriStrata } = scriSummaryAndStrata(r);
    return {
      kind: "vaccine-scri",
      analysisType,
      analysisLabel: label,
      summaryLine,
      hasSignal: false,
      rows: [],
      ...emptyExtras(),
      scriStrata,
    };
  }

  if (analysisType === "external-control-registration") {
    return {
      kind: "external-control-registration",
      analysisType,
      analysisLabel: label,
      summaryLine: label,
      hasSignal: false,
      rows: [],
      ...emptyExtras(),
    };
  }

  if (analysisType === "paired-cohort") {
    const cohortSize = typeof r.cohortSize === "number" ? r.cohortSize : null;
    const exposed = typeof r.exposed === "number" ? r.exposed : null;
    const outcome = typeof r.outcome === "number" ? r.outcome : null;
    const exposedWithOutcome =
      typeof r.exposedWithOutcome === "number" ? r.exposedWithOutcome : null;
    const complete =
      cohortSize != null && exposed != null && outcome != null && exposedWithOutcome != null;

    const kvRows: MdopKvRow[] = [
      {
        label: "配对后队列规模",
        value: cohortSize != null ? String(cohortSize) : DASH,
        help: PAIRED_METRIC_HELP.cohortSize,
      },
      {
        label: "暴露人数",
        value: exposed != null ? String(exposed) : DASH,
        help: PAIRED_METRIC_HELP.exposed,
      },
      {
        label: "出现结局人数",
        value: outcome != null ? String(outcome) : DASH,
        help: PAIRED_METRIC_HELP.outcome,
      },
      {
        label: "暴露且出现结局",
        value: exposedWithOutcome != null ? String(exposedWithOutcome) : DASH,
        help: PAIRED_METRIC_HELP.exposedWithOutcome,
      },
    ];

    const summaryLine = complete
      ? [
          `分析队列共 ${cohortSize} 人`,
          pairedDirectionSummary(cohortSize, exposed, outcome, exposedWithOutcome),
        ].join(" · ")
      : cohortSize != null
        ? `分析队列共 ${cohortSize} 人（计数不完整）`
        : label;

    return {
      kind: "paired-cohort",
      analysisType,
      analysisLabel: label,
      summaryLine,
      hasSignal: false,
      rows: [],
      ...emptyExtras(),
      kvRows,
    };
  }

  if (r.modelHash || analysisType === "fl-prediction") {
    const modelHash = typeof r.modelHash === "string" ? r.modelHash : null;
    return {
      kind: "fl-prediction",
      analysisType: analysisType ?? "fl-prediction",
      analysisLabel: analysisTypeLabel("fl-prediction"),
      summaryLine: flSummaryLine(r),
      hasSignal: false,
      rows: [],
      ...emptyExtras(),
      flMetrics: flMetricRows(r),
      modelHash,
    };
  }

  return {
    kind: "generic",
    analysisType,
    analysisLabel: label,
    summaryLine:
      typeof r.cohortSize === "number" ? `分析队列共 ${r.cohortSize} 人` : label,
    hasSignal: false,
    rows: [],
    ...emptyExtras(),
  };
}
