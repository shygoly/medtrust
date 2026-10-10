import { currentConnectorSpaceId } from "../space/space-context";
import { DEFAULT_NODE_KEY_FILE } from './identity';

/**
 * 可信空间节点的运行配置与**两道闸门**（任务 3.1–3.3）。
 *
 * 闸门 ① **软件实现不得作为 C2 上线**：`software` 证明提供者 / `local-dev` KMS 只允许在
 * 显式开启 `TEE_NODE_ALLOW_DEV_PROVIDERS=true` **且非生产环境**时使用；生产环境用它们直接拒绝启动。
 * 这不是「可能出问题」的告警，而是配置期的硬失败——把「先用软件顶上」挡在部署之前。
 *
 * 闸门 ② **不得虚标 TEE 能力**：只有真实证明提供者接上时才允许在能力通告里写 `tee{kind,min_tcb}`，
 * 且 `min_tcb` 必须来自配置（真实能力），缺了就报错而不是给个默认值（见 `capability.ts`）。
 */

export type AttestationProviderKind = 'software' | 'hardware';
export type KmsMode = 'local-dev' | 'remote';

export interface TeeNodeConfig {
  participantId: string;
  spaceId: string;
  urn: string;
  keyFile: string;
  attestationProvider: AttestationProviderKind;
  kmsMode: KmsMode;
  kmsRef: string;
  /** KMS 公钥（部署配置；用于核对释放凭据，MUST NOT 取自消息）。 */
  kmsPublicKey: string;
  /** 显式允许开发用替身（软件证明 / 本机演练 KMS）。 */
  allowDevProviders: boolean;
  controlPlaneUrl: string;
}

export class TeeNodeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeeNodeConfigError';
  }
}

/**
 * 读配置。**逐个键用 `process.env.<KEY>` 直读**（不做 `process.env[name]` 间接）：
 * 本仓的部署登记表（DEPLOY.md §2）与代码读取点靠这一形式做双向对拍——
 * 间接读会让「登记了但没人读」和「读了但没登记」都查不出来（`connector-key.ts` 同一约定）。
 */
export function loadTeeNodeConfig(): TeeNodeConfig {
  const participantId = (process.env.TEE_NODE_PARTICIPANT_ID ?? '').trim();
  if (!participantId) throw new TeeNodeConfigError('缺少必填配置 TEE_NODE_PARTICIPANT_ID');
  const spaceId = currentConnectorSpaceId();
  const provider = ((process.env.TEE_NODE_ATTESTATION_PROVIDER ?? 'software').trim() ||
    'software') as AttestationProviderKind;
  const kmsMode = ((process.env.TEE_NODE_KMS_MODE ?? 'local-dev').trim() ||
    'local-dev') as KmsMode;
  const allowDevProviders =
    (process.env.TEE_NODE_ALLOW_DEV_PROVIDERS ?? 'false').trim().toLowerCase() === 'true';
  const production = (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';

  if (provider !== 'software' && provider !== 'hardware')
    throw new TeeNodeConfigError(`未知的证明提供者：${provider}`);
  if (kmsMode !== 'local-dev' && kmsMode !== 'remote')
    throw new TeeNodeConfigError(`未知的 KMS 模式：${kmsMode}`);

  const usesDevProvider = provider === 'software' || kmsMode === 'local-dev';
  if (usesDevProvider && !allowDevProviders)
    throw new TeeNodeConfigError(
      '软件证明提供者 / 本机演练 KMS 属于**开发替身**：需显式设置 TEE_NODE_ALLOW_DEV_PROVIDERS=true ' +
        '才允许（且不得用于真实数据）。真实部署请接厂商证明链与持有方自建/共管 KMS（D-TEE-1/D-TEE-3）',
    );
  if (usesDevProvider && production)
    throw new TeeNodeConfigError(
      '生产环境不得使用软件证明提供者或本机演练 KMS：软件隔离不是 TEE，' +
        'C2 的密钥释放判据在其上不成立（D9 / CTL-09）',
    );

  const kmsPublicKey = (process.env.TEE_NODE_KMS_PUBKEY ?? '').trim();
  if (!kmsPublicKey)
    throw new TeeNodeConfigError(
      '缺少 TEE_NODE_KMS_PUBKEY：核对 KMS 释放凭据需要**部署配置**里的公钥（不得取自消息）',
    );

  return {
    participantId,
    spaceId,
    urn: `urn:tds:${spaceId}:participant:${participantId}`,
    keyFile: (process.env.TEE_NODE_KEY_FILE ?? DEFAULT_NODE_KEY_FILE).trim(),
    attestationProvider: provider,
    kmsMode,
    kmsRef: (process.env.TEE_NODE_KMS_REF ?? 'kms://local-dev').trim() || 'kms://local-dev',
    kmsPublicKey,
    allowDevProviders,
    controlPlaneUrl: (process.env.CONTROL_PLANE_URL ?? 'http://localhost:5021/api/v1').replace(
      /\/$/,
      '',
    ),
  };
}
