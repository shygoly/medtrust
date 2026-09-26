import { WasmSandboxRunner } from '../domain/sandbox/sandbox-runner';
import type { MdopStageExecutor } from '../mdop/mdop-executor';
import { MdopStageExecutor as Executor } from '../mdop/mdop-executor';
import type { NodePublicationReview } from '../mdop/node/publication-review';
import { registerNodeDeclassifyOperator } from './declassify-op';
import type { NodeDeclassifyRegistration } from './declassify-op';
import { registerNodeWasmOps } from './wasm-runner';

/**
 * 节点**执行面**的装配（任务 3.12f）：一次把节点会跑的算子接齐。
 *
 * 为什么要有这个装配点：节点能跑的算子有两类，两类都得接上，缺一类那个阶段就永远执行不了：
 *  - **system**：`declassify.small_cell`（把发布审查注册成算子，含 minCell 判据）；
 *  - **wasm**：`rws.paired-cohort`（注册中心签发的模块，走零能力沙箱 + 5 参数字列 ABI）。
 *
 * 这里刻意**不接受任意算子**：能跑什么由代码写死（清单只决定「这次作业准不准跑」），
 * 未接线的算子一律 `E_CAPABILITY_MISMATCH`，不回退到内置实现。
 */

export interface NodeExecutorDeps {
  /** 节点内的发布审查（system 降密算子的判据来源）。 */
  review: NodePublicationReview;
  /** 按 SM3 摘要取模块字节（节点本地模块库；取不到即拒）。 */
  moduleBytes(digest: string): Uint8Array | undefined;
  /** 沙箱执行器（缺省新建）。 */
  runner?: WasmSandboxRunner;
  /** 配对算子的分层取值列表（缺省按投影里出现过的分层键排序）。 */
  strataKeys?: readonly string[];
}

export interface NodeExecutorAssembly {
  executor: MdopStageExecutor;
  /** 降密算子的发布审查记录来源（出口造随行清单要用它，别在装配处另建一个）。 */
  declassify: NodeDeclassifyRegistration;
}

export function createNodeExecutor(deps: NodeExecutorDeps): NodeExecutorAssembly {
  const executor = new Executor();
  const declassify = registerNodeDeclassifyOperator(executor, { review: deps.review });
  registerNodeWasmOps(executor, {
    moduleBytes: deps.moduleBytes,
    ...(deps.runner ? { runner: deps.runner } : {}),
    ...(deps.strataKeys ? { strataKeys: deps.strataKeys } : {}),
  });
  return { executor, declassify };
}
