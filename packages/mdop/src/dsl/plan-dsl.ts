import { canonicalSm3 } from "../crypto/sm3";
import type { LogicalPlan, LogicalStage } from "../schema/plan";
import { parseLogicalPlan } from "../schema/plan";

/** 声明式 MDOP DSL 的封闭版本。它不是执行格式，最终仍编译成 LogicalPlan。 */
export const MDOP_PLAN_DSL_VERSION = "mdop.plan/v1";
export const MDOP_DSL_COMPILER_VERSION = "mdop-compiler-dsl/1.0.0";

export type DslDraftState = "frozen" | "llm-draft";
export type DslPlacement = string | { node: string };

export interface DslSource {
  participant: string;
  dataProduct: string;
  role: string;
  contract?: string;
  projection?: string;
}

export interface DslOperator {
  id: string;
  op: string;
  inputs: Array<string | { from: string }>;
  placement: string;
  parameters?: Record<string, unknown>;
}

export interface DslContractBundleRef {
  bundleId: string;
  version: string;
  members: Array<{
    role: string;
    contractId: string;
    participantId?: string;
    dataProductId?: string;
  }>;
}

export interface DslStudyProfile {
  studyId: string;
  design: "single-arm-with-external-control";
  objective: "superiority";
  evidenceRole: "primary" | "supportive" | "exploratory";
  estimand: "ATT" | "ATE";
  estimator: "IPTW-ATT" | "IPTW-ATE";
  timeZero: string;
  outcome: string;
  profileVersion: string;
  protocolVersion: string;
  sapVersion: string;
  synthetic: boolean;
  frozen: boolean;
  p0DecisionsFrozen: boolean;
}

export interface MdopPlanDsl {
  dslVersion: typeof MDOP_PLAN_DSL_VERSION;
  template: { id: string; version: string };
  draft: DslDraftState;
  purpose: string;
  applicant: { org: string; project: string };
  sources: Record<string, DslSource>;
  roles: Record<string, string>;
  contracts: string[];
  contractBundle?: DslContractBundleRef;
  study?: DslStudyProfile;
  operators: DslOperator[];
  placement: Record<string, DslPlacement>;
  release: Record<string, unknown>;
  ethics: Record<string, unknown>;
  budget: Record<string, unknown>;
  window: { notBefore: string; notAfter: string };
  evidence: Record<string, unknown>;
}

export interface DslCompileInput {
  dsl: string | unknown;
  /** Card/表单值，只用于替换 `${name}`。 */
  values?: Record<string, unknown>;
  /** 已登记模板与算子引用；缺省拒绝任何未显式声明的运行入口。 */
  templateRegistry?: Record<string, string>;
  operatorRegistry?: Record<string, string>;
  /** 服务端模板展开后的可信标记。 */
  templateExpanded?: boolean;
  /** 人工确认并冻结方案后由服务端置 true。 */
  humanConfirmed?: boolean;
}

export interface DslCompileResult {
  dsl: MdopPlanDsl;
  ast: MdopPlanDsl;
  canonicalPlan: LogicalPlan;
  logicalPlanHash: string;
  audit: {
    dslVersion: string;
    templateId: string;
    templateVersion: string;
    compilerVersion: string;
    contractBundleVersion: string | null;
    draft: DslDraftState;
  };
}

export class DslParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly line: number | null,
    message: string,
    public readonly suggestions: string[] = [],
  ) {
    super(`${path}${line === null ? "" : ` (line ${line})`}: ${message}`);
    this.name = "DslParseError";
  }
}

const TOP_KEYS = [
  "dslVersion",
  "template",
  "draft",
  "purpose",
  "applicant",
  "sources",
  "roles",
  "contracts",
  "contractBundle",
  "study",
  "operators",
  "placement",
  "release",
  "ethics",
  "budget",
  "window",
  "evidence",
] as const;

const FORBIDDEN_KEYS = new Set([
  "code",
  "script",
  "sourceCode",
  "wasm",
  "wasmBase64",
  "url",
  "fetch",
  "http",
  "sql",
  "eval",
  "loop",
  "while",
  "for",
  "exec",
]);

const PLACEHOLDER = /^\$\{([A-Za-z][A-Za-z0-9_.-]*)\}$/;

function pathOf(path: string): string {
  return path || "dsl";
}

function fail(path: string, message: string, suggestions: string[] = []): never {
  throw new DslParseError(pathOf(path), null, message, suggestions);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(path, "必须是对象");
  return value as Record<string, unknown>;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    fail(path, "必须是非空字符串");
  return value.trim();
}

function stringArrayAt(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, "必须是字符串数组");
  return value.map((item, index) => stringAt(item, `${path}[${index}]`));
}

function placementAt(value: unknown, path: string): string {
  if (typeof value === "string") {
    if (!value.startsWith("urn:"))
      fail(path, "置放节点必须是 urn: 标识", ["urn:<space>:participant:<node>"]);
    return value;
  }
  const obj = objectAt(value, path);
  rejectUnknown(obj, path, ["node"]);
  return placementAt(obj.node, `${path}.node`);
}

function rejectUnknown(obj: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key))
      fail(`${path}.${key}`, "DSL 禁止脚本、网络、SQL、动态代码和任意表达式");
    if (!allowedSet.has(key))
      fail(`${path}.${key}`, "未知字段", [...allowed]);
  }
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 非法";
    const position = /position\s+(\d+)/i.exec(message)?.[1];
    const index = position ? Number(position) : Math.max(0, input.indexOf("}"));
    const line = input.slice(0, index).split("\n").length;
    throw new DslParseError("dsl", line, message, [
      "检查逗号、引号与括号",
      `版本必须是 ${MDOP_PLAN_DSL_VERSION}`,
    ]);
  }
}

/** 解析并做严格封闭校验；未知字段、循环/脚本/网络/SQL 一律 fail-closed。 */
export function parseMdopPlanDsl(input: string | unknown): MdopPlanDsl {
  const raw = typeof input === "string" ? parseJson(input) : input;
  const root = objectAt(raw, "dsl");
  rejectUnknown(root, "dsl", TOP_KEYS);

  if (root.dslVersion !== MDOP_PLAN_DSL_VERSION)
    fail("dsl.dslVersion", `仅支持 ${MDOP_PLAN_DSL_VERSION}`, [MDOP_PLAN_DSL_VERSION]);
  if (root.draft !== "frozen" && root.draft !== "llm-draft")
    fail("dsl.draft", "必须是 frozen 或 llm-draft");

  const templateObj = objectAt(root.template, "dsl.template");
  rejectUnknown(templateObj, "dsl.template", ["id", "version"]);
  const applicantObj = objectAt(root.applicant, "dsl.applicant");
  rejectUnknown(applicantObj, "dsl.applicant", ["org", "project"]);

  const sourcesObj = objectAt(root.sources, "dsl.sources");
  const sources: Record<string, DslSource> = {};
  for (const [name, rawSource] of Object.entries(sourcesObj)) {
    const source = objectAt(rawSource, `dsl.sources.${name}`);
    rejectUnknown(source, `dsl.sources.${name}`, [
      "participant",
      "dataProduct",
      "role",
      "contract",
      "projection",
    ]);
    const parsed: DslSource = {
      participant: stringAt(source.participant, `dsl.sources.${name}.participant`),
      dataProduct: stringAt(source.dataProduct, `dsl.sources.${name}.dataProduct`),
      role: stringAt(source.role, `dsl.sources.${name}.role`),
      ...(source.contract !== undefined
        ? { contract: stringAt(source.contract, `dsl.sources.${name}.contract`) }
        : {}),
      ...(source.projection !== undefined
        ? { projection: stringAt(source.projection, `dsl.sources.${name}.projection`) }
        : {}),
    };
    sources[name] = parsed;
  }
  if (Object.keys(sources).length === 0) fail("dsl.sources", "至少声明一个数据源");

  const rolesObj = objectAt(root.roles, "dsl.roles");
  const roles = Object.fromEntries(
    Object.entries(rolesObj).map(([key, value]) => [key, stringAt(value, `dsl.roles.${key}`)]),
  );
  for (const [sourceName, source] of Object.entries(sources)) {
    if (!roles[source.role])
      fail(`dsl.sources.${sourceName}.role`, `角色 ${source.role} 未在 roles 中声明`, Object.keys(roles));
  }

  const operatorsRaw = root.operators;
  if (!Array.isArray(operatorsRaw)) fail("dsl.operators", "必须是数组");
  const operators: DslOperator[] = operatorsRaw.map((rawOperator, index) => {
    const path = `dsl.operators[${index}]`;
    const operator = objectAt(rawOperator, path);
    rejectUnknown(operator, path, ["id", "op", "inputs", "placement", "parameters"]);
    if (!Array.isArray(operator.inputs)) fail(`${path}.inputs`, "必须是数组");
    return {
      id: stringAt(operator.id, `${path}.id`),
      op: stringAt(operator.op, `${path}.op`),
      inputs: operator.inputs.map((item, inputIndex) => {
        if (typeof item === "string") return item;
        const inputObj = objectAt(item, `${path}.inputs[${inputIndex}]`);
        rejectUnknown(inputObj, `${path}.inputs[${inputIndex}]`, ["from"]);
        return { from: stringAt(inputObj.from, `${path}.inputs[${inputIndex}].from`) };
      }),
      placement: placementAt(operator.placement, `${path}.placement`),
      ...(operator.parameters !== undefined
        ? {
            parameters: objectAt(operator.parameters, `${path}.parameters`),
          }
        : {}),
    };
  });
  if (operators.length === 0) fail("dsl.operators", "至少声明一个算子");
  const operatorIds = new Set(operators.map((operator) => operator.id));
  if (operatorIds.size !== operators.length) fail("dsl.operators", "算子 id 必须唯一");

  const placement = Object.fromEntries(
    Object.entries(objectAt(root.placement, "dsl.placement")).map(([key, value]) => {
      if (typeof value === "string") return [key, placementAt(value, `dsl.placement.${key}`)];
      const item = objectAt(value, `dsl.placement.${key}`);
      rejectUnknown(item, `dsl.placement.${key}`, ["node"]);
      return [key, { node: placementAt(item.node, `dsl.placement.${key}.node`) }];
    }),
  );

  const windowObj = objectAt(root.window, "dsl.window");
  rejectUnknown(windowObj, "dsl.window", ["notBefore", "notAfter"]);
  const notBefore = stringAt(windowObj.notBefore, "dsl.window.notBefore");
  const notAfter = stringAt(windowObj.notAfter, "dsl.window.notAfter");
  if (Date.parse(notBefore) >= Date.parse(notAfter))
    fail("dsl.window", "notBefore 必须早于 notAfter");

  const bundleObj =
    root.contractBundle === undefined
      ? undefined
      : objectAt(root.contractBundle, "dsl.contractBundle");
  let contractBundle: DslContractBundleRef | undefined;
  if (bundleObj) {
    rejectUnknown(bundleObj, "dsl.contractBundle", ["bundleId", "version", "members"]);
    if (!Array.isArray(bundleObj.members)) fail("dsl.contractBundle.members", "必须是数组");
    contractBundle = {
      bundleId: stringAt(bundleObj.bundleId, "dsl.contractBundle.bundleId"),
      version: stringAt(bundleObj.version, "dsl.contractBundle.version"),
      members: bundleObj.members.map((value, index) => {
        const path = `dsl.contractBundle.members[${index}]`;
        const member = objectAt(value, path);
        rejectUnknown(member, path, [
          "role",
          "contractId",
          "participantId",
          "dataProductId",
        ]);
        return {
          role: stringAt(member.role, `${path}.role`),
          contractId: stringAt(member.contractId, `${path}.contractId`),
          ...(member.participantId !== undefined
            ? { participantId: stringAt(member.participantId, `${path}.participantId`) }
            : {}),
          ...(member.dataProductId !== undefined
            ? { dataProductId: stringAt(member.dataProductId, `${path}.dataProductId`) }
            : {}),
        };
      }),
    };
  }

  const contracts = stringArrayAt(root.contracts, "dsl.contracts");
  if (contracts.length === 0) fail("dsl.contracts", "至少引用一份成员合约");
  if (contractBundle) {
    for (const member of contractBundle.members) {
      if (!contracts.includes(member.contractId))
        fail(
          "dsl.contracts",
          `成员合约 ${member.contractId} 未在 contracts 中显式引用`,
          contracts,
        );
    }
  }

  let study: DslStudyProfile | undefined;
  if (root.study !== undefined) {
    const raw = objectAt(root.study, "dsl.study");
    rejectUnknown(raw, "dsl.study", [
      "studyId",
      "design",
      "objective",
      "evidenceRole",
      "estimand",
      "estimator",
      "timeZero",
      "outcome",
      "profileVersion",
      "protocolVersion",
      "sapVersion",
      "synthetic",
      "frozen",
      "p0DecisionsFrozen",
    ]);
    if (raw.design !== "single-arm-with-external-control")
      fail("dsl.study.design", "注册型 DSL 只接受 single-arm-with-external-control");
    if (raw.objective !== "superiority")
      fail("dsl.study.objective", "外部对照注册研究只接受 superiority");
    if (!["primary", "supportive", "exploratory"].includes(String(raw.evidenceRole)))
      fail("dsl.study.evidenceRole", "必须是 primary/supportive/exploratory");
    if (raw.estimand !== "ATT" && raw.estimand !== "ATE")
      fail("dsl.study.estimand", "必须是 ATT 或 ATE");
    if (raw.estimator !== "IPTW-ATT" && raw.estimator !== "IPTW-ATE")
      fail("dsl.study.estimator", "必须是 IPTW-ATT 或 IPTW-ATE");
    if (
      (raw.estimand === "ATT" && raw.estimator !== "IPTW-ATT") ||
      (raw.estimand === "ATE" && raw.estimator !== "IPTW-ATE")
    )
      fail("dsl.study.estimator", "estimand 与 estimator 必须一致");
    if (typeof raw.synthetic !== "boolean" || typeof raw.frozen !== "boolean" || typeof raw.p0DecisionsFrozen !== "boolean")
      fail("dsl.study", "synthetic/frozen/p0DecisionsFrozen 必须是布尔值");
    study = {
      studyId: stringAt(raw.studyId, "dsl.study.studyId"),
      design: raw.design,
      objective: raw.objective,
      evidenceRole: raw.evidenceRole as DslStudyProfile["evidenceRole"],
      estimand: raw.estimand,
      estimator: raw.estimator,
      timeZero: stringAt(raw.timeZero, "dsl.study.timeZero"),
      outcome: stringAt(raw.outcome, "dsl.study.outcome"),
      profileVersion: stringAt(raw.profileVersion, "dsl.study.profileVersion"),
      protocolVersion: stringAt(raw.protocolVersion, "dsl.study.protocolVersion"),
      sapVersion: stringAt(raw.sapVersion, "dsl.study.sapVersion"),
      synthetic: raw.synthetic,
      frozen: raw.frozen,
      p0DecisionsFrozen: raw.p0DecisionsFrozen,
    };
  }

  return {
    dslVersion: MDOP_PLAN_DSL_VERSION,
    template: {
      id: stringAt(templateObj.id, "dsl.template.id"),
      version: stringAt(templateObj.version, "dsl.template.version"),
    },
    draft: root.draft,
    purpose: stringAt(root.purpose, "dsl.purpose"),
    applicant: {
      org: stringAt(applicantObj.org, "dsl.applicant.org"),
      project: stringAt(applicantObj.project, "dsl.applicant.project"),
    },
    sources,
    roles,
    contracts,
    ...(contractBundle ? { contractBundle } : {}),
    ...(study ? { study } : {}),
    operators,
    placement,
    release: objectAt(root.release, "dsl.release"),
    ethics: objectAt(root.ethics, "dsl.ethics"),
    budget: objectAt(root.budget, "dsl.budget"),
    window: { notBefore, notAfter },
    evidence: objectAt(root.evidence, "dsl.evidence"),
  };
}

function resolveValue(value: unknown, values: Record<string, unknown>, path: string): unknown {
  if (typeof value === "string") {
    const placeholder = PLACEHOLDER.exec(value);
    if (!placeholder) return value;
    const key = placeholder[1]!;
    if (!(key in values)) fail(path, `未提供的表单占位符 ${key}`, Object.keys(values));
    return values[key];
  }
  if (Array.isArray(value)) return value.map((item, index) => resolveValue(item, values, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        resolveValue(child, values, `${path}.${key}`),
      ]),
    );
  }
  return value;
}

/**
 * DSL → AST（已校验）→ Canonical Logical Plan。
 *
 * `llm-draft` 只能在 `templateExpanded=false` 时生成预览；进入正式编译必须先由服务端
 * 模板展开并标记 `frozen`。正式提交仍由现有 MDOP 编译器计算物理 plan_hash。
 */
export function compileMdopPlanDsl(input: DslCompileInput): DslCompileResult {
  const rawDsl = typeof input.dsl === "string" ? parseJson(input.dsl) : input.dsl;
  const parsedShape = parseMdopPlanDsl(rawDsl);
  if (parsedShape.draft === "llm-draft" && (!input.templateExpanded || !input.humanConfirmed))
    fail(
      "dsl.draft",
      "llm-draft 不能直接编译为执行计划；请先完成模板展开和人工确认",
      ["frozen"],
    );
  if (input.templateRegistry && !input.templateRegistry[parsedShape.template.id])
    fail(
      `dsl.template.id`,
      `模板 ${parsedShape.template.id} 未登记`,
      Object.keys(input.templateRegistry),
    );
  for (const operator of parsedShape.operators) {
    if (input.operatorRegistry && !input.operatorRegistry[operator.op])
      fail(
        `dsl.operators.${operator.id}.op`,
        `算子 ${operator.op} 未在 registry 登记`,
        Object.keys(input.operatorRegistry),
      );
  }
  const resolvedInput = resolveValue(
    rawDsl,
    input.values ?? {},
    "dsl",
  );
  const dsl = parseMdopPlanDsl(resolvedInput);
  const registrationDsl =
    dsl.study !== undefined ||
    dsl.operators.some((operator) =>
      operator.op.includes("external-control-registration@"),
    );
  if (registrationDsl) {
    if (!dsl.study)
      fail("dsl.study", "注册型外部对照必须声明冻结研究 profile");
    if (!dsl.study.frozen)
      fail("dsl.study.frozen", "研究 profile 未冻结，禁止编译");
    if (!dsl.study.synthetic && !dsl.study.p0DecisionsFrozen)
      fail(
        "dsl.study.p0DecisionsFrozen",
        "真实注册研究必须确认全部 P0 临床与注册决策",
      );
  }
  if (
    dsl.contractBundle &&
    !dsl.contractBundle.members.some((member) => dsl.contracts.includes(member.contractId))
  )
    fail("dsl.contractBundle.members", "bundle 与作业合约引用没有交集");

  const stages: LogicalStage[] = [];
  const sourceStageByKey = new Map<string, string>();
  for (const [key, source] of Object.entries(dsl.sources)) {
    const resolved = resolveValue(source, input.values ?? {}, `dsl.sources.${key}`) as DslSource;
    const sourceStageId = `source_${key}`;
    const sourceStage: LogicalStage = {
      id: sourceStageId,
      op: "source.dataset@1.0.0",
      inputs: [{ from: `ds://${resolved.participant}/${resolved.dataProduct}` }],
      params: { uri: `ds://${resolved.participant}/${resolved.dataProduct}` },
    };
    stages.push(sourceStage);
    sourceStageByKey.set(key, sourceStageId);
    const contractId = resolved.contract ?? dsl.contractBundle?.members.find((m) => m.role === resolved.role)?.contractId;
    if (contractId) {
      if (!dsl.contracts.includes(contractId))
        fail(`dsl.sources.${key}.contract`, "引用的合约不在 contracts 中", dsl.contracts);
      stages.push({
        id: `seal_${key}`,
        op: "seal.envelope@1.0.0",
        inputs: [{ from: sourceStageId }],
        params: {
          contractId,
          ...(resolved.projection ? { projection: resolved.projection } : {}),
        },
      });
      sourceStageByKey.set(key, `seal_${key}`);
    }
  }

  for (const operator of dsl.operators) {
    const inputs = operator.inputs.map((raw, index) => {
      const from = typeof raw === "string" ? raw : raw.from;
      if (!operatorIdsHave(operatorsSoFar(stages), from) && !operatorIds(dsl).has(from) && !sourceStageByKey.has(from))
        fail(
          `dsl.operators.${operator.id}.inputs[${index}]`,
          `输入的阶段/数据源 ${from} 不存在`,
          [...operatorIds(dsl), ...sourceStageByKey.keys()],
        );
      return { from: sourceStageByKey.get(from) ?? from };
    });
    const placement = dsl.placement[operator.id] ?? operator.placement;
    const node = typeof placement === "string" ? placement : placement.node;
    stages.push({
      id: operator.id,
      op: operator.op,
      inputs,
      params: resolveValue(operator.parameters ?? {}, input.values ?? {}, `dsl.operators.${operator.id}.parameters`) as Record<string, unknown>,
      at: node,
    });
  }

  const canonicalPlan = parseLogicalPlan({
    job: {
      purpose: dsl.purpose,
      applicant: dsl.applicant,
      contracts: dsl.contracts,
    },
    stages,
  });
  const logicalPlanHash = canonicalSm3({
    dslVersion: dsl.dslVersion,
    template: dsl.template,
    compilerVersion: MDOP_DSL_COMPILER_VERSION,
    contractBundleVersion: dsl.contractBundle?.version ?? null,
    plan: canonicalPlan,
  });
  return {
    dsl,
    ast: dsl,
    canonicalPlan,
    logicalPlanHash,
    audit: {
      dslVersion: dsl.dslVersion,
      templateId: dsl.template.id,
      templateVersion: dsl.template.version,
      compilerVersion: MDOP_DSL_COMPILER_VERSION,
      contractBundleVersion: dsl.contractBundle?.version ?? null,
      draft: dsl.draft,
    },
  };
}

function operatorIds(dsl: MdopPlanDsl): Set<string> {
  return new Set(dsl.operators.map((operator) => operator.id));
}

function operatorsSoFar(stages: LogicalStage[]): Set<string> {
  return new Set(stages.map((stage) => stage.id));
}

function operatorIdsHave(ids: Set<string>, id: string): boolean {
  return ids.has(id);
}

/** 人可读解释器：逐项显示数据源、合约、节点、算子和发布约束。 */
export function explainMdopPlanDsl(input: string | unknown): string[] {
  const dsl = parseMdopPlanDsl(input);
  const lines = [
    `${dsl.dslVersion} ${dsl.template.id}@${dsl.template.version} (${dsl.draft})`,
    `purpose=${dsl.purpose}`,
    `window=${dsl.window.notBefore}..${dsl.window.notAfter}`,
  ];
  if (dsl.study)
    lines.push(
      `study=${dsl.study.studyId} design=${dsl.study.design} ${dsl.study.estimand}/${dsl.study.estimator} profile=${dsl.study.profileVersion} protocol=${dsl.study.protocolVersion} sap=${dsl.study.sapVersion} synthetic=${String(dsl.study.synthetic)}`,
    );
  for (const [key, source] of Object.entries(dsl.sources)) {
    lines.push(
      `source ${key}: ${source.participant}/${source.dataProduct} role=${source.role} contract=${source.contract ?? "(bundle)"}`,
    );
  }
  for (const operator of dsl.operators) {
    const placement = dsl.placement[operator.id] ?? operator.placement;
    const node = typeof placement === "string" ? placement : placement.node;
    lines.push(
      `operator ${operator.id}: ${operator.op} node=${node} inputs=${operator.inputs.map((i) => (typeof i === "string" ? i : i.from)).join(",")}`,
    );
  }
  lines.push(
    `bundle=${dsl.contractBundle ? `${dsl.contractBundle.bundleId}@${dsl.contractBundle.version}` : "(none)"}`,
  );
  return lines;
}
