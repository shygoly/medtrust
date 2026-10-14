/**
 * 组装关注点（Nest provider）：住在 `src/wiring/` 而不是基座目录 —— 它要把行业包声明的算子接线接到
 * 应用侧实现上，属**组装根区域**（change `kernel-stage-contract`：内核目录 MUST NOT import 行业包）。
 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { decodeFlLogisticOutput } from '@medtrust/wasm-algorithms';
import { AlgorithmSandboxExecutor } from '../domain/sandbox/algorithm-sandbox-executor';
import { ConnectorModuleClient } from '../domain/sandbox/module-client';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import {
  encodeTrainingRows,
  registerL4DeclassifyOperator,
  registerL4TrainOperator,
} from '../mdop/operators/l4';

/**
 * 把 L4 的院内**定点训练**算子接到「已登记 wasm 模块 + 零能力沙箱」上（批次 1A）。
 *
 * 复用而不重写：特征编码复用旧链同一函数（`encodeTabularRows`），训练语义在 wasm 模块里，
 * 本模块只做：阶段清单取模块摘要 → 编码输入块 → 沙箱执行 → 解码定点系数 → 输出 C0。
 * 与 L1.5 的 wiring 相互独立：`registerWasmOperator` 按前缀分派，不覆盖对方的 runner。
 */
@Injectable()
export class L4OperatorWiring implements OnModuleInit {
  private readonly logger = new Logger(L4OperatorWiring.name);

  constructor(
    private readonly executor: MdopStageExecutor,
    @Optional() private readonly sandbox?: AlgorithmSandboxExecutor,
    @Optional() private readonly modules?: ConnectorModuleClient,
  ) {}

  onModuleInit(): void {
    registerL4TrainOperator(
      this.executor,
      {
        runLogistic: async ({ rows, spec, stage }) => {
          if (!this.sandbox || !this.modules)
            throw new Error('本节点未接入 wasm 沙箱执行器（MDOP L4 需要它，fail-closed）');
          // 合约/计划固定的模块摘要从阶段清单取（MDOP 语义下的 pinnedModule）
          const pinnedSm3 = String(stage.stage.op_digest ?? '').replace(/^sm3:/, '');
          if (!/^[0-9a-f]{64}$/.test(pinnedSm3))
            throw new Error(`阶段没有可用的 wasm 模块摘要：${stage.stage.op_digest}`);

          const { encoded, featureNames } = encodeTrainingRows(rows, spec);
          const d = encoded.d;
          // 沙箱把输入块写在内存偏移 0；模块自算工作区（gradQ: i64[d]）在其后
          const align8 = (v: number) => (v + 7) & ~7;
          const outOff = align8(encoded.bytes.length) + d * 8 + 64;
          const outBytes = d * 4 + 12;

          const result = await this.sandbox.runFixedCompute({
            pinnedModule: { analysisType: 'fl-logistic', sm3: pinnedSm3 },
            input: encoded.bytes,
            n: encoded.n,
            k: d,
            outOff,
            outBytes,
            requiredBytes: outOff + outBytes + 65536,
            taskId: stage.jobId,
          });
          const decoded = decodeFlLogisticOutput(result.output, d);
          this.logger.log(
            `L4 定点训练完成 n=${decoded.nSamples} d=${d} sm3=${result.moduleSm3.slice(0, 16)}…`,
          );
          return {
            featureNames,
            thetaQ: decoded.thetaQ,
            interceptQ: decoded.interceptQ,
            nSamples: decoded.nSamples,
            positives: decoded.positives,
            moduleSm3: result.moduleSm3,
          };
        },
      },
      this.logger,
    );
    // 出域环：与 L1.5 共用 `declassify.small_cell` 这个 op，按载荷语义分派（链式，互不覆盖）
    registerL4DeclassifyOperator(this.executor, this.logger);
    this.logger.log(
      `L4 算子已注册：wasm=[${this.executor.registeredWasmOps().join(', ')}] system=[${this.executor.registeredSystemOps().join(', ')}]`,
    );
  }
}
