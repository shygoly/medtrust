import { publicKeyFromPrivateKey } from '@medtrust/mdop';

export interface ConnectorSpaceConfig {
  readonly spaceId: string;
  /** 本连接器在该空间下的参与方标识（URN 用）。 */
  readonly participantId: string;
  /**
   * 该空间下本连接器的 SM2 私钥（64 hex）。
   * **MUST NOT 与其它空间复用**——同一把密钥在两个空间签名 = 身份边界被打通（D-SPD-2）。
   */
  readonly privateKey: string;
}

export class ConnectorKeyReuseError extends Error {
  constructor(from: string, to: string) {
    super(
      `连接器密钥跨空间复用被拒：${from} → ${to}——同一把私钥不得在两个空间签名（D-SPD-2）`,
    );
    this.name = 'ConnectorKeyReuseError';
  }
}

/**
 * 连接器的**多空间装配表**（P10.1 / P10.2）。
 *
 * 一台院内连接器同时服务多个空间：每个空间一套参与方标识与**独立密钥**。
 * 注册时强制校验密钥不复用（fail-closed），并在解析时给出该空间的 URN / 公钥。
 */
export class ConnectorSpaceRegistry {
  private readonly bySpace = new Map<string, ConnectorSpaceConfig>();

  register(config: ConnectorSpaceConfig): void {
    const spaceId = config.spaceId?.trim();
    if (!spaceId) throw new Error('CONNECTOR_SPACE_ID_MISSING');
    const privateKey = (config.privateKey ?? '').trim().toLowerCase();
    if (privateKey) {
      for (const [existingSpace, existing] of this.bySpace) {
        if (existing.privateKey && existing.privateKey === privateKey) {
          throw new ConnectorKeyReuseError(existingSpace, spaceId);
        }
      }
    }
    this.bySpace.set(spaceId, {
      spaceId,
      participantId: config.participantId,
      privateKey,
    });
  }

  has(spaceId: string): boolean {
    return this.bySpace.has(spaceId);
  }

  spaceIds(): readonly string[] {
    return [...this.bySpace.keys()].sort();
  }

  get(spaceId: string): ConnectorSpaceConfig {
    const found = this.bySpace.get(spaceId);
    if (!found) throw new Error(`CONNECTOR_SPACE_NOT_JOINED:${spaceId}`);
    return found;
  }

  /** 该空间下平台节点的 URN。 */
  platformUrn(spaceId: string): string {
    return `urn:tds:${spaceId}:participant:platform`;
  }

  /** 该空间下**本连接器**的 URN。 */
  selfUrn(spaceId: string): string {
    return `urn:tds:${spaceId}:participant:${this.get(spaceId).participantId}`;
  }

  /** 该空间的连接器公钥（注册时提交的那一份）。 */
  publicKey(spaceId: string): string {
    return publicKeyFromPrivateKey(this.get(spaceId).privateKey);
  }
}
