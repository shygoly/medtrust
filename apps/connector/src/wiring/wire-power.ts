/**
 * 电力算子接线（批次 6）：把电力包的节点算子接到 MdopStageExecutor。
 *
 * 对齐 L15 / L4 wiring：组装根注入执行器与依赖，行业包 `registerPowerOperators` 只做纯接线。
 * - 数据：`series-file` 产品经 `DataProductLocalSource.readSeriesFile` 读（路径守卫 + 审计 + 快照），
 *   不进 LocalStore（D-CN-8）；
 * - 计算：三个分析算子走**已登记 wasm 模块 + 零能力沙箱**（`runFixedCompute`），未接入即 fail-closed；
 * - 假名：HMAC-SM3，密钥只在连接器环境（`CONNECTOR_POWER_PSEUDONYM_KEY`），同一联盟的节点配同一把，
 *   跨区域可关联、平台无从反查。缺密钥时电力降密环拒绝出域（启动不受影响）。
 */
import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import {
  POWER_NODE_OPERATOR_REFS,
  registerPowerOperators,
  type PowerOperatorDeps,
} from "@medtrust/domain-power";

import { DataProductLocalSource } from "../domain/data-product-local-source";
import { AlgorithmSandboxExecutor } from "../domain/sandbox/algorithm-sandbox-executor";
import { ConnectorModuleClient } from "../domain/sandbox/module-client";
import { MdopStageExecutor } from "../mdop/mdop-executor";
import { hmacSm3Hex } from "../domain/sm3";

const PSEUDONYM_KEY_ENV = "CONNECTOR_POWER_PSEUDONYM_KEY";
const MIN_KEY_LENGTH = 32;

// 键控假名的 HMAC-SM3 实现住在 `domain/sm3.ts`——连接器平面唯一的 sm-crypto 直引入口
// （scripts/check-crypto-imports.mjs 白名单）。此处只再导出，保持既有调用面不变。
export { hmacSm3Hex };

export function powerPseudonymKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[PSEUDONYM_KEY_ENV] ?? "";
  if (key.length < MIN_KEY_LENGTH) {
    throw new Error(
      `${PSEUDONYM_KEY_ENV} 未配置或短于 ${MIN_KEY_LENGTH} 字符：电力降密环不能生成键控假名（拒绝出域）`,
    );
  }
  return key;
}

@Injectable()
export class PowerOperatorWiring implements OnModuleInit {
  private readonly logger = new Logger(PowerOperatorWiring.name);

  constructor(
    private readonly executor: MdopStageExecutor,
    @Optional() private readonly source?: DataProductLocalSource,
    @Optional() private readonly sandbox?: AlgorithmSandboxExecutor,
    @Optional() private readonly modules?: ConnectorModuleClient,
  ) {}

  /** 暴露给测试 / 演示：组装好的依赖（与 onModuleInit 注册的同一份）。 */
  deps(): PowerOperatorDeps {
    return {
      readSeries: async (dataProductId) => {
        if (!this.source) return null;
        const declaration = await this.source.declarationFor(dataProductId);
        if (declaration?.type !== "series-file") return null;
        const read = await this.source.readSeriesFile(dataProductId, "mdop-power-source");
        this.logger.log(`MDOP 时序数据源 product=${dataProductId} schema=${read.schema}`);
        return { schema: read.schema, text: read.text, snapshot: read.snapshot };
      },
      runModule: async (run) => {
        if (!this.sandbox || !this.modules)
          throw new Error("本节点未接入 wasm 沙箱执行器（电力分析算子需要它，fail-closed）");
        const result = await this.sandbox.runFixedCompute({
          pinnedModule: { analysisType: run.analysisType, sm3: run.sm3 },
          input: run.input,
          n: run.m,
          k: run.k,
          outOff: run.outOff,
          outBytes: run.outBytes,
          requiredBytes: run.requiredBytes,
          taskId: run.taskId,
        });
        return { output: result.output, moduleSm3: result.moduleSm3 };
      },
      pseudonymize: (value, scope) =>
        `ps_${hmacSm3Hex(powerPseudonymKey(), `${scope}\n${value}`).slice(0, 32)}`,
    };
  }

  onModuleInit(): void {
    registerPowerOperators(this.executor, this.deps(), this.logger);
    this.logger.log(`电力算子已挂到执行器：wasm=[${this.wiredRefs().join(", ")}]`);
  }

  wiredRefs(): readonly string[] {
    const wasm = this.executor.registeredWasmOps();
    return POWER_NODE_OPERATOR_REFS.filter((ref) => wasm.some((p) => ref.startsWith(p)));
  }

  isWired(ref: string): boolean {
    return this.wiredRefs().includes(ref as (typeof POWER_NODE_OPERATOR_REFS)[number]);
  }
}
