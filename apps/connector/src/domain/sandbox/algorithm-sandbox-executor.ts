// algorithm-sandbox — 宿主侧沙箱执行入口。
//
// 合约固定了模块的分析类型走这里:取模块 → 双重校验 → 零能力检查 → 资源上限检查 →
// worker 内实例化并执行 → 输出不变量校验。任何一步失败都抛错(任务失败),不回退。
import { Injectable, Optional } from '@nestjs/common';
import { AuditService } from '../audit';
import {
  DisproportionalityProjection,
  SandboxBucket,
  projectionRequiredBytes,
  bucketsFromSandboxOutput,
} from './disproportionality-sandbox';
import { ConnectorModuleClient, PinnedModuleRef } from './module-client';
import { WasmSandboxRunner } from './sandbox-runner';

export interface SandboxDisproportionalityResult {
  buckets: SandboxBucket[];
  moduleSm3: string;
  abiVersion: number;
}

@Injectable()
export class AlgorithmSandboxExecutor {
  constructor(
    private readonly modules: ConnectorModuleClient,
    private readonly runner: WasmSandboxRunner,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** L1.5 失衡检测:最小列投影 → 沙箱 2×2 计数 → 回填 key/rate。 */
  async runProjection(
    projection: DisproportionalityProjection,
    opts: {
      pinnedModule: PinnedModuleRef;
      taskId?: string;
    },
  ): Promise<SandboxDisproportionalityResult> {
    // 校验/上限失败也要留 sandbox-fail 审计(失败原因必须可追)。
    const fail = (err: unknown): never => {
      this.audit?.record({
        action: 'sandbox-fail',
        actor: opts.taskId ?? 'wasm-sandbox',
        allowed: false,
        detail: `analysis=${opts.pinnedModule.analysisType} sm3=${opts.pinnedModule.sm3} reason=${(err as Error).message}`,
      });
      throw err;
    };

    // 运行前:内存上限(调用前拒绝)+ 模块双重校验。失败由这里记沙箱审计。
    let module: Awaited<ReturnType<ConnectorModuleClient['getVerifiedModule']>>;
    try {
      this.runner.assertWithinMemoryLimit(
        projectionRequiredBytes(projection.n, projection.k),
      );
      module = await this.modules.getVerifiedModule(opts.pinnedModule);
    } catch (err) {
      return fail(err);
    }

    // 执行:worker 内运行。runner 自身在成功/失败两侧都写审计,这里不重复记。
    const result = await this.runner.run({
      analysisType: opts.pinnedModule.analysisType,
      moduleSm3: module.sm3,
      moduleBytes: module.bytes,
      input: projection.input,
      n: projection.n,
      k: projection.k,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
      // 闸 1 报告里的声明内存下限:宿主注入的内存不得小于它。
      minMemoryPages: (module.gate as { memoryPages?: { min?: number } } | undefined)
        ?.memoryPages?.min,
      taskId: opts.taskId,
    });

    // 运行后:ABI 声明一致 + 输出不变量。违反即 sandbox-fail。
    try {
      if (result.abiVersion !== module.abiVersion) {
        throw new Error(
          `模块 abi_version=${result.abiVersion} 与分发声明 ${module.abiVersion} 不符`,
        );
      }
      const buckets = bucketsFromSandboxOutput(result.output, projection);
      return { buckets, moduleSm3: module.sm3, abiVersion: result.abiVersion };
    } catch (err) {
      return fail(err);
    }
  }

  /**
   * 通用**定点计算**路径（批次 1A / L4 联邦预测用它跑院内定点训练模块）。
   *
   * 与 `runProjection` 同一套闸：内存上限 → 模块双重校验 → 沙箱执行 → ABI 一致 → 审计；
   * 差别只在于**输入载荷由调用方按模块 ABI 编码好**（宿主不解释语义），调用形状固定为
   * `table@1` = `run(0, n, k, outOff)`（沙箱只认形状，不认语义）。
   * 输出字节按模块 ABI 解码由调用方负责（见 `mdop/operators/l4.ts`）。
   */
  async runFixedCompute(opts: {
    pinnedModule: PinnedModuleRef;
    /** 编码好的输入块（宿主写入内存偏移 0）。 */
    input: Uint8Array;
    /** `run` 的第二参（行数）。 */
    n: number;
    /** `run` 的第三参（该模块写作 d：特征数）。 */
    k: number;
    outOff: number;
    outBytes: number;
    /** 内存上限判据（含工作区与输出区）。 */
    requiredBytes: number;
    taskId?: string;
  }): Promise<{ output: Uint8Array; moduleSm3: string; abiVersion: number }> {
    const fail = (err: unknown): never => {
      this.audit?.record({
        action: 'sandbox-fail',
        actor: opts.taskId ?? 'wasm-sandbox',
        allowed: false,
        detail: `analysis=${opts.pinnedModule.analysisType} sm3=${opts.pinnedModule.sm3} reason=${(err as Error).message}`,
      });
      throw err;
    };

    let module: Awaited<ReturnType<ConnectorModuleClient['getVerifiedModule']>>;
    try {
      this.runner.assertWithinMemoryLimit(opts.requiredBytes);
      module = await this.modules.getVerifiedModule(opts.pinnedModule);
    } catch (err) {
      return fail(err);
    }

    const result = await this.runner.run({
      analysisType: opts.pinnedModule.analysisType,
      moduleSm3: module.sm3,
      moduleBytes: module.bytes,
      input: opts.input,
      n: opts.n,
      k: opts.k,
      outOff: opts.outOff,
      outBytes: opts.outBytes,
      minMemoryPages: (module.gate as { memoryPages?: { min?: number } } | undefined)
        ?.memoryPages?.min,
      taskId: opts.taskId,
    });

    try {
      if (result.abiVersion !== module.abiVersion) {
        throw new Error(
          `模块 abi_version=${result.abiVersion} 与分发声明 ${module.abiVersion} 不符`,
        );
      }
      return {
        output: result.output,
        moduleSm3: module.sm3,
        abiVersion: result.abiVersion,
      };
    } catch (err) {
      return fail(err);
    }
  }
}
