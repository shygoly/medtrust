// third-party-module-admission 闸 5 —— 模块吊销（撤签名 / 撤合约固定 / 吊销名单）。
//
// 三条路各自独立生效，叠加使用:
//   1. 吊销名单(本文件):平台把 SM3 打进名单,连接器长轮询随任务批次拿到;
//   2. 撤合约固定:医院把合约里的 pinnedModules 改掉 → SM3 不符当场拒(CTL-20 已有);
//   3. 撤签名:平台不再对该 SM3 出签名 → 新连接器拉不到可验证的模块。
//
// PEP 在**执行前**检查 1，吊销即拒、**不回退到内置实现**(usage-control 增量)。

export type RevocationReason =
  | "security-incident"
  | "failed-shadow"
  | "reproducibility-lost"
  | "vendor-withdrawn"
  | "superseded"
  | "other";

export interface ModuleRevocation {
  /** 被吊销模块的 SM3（小写 64 hex）。 */
  sm3: string;
  reason: RevocationReason;
  /** 吊销时间（ISO）。 */
  revokedAt: string;
  /** 吊销发起方（平台审查者 / 医院 DPO）。 */
  revokedBy: string;
  detail?: string;
}

/** 随任务批次下发给连接器的吊销名单。 */
export interface RevocationList {
  /** 名单版本（单调递增，连接器据此判断是否更新）。 */
  version: number;
  issuedAt: string;
  revoked: ModuleRevocation[];
}

export const EMPTY_REVOCATION_LIST: RevocationList = {
  version: 0,
  issuedAt: new Date(0).toISOString(),
  revoked: [],
};

export class ModuleRevokedError extends Error {
  constructor(
    readonly sm3: string,
    readonly revocation: ModuleRevocation,
  ) {
    super(
      `模块已吊销，拒绝执行且不回退到内置实现：sm3=${sm3} ` +
        `reason=${revocation.reason} at=${revocation.revokedAt} by=${revocation.revokedBy}` +
        (revocation.detail ? ` detail=${revocation.detail}` : ""),
    );
    this.name = "ModuleRevokedError";
  }
}

/** 查名单。命中返回吊销记录，未命中返回 undefined。 */
export function findRevocation(
  list: RevocationList | undefined,
  sm3: string,
): ModuleRevocation | undefined {
  if (!list) return undefined;
  const key = (sm3 ?? "").toLowerCase();
  return list.revoked.find((r) => r.sm3.toLowerCase() === key);
}

/**
 * 执行前吊销检查（PEP 调用）。命中即抛 ModuleRevokedError。
 *
 * 注意「名单缺失」不等于「未吊销」:连接器从未拿到过名单(version < 0 视为未知)
 * 时,调用方应按部署策略决定 —— 本函数只负责「拿到的名单说什么」。
 */
export function assertNotRevoked(
  list: RevocationList | undefined,
  sm3: string,
): void {
  const hit = findRevocation(list, sm3);
  if (hit) throw new ModuleRevokedError(sm3.toLowerCase(), hit);
}

/** 合并新下发的名单：版本更高才接受（防回放旧名单把吊销「撤销」掉）。 */
export function mergeRevocationList(
  current: RevocationList,
  incoming: RevocationList,
): RevocationList {
  return incoming.version > current.version ? incoming : current;
}
