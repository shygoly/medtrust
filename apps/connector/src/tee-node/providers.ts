import {
  LocalDevKms,
  SoftwareAttestationProvider,
  createAttestationVerifier,
  type AttestationProvider,
  type KmsClient,
  type TeeKind,
  type TrustedRoot,
} from '@medtrust/mdop';
import { TeeNodeConfigError, type TeeNodeConfig } from './config';

/**
 * 两处**可插拔接缝**的装配点（任务 3.2 / 3.3、试点结论「换硬件只换两个类」）。
 *
 * 这个文件是「换链/换 KMS 时唯一要改的地方」的落点：
 *  - `createAttestationProvider`：软件替身（开发用）或真实证明代理（对接 CSV / TDX / SEV-SNP 证明链）；
 *  - `createKmsClient`：本机演练 KMS 或真实 KMS 客户端（持有方自建 / 与运营方共管）。
 *
 * **未实现的实现一律抛错**，不给「默默降级成软件实现」的机会：宁可起不来，也不要假证明。
 */

/** 真实证明代理的接缝：实现方需对接厂商证明服务并产出统一证明形态。 */
export interface HardwareAttestationProviderFactory {
  (config: TeeNodeConfig): AttestationProvider;
}

/** 真实 KMS 客户端的接缝。 */
export interface RemoteKmsClientFactory {
  (config: TeeNodeConfig): KmsClient;
}

/** 由部署方注入的真实实现（未注入 = 未对接，调用即报错）。 */
export interface TeeNodeProviderRegistry {
  hardwareAttestation?: HardwareAttestationProviderFactory;
  remoteKms?: RemoteKmsClientFactory;
  /** 本机演练 KMS 的密钥表与签名密钥（仅开发）。 */
  devKms?: { privateKey: string; keys: Map<string, Uint8Array>; roots: TrustedRoot[] };
}

export function createAttestationProvider(
  config: TeeNodeConfig,
  registry: TeeNodeProviderRegistry = {},
): AttestationProvider {
  if (config.attestationProvider === 'software') {
    // 开发替身：恒定 `level=software` / `isolation=none`，**永远过不了 C2 判定**（这是设计意图）
    return new SoftwareAttestationProvider({ measurement: `sm3:${'0'.repeat(64)}` });
  }
  const factory = registry.hardwareAttestation;
  if (!factory)
    throw new TeeNodeConfigError(
      '未接入真实证明代理：对接厂商证明链（CSV/TDX/SEV-SNP）后由部署方注入实现（D-TEE-3）',
    );
  return factory(config);
}

export function createKmsClient(
  config: TeeNodeConfig,
  registry: TeeNodeProviderRegistry = {},
): KmsClient {
  if (config.kmsMode === 'remote') {
    const factory = registry.remoteKms;
    if (!factory)
      throw new TeeNodeConfigError(
        '未接入真实 KMS 客户端：KMS 由数据持有方自建或与运营方共管（D-TEE-1），需部署方注入实现',
      );
    return factory(config);
  }
  const dev = registry.devKms;
  if (!dev)
    throw new TeeNodeConfigError('本机演练 KMS 未装配（缺 devKms：演练密钥表与信任根）');
  return new LocalDevKms({
    kmsRef: config.kmsRef,
    privateKey: dev.privateKey,
    verifier: createAttestationVerifier(dev.roots),
    keys: dev.keys,
  });
}

/**
 * 能力通告（任务 3.1 / §5.2：编译器据此决定能不能把阶段放在该节点）。
 *
 * 硬规则：**没有真实证明能力就不许写 `tee`**。判定不看配置里写了什么，而是**真跑一次证明**：
 * 报告不是 `level=hardware` / `isolation=hardware-enclave`（含软件提供者、半吊子声明）→ `tee: null`；
 * 是硬件级 → `kind` 与 `min_tcb` **取自这份报告**（不是拍的配置值）。这样「配置写着 tdx」也骗不过编译器。
 */
export async function nodeCapabilityAdvertisement(input: {
  provider: AttestationProvider;
  runtime: string[];
  systemOps: string[];
  whitelistDigests: string[];
  protocols?: Array<{ name: string; version: string }>;
}): Promise<{
  runtime: string[];
  system_ops: string[];
  whitelist_digests: string[];
  tee: { kind: TeeKind; min_tcb: string } | null;
  protocols: Array<{ name: string; version: string }>;
}> {
  const report = await input.provider.prove();
  let tee: { kind: TeeKind; min_tcb: string } | null = null;
  if (report.level === 'hardware' && report.isolation === 'hardware-enclave' && report.kind && report.tcb)
    tee = { kind: report.kind, min_tcb: report.tcb };
  return {
    runtime: [...input.runtime],
    system_ops: [...input.systemOps],
    whitelist_digests: [...input.whitelistDigests],
    tee,
    protocols: input.protocols ? [...input.protocols] : [],
  };
}
