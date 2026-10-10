import {
  DEFAULT_MIN_CELL,
  buildOutputPolicy,
} from "@medtrust/database";
import type {
  EgressPolicyProvider,
  EgressPolicyTemplate,
  MeteringInput,
  MeteringMeasurement,
  MeteringProvider,
  OperatorDeclaration,
  OperatorPack,
  SpiContext,
} from "@medtrust/space-kernel-spi";

/**
 * 把**既有医疗实现**挂到六根 SPI 上（P1.2）。
 *
 * 方向恒为 包 → SPI → 基座：这里是「应用侧装配」，所以由 apps/api 反向把既有实现的
 * 窄接口喂给医疗包（医疗包 MUST NOT 依赖任何实现包）。
 * 每个适配器都只做**委托**，不复制逻辑——单一事实源仍在既有模块里。
 */

/** S3 出域策略 ← 既有合约 outputPolicy 默认（D-DC-2，单一事实源）。 */
export function egressFromOutputPolicy(): EgressPolicyProvider {
  const policy = buildOutputPolicy("aggregate_and_model", {
    minCell: DEFAULT_MIN_CELL,
  });
  return {
    resolve(_ctx: SpiContext): EgressPolicyTemplate {
      return {
        templateId: "med-default",
        minimumCount: policy.minCell,
        allowedArtifacts: [...policy.allowedArtifacts],
        rules: [
          {
            id: "min-count",
            kind: "minimum-count",
            params: { minimumCount: policy.minCell },
          },
        ],
      };
    },
  };
}

/** 算法模块注册表的最小窄接口（只取声明所需的字段）。 */
export interface OperatorManifestSource {
  list(): Array<{
    analysisType: string;
    sm3: string;
    abiVersion: number;
    operator?: {
      id: string;
      version: string;
      category: string;
      environments: string[];
      inputs: Array<{ name: string; schema: string; accept_labels: string[] }>;
      outputs: Array<{ name: string; schema: string; label_rule: string }>;
    };
  }>;
}

/**
 * S2 算子 ← 既有算法模块注册表。
 * 摘要 MUST 来自复现构建（D-CN-5）——这里只搬运，不生成 digest。
 */
export function operatorsFromRegistry(source: OperatorManifestSource): OperatorPack {
  return {
    packId: "med",
    declareOperators(_ctx: SpiContext): readonly OperatorDeclaration[] {
      return source.list().map((m) => ({
        id: m.operator?.id ?? m.analysisType,
        version: m.operator?.version ?? String(m.abiVersion),
        kind: "wasm" as const,
        category: m.operator?.category ?? "local",
        digest: m.sm3,
        environments: m.operator?.environments ?? ["connector-local"],
        inputs: (m.operator?.inputs ?? []).map((p) => ({
          name: p.name,
          schema: p.schema,
          acceptLabels: p.accept_labels,
        })),
        outputs: (m.operator?.outputs ?? []).map((p) => ({
          name: p.name,
          schema: p.schema,
          acceptLabels: [],
          labelRule: p.label_rule,
        })),
      }));
    },
  };
}

/**
 * S4 计量 ← 既有 MeteringService。
 * 无算法口径时由它自己走开放兜底并**如实标注 proxy**（D-SPD-7）——
 * 适配器 MUST NOT 改写 mode，否则就是替闭源插件撒谎。
 */
export function meteringFromService(service: {
  measure(
    input: MeteringInput,
    spaceId?: string,
  ): MeteringMeasurement | Promise<MeteringMeasurement>;
}): MeteringProvider {
  return {
    measure(ctx: SpiContext, input: MeteringInput) {
      return service.measure(input, ctx.spaceId);
    },
  };
}
