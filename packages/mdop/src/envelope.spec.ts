import {
  ENVELOPE_CLOCK_SKEW_MS,
  assertNoInlineArtifact,
  participantUrn,
  signEnvelope,
  verifyEnvelope,
  type Envelope,
  type NonceStore,
  type UnsignedEnvelope,
} from "./envelope";
import { generateSm2KeyPair, publicKeyKid } from "./crypto/sm2";
import { MdopError } from "./errors";

/** 落盘式 nonce 存储的内存替身：跨「重启」（新建实例）由外部传入同一 Map。 */
class MemoryNonceStore implements NonceStore {
  constructor(private readonly rows: Map<string, number>) {}
  seen(nonce: string): boolean {
    const expiry = this.rows.get(nonce);
    if (expiry === undefined) return false;
    if (expiry < Date.now()) {
      this.rows.delete(nonce);
      return false;
    }
    return true;
  }
  remember(nonce: string, expiresAt: Date): void {
    this.rows.set(nonce, expiresAt.getTime());
  }
}

const PLATFORM = participantUrn("space-x", "platform");
const HOSP_A = participantUrn("space-x", "hospA");

function fixture(overrides: Partial<UnsignedEnvelope> = {}) {
  return {
    mdop: "0.2",
    msg_id: "01J8Z6TEST",
    msg_type: "PlanFragmentOffer" as const,
    job_id: "job-1",
    sender: PLATFORM,
    receiver: HOSP_A,
    timestamp: new Date().toISOString(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    idempotency_key: "job-1:stage-1:1",
    body: { ticket_id: "tkt-1" },
    ...overrides,
  };
}

describe("MDOP 信封（协议 §7.1）", () => {
  const platformKeys = generateSm2KeyPair();
  const otherKeys = generateSm2KeyPair();
  const rows = new Map<string, number>();
  const nonceStore = new MemoryNonceStore(rows);

  it("签名后能验过，且 kid 是公钥 SM3 全长", () => {
    const envelope = signEnvelope(fixture(), platformKeys.privateKey, {
      publicKey: platformKeys.publicKey,
    });
    expect(envelope.sig.alg).toBe("SM2-SM3");
    expect(envelope.sig.kid).toBe(publicKeyKid(platformKeys.publicKey));
    expect(envelope.sig.kid).toHaveLength(64);
    expect(
      verifyEnvelope(envelope, { self: HOSP_A, senderPublicKey: platformKeys.publicKey, nonceStore }),
    ).toBe(envelope);
  });

  it("body 被篡改 → E_AUTH_INVALID（签名绑定 JCS 后的全部内容）", () => {
    const envelope = signEnvelope(fixture(), platformKeys.privateKey, {
      publicKey: platformKeys.publicKey,
    });
    const tampered: Envelope = { ...envelope, body: { ticket_id: "tkt-evil" } };
    expect(() =>
      verifyEnvelope(tampered, {
        self: HOSP_A,
        senderPublicKey: platformKeys.publicKey,
        nonceStore,
      }),
    ).toThrow(expect.objectContaining({ code: "E_AUTH_INVALID" }));
  });

  it("nonce 重放被拒，且重启后仍有效（nonce 持久化）", () => {
    const envelope = signEnvelope(fixture({ nonce: "nonce-replay-1" }), platformKeys.privateKey, {
      publicKey: platformKeys.publicKey,
    });
    verifyEnvelope(envelope, { self: HOSP_A, senderPublicKey: platformKeys.publicKey, nonceStore });
    // 「重启」= 换一个新 store 实例，但读同一份落盘数据
    const afterRestart = new MemoryNonceStore(rows);
    expect(() =>
      verifyEnvelope(envelope, {
        self: HOSP_A,
        senderPublicKey: platformKeys.publicKey,
        nonceStore: afterRestart,
      }),
    ).toThrow(expect.objectContaining({ code: "E_REPLAY" }));
  });

  it("时间偏差超出 ±5 分钟被拒", () => {
    const envelope = signEnvelope(
      fixture({ timestamp: new Date(Date.now() - ENVELOPE_CLOCK_SKEW_MS - 1000).toISOString() }),
      platformKeys.privateKey,
      { publicKey: platformKeys.publicKey },
    );
    expect(() =>
      verifyEnvelope(envelope, {
        self: HOSP_A,
        senderPublicKey: platformKeys.publicKey,
        nonceStore,
      }),
    ).toThrow(expect.objectContaining({ code: "E_AUTH_INVALID" }));
  });

  it("收件人不是自己 → 拒收", () => {
    const envelope = signEnvelope(fixture({ receiver: participantUrn("space-x", "hospB") }), platformKeys.privateKey, {
      publicKey: platformKeys.publicKey,
    });
    expect(() =>
      verifyEnvelope(envelope, {
        self: HOSP_A,
        senderPublicKey: platformKeys.publicKey,
        nonceStore,
      }),
    ).toThrow(expect.objectContaining({ code: "E_AUTH_INVALID" }));
  });

  it("用别的公钥验不过（kid 不符即拒）", () => {
    const envelope = signEnvelope(fixture(), platformKeys.privateKey, {
      publicKey: platformKeys.publicKey,
    });
    expect(() =>
      verifyEnvelope(envelope, {
        self: HOSP_A,
        senderPublicKey: otherKeys.publicKey,
        nonceStore,
      }),
    ).toThrow(MdopError);
  });

  it("旧格式算法标识的线上消息一律拒（防降级）", () => {
    const envelope = signEnvelope(fixture(), platformKeys.privateKey, {
      publicKey: platformKeys.publicKey,
    });
    const legacy: Envelope = { ...envelope, sig: { ...envelope.sig, alg: "SM2-legacy-raw" } };
    expect(() =>
      verifyEnvelope(legacy, {
        self: HOSP_A,
        senderPublicKey: platformKeys.publicKey,
        nonceStore,
      }),
    ).toThrow(expect.objectContaining({ code: "E_AUTH_INVALID" }));
  });

  it("未知信封字段被拒绝（不按缺省补全）", () => {
    const envelope = { ...fixture(), extra: 1 } as unknown as Envelope;
    expect(() =>
      verifyEnvelope(envelope, {
        self: HOSP_A,
        senderPublicKey: platformKeys.publicKey,
        nonceStore,
      }),
    ).toThrow();
  });

  it("控制面消息夹带制品内容即拒", () => {
    expect(() => assertNoInlineArtifact({ ok: 1 })).not.toThrow();
    expect(() => assertNoInlineArtifact({ payload: "base64..." })).toThrow(
      expect.objectContaining({ code: "E_AUTH_INVALID" }),
    );
    expect(() => assertNoInlineArtifact({ nested: { rows: [1, 2, 3] } })).toThrow(MdopError);
  });
});
