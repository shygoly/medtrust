import { z } from "zod";

/**
 * C3 聚合结果 → 「事实清单」（确定性，不经模型）。
 *
 * 两个目的：
 *  1. 入参白名单：只接受已知的聚合字段（`.strict()`），行级/未过闸字段一律拒收；
 *  2. 派生量（率、方向词）在这里算好——小模型算数不可靠（实测见
 *     openspec/changes/intel-tdx-xeon-showcase/design.md S3），模型只负责措辞。
 */

const count = z.number().int().min(0);
const label = z.string().min(1).max(80);

const pairedCohortSchema = z
  .object({
    analysisType: z.literal("paired-cohort"),
    cohortSize: count,
    exposed: count,
    outcome: count,
    exposedWithOutcome: count,
  })
  .strict();

const bucketSchema = z
  .object({
    key: label,
    count,
    prr: z.number().optional(),
    prrCi95: z.tuple([z.number(), z.number()]).optional(),
    ror: z.number().optional(),
    rorCi95: z.tuple([z.number(), z.number()]).optional(),
    signal: z.boolean().optional(),
    suppressed: z.boolean().optional(),
  })
  .strict();

const disproportionalitySchema = z
  .object({
    analysisType: z.literal("disproportionality"),
    cohortSize: count,
    buckets: z.array(bucketSchema).max(200),
  })
  .strict();

const dayWindow = z.tuple([z.number().int(), z.number().int()]);

const vaccineScriSchema = z
  .object({
    analysisType: z.literal("vaccine-scri"),
    windows: z.object({ risk: dayWindow, control: dayWindow }).strict(),
    strata: z
      .array(
        z
          .object({
            key: label,
            doses: count,
            riskEvents: count,
            controlEvents: count,
            suppressed: z.boolean().optional(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export const c3ResultSchema = z.discriminatedUnion("analysisType", [
  pairedCohortSchema,
  disproportionalitySchema,
  vaccineScriSchema,
]);

export type C3Result = z.infer<typeof c3ResultSchema>;

/** 事件条目过多时只解读前几条，提示词保持短。 */
const MAX_BUCKETS = 5;

function decimal(n: number): string {
  return n.toFixed(2);
}

function percent(numerator: number, denominator: number): string {
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function pairedCohortFacts(r: z.infer<typeof pairedCohortSchema>): string[] {
  const unexposed = r.cohortSize - r.exposed;
  const unexposedWithOutcome = r.outcome - r.exposedWithOutcome;
  const facts = [
    `配对后的队列规模：${r.cohortSize} 人`,
    `暴露者 ${r.exposed} 人，未暴露者 ${unexposed} 人`,
    `发生结局者 ${r.outcome} 人，其中暴露者 ${r.exposedWithOutcome} 人`,
  ];
  if (r.exposed === 0 || unexposed <= 0 || unexposedWithOutcome < 0) {
    facts.push("暴露组或未暴露组为空，无法比较两组发生率");
    return facts;
  }
  facts.push(
    `暴露者的结局发生率：${percent(r.exposedWithOutcome, r.exposed)}`,
    `未暴露者的结局发生率：${percent(unexposedWithOutcome, unexposed)}`,
  );
  const exposedRate = r.exposedWithOutcome / r.exposed;
  const unexposedRate = unexposedWithOutcome / unexposed;
  const direction =
    exposedRate === unexposedRate
      ? "与未暴露者相同"
      : exposedRate > unexposedRate
        ? "高于未暴露者"
        : "低于未暴露者";
  facts.push(
    `方向：暴露者的结局发生率${direction}（粗率比较，未做混杂调整与显著性检验）`,
  );
  return facts;
}

function disproportionalityFacts(
  r: z.infer<typeof disproportionalitySchema>,
): string[] {
  const visible = r.buckets.filter((b) => !b.suppressed);
  const ranked = [...visible].sort(
    (a, b) =>
      Number(b.signal ?? false) - Number(a.signal ?? false) ||
      (b.prr ?? 0) - (a.prr ?? 0),
  );
  const facts = [
    `合并后的报告总数：${r.cohortSize}`,
    `事件条目 ${visible.length} 个，其中达到信号阈值 ${visible.filter((b) => b.signal).length} 个`,
  ];
  for (const b of ranked.slice(0, MAX_BUCKETS)) {
    const parts = [`事件「${b.key}」：报告数 ${b.count}`];
    if (b.prr !== undefined)
      parts.push(
        b.prrCi95
          ? `PRR ${decimal(b.prr)}（95%CI ${decimal(b.prrCi95[0])}–${decimal(b.prrCi95[1])}）`
          : `PRR ${decimal(b.prr)}`,
      );
    if (b.ror !== undefined)
      parts.push(
        b.rorCi95
          ? `ROR ${decimal(b.ror)}（95%CI ${decimal(b.rorCi95[0])}–${decimal(b.rorCi95[1])}）`
          : `ROR ${decimal(b.ror)}`,
      );
    if (b.signal !== undefined)
      parts.push(b.signal ? "达到信号阈值" : "未达到信号阈值");
    facts.push(parts.join("；"));
  }
  return facts;
}

/** P(X ≤ x)，X ~ Binomial(n, p)，对数域累加（n 在百级以内足够稳）。 */
function binomCdf(x: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return x >= n ? 1 : 0;
  let logC = 0;
  let sum = 0;
  for (let k = 0; k <= x; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    sum += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return Math.min(1, sum);
}

function bisect(f: (p: number) => number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * SCRI 的相对发生率与 95% 精确置信区间。
 * 在「风险期 + 对照期」内发生的 n 次事件里，落在风险期的次数 x ~ Binomial(n, π)，
 * π = RI·Lr /(RI·Lr + Lc)，故 RI = π/(1−π) · Lc/Lr；π 的 Clopper-Pearson 区间换算即得 RI 的区间。
 */
export function scriRelativeIncidence(input: {
  riskEvents: number;
  controlEvents: number;
  riskDays: number;
  controlDays: number;
}): { ri: number; lower: number; upper: number } | null {
  const x = input.riskEvents;
  const n = input.riskEvents + input.controlEvents;
  if (n === 0 || input.controlEvents === 0) return null;
  const scale = input.controlDays / input.riskDays;
  const toRi = (p: number) => (p / (1 - p)) * scale;
  const pLow =
    x === 0
      ? 0
      : bisect((p) => (1 - binomCdf(x - 1, n, p) - 0.025 < 0 ? 1 : -1));
  const pHigh =
    x === n ? 1 : bisect((p) => (binomCdf(x, n, p) - 0.025 > 0 ? 1 : -1));
  return {
    ri: toRi(x / n),
    lower: toRi(pLow),
    upper: pHigh >= 1 ? Number.POSITIVE_INFINITY : toRi(pHigh),
  };
}

const AGE_LABEL: Record<string, string> = {
  "<40": "40 岁以下",
  "40+": "40 岁及以上",
};
const SEX_LABEL: Record<string, string> = {
  M: "男性",
  F: "女性",
  male: "男性",
  female: "女性",
};
function stratumLabel(key: string): string {
  const [age, sex] = key.split("|");
  return `${AGE_LABEL[age] ?? age}${SEX_LABEL[sex] ?? sex ?? ""}`;
}
const dayRange = ([a, b]: readonly unknown[]) =>
  (a as number) < 0 && (b as number) < 0
    ? `接种前第 ${-(a as number)}–${-(b as number)} 天`
    : `接种后第 ${a as number}–${b as number} 天`;

type ScriVerdict = "higher" | "lower" | "none" | "unknown";

interface ScriStratumView {
  label: string;
  stratum: z.infer<typeof vaccineScriSchema>["strata"][number];
  ri: ReturnType<typeof scriRelativeIncidence>;
  verdict: ScriVerdict;
}

function scriView(r: z.infer<typeof vaccineScriSchema>): {
  riskDays: number;
  controlDays: number;
  visible: ScriStratumView[];
  suppressed: string[];
} {
  const [r1, r2] = r.windows.risk as unknown as [number, number];
  const [c1, c2] = r.windows.control as unknown as [number, number];
  const riskDays = r2 - r1 + 1;
  const controlDays = c2 - c1 + 1;
  const visible = r.strata
    .filter((s) => !s.suppressed)
    .map((s) => {
      const ri = scriRelativeIncidence({
        riskEvents: s.riskEvents,
        controlEvents: s.controlEvents,
        riskDays,
        controlDays,
      });
      const verdict: ScriVerdict = !ri
        ? "unknown"
        : ri.lower > 1
          ? "higher"
          : ri.upper < 1
            ? "lower"
            : "none";
      return { label: stratumLabel(s.key), stratum: s, ri, verdict };
    });
  const suppressed = r.strata
    .filter((s) => s.suppressed)
    .map((s) => stratumLabel(s.key));
  return { riskDays, controlDays, visible, suppressed };
}

const ciText = (ri: NonNullable<ScriStratumView["ri"]>) =>
  `相对发生率 ${decimal(ri.ri)}（95% CI ${decimal(ri.lower)}–${Number.isFinite(ri.upper) ? decimal(ri.upper) : "无上限"}）`;

/**
 * 结论行放在最前：多分层、方向不一时，小模型从逐层明细里「归纳」容易归纳错
 * （实测把唯一显著的分层说成「均未达到显著」），所以归纳在这里确定性地做好，模型只转述。
 */
function scriHeadline(visible: ScriStratumView[]): string {
  const higher = visible.filter((v) => v.verdict === "higher");
  const lower = visible.filter((v) => v.verdict === "lower");
  const rest = visible.length - higher.length - lower.length;
  if (!higher.length && !lower.length)
    return `结论：${visible.length} 个分层的风险期与对照期发生率均无统计学差异`;
  const parts = [
    ...higher.map(
      (v) => `「${v.label}」风险期发生率高于对照期（${ciText(v.ri!)}）`,
    ),
    ...lower.map(
      (v) => `「${v.label}」风险期发生率低于对照期（${ciText(v.ri!)}）`,
    ),
  ];
  return `结论：${visible.length} 个分层中，${parts.join("；")}${rest ? `；其余 ${rest} 个分层无统计学差异` : ""}`;
}

function vaccineScriFacts(r: z.infer<typeof vaccineScriSchema>): string[] {
  const { riskDays, controlDays, visible, suppressed } = scriView(r);
  const facts = [
    `设计：自身对照风险期（只比较受种者自己在两个时间窗内的事件）`,
    `风险期：${dayRange(r.windows.risk)}（${riskDays} 天）；对照期：${dayRange(r.windows.control)}（${controlDays} 天）`,
    scriHeadline(visible),
  ];
  for (const v of visible) {
    const s = v.stratum;
    const head = `${v.label}：接种 ${s.doses} 剂次，风险期事件 ${s.riskEvents}，对照期事件 ${s.controlEvents}`;
    if (!v.ri) {
      facts.push(`${head}；对照期无事件，无法估计相对发生率`);
      continue;
    }
    const verdict =
      v.verdict === "higher"
        ? "风险期发生率高于对照期（95% 置信区间下限大于 1）"
        : v.verdict === "lower"
          ? "风险期发生率低于对照期（95% 置信区间上限小于 1）"
          : "风险期与对照期无统计学差异（95% 置信区间含 1）";
    facts.push(`${head}；${ciText(v.ri)}，${verdict}`);
  }
  if (suppressed.length)
    facts.push(
      `以下分层因小单元格审查被抑制、不参与解读：${suppressed.join("、")}`,
    );
  facts.push(
    "说明：自身对照设计抵消了不随时间变化的个体因素，但未调整季节、年龄随时间变化与健康受种者效应",
  );
  return facts;
}

/** 一概否定的措辞：分层方向不一时出现即视为与结论矛盾。 */
const BLANKET_NEGATION = /(均|都|皆|全部)(未|无|没有|不)/;

/**
 * 结论一致性回查（数字回查之外的第二道闸）：数字都对、结论说反的草稿同样拒收。
 * 返回矛盾说明（空数组 = 通过）。目前只对方向判定明确的 SCRI 做。
 */
export function contradictedVerdicts(
  draft: string,
  result: C3Result,
): string[] {
  if (result.analysisType !== "vaccine-scri") return [];
  const { visible } = scriView(result);
  const problems: string[] = [];
  const higher = visible.filter((v) => v.verdict === "higher");
  const lower = visible.filter((v) => v.verdict === "lower");
  if (higher.length && !draft.includes("高于"))
    problems.push("有分层风险期发生率高于对照期，草稿未如实表述");
  if (lower.length && !draft.includes("低于"))
    problems.push("有分层风险期发生率低于对照期，草稿未如实表述");
  if ((higher.length || lower.length) && BLANKET_NEGATION.test(draft))
    problems.push("分层方向不一，草稿使用了一概否定的措辞");
  return problems;
}

export function buildC3Facts(result: C3Result): string[] {
  if (result.analysisType === "vaccine-scri") return vaccineScriFacts(result);
  return result.analysisType === "paired-cohort"
    ? pairedCohortFacts(result)
    : disproportionalityFacts(result);
}

const NUMBER = /\d+(?:\.\d+)?/g;

/**
 * 输出数字回查：模型写出的每个数字都必须在 `allowedText` 里原样出现过。
 * 返回未经核实的数字（空数组 = 通过）。按数值比较，`3.0` 与 `3` 视为同一个数。
 */
export function unsupportedNumbers(
  output: string,
  allowedText: string,
): string[] {
  const allowed = new Set((allowedText.match(NUMBER) ?? []).map(Number));
  return (output.match(NUMBER) ?? []).filter((n) => !allowed.has(Number(n)));
}
