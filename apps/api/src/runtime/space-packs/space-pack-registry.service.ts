import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { PackRegistry } from "@medtrust/space-kernel";
import type { SpiContext } from "@medtrust/space-kernel-spi";
import { createMedPackBundle, medPackManifest } from "@medtrust/domain-med";
import { AlgorithmModuleRegistry } from "../connector-modules/algorithm-module.registry";
import { MeteringService } from "../space-context/metering.service";
import {
  egressFromOutputPolicy,
  meteringFromService,
  operatorsFromRegistry,
} from "./spi-bindings";

export const MED_PACK_ID = "med";
export const DEFAULT_ALLOWED_PACKS: readonly string[] = [MED_PACK_ID];

/**
 * 部署白名单解析（P1.3 / D-SPD-10）。
 * 环境变量只决定**本部署被授权运行哪些包**，MUST NOT 决定单个空间的启用集。
 */
export function parseAllowedPacks(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : [...DEFAULT_ALLOWED_PACKS];
}

/**
 * 能力包装配与按空间启用（P1.2 / P1.3 / D-SPD-10）。
 *
 * 两个彼此独立的开关：
 *   - 部署白名单（SPACE_PACKS，构造期固定）；
 *   - 空间运行期启用集（enableForSpace，逐空间声明）。
 */
@Injectable()
export class SpacePackRegistryService implements OnModuleInit {
  private readonly logger = new Logger(SpacePackRegistryService.name);
  readonly registry: PackRegistry;

  constructor(
    private readonly metering: MeteringService,
    @Optional() private readonly algorithms?: AlgorithmModuleRegistry,
  ) {
    this.registry = new PackRegistry(parseAllowedPacks(process.env.SPACE_PACKS));
  }

  /** 启动时把医疗包挂到既有实现上（仅当它在部署白名单内）。 */
  onModuleInit(): void {
    if (!this.registry.allowed().includes(MED_PACK_ID)) {
      this.logger.log(
        "医疗包不在部署白名单内，不装载（allowed=" + this.registry.allowed().join(",") + "）",
      );
      return;
    }
    this.registry.register(
      medPackManifest,
      createMedPackBundle({
        egress: egressFromOutputPolicy(),
        metering: meteringFromService(this.metering),
        ...(this.algorithms
          ? { operators: operatorsFromRegistry(this.algorithms) }
          : {}),
      }),
    );
    this.logger.log("医疗包已挂载：egress←合约 outputPolicy、operators←算法注册表、metering←MeteringService");
  }

  /** 空间运行期启用（幂等；未在白名单内即抛）。 */
  enableForSpace(ctx: SpiContext, packIds: readonly string[] = [MED_PACK_ID]): void {
    for (const id of packIds) this.registry.enable(ctx, id);
  }

  packsForSpace(ctx: SpiContext): readonly string[] {
    return this.registry.enabledIds(ctx);
  }

  allowedPacks(): readonly string[] {
    return this.registry.allowed();
  }
}
