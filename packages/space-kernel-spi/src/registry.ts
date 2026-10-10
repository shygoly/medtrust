// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type {
  AssuranceProfile,
  DataSourceAdapter,
  EgressPolicyProvider,
  MeteringProvider,
  OperatorPack,
  SpiContext,
  TerminologyDeidentifier,
} from "./seams";
import type { PackManifest } from "./manifest";

/** 一个空间装载的全部 SPI 实现。 */
export interface SpiBundle {
  readonly packId: string;
  readonly dataSource?: DataSourceAdapter;
  readonly operators?: OperatorPack;
  readonly egress?: EgressPolicyProvider;
  readonly metering?: MeteringProvider;
  readonly assurance?: AssuranceProfile;
  readonly terminology?: TerminologyDeidentifier;
}

/**
 * 按空间解析 SPI 实现的注册表（P1 参考实现，零依赖）。
 *
 * 内核 MUST 按空间解析，MUST NOT 用进程级单例替代（D-SPD-10 / D-SPD-2）。
 * 同一空间同缝多实现时，后注册者生效（后装配覆盖先装配）。
 */
/**
 * 包注册面（由基座实现，包只依赖此接口，不依赖基座实现）——
 * 保证依赖方向恒为 包 → SPI → 基座（KERNEL.md §1 / D-SPD-1）。
 */
export interface PackRegistrar {
  /** 全局注册：受**部署白名单**约束，不在白名单内即拒绝。 */
  register(manifest: PackManifest, bundle: SpiBundle): void;
  /** 空间运行期启用：只影响该空间，不改变其他空间的启用集（D-SPD-10）。 */
  enable(ctx: SpiContext, packId: string): void;
}

export class InMemorySpiRegistry {
  private readonly bySpace = new Map<string, SpiBundle[]>();

  register(ctx: SpiContext, bundle: SpiBundle): void {
    const list = this.bySpace.get(ctx.spaceId) ?? [];
    list.push(bundle);
    this.bySpace.set(ctx.spaceId, list);
  }

  list(ctx: SpiContext): readonly SpiBundle[] {
    return this.bySpace.get(ctx.spaceId) ?? [];
  }

  resolve(ctx: SpiContext): SpiBundle | undefined {
    const list = this.list(ctx);
    return list.length ? list[list.length - 1] : undefined;
  }
}
