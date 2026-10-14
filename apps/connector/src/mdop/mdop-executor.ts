import { Injectable, Logger } from '@nestjs/common';
import {
  MdopError,
  canonicalSm3,
  parseOperatorManifest,
  type ChainSystemHandler,
  type FlowLabel,
  type PhysicalStage,
  type StageInput,
  type StageExecutor,
  type StageOutput,
  type SystemHandler,
  type WasmRunner,
} from '@medtrust/mdop';

/**
 * 片段执行器（任务 8.4）。
 *
 * 支持两类算子：
 *  - `system`：连接器或平台自带的机制（数据源、降密闸门、合并），由**本连接器**的
 *    handler 注册实现（`registerSystem`）；
 *  - `wasm`：经现有零能力沙箱执行已登记的模块（`setWasmRunner`，§9 接真实模块）。
 *
 * 未注册的算子一律 `E_CAPABILITY_MISMATCH` —— 不回退到内置实现（fail-closed）。
 * 输出摘要由执行器统一计算（`canonicalSm3(payload)`），句柄登记与投递都用它。
 */

/**
 * 阶段执行契约已上移到协议核（change `kernel-stage-contract`）：应用与行业包共用**同一份**定义，
 * 不再各自镜像。此处**再导出**，既有调用点（从 `../mdop-executor` 引 `StageInput` 等）不变。
 */
export type {
  ChainSystemHandler,
  StageInput,
  StageOutput,
  SystemHandler,
  WasmRunner,
} from "@medtrust/mdop";

@Injectable()
export class MdopStageExecutor implements StageExecutor {
  private readonly logger = new Logger(MdopStageExecutor.name);
  private readonly systemHandlers = new Map<string, SystemHandler>();
  private readonly systemChains = new Map<string, ChainSystemHandler[]>();
  private wasmRunner?: WasmRunner;
  /** 按算子**前缀**注册的 wasm 实现（多算子共存；见 registerWasmOperator）。 */
  private readonly wasmOperators = new Map<string, WasmRunner>();

  registerSystem(opRef: string, handler: SystemHandler): void {
    this.systemHandlers.set(opRef, handler);
  }

  setWasmRunner(runner: WasmRunner): void {
    this.wasmRunner = runner;
  }

  /**
   * 按算子**前缀**注册 wasm 执行实现。
   *
   * 为什么需要它：`setWasmRunner` 一个执行器只留**一个** runner —— 先注册 L1.5、后注册 L4 时
   * 后者会把前者顶掉（或反过来在 L1.5 的 runner 里硬写 L4 分支，把两个域耦在一起）。
   * 这里把「多个 wasm 算子」变成执行器的能力，`setWasmRunner` 保留为**兜底**（老路径行为不变）。
   */
  registerWasmOperator(opPrefix: string, runner: WasmRunner): void {
    this.wasmOperators.set(opPrefix, runner);
  }

  registeredWasmOps(): string[] {
    return [...this.wasmOperators.keys()].sort();
  }

  private resolveWasmRunner(op: string): WasmRunner | undefined {
    for (const [prefix, runner] of this.wasmOperators) {
      if (op.startsWith(prefix)) return runner;
    }
    return this.wasmRunner;
  }

  /** 同一个 op 追加一环（婉拒式；见 ChainSystemHandler）。 */
  appendSystemHandler(opRef: string, handler: ChainSystemHandler): void {
    const list = this.systemChains.get(opRef) ?? [];
    list.push(handler);
    this.systemChains.set(opRef, list);
  }

  registeredSystemOps(): string[] {
    return [
      ...new Set([...this.systemHandlers.keys(), ...this.systemChains.keys()]),
    ].sort();
  }

  async execute(input: StageInput, manifestJson?: unknown): Promise<StageOutput> {
    const manifest = manifestJson ? parseOperatorManifest(manifestJson) : undefined;
    if (!manifest)
      throw new MdopError('E_CAPABILITY_MISMATCH', {}, `算子清单未同步：${input.stage.op}`);

    const kind = manifest.kind;
    let produced: { label?: FlowLabel; schema?: string; payload: Record<string, unknown> };
    if (kind === 'wasm') {
      const runner = this.resolveWasmRunner(input.stage.op);
      if (!runner)
        throw new MdopError('E_CAPABILITY_MISMATCH', {}, '本节点未接入 wasm 沙箱执行器');
      produced = await runner(input.stage.op, manifest.digest, input);
    } else if (kind === 'system') {
      const handler = this.systemHandlers.get(input.stage.op);
      if (handler) {
        produced = await handler(input);
      } else {
        const chain = this.systemChains.get(input.stage.op) ?? [];
        let claimed: Awaited<ReturnType<ChainSystemHandler>>;
        for (const step of chain) {
          claimed = await step(input);
          if (claimed) break;
        }
        if (!claimed)
          throw new MdopError(
            'E_CAPABILITY_MISMATCH',
            {},
            `没有处理器认领该 ${input.stage.op} 阶段的载荷（链上 ${chain.length} 环）`,
          );
        produced = claimed;
      }
    } else {
      // oci 本期未启用
      throw new MdopError('E_CAPABILITY_MISMATCH', {}, `算子类型 ${kind} 本期未启用`);
    }

    const output: StageOutput = {
      // 等级以**本地清单声明的规则**为准（复核阶段已重算过一致性）
      label: produced.label ?? input.stage.output_label,
      schema: produced.schema ?? input.stage.output_schema,
      payload: produced.payload,
      digest: canonicalSm3(produced.payload),
    };
    this.logger.log(
      `阶段执行完成 job=${input.jobId} stage=${input.stage.id} op=${input.stage.op} digest=${output.digest.slice(0, 16)}…`,
    );
    return output;
  }
}
