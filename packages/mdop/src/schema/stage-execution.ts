/**
 * **阶段执行契约**（平台与连接器复核共用的形状）。
 *
 * 从 `apps/connector/src/mdop/mdop-executor.ts` 上移（change `kernel-stage-contract`，TD-12 边界）：
 * 这些形状**零领域语义**（作业号、阶段声明、上游产物、合约条款），但**应用侧与行业包都要看见它**；
 * 各留一份结构镜像会逼迫接线代码做双向断言，故收敛到协议核单一来源。
 *
 * `inputs` 用**中立**记录类型（`Record<string, unknown>`）：领域记录类型（如医疗的 `InternalRecord`）
 * 归行业包，基座 MUST NOT 出现领域字段名。
 */
import type { FlowLabel } from "../label/lattice";
import type { PhysicalStage } from "./plan";

export interface StageInput {
  jobId: string;
  stage: PhysicalStage;
  /** 上游产物（按 from 索引）。 */
  inputs: Map<string, Record<string, unknown>>;
  /** 本地合约的规范化条款（system 算子读 minCell 等发布条件）。 */
  contractTerms?: Record<string, unknown>;
  attempt: number;
}

export interface StageOutput {
  label: FlowLabel;
  schema: string;
  payload: Record<string, unknown>;
  digest: string;
}

export type SystemHandler = (input: StageInput) => Promise<{
  label?: FlowLabel;
  schema?: string;
  payload: Record<string, unknown>;
}>;

/**
 * 处理器**链**的一环：认领不了就返回 `undefined`（婉拒），由下一环接管。
 * 用于**同一个 op** 承载多种载荷语义（如 `declassify.small_cell` 既要处理 L1.5 的四格表、
 * 又要处理 L4 的模型载荷）——注册是「追加」，不是覆盖。
 */
export type ChainSystemHandler = (input: StageInput) => Promise<
  | {
      label?: FlowLabel;
      schema?: string;
      payload: Record<string, unknown>;
    }
  | undefined
>;

export type WasmRunner = (
  opRef: string,
  moduleDigest: string,
  input: StageInput,
) => Promise<{ label?: FlowLabel; schema?: string; payload: Record<string, unknown> }>;

/**
 * 阶段**执行器**的形状（应用侧实现留在连接器；行业包只依赖这个接口）。
 *
 * 与执行契约同源：应用侧的执行器类 `implements StageExecutor`，包不再自备结构镜像（也就无需断言）。
 */
export interface StageExecutor {
  registerSystem(opRef: string, handler: SystemHandler): void;
  setWasmRunner(runner: WasmRunner): void;
  appendSystemHandler(opRef: string, handler: ChainSystemHandler): void;
}
