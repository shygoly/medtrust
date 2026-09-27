import {
  createAttestationVerifier,
  MdopError,
  type AttestationPolicy,
  type AttestationVerifier,
  type SoftwareAttestationTestKit,
  type TrustedRoot,
} from "@medtrust/mdop";

/**
 * 控制面 TEE 通道的证明接缝（对照 `apps/connector/src/tee-node/providers.ts`）。
 *
 * 部署方注入 `TrustedRoot` + `AttestationPolicy` 后，校验走 mdop 的
 * `createAttestationVerifier` + `verifyAttestationForC2`。
 * **未注入一律抛错**，不静默降级、不暗中放行（D9 / D-TEE-3）。
 */
export const TEE_ATTESTATION_REGISTRY = "TEE_ATTESTATION_REGISTRY";

export interface ControlPlaneAttestationRegistry {
  /** 各链信任根；缺省或空 = 未对接证明链。 */
  roots?: readonly TrustedRoot[];
  /** 合约侧允许的链型 / 度量 / TCB 下限；缺省 = 未给出判定策略。 */
  policy?: AttestationPolicy;
  /**
   * 仅测试期可注入的软件证明通道。生产构造即抛。
   * 未注入时既有行为完全不变（软件报告仍拒）。
   */
  softwareAttestationTestKit?: SoftwareAttestationTestKit;
}

export interface ResolvedControlPlaneAttestation {
  roots: readonly TrustedRoot[];
  policy: AttestationPolicy;
  verifier: AttestationVerifier;
}

/**
 * 解析注入的信任根与策略。未注入真实实现时抛 `E_ATTESTATION_FAILED`，
 * 拒绝理由来自接缝本身（无信任根 / 无策略），不是硬编码 `return false`。
 */
export function resolveControlPlaneAttestation(
  registry?: ControlPlaneAttestationRegistry | null,
): ResolvedControlPlaneAttestation {
  if (!registry?.roots?.length) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      {},
      "未注入 TrustedRoot：无信任根，不得放行。对接 CSV/TDX/SEV-SNP 证明链后由部署方注入（D9 / D-TEE-3）",
    );
  }
  if (!registry.policy) {
    throw new MdopError(
      "E_ATTESTATION_FAILED",
      {},
      "未注入 AttestationPolicy：无允许链型/度量/TCB 下限，不得放行",
    );
  }
  return {
    roots: registry.roots,
    policy: registry.policy,
    verifier: createAttestationVerifier(registry.roots),
  };
}
