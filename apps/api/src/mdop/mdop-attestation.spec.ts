import { MdopError } from "@medtrust/mdop";
import { generateSm2KeyPair, signEndorsementPush } from "@medtrust/mdop";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import {
  MdopAttestationService,
  type AttestationDeps,
  type AttestationWarrant,
} from "./mdop-attestation.service";

const NOW = new Date("2026-09-25T10:00:00.000Z");
const NODE = "urn:tds:sh-med:participant:tee-1";
const MEAS = "sm3:" + "a".repeat(64);
const QUOTE = "sm3:" + "b".repeat(64);
const KMS_KEYS = generateSm2KeyPair();

/** 校验方（KMS）签的**作业之前**的证明背书（D-TEE-6）。 */
function endorsementPush(
  over: Partial<{
    verifier: string;
    expiresAt: string;
    kind: string;
    node: string;
  }> = {},
) {
  return signEndorsementPush({
    verifier: over.verifier ?? "kms-1",
    endorsement: {
      node: over.node ?? NODE,
      kind: (over.kind ?? "tdx") as never,
      measurement: MEAS,
      tcb: "3.1.2",
      quoteDigest: QUOTE,
      verifiedAt: new Date(NOW.getTime() - 30_000).toISOString(),
      expiresAt:
        over.expiresAt ?? new Date(NOW.getTime() + 3_600_000).toISOString(),
    },
    privateKey: KMS_KEYS.privateKey,
    publicKey: KMS_KEYS.publicKey,
  });
}

function warrant(over: Partial<AttestationWarrant> = {}): AttestationWarrant {
  return {
    node: NODE,
    kind: "tdx",
    measurement: MEAS,
    tcb: "3.1.2",
    quoteDigest: "sm3:" + "b".repeat(64),
    verifiedBy: "kms-1",
    verifiedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
    warrantDigest: "sm3:" + "c".repeat(64),
    ...over,
  };
}

function service(deps: AttestationDeps = {}) {
  return new MdopAttestationService(mockRepo() as never, {
    trustedVerifiers: ["kms-1"],
    registryMeasurements: [MEAS, "sm3:" + "d".repeat(64)],
    verifyWarrant: () => true,
    ...deps,
  });
}

describe("可信空间节点的证明登记（任务 5.1）", () => {
  it("登记通过并被 compile 期判为可用；同时给出冻结所需的 {链型, 度量, TCB}", async () => {
    const svc = service();
    const row = await svc.register(warrant(), NOW);
    expect(row.measurement).toBe(MEAS);
    expect(row.kind).toBe("tdx");

    const usable = await svc.assertUsableForC2(
      NODE,
      { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
      NOW,
    );
    expect(usable.quoteDigest).toBe("sm3:" + "b".repeat(64));
  });

  it("校验方不在部署白名单 → 拒（防「自报我已校验」）", async () => {
    const svc = service();
    await expect(
      svc.register(warrant({ verifiedBy: "self-claimed" }), NOW),
    ).rejects.toMatchObject({
      code: "E_ATTESTATION_FAILED",
    });
  });

  it("释放凭据验签不过（或没有验签器）→ 拒", async () => {
    const bad = service({ verifyWarrant: () => false });
    await expect(bad.register(warrant(), NOW)).rejects.toMatchObject({
      code: "E_ATTESTATION_FAILED",
    });
    const none = new MdopAttestationService(mockRepo() as never, {
      trustedVerifiers: ["kms-1"],
      registryMeasurements: [MEAS],
    });
    await expect(none.register(warrant(), NOW)).rejects.toMatchObject({
      code: "E_ATTESTATION_FAILED",
    });
  });

  it("度量不在注册中心白名单 / 证明已过期 / 链型不支持 → 逐条拒", async () => {
    const svc = service();
    await expect(
      svc.register(warrant({ measurement: "sm3:" + "9".repeat(64) }), NOW),
    ).rejects.toMatchObject({ code: "E_MEASUREMENT_NOT_ALLOWED" });
    await expect(
      svc.register(
        warrant({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: "E_ATTESTATION_FAILED" });
    await expect(
      svc.register(warrant({ kind: "sgx" }), NOW),
    ).rejects.toMatchObject({
      code: "E_ATTESTATION_FAILED",
    });
  });

  it("未登记 / 已过期 → 不能作为 C2 目标（编译期即拒）", async () => {
    const svc = service();
    await expect(
      svc.assertUsableForC2(NODE, { tee: ["tdx"] }, NOW),
    ).rejects.toMatchObject({ code: "E_ATTESTATION_FAILED" });

    await svc.register(
      warrant({ expiresAt: new Date(NOW.getTime() + 1).toISOString() }),
      NOW,
    );
    await expect(
      svc.assertUsableForC2(
        NODE,
        { tee: ["tdx"] },
        new Date(NOW.getTime() + 60_000),
      ),
    ).rejects.toMatchObject({ code: "E_ATTESTATION_FAILED" });
  });

  it("链型不符 / TCB 低于按链下限 → 拒；阈值跨体系不可比也拒", async () => {
    const svc = service();
    await svc.register(warrant(), NOW);
    await expect(
      svc.assertUsableForC2(NODE, { tee: ["csv"] }, NOW),
    ).rejects.toMatchObject({ code: "E_CAPABILITY_MISMATCH" });
    await expect(
      svc.assertUsableForC2(
        NODE,
        { tee: ["tdx"], min_tcb: { tdx: "3.2.0" } },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "E_TCB_TOO_OLD" });
    // CSV 的年月阈值拿去卡 TDX 的点分数字：不可比 → fail-closed
    await expect(
      svc.assertUsableForC2(NODE, { tee: ["tdx"], min_tcb: "2026-06" }, NOW),
    ).rejects.toMatchObject({ code: "E_TCB_TOO_OLD" });
  });

  it("合约度量清单收窄后，不在交集里的节点被判不可用（注册中心是上限）", async () => {
    const svc = service();
    await svc.register(warrant(), NOW);
    await expect(
      svc.assertUsableForC2(
        NODE,
        { tee: ["tdx"], allowed_measurements: ["sm3:" + "d".repeat(64)] },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "E_MEASUREMENT_NOT_ALLOWED" });
    // 交集为空：不能退化成「不限」
    await expect(
      svc.assertUsableForC2(
        NODE,
        { tee: ["tdx"], allowed_measurements: ["sm3:" + "z".repeat(64)] },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "E_MEASUREMENT_NOT_ALLOWED" });
  });

  it("同一份证明重复登记幂等；链不可达时不写假交易号", async () => {
    const svc = service();
    const a = await svc.register(warrant(), NOW);
    const b = await svc.register(warrant(), NOW);
    expect(b.id).toBe(a.id);

    await svc.recordAnchor(a.id, "0xLOCAL:degraded", 0);
    const after = await svc.latestFor(NODE, NOW);
    expect(after?.chainTx).toBeFalsy();

    await svc.recordAnchor(a.id, "0xreal123", 7);
    expect((await svc.latestFor(NODE, NOW))?.chainBlock).toBe(7);
  });

  it("历史保留：同一节点不同 quote 各留一条，取最新", async () => {
    const svc = service();
    await svc.register(warrant({ quoteDigest: "sm3:" + "1".repeat(64) }), NOW);
    const newer = await svc.register(
      warrant({
        quoteDigest: "sm3:" + "2".repeat(64),
        verifiedAt: new Date(NOW.getTime() + 1000).toISOString(),
      }),
      NOW,
    );
    expect((await svc.latestFor(NODE, NOW))?.id).toBe(newer.id);
  });

  it("错误类型是 MdopError（400 + 错误码，而不是 500）", async () => {
    const svc = service();
    await expect(
      svc.register(warrant({ kind: "sgx" }), NOW),
    ).rejects.toBeInstanceOf(MdopError);
  });

  it("证明摘要随登记上链；链不可达时留空（不写假交易号）", async () => {
    const anchored: string[] = [];
    const withChain = new MdopAttestationService(
      mockRepo() as never,
      {
        trustedVerifiers: ["kms-1"],
        registryMeasurements: [MEAS],
        verifyWarrant: () => true,
      },
      {
        anchor: async (hash: string) => {
          anchored.push(hash);
          return {
            txHash: "0xchain-abc",
            block: 42,
            hash,
            attestationLevel: "software",
          };
        },
      } as never,
    );
    const row = await withChain.register(warrant(), NOW);
    expect(anchored[0]).toMatch(/^SM3:[0-9a-f]{64}$/);
    expect((await withChain.latestFor(NODE, NOW))?.chainTx).toBe("0xchain-abc");
    expect((await withChain.latestFor(NODE, NOW))?.chainBlock).toBe(42);
    expect(row.quoteDigest).toBe("sm3:" + "b".repeat(64));

    // 链降级为本地回执（`0xLOCAL:`）：登记照常，但**不留假交易号**
    const degraded = new MdopAttestationService(
      mockRepo() as never,
      {
        trustedVerifiers: ["kms-1"],
        registryMeasurements: [MEAS],
        verifyWarrant: () => true,
      },
      {
        anchor: async (hash: string) => ({
          txHash: "0xLOCAL:degraded",
          block: 0,
          hash,
          attestationLevel: "software",
        }),
      } as never,
    );
    await degraded.register(warrant(), NOW);
    expect((await degraded.latestFor(NODE, NOW))?.chainTx).toBeFalsy();
  });

  it("链不可达时进补偿队列：链恢复后补锚，且与登记走**同一条通道、同一段 payload**", async () => {
    const deps: AttestationDeps = {
      trustedVerifiers: ["kms-1"],
      registryMeasurements: [MEAS],
      verifyWarrant: () => true,
    };
    const calls: Array<{ hash: string; payload: Record<string, unknown> }> = [];
    let reachable = false;
    const chain = {
      anchor: async (hash: string, payload: Record<string, unknown>) => {
        calls.push({ hash, payload });
        if (!reachable) throw new Error("存证链不可达");
        return {
          txHash: "0xchain-later",
          block: 9,
          hash,
          attestationLevel: "software",
        };
      },
    };
    const svc = new MdopAttestationService(
      mockRepo() as never,
      deps,
      chain as never,
    );

    // ① 首次登记时链不可达：**登记照常生效**（未锚不影响编译期放置），但进了补偿队列
    await svc.register(warrant(), NOW);
    expect((await svc.latestFor(NODE, NOW))?.chainTx).toBeFalsy();
    expect(await svc.pendingAnchors()).toHaveLength(1);
    expect(await svc.retryPendingAnchors()).toBe(0); // 链仍不可达：补不上就继续等

    // ② 链恢复：同一节拍补齐
    reachable = true;
    expect(await svc.retryPendingAnchors()).toBe(1);
    const anchored = await svc.latestFor(NODE, NOW);
    expect(anchored?.chainTx).toBe("0xchain-later");
    expect(anchored?.chainBlock).toBe(9);
    expect(await svc.pendingAnchors()).toHaveLength(0);

    // ③ 两次锚的是**同一个摘要 + 同一段 payload**（否则链上会出现两种记录，第三方无从对齐）
    expect(calls).toHaveLength(3); // 登记一次 + 补锚两次
    expect(calls[0]?.hash).toMatch(/^SM3:[0-9a-f]{64}$/);
    expect(calls[0]?.hash).toBe(calls[2]?.hash);
    expect(calls[0]?.payload).toEqual(calls[2]?.payload);
    expect(calls[0]?.payload.source).toBe("mdop-attestation");
  });

  it("链一直降级：补锚不写假交易号，登记保持未锚等下一轮", async () => {
    const degraded = new MdopAttestationService(
      mockRepo() as never,
      {
        trustedVerifiers: ["kms-1"],
        registryMeasurements: [MEAS],
        verifyWarrant: () => true,
      },
      {
        anchor: async (hash: string) => ({
          txHash: "0xLOCAL:still-down",
          block: 0,
          hash,
          attestationLevel: "software",
        }),
      } as never,
    );
    await degraded.register(warrant(), NOW);
    expect(await degraded.retryPendingAnchors()).toBe(0);
    expect((await degraded.latestFor(NODE, NOW))?.chainTx).toBeFalsy();
    expect(await degraded.pendingAnchors()).toHaveLength(1);
  });

  it("已锚的登记不会被重复补锚（幂等：每份摘要只上一次链）", async () => {
    const hashes: string[] = [];
    const svc = new MdopAttestationService(
      mockRepo() as never,
      {
        trustedVerifiers: ["kms-1"],
        registryMeasurements: [MEAS],
        verifyWarrant: () => true,
      },
      {
        anchor: async (hash: string) => {
          hashes.push(hash);
          return {
            txHash: "0xonce",
            block: 1,
            hash,
            attestationLevel: "software",
          };
        },
      } as never,
    );
    await svc.register(warrant(), NOW);
    expect(await svc.retryPendingAnchors()).toBe(0);
    expect(hashes).toHaveLength(1);
  });

  it("未接入存证链：补偿队列可枚举但补锚返回 0（不假装锚过）", async () => {
    const svc = service();
    await svc.register(warrant(), NOW);
    expect(await svc.pendingAnchors()).toHaveLength(1);
    expect(await svc.retryPendingAnchors()).toBe(0);
  });

  describe("作业之前的证明登记：校验方推送背书（D-TEE-6）", () => {
    const withKms = (deps: AttestationDeps = {}) =>
      service({ kmsPublicKey: KMS_KEYS.publicKey, ...deps });

    it("校验方签名推送 → 平台验签并登记 → 编译期判为可用（不再卡在「先有鸡还是先有蛋」）", async () => {
      const svc = withKms();
      const row = await svc.acceptEndorsement(endorsementPush(), NOW);
      expect(row.node).toBe(NODE);
      expect(row.kind).toBe("tdx");
      expect(row.verifiedBy).toBe("kms-1");
      // 同一份背书重复推送：幂等（不产生第二行）
      const again = await svc.acceptEndorsement(endorsementPush(), NOW);
      expect(again.id).toBe(row.id);
      // 关键：**作业之前**这份登记就能让编译期通过
      const usable = await svc.assertUsableForC2(
        NODE,
        { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
        NOW,
      );
      expect(usable.quoteDigest).toBe(QUOTE);
    });

    it("未配置 KMS 公钥 → 拒（不得在无法验签时登记）", async () => {
      const svc = service();
      await expect(
        svc.acceptEndorsement(endorsementPush(), NOW),
      ).rejects.toMatchObject({
        code: "E_ATTESTATION_FAILED",
      });
    });

    it("签名不是部署配置那把 / 被篡改 → 拒", async () => {
      const svc = withKms();
      const stranger = generateSm2KeyPair();
      const forged = signEndorsementPush({
        verifier: "kms-1",
        endorsement: endorsementPush().endorsement,
        privateKey: stranger.privateKey,
        publicKey: stranger.publicKey,
      });
      await expect(svc.acceptEndorsement(forged, NOW)).rejects.toMatchObject({
        code: "E_ATTESTATION_FAILED",
      });
      const tampered = {
        ...endorsementPush(),
        endorsement: {
          ...endorsementPush().endorsement,
          measurement: "sm3:" + "f".repeat(64),
        },
      };
      await expect(svc.acceptEndorsement(tampered, NOW)).rejects.toMatchObject({
        code: "E_ATTESTATION_FAILED",
      });
    });

    it("校验方不在部署白名单 / 背书已过期 → 拒", async () => {
      const svc = withKms({ trustedVerifiers: ["kms-9"] });
      await expect(
        svc.acceptEndorsement(endorsementPush(), NOW),
      ).rejects.toMatchObject({
        code: "E_ATTESTATION_FAILED",
      });
      const expired = withKms();
      await expect(
        expired.acceptEndorsement(
          endorsementPush({
            expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
          }),
          NOW,
        ),
      ).rejects.toMatchObject({ code: "E_ATTESTATION_FAILED" });
    });

    it("软件实现不得作为 C2 目标（schema 层就拒）", async () => {
      const svc = withKms();
      await expect(
        svc.acceptEndorsement(endorsementPush({ kind: "software" }), NOW),
      ).rejects.toThrow(/背书只接受硬件证明链型/);
    });
  });
});
