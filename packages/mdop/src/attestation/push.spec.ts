import { generateSm2KeyPair, publicKeyKid } from "../crypto/sm2";
import {
  signEndorsementPush,
  verifyEndorsementPush,
  type AttestationEndorsement,
} from "./push";

/**
 * 作业之前的证明背书（D-TEE-6）：校验方签名、平台验签的共享判据。
 *
 * 要钉住的性质：签名覆盖 `{verifier, endorsement}` 整体（换节点/换度量/换有效期/换校验方都要重签）；
 * 软件实现不得作为 C2 目标；过期与未来时刻一律拒；公钥只能来自部署配置。
 */

const NOW = new Date("2026-09-25T10:00:00.000Z");
const NODE = "urn:tds:sh-med:participant:tee-1";
const MEAS = "sm3:" + "a".repeat(64);
const QUOTE = "sm3:" + "b".repeat(64);
const KMS = generateSm2KeyPair();
const OTHER = generateSm2KeyPair();

function endorsement(over: Partial<AttestationEndorsement> = {}): AttestationEndorsement {
  return {
    node: NODE,
    kind: "tdx",
    measurement: MEAS,
    tcb: "3.1.2",
    quoteDigest: QUOTE,
    verifiedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    note: "probe-1",
    ...over,
  };
}

function push(over: Partial<AttestationEndorsement> = {}, verifier = "kms-1") {
  return signEndorsementPush({
    verifier,
    endorsement: endorsement(over),
    privateKey: KMS.privateKey,
    publicKey: KMS.publicKey,
  });
}

function verify(over: { push?: unknown; publicKey?: string; verifiers?: readonly string[] } = {}) {
  return verifyEndorsementPush({
    push: over.push ?? push(),
    verifierPublicKey: over.publicKey ?? KMS.publicKey,
    trustedVerifiers: over.verifiers ?? ["kms-1"],
    now: NOW,
  });
}

describe("作业之前的证明背书（D-TEE-6）", () => {
  it("校验方签名 → 平台验签通过，并给出「是谁背的」", () => {
    const verified = verify();
    expect(verified.verifier).toBe("kms-1");
    expect(verified.endorsement.node).toBe(NODE);
    expect(verified.endorsement.measurement).toBe(MEAS);
    expect(verified.endorsement.expiresAt).toBe(endorsement().expiresAt);
  });

  it("改任何一个被签字段都要重签：换节点 / 换度量 / 换有效期 / 换校验方", () => {
    const good = push();
    const cases: unknown[] = [
      { ...good, endorsement: { ...good.endorsement, node: "urn:tds:sh-med:participant:tee-9" } },
      { ...good, endorsement: { ...good.endorsement, measurement: "sm3:" + "c".repeat(64) } },
      {
        ...good,
        endorsement: { ...good.endorsement, expiresAt: new Date(NOW.getTime() + 7200_000).toISOString() },
      },
      { ...good, verifier: "kms-2" },
    ];
    for (const tampered of cases) {
      expect(() => verify({ push: tampered })).toThrow(
        expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
      );
    }
  });

  it("公钥不是部署配置那把（或被换过）→ 拒；白名单外的校验方 → 拒", () => {
    expect(() => verify({ publicKey: OTHER.publicKey })).toThrow(
      expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
    );
    const foreign = signEndorsementPush({
      verifier: "kms-1",
      endorsement: endorsement(),
      privateKey: OTHER.privateKey,
      publicKey: OTHER.publicKey,
    });
    expect(() => verify({ push: foreign })).toThrow(
      expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
    );
    expect(() => verify({ verifiers: ["kms-9"] })).toThrow(
      expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
    );
    // 签名指纹与部署公钥不符（换了节点侧公钥却复用同一个 kid 的情形）
    const swapped = { ...push(), signature: { ...push().signature, kid: publicKeyKid(OTHER.publicKey) } };
    expect(() => verify({ push: swapped })).toThrow(
      expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
    );
  });

  it("软件实现不得作为 C2 目标（schema 层就拒）", () => {
    const software = signEndorsementPush({
      verifier: "kms-1",
      endorsement: { ...endorsement(), kind: "software" as never },
      privateKey: KMS.privateKey,
      publicKey: KMS.publicKey,
    });
    expect(() => verify({ push: software })).toThrow();
  });

  it("过期 / 未来时刻 / 有效期早于校验时刻 / 未定义字段 → 拒", () => {
    expect(() =>
      verify({
        push: push({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() }),
      }),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    expect(() =>
      verify({
        push: push({
          verifiedAt: new Date(NOW.getTime() + 600_000).toISOString(),
          expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
        }),
      }),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    expect(() =>
      verify({
        push: push({
          verifiedAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
          expiresAt: new Date(NOW.getTime() + 1_800_000).toISOString(),
        }),
      }),
    ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    const extra = push();
    expect(() => verify({ push: { ...extra, extra: 1 } })).toThrow();
    expect(() =>
      verify({ push: { ...extra, endorsement: { ...extra.endorsement, extra: 1 } } }),
    ).toThrow();
  });
});
