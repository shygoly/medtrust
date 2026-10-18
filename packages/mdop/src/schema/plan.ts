import { FLOW_LABELS, type FlowLabel, type PlanEdge } from "../label/lattice";
import {
  SchemaError,
  asObject,
  checkKeys,
  optNumber,
  optString,
  reqArray,
  reqObject,
  reqString,
} from "./strict";

/**
 * 逻辑计划与物理计划（协议 §6 / 规格「作业提交」「片段切分与计划哈希」）。
 *
 * 逻辑计划只描述「算什么」：用途、申请方、引用的合约、阶段集合。
 * **MUST NOT 携带可执行代码**——阶段只能引用已注册的算子 `id@version`。
 */

export interface LogicalStageInput {
  /** 上游阶段 id，或数据源句柄 `ds://<node>/<dataProductId>`。 */
  from: string;
}

export interface LogicalStage {
  id: string;
  op: string;
  inputs: LogicalStageInput[];
  params: Record<string, unknown>;
  /** 可选：显式指定执行节点（与数据所在节点冲突即 `E_LABEL_VIOLATION`）。 */
  at?: string;
  /** 可选：制品过期时间（小时）。 */
  ttl_hours?: number;
}

export interface JobHeader {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  ethics_ref?: string;
  dp_budget?: number;
  deadline?: string;
  contract_bundle?: {
    id: string;
    version: string;
  };
  contract_bindings?: Array<{
    contract_id: string;
    participant_id: string;
    data_product_id: string;
    role: string;
    stages: string[];
  }>;
}

export interface LogicalPlan {
  job: JobHeader;
  stages: LogicalStage[];
}

export interface PhysicalStage {
  id: string;
  node: string;
  op: string;
  op_digest: string;
  params: Record<string, unknown>;
  inputs: LogicalStageInput[];
  input_labels: FlowLabel[];
  output_label: FlowLabel;
  output_schema: string;
  ttl_hours?: number;
}

export interface Fragment {
  node: string;
  stages: PhysicalStage[];
  /** 全部边界边（含对端、等级、通道）。 */
  edges: PlanEdge[];
}

export type EdgeChannel = "none" | "p2p-mtls" | "envelope" | "delivery";

export function parseLogicalPlan(input: unknown): LogicalPlan {
  const obj = asObject(input, "logicalPlan");
  checkKeys(obj, "logicalPlan", { required: ["job", "stages"] });
  return {
    job: parseJobHeader(obj.job, "logicalPlan.job"),
    stages: reqArray(obj, "stages", "logicalPlan").map((stage, i) =>
      parseLogicalStage(stage, i),
    ),
  };
}

function parseJobHeader(input: unknown, path: string): JobHeader {
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["purpose", "applicant", "contracts"],
    optional: [
      "ethics_ref",
      "dp_budget",
      "deadline",
      "contract_bundle",
      "contract_bindings",
    ],
  });
  const applicantPath = `${path}.applicant`;
  const applicant = reqObject(obj, "applicant", path);
  checkKeys(applicant, applicantPath, { required: ["org", "project"] });
  const header: JobHeader = {
    purpose: reqString(obj, "purpose", path),
    applicant: {
      org: reqString(applicant, "org", applicantPath),
      project: reqString(applicant, "project", applicantPath),
    },
    contracts: reqArray(obj, "contracts", path).map((item, i) => {
      if (typeof item !== "string" || item.length === 0)
        throw new SchemaError(`${path}.contracts[${i}]`, "必须是合约 id");
      return item as string;
    }),
  };
  const ethics = optString(obj, "ethics_ref", path);
  if (ethics !== undefined) header.ethics_ref = ethics;
  const budget = optNumber(obj, "dp_budget", path);
  if (budget !== undefined) header.dp_budget = budget;
  const deadline = optString(obj, "deadline", path);
  if (deadline !== undefined) {
    if (Number.isNaN(Date.parse(deadline)))
      throw new SchemaError(`${path}.deadline`, "必须是 RFC3339 时间戳");
    header.deadline = deadline;
  }
  if (obj.contract_bundle !== undefined) {
    const bundle = reqObject(obj, "contract_bundle", path);
    checkKeys(bundle, `${path}.contract_bundle`, { required: ["id", "version"] });
    header.contract_bundle = {
      id: reqString(bundle, "id", `${path}.contract_bundle`),
      version: reqString(bundle, "version", `${path}.contract_bundle`),
    };
  }
  if (obj.contract_bindings !== undefined) {
    header.contract_bindings = reqArray(obj, "contract_bindings", path).map((item, index) => {
      const bindingPath = `${path}.contract_bindings[${index}]`;
      const binding = asObject(item, bindingPath);
      checkKeys(binding, bindingPath, {
        required: [
          "contract_id",
          "participant_id",
          "data_product_id",
          "role",
          "stages",
        ],
      });
      return {
        contract_id: reqString(binding, "contract_id", bindingPath),
        participant_id: reqString(binding, "participant_id", bindingPath),
        data_product_id: reqString(binding, "data_product_id", bindingPath),
        role: reqString(binding, "role", bindingPath),
        stages: reqArray(binding, "stages", bindingPath).map((stage, stageIndex) => {
          if (typeof stage !== "string" || stage.length === 0)
            throw new SchemaError(`${bindingPath}.stages[${stageIndex}]`, "必须是阶段 id");
          return stage as string;
        }),
      };
    });
  }
  return header;
}

function parseLogicalStage(input: unknown, index: number): LogicalStage {
  const path = `logicalPlan.stages[${index}]`;
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["id", "op", "inputs", "params"],
    optional: ["at", "ttl_hours"],
  });
  const stage: LogicalStage = {
    id: reqString(obj, "id", path),
    op: reqString(obj, "op", path),
    inputs: reqArray(obj, "inputs", path).map((item, i) => {
      const inputPath = `${path}.inputs[${i}]`;
      const inputObj = asObject(item, inputPath);
      checkKeys(inputObj, inputPath, { required: ["from"] });
      return { from: reqString(inputObj, "from", inputPath) };
    }),
    params: reqObject(obj, "params", path),
  };
  const at = optString(obj, "at", path);
  if (at !== undefined) stage.at = at;
  const ttl = optNumber(obj, "ttl_hours", path);
  if (ttl !== undefined) stage.ttl_hours = ttl;
  if (containsExecutable(stage.params))
    throw new SchemaError(path, "逻辑计划的参数 MUST NOT 携带可执行代码");
  return stage;
}

/** 结构化判定「参数里夹带可执行代码」。 */
const EXECUTABLE_KEYS = ["code", "script", "source", "wasm", "wasm_b64", "entrypoint", "image"];
function containsExecutable(value: unknown, depth = 0): boolean {
  if (depth > 6 || typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some((item) => containsExecutable(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => EXECUTABLE_KEYS.includes(key) || containsExecutable(child, depth + 1),
  );
}

export function parseFragment(input: unknown): Fragment {
  const obj = asObject(input, "fragment");
  checkKeys(obj, "fragment", { required: ["node", "stages", "edges"] });
  return {
    node: reqString(obj, "node", "fragment"),
    stages: reqArray(obj, "stages", "fragment").map((stage, i) =>
      parsePhysicalStage(stage, i),
    ),
    edges: reqArray(obj, "edges", "fragment").map((edge, i) => parsePlanEdge(edge, i)),
  };
}

function parsePhysicalStage(input: unknown, index: number): PhysicalStage {
  const path = `fragment.stages[${index}]`;
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: [
      "id",
      "node",
      "op",
      "op_digest",
      "params",
      "inputs",
      "input_labels",
      "output_label",
      "output_schema",
    ],
    optional: ["ttl_hours"],
  });
  const stage: PhysicalStage = {
    id: reqString(obj, "id", path),
    node: reqString(obj, "node", path),
    op: reqString(obj, "op", path),
    op_digest: reqString(obj, "op_digest", path),
    params: reqObject(obj, "params", path),
    inputs: reqArray(obj, "inputs", path).map((item, i) => {
      const inputPath = `${path}.inputs[${i}]`;
      const inputObj = asObject(item, inputPath);
      checkKeys(inputObj, inputPath, { required: ["from"] });
      return { from: reqString(inputObj, "from", inputPath) };
    }),
    input_labels: reqArray(obj, "input_labels", path).map((label, i) =>
      parseLabel(label, `${path}.input_labels[${i}]`),
    ),
    output_label: parseLabel(obj.output_label, `${path}.output_label`),
    output_schema: reqString(obj, "output_schema", path),
  };
  const ttl = optNumber(obj, "ttl_hours", path);
  if (ttl !== undefined) stage.ttl_hours = ttl;
  return stage;
}

export function parsePlanEdge(input: unknown, index: number): PlanEdge {
  const path = `fragment.edges[${index}]`;
  const obj = asObject(input, path);
  checkKeys(obj, path, {
    required: ["from_stage", "to_stage", "label", "from_node", "to_node"],
    optional: ["channel"],
  });
  return {
    from_stage: reqString(obj, "from_stage", path),
    to_stage: reqString(obj, "to_stage", path),
    label: parseLabel(obj.label, `${path}.label`),
    from_node: reqString(obj, "from_node", path),
    to_node: reqString(obj, "to_node", path),
  };
}

function parseLabel(input: unknown, path: string): FlowLabel {
  if (typeof input !== "string" || !(FLOW_LABELS as readonly string[]).includes(input))
    throw new SchemaError(path, `流动等级非法：${String(input)}`);
  return input as FlowLabel;
}

/** 数据源句柄 `ds://<node>/<dataProductId>`。 */
export const DATASET_URI_PREFIX = "ds://";

export function datasetUriNode(uri: string): string | undefined {
  if (!uri.startsWith(DATASET_URI_PREFIX)) return undefined;
  const rest = uri.slice(DATASET_URI_PREFIX.length);
  const slash = rest.indexOf("/");
  return slash > 0 ? rest.slice(0, slash) : undefined;
}

export function artifactUri(node: string, jobId: string, stage: string, output: string): string {
  return `art://${node}/${jobId}/${stage}/${output}`;
}
