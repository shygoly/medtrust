import { FLOW_LABELS, type FlowLabel } from "../label/lattice";
import {
  SchemaError,
  asObject,
  checkKeys,
  reqArray,
  reqBoolean,
  reqDigest,
  reqEnum,
  reqObject,
  reqString,
} from "./strict";

/**
 * 算子清单（协议 §5.2 + D-MDOP-5）。
 *
 * `kind` 四类：`wasm`（摘要为模块 SM3）、`oci`（镜像 digest，本期不启用）、
 * `system`（连接器/平台自带机制，`id@version` + 组件构建版本）、
 * `secure_aggregate`（节点侧安全聚合；计划标识写作 `system.secure_aggregate`，D-MDOP-5 补注）。
 * 承载受托分析逻辑的算子 MUST 是 `wasm` 或 `oci`；`system` 只许 `source`/`declassify`/合并；
 * `secure_aggregate` 不承载分析逻辑，标签路径固定为 C1 输入 → C3 输出。
 */

export const OPERATOR_KINDS = ["wasm", "oci", "system", "secure_aggregate"] as const;
export type OperatorKind = (typeof OPERATOR_KINDS)[number];

export const OPERATOR_CATEGORIES = [
  "source",
  "local",
  "collab",
  "enclave",
  "seal",
  "declassify",
  "merge",
  "aggregation",
  "control",
] as const;
export type OperatorCategory = (typeof OPERATOR_CATEGORIES)[number];

/** `system` 只允许承载这几类机制（`seal` 是封装/解封机制，见协议 §5.1）。 */
export const SYSTEM_ALLOWED_CATEGORIES: readonly OperatorCategory[] = [
  "source",
  "seal",
  "declassify",
  "merge",
];

/** 本期不启用的 kind：编译期引用即 `E_CAPABILITY_MISMATCH`。 */
export const DISABLED_KINDS: readonly OperatorKind[] = ["oci"];

export type OutputLabelRule = "inherit" | FlowLabel;

export interface OperatorInput {
  name: string;
  schema: string;
  accept_labels: FlowLabel[];
}

export interface OperatorOutput {
  name: string;
  schema: string;
  label_rule: OutputLabelRule;
}

export interface OperatorManifest {
  apiVersion: string;
  kind: OperatorKind;
  id: string;
  version: string;
  category: OperatorCategory;
  digest: string;
  publisher: string;
  inputs: OperatorInput[];
  outputs: OperatorOutput[];
  params: Record<string, unknown>;
  environments: string[];
  security: { network: string; writes?: string };
  /** `wasm` / `oci` 必填：可复现构建来源（D-CN-5）。 */
  build?: {
    source_digest: string;
    toolchain: string;
    reproducible: boolean;
  };
  /** `system` / `secure_aggregate` 必填：组件构建版本标识。 */
  component?: string;
  /**
   * 仅 `kind: secure_aggregate` 必填。
   * 具体参与方名单在编译期写入 `AggregateStageSpec`，清单只声明闭合方式。
   */
  aggregation?: {
    encryption: "per_recipient_pubkey";
    party_closure: "compile_time";
  };
}

export type OperatorRef = { id: string; version: string };

export function operatorRefString(ref: OperatorRef): string {
  return `${ref.id}@${ref.version}`;
}

export function parseOperatorRef(input: string): OperatorRef {
  const match = /^(.+)@(\d+\.\d+\.\d+)$/.exec(input);
  if (!match) throw new SchemaError("operator.ref", `算子引用必须形如 id@x.y.z：${input}`);
  return { id: match[1], version: match[2] };
}

export function parseOperatorManifest(input: unknown): OperatorManifest {
  const obj = asObject(input, "operator");
  checkKeys(obj, "operator", {
    required: [
      "apiVersion",
      "kind",
      "id",
      "version",
      "category",
      "digest",
      "publisher",
      "inputs",
      "outputs",
      "params",
      "environments",
      "security",
    ],
    optional: ["build", "component", "aggregation"],
  });

  const kind = reqEnum(obj, "kind", "operator", OPERATOR_KINDS);
  const category = reqEnum(obj, "category", "operator", OPERATOR_CATEGORIES);
  const manifest: OperatorManifest = {
    apiVersion: reqString(obj, "apiVersion", "operator"),
    kind,
    id: reqString(obj, "id", "operator"),
    version: reqString(obj, "version", "operator"),
    category,
    digest: reqString(obj, "digest", "operator"),
    publisher: reqString(obj, "publisher", "operator"),
    inputs: reqArray(obj, "inputs", "operator").map((item, i) => parseInput(item, i)),
    outputs: reqArray(obj, "outputs", "operator").map((item, i) => parseOutput(item, i)),
    params: reqObject(obj, "params", "operator"),
    environments: reqArray(obj, "environments", "operator").map((item, i) =>
      parseEnvName(item, i),
    ),
    security: parseSecurity(obj, "operator"),
  };

  if (obj.build !== undefined) {
    const build = reqObject(obj, "build", "operator");
    checkKeys(build, "operator.build", {
      required: ["source_digest", "toolchain", "reproducible"],
    });
    manifest.build = {
      source_digest: reqDigest(build, "source_digest", "operator.build"),
      toolchain: reqString(build, "toolchain", "operator.build"),
      reproducible: reqBoolean(build, "reproducible", "operator.build"),
    };
  }
  const component = obj.component;
  if (component !== undefined) {
    if (typeof component !== "string" || component.length === 0)
      throw new SchemaError("operator.component", "必须是字符串");
    manifest.component = component;
  }
  if (obj.aggregation !== undefined) manifest.aggregation = parseAggregation(obj);

  assertManifestRules(manifest);
  return manifest;
}

function parseInput(item: unknown, index: number): OperatorInput {
  const path = `operator.inputs[${index}]`;
  const obj = asObject(item, path);
  checkKeys(obj, path, { required: ["name", "schema", "accept_labels"] });
  return {
    name: reqString(obj, "name", path),
    schema: reqString(obj, "schema", path),
    accept_labels: reqArray(obj, "accept_labels", path).map((label, i) =>
      labelValue(label, `${path}.accept_labels[${i}]`),
    ),
  };
}

function parseOutput(item: unknown, index: number): OperatorOutput {
  const path = `operator.outputs[${index}]`;
  const obj = asObject(item, path);
  checkKeys(obj, path, { required: ["name", "schema", "label_rule"] });
  const rule = reqString(obj, "label_rule", path);
  if (rule !== "inherit" && !(FLOW_LABELS as readonly string[]).includes(rule))
    throw new SchemaError(`${path}.label_rule`, `非法输出规则 ${rule}`);
  return {
    name: reqString(obj, "name", path),
    schema: reqString(obj, "schema", path),
    label_rule: rule as OutputLabelRule,
  };
}

function parseEnvName(item: unknown, index: number): string {
  if (typeof item !== "string" || item.length === 0)
    throw new SchemaError(`operator.environments[${index}]`, "必须是非空字符串");
  return item;
}

function parseSecurity(
  obj: Record<string, unknown>,
  path: string,
): { network: string; writes?: string } {
  const security = reqObject(obj, "security", path);
  checkKeys(security, `${path}.security`, { required: ["network"], optional: ["writes"] });
  const out: { network: string; writes?: string } = {
    network: reqString(security, "network", `${path}.security`),
  };
  if (security.writes !== undefined) {
    if (typeof security.writes !== "string")
      throw new SchemaError(`${path}.security.writes`, "必须是字符串");
    out.writes = security.writes;
  }
  return out;
}

const AGGREGATION_ENCRYPTION = ["per_recipient_pubkey"] as const;
const PARTY_CLOSURE = ["compile_time"] as const;

function parseAggregation(obj: Record<string, unknown>): NonNullable<OperatorManifest["aggregation"]> {
  const aggregation = reqObject(obj, "aggregation", "operator");
  checkKeys(aggregation, "operator.aggregation", {
    required: ["encryption", "party_closure"],
  });
  return {
    encryption: reqEnum(aggregation, "encryption", "operator.aggregation", AGGREGATION_ENCRYPTION),
    party_closure: reqEnum(aggregation, "party_closure", "operator.aggregation", PARTY_CLOSURE),
  };
}

function labelValue(input: unknown, path: string): FlowLabel {
  if (typeof input !== "string" || !(FLOW_LABELS as readonly string[]).includes(input))
    throw new SchemaError(path, `流动等级非法：${String(input)}`);
  return input as FlowLabel;
}

/** 登记时的清单约束（规格「算子清单」「算子类型」「wasm 算子准入来源」）。 */
export function assertManifestRules(manifest: OperatorManifest): void {
  const at = "operator";
  if (manifest.kind === "system" && !SYSTEM_ALLOWED_CATEGORIES.includes(manifest.category))
    throw new SchemaError(
      at,
      `system 算子只许承载 ${SYSTEM_ALLOWED_CATEGORIES.join("/")} 机制，不许冒充分析算子（category=${manifest.category}）`,
    );
  if (manifest.kind !== "system" && manifest.category === "control")
    throw new SchemaError(at, "control 类只能是 system 机制");
  if (manifest.kind === "secure_aggregate" && manifest.category !== "aggregation")
    throw new SchemaError(at, "secure_aggregate 的 category 必须是 aggregation");
  if (manifest.kind !== "secure_aggregate" && manifest.category === "aggregation")
    throw new SchemaError(at, "aggregation 类只能是 secure_aggregate");
  if (manifest.kind === "secure_aggregate" && !manifest.aggregation)
    throw new SchemaError(at, "secure_aggregate 必须声明 aggregation（参与方闭合与加密方式）");
  if (manifest.kind !== "secure_aggregate" && manifest.aggregation)
    throw new SchemaError(at, "只有 secure_aggregate 可以声明 aggregation");

  if (manifest.kind === "secure_aggregate") {
    if (manifest.inputs.length === 0)
      throw new SchemaError(at, "secure_aggregate 必须声明 C1 输入");
    for (const [i, input] of manifest.inputs.entries()) {
      if (input.accept_labels.length !== 1 || input.accept_labels[0] !== "C1")
        throw new SchemaError(
          `${at}.inputs[${i}]`,
          "secure_aggregate 的输入只接受 C1",
        );
    }
  }

  for (const [i, output] of manifest.outputs.entries()) {
    if (manifest.kind === "secure_aggregate") {
      if (output.label_rule !== "C3")
        throw new SchemaError(
          `${at}.outputs[${i}]`,
          `secure_aggregate 的输出规则必须是 C3（收到 ${output.label_rule}）`,
        );
      continue;
    }
    // 封装类（`seal`）必须声明固定等级：封装 C2、解封 C0（协议 §4.2 R4 / §5.1）。
    // `secure_aggregate` 的 C3 已在上面单独校验。其余非降密算子一律 `inherit`。
    if (manifest.category === "seal") {
      if (output.label_rule !== "C2" && output.label_rule !== "C0")
        throw new SchemaError(
          `${at}.outputs[${i}]`,
          `封装类算子的输出规则必须是 C2（封装）或 C0（解封）（收到 ${output.label_rule}）`,
        );
      continue;
    }
    if (manifest.category !== "declassify" && output.label_rule !== "inherit")
      throw new SchemaError(
        `${at}.outputs[${i}]`,
        `非 declassify 算子的输出规则必须是 inherit（收到 ${output.label_rule}）`,
      );
  }

  if (
    manifest.category !== "collab" &&
    manifest.category !== "aggregation" &&
    manifest.security.network !== "none"
  )
    throw new SchemaError(at, `除协同算子外 security.network 必须是 none（收到 ${manifest.security.network}）`);

  if (manifest.kind === "wasm") {
    if (!manifest.build) throw new SchemaError(at, "wasm 算子必须带可复现构建记录");
    if (!manifest.build.reproducible)
      throw new SchemaError(at, "wasm 算子的构建记录必须标明可复现（复现不出的摘要不得登记）");
    if (!/^sm3:[0-9a-f]{64}$/.test(manifest.digest))
      throw new SchemaError(at, "wasm 算子的 digest 必须是模块 SM3");
  }
  if ((manifest.kind === "system" || manifest.kind === "secure_aggregate") && !manifest.component)
    throw new SchemaError(at, `${manifest.kind} 算子必须带组件构建版本（component）`);
  if (manifest.kind === "oci" && !manifest.digest.startsWith("sha256:"))
    throw new SchemaError(at, "oci 算子的 digest 必须是镜像摘要");
}

/** 按 `id@version` 在清单集合里查；未登记即未注册（编译期 `E_CAPABILITY_MISMATCH`）。 */
export function findOperator(
  manifests: readonly OperatorManifest[],
  ref: OperatorRef,
): OperatorManifest | undefined {
  return manifests.find((m) => m.id === ref.id && m.version === ref.version);
}
