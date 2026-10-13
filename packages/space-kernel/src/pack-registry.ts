// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import type {
  PackManifest,
  PackRegistrar,
  SpiBundle,
  SpiContext,
} from "@medtrust/space-kernel-spi";

export interface PackRegistration {
  readonly manifest: PackManifest;
  readonly bundle: SpiBundle;
}

/**
 * 能力包注册表 —— 基座 T0 机制（KERNEL.md §2 ⑨ / D-SPD-10）。
 *
 * 两个彼此独立的开关，MUST NOT 混用：
 *   - **部署白名单**（构造期固定）：本部署被授权运行哪些包；
 *   - **空间运行期启用集**（运行期可变）：某个空间实际启用了哪些包。
 *
 * 连接器 / 控制面按空间解析；MUST NOT 用进程级单例替代（D-SPD-2）。
 */
export class PackRegistry implements PackRegistrar {
  private readonly allowlist: ReadonlySet<string>;
  private readonly registered = new Map<string, PackRegistration>();
  private readonly enabledBySpace = new Map<string, Set<string>>();

  constructor(allowlist: readonly string[]) {
    this.allowlist = new Set(allowlist);
  }

  register(manifest: PackManifest, bundle: SpiBundle): void {
    if (!this.allowlist.has(manifest.id)) {
      throw new Error("PACK_NOT_ALLOWED:" + manifest.id);
    }
    if (bundle.packId !== manifest.id) {
      throw new Error("PACK_BUNDLE_MISMATCH:" + manifest.id);
    }
    if (!licenseIsSet(manifest.license)) {
      throw new Error("PACK_LICENSE_UNSET:" + manifest.id);
    }
    this.registered.set(manifest.id, { manifest, bundle });
  }

  enable(ctx: SpiContext, packId: string): void {
    if (!this.allowlist.has(packId)) throw new Error("PACK_NOT_ALLOWED:" + packId);
    if (!this.registered.has(packId)) throw new Error("PACK_NOT_REGISTERED:" + packId);
    const set = this.enabledBySpace.get(ctx.spaceId) ?? new Set<string>();
    set.add(packId);
    this.enabledBySpace.set(ctx.spaceId, set);
  }

  /** 本空间已启用的包（顺序稳定，便于测试与诊断）。 */
  enabled(ctx: SpiContext): readonly PackRegistration[] {
    const ids = this.enabledBySpace.get(ctx.spaceId);
    if (!ids) return [];
    const out: PackRegistration[] = [];
    for (const id of [...ids].sort()) {
      const reg = this.registered.get(id);
      if (reg) out.push(reg);
    }
    return out;
  }

  enabledIds(ctx: SpiContext): readonly string[] {
    return this.enabled(ctx).map((r) => r.manifest.id);
  }

  /** 部署白名单（只读）。 */
  allowed(): readonly string[] {
    return [...this.allowlist].sort();
  }
}

const UNSET_LICENSES = new Set(["", "tbd", "todo", "n/a", "placeholder"]);

/** 未写明的许可不能注册。TBD 与空字符串都算未定。 */
export function licenseIsSet(license: string | undefined): boolean {
  const value = (license ?? "").trim().toLowerCase();
  return value.length > 0 && !UNSET_LICENSES.has(value);
}
