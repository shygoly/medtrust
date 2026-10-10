export interface LocalEgressTemplate {
  readonly minimumCount: number;
  readonly allowedArtifacts: readonly string[];
}

/** 缺省本地基线（与既有合约 outputPolicy 缺省一致，D-DC-2）。 */
export const DEFAULT_LOCAL_EGRESS: LocalEgressTemplate = {
  minimumCount: 5,
  allowedArtifacts: ['aggregate', 'model-delta'],
};

/**
 * 按空间的**本地策略基线**（P10.3 / D-SPD-2）。
 *
 * 合约仍是闸门参数的**权威**（D-DC-2）；本表是连接器侧的本地基线：
 * 同一份院内数据「空间 A 允许出域、空间 B 不允许」时，两空间各算各的。
 * 实际放行阈值取 **本地基线与合约的较严者**（fail-closed）。
 */
export class LocalPolicyRegistry {
  private readonly bySpace = new Map<string, LocalEgressTemplate>();

  set(spaceId: string, template: LocalEgressTemplate): void {
    if (!spaceId?.trim()) throw new Error('LOCAL_POLICY_SPACE_ID_MISSING');
    this.bySpace.set(spaceId, {
      minimumCount: template.minimumCount,
      allowedArtifacts: [...template.allowedArtifacts],
    });
  }

  get(spaceId: string | undefined): LocalEgressTemplate {
    if (!spaceId) return DEFAULT_LOCAL_EGRESS;
    return this.bySpace.get(spaceId) ?? DEFAULT_LOCAL_EGRESS;
  }

  /** 生效阈值 = max(本地基线, 合约)。本地更严时以本地为准（fail-closed）。 */
  effectiveMinimumCount(spaceId: string | undefined, contractMinimum: number): number {
    return Math.max(this.get(spaceId).minimumCount, contractMinimum);
  }

  /** 该空间允许的出域制品类（与合约白名单取交集）。 */
  effectiveArtifacts(
    spaceId: string | undefined,
    contractArtifacts: readonly string[],
  ): readonly string[] {
    const local = new Set(this.get(spaceId).allowedArtifacts);
    return contractArtifacts.filter((a) => local.has(a));
  }
}
