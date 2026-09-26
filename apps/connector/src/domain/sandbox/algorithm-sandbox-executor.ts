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
}
