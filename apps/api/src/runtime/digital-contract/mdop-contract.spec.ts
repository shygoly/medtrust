import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  MdopError,
  canonicalize,
  parseMdopContract,
  sm2Sign,
} from "@medtrust/mdop";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import { mockRepo } from "../test-utils/mock-repo";
import { MdopContractService } from "./mdop-contract.service";
import { buildCanonicalFromEntity, isHolderSigned } from "./mdop-contract";

/**
 * 平台侧 MDOP 合约流程（D-MDOP-4 / 任务 5.2、5.6）。
 * 全程用真实国密 crypto：负例（改字段 / 换密钥 / 无签名）才有意义。
 */
describe("MDOP 合约持有方签署（平台侧）", () => {
  const PROVIDER = "p-huashan";
  const CONTRACT_ID = "ctr-mdop-1";

  let gm: GMCryptoService;
  let ca: CaService;
  let contracts: ReturnType<typeof mockRepo>;
  let certs: ReturnType<typeof mockRepo>;
  let outbox: ReturnType<typeof mockRepo>;
  let svc: MdopContractService;
  let providerKeys: { publicKey: string; privateKey: string };

  const seedContract = async (over: Record<string, unknown> = {}) => {
    await contracts.save(
      contracts.create({
        id: CONTRACT_ID,
        dataProductId: "dp-1",
        providerId: PROVIDER,
        consumerId: "p-meddata",
        purpose: "RWS.EFFECTIVENESS",
        retention: "阅后即焚",
        output: "仅聚合统计",
        outputPolicy: { preset: "aggregate-only", minCell: 10 },
        validUntil: "2027-09-24T00:00:00.000Z",
        status: "active",
        pinnedModules: {
          disproportionality: { sm3: "a".repeat(64), tier: "A" },
        },
        createdAt: new Date("2026-09-24T00:00:00.000Z"),
        mdopStatus: "unsigned",
        ...over,
      }),
    );
  };

  beforeEach(async () => {
    gm = new GMCryptoService();
    ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    contracts = mockRepo();
    certs = mockRepo();
    outbox = mockRepo();
    svc = new MdopContractService(gm, ca, contracts, certs, outbox, "sh-med");
    providerKeys = gm.generateSM2KeyPair();
    // 提供方连接器已注册（在册证书是验签的唯一信任锚）
    await certs.save(
      certs.create({
        sm2Fingerprint: "SM2:PROVIDER",
        participantId: PROVIDER,
        connectorId: "c-huashan",
        spaceId: "sh-med",
        subjectPublicKey: providerKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
  });

  it("发起要约：条款含平台合并方 + 提供方公钥指纹，且落发件箱", async () => {
    await seedContract();
    const { canonical, offerId } = await svc.offer(CONTRACT_ID);

    const row = await contracts.findOne({ where: { id: CONTRACT_ID } });
    expect(row.mdopStatus).toBe("offered");
    expect(
      row.mdopTerms.recipients.map((r: { party: string }) => r.party),
    ).toContain(svc.platformParty());
    expect(
      row.mdopTerms.recipients.find(
        (r: { role: string }) => r.role === "merger",
      ).party,
    ).toBe(svc.platformParty());
    expect(row.mdopTerms.providerPublicKeyKid).toBe(
      gm.publicKeyKid(providerKeys.publicKey),
    );
    expect(row.mdopTerms.platformPublicKeyKid).toBe(
      gm.publicKeyKid(ca.platformNodePublicKey),
    );
    expect(row.mdopTerms.allowedOpDigests).toEqual(["a".repeat(64)]);
    expect(row.mdopTerms.publication.minCell).toBe(10);
    // 缺省人工复核、72 小时（合同缺省不自动放行）
    expect(row.mdopTerms.review).toEqual({ mode: "manual", deadlineHours: 72 });
    expect(canonical).toBe(buildCanonicalFromEntity(row, row.mdopTerms));

    const queued = await outbox.find();
    expect(queued).toHaveLength(1);
    expect(queued[0].msg_type).toBe("ContractOffer");
    expect(queued[0].receiver).toBe("urn:tds:sh-med:participant:p-huashan");
    expect(queued[0].body.canonical).toBe(canonical);
    expect(offerId).toContain(CONTRACT_ID);
  });

  it("提供方连接器未注册证书 → 拒发要约（平台不代生成参与方密钥）", async () => {
    await seedContract();
    certs = mockRepo();
    svc = new MdopContractService(gm, ca, contracts, certs, outbox, "sh-med");
    await expect(svc.offer(CONTRACT_ID)).rejects.toThrow(BadRequestException);
    expect(await outbox.find()).toHaveLength(0);
  });

  it("接受签署：验签通过后平台副署并激活", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    const holderSignature = sm2Sign(canonical, providerKeys.privateKey, {
      publicKey: providerKeys.publicKey,
    });
    const row = await svc.agree({
      contractId: CONTRACT_ID,
      canonical,
      holderSignature,
    });

    expect(row.mdopStatus).toBe("active");
    expect(row.holderSignature).toBe(holderSignature);
    expect(isHolderSigned(row)).toBe(true);
    // 副署必须能被平台节点公钥验过（连接器侧就是这么验的）
    expect(
      gm.sm2Verify(
        canonical,
        row.platformCountersignature as string,
        ca.platformNodePublicKey,
      ),
    ).toBe(true);
    // 且不能用 CA 根钥验过（用途互斥）
    expect(
      gm.sm2Verify(
        canonical,
        row.platformCountersignature as string,
        ca.caPublicKey,
      ),
    ).toBe(false);
  });

  it("提交方不是该合约的提供方 → 拒（签名只证明条款是提供方签的，不证明现在由它提交）", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    const holderSignature = sm2Sign(canonical, providerKeys.privateKey, {
      publicKey: providerKeys.publicKey,
    });

    // 换一家（拿着同一份签署全文）来提交 → 拒，且不得把合约激活
    await expect(
      svc.agree({
        contractId: CONTRACT_ID,
        canonical,
        holderSignature,
        senderUrn: "urn:tds:sh-med:participant:p-ruijin",
      }),
    ).rejects.toThrow(ForbiddenException);
    // 要约发出后是 offered；被拒的提交 MUST NOT 把它推进到 active
    expect(
      (await contracts.findOne({ where: { id: CONTRACT_ID } })).mdopStatus,
    ).toBe("offered");

    // 提供方自己提交（消息路径带上 senderUrn）→ 通过
    const row = await svc.agree({
      contractId: CONTRACT_ID,
      canonical,
      holderSignature,
      senderUrn: "urn:tds:sh-med:participant:p-huashan",
    });
    expect(row.mdopStatus).toBe("active");
  });

  it("签署内容与平台条款不一致（改了字段）→ 拒", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    const tampered = canonical.replace("RWS.EFFECTIVENESS", "OTHER.PURPOSE");
    const signature = sm2Sign(tampered, providerKeys.privateKey, {
      publicKey: providerKeys.publicKey,
    });
    await expect(
      svc.agree({
        contractId: CONTRACT_ID,
        canonical: tampered,
        holderSignature: signature,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("签名不是提供方连接器签的（另一把密钥）→ 拒", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    const other = gm.generateSM2KeyPair();
    const signature = sm2Sign(canonical, other.privateKey, {
      publicKey: other.publicKey,
    });
    await expect(
      svc.agree({
        contractId: CONTRACT_ID,
        canonical,
        holderSignature: signature,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("结构非法的合约（多未定义字段）→ 拒", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    const parsed = JSON.parse(canonical);
    const broken = canonicalize({ ...parsed, extra_field: 1 });
    await expect(
      svc.agree({
        contractId: CONTRACT_ID,
        canonical: broken,
        holderSignature: sm2Sign(broken, providerKeys.privateKey, {
          publicKey: providerKeys.publicKey,
        }),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("编译期合约校验：无持有方签名 → E_CONTRACT_UNSIGNED（旧合约 fail-closed）", async () => {
    await seedContract(); // mdopStatus = unsigned
    await expect(
      svc.assertUsableForJob(CONTRACT_ID, "RWS.EFFECTIVENESS"),
    ).rejects.toMatchObject({ code: "E_CONTRACT_UNSIGNED" });
  });

  it("编译期合约校验：用途不符 → E_PURPOSE_MISMATCH；终止后 → E_CONTRACT_EXPIRED", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    await svc.agree({
      contractId: CONTRACT_ID,
      canonical,
      holderSignature: sm2Sign(canonical, providerKeys.privateKey, {
        publicKey: providerKeys.publicKey,
      }),
    });
    await expect(
      svc.assertUsableForJob(CONTRACT_ID, "OTHER"),
    ).rejects.toMatchObject({
      code: "E_PURPOSE_MISMATCH",
    });
    expect(
      (await svc.assertUsableForJob(CONTRACT_ID, "RWS.EFFECTIVENESS")).id,
    ).toBe(CONTRACT_ID);

    await svc.terminate(CONTRACT_ID, "平台撤销");
    await expect(
      svc.assertUsableForJob(CONTRACT_ID, "RWS.EFFECTIVENESS"),
    ).rejects.toMatchObject({ code: "E_CONTRACT_EXPIRED" });
  });

  it("终止：状态置 terminated 并向该院连接器发 ContractTerminate", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    await svc.agree({
      contractId: CONTRACT_ID,
      canonical,
      holderSignature: sm2Sign(canonical, providerKeys.privateKey, {
        publicKey: providerKeys.publicKey,
      }),
    });
    await svc.terminate(CONTRACT_ID, "合规要求");
    const row = await contracts.findOne({ where: { id: CONTRACT_ID } });
    expect(row.mdopStatus).toBe("terminated");
    const queued = await outbox.find();
    expect(queued.map((q: { msg_type: string }) => q.msg_type)).toEqual([
      "ContractOffer",
      // 副署必须回传连接器：本地副本要带着平台副署才算生效（复核只认本地副本）
      "ContractAgreeAck",
      "ContractTerminate",
    ]);
    expect(queued[2].body.reason).toBe("合规要求");
  });

  it("旧合约（无 MDOP 条款）不涉终止：terminate 静默返回", async () => {
    await seedContract();
    await svc.terminate(CONTRACT_ID, "无所谓");
    expect(await outbox.find()).toHaveLength(0);
  });

  it("不存在的合约 → NotFound", async () => {
    await expect(svc.canonicalFor("nope")).rejects.toThrow(NotFoundException);
    await expect(svc.assertUsableForJob("nope", "X")).rejects.toBeInstanceOf(
      MdopError,
    );
  });

  it("规范化合约可被连接器解析（跨平面不漂移）", async () => {
    await seedContract();
    const { canonical } = await svc.offer(CONTRACT_ID);
    const parsed = parseMdopContract(JSON.parse(canonical));
    expect(parsed.contract_id).toBe(CONTRACT_ID);
    expect(canonical).toBe(canonicalize(parsed));
  });

  describe("证明策略（C2 条款）", () => {
    it("未声明证明策略时，条款里不出现该键（非 C2 合约的哈希与升级前一致）", async () => {
      await seedContract();
      const row = await contracts.findOne({ where: { id: CONTRACT_ID } });
      // provider kid 由 offer() 在查证后填入；这里直接给一个，模拟要约时刻的条款
      const terms = {
        ...svc.buildTerms(row),
        providerPublicKeyKid: "a".repeat(64),
      };
      const canonical = buildCanonicalFromEntity(row, terms);
      expect(canonical).not.toContain("attestation_policy");
      // 能被协议解析器接受，且回读后依然没有该字段
      expect(
        parseMdopContract(JSON.parse(canonical)).attestation_policy,
      ).toBeUndefined();
    });

    it("声明证明策略后进入规范化：持有方签的就是这一版，解析后可回读", async () => {
      await seedContract();
      const row = await contracts.findOne({ where: { id: CONTRACT_ID } });
      const terms = svc.buildTerms(row, {
        attestationPolicy: {
          tee: ["csv", "tdx"],
          minTcb: { csv: "2026-06", tdx: "3.1.2" },
          allowedMeasurements: ["sm3:" + "c".repeat(64)],
        },
      });
      terms.providerPublicKeyKid = "a".repeat(64);
      const canonical = buildCanonicalFromEntity(row, terms);
      const parsed = parseMdopContract(JSON.parse(canonical));
      expect(parsed.attestation_policy).toEqual({
        tee: ["csv", "tdx"],
        min_tcb: { csv: "2026-06", tdx: "3.1.2" },
        allowed_measurements: ["sm3:" + "c".repeat(64)],
      });
      // 规范化稳定：同一份条款两次结果一致（哈希不漂移）
      const again = svc.buildTerms(row, {
        attestationPolicy: {
          tee: ["csv", "tdx"],
          minTcb: { csv: "2026-06", tdx: "3.1.2" },
          allowedMeasurements: ["sm3:" + "c".repeat(64)],
        },
      });
      again.providerPublicKeyKid = "a".repeat(64);
      expect(canonical).toBe(buildCanonicalFromEntity(row, again));
    });

    it("给了策略就必须能过协议解析（空链型清单这类非法条款在这里就被拦）", async () => {
      await seedContract();
      const row = await contracts.findOne({ where: { id: CONTRACT_ID } });
      const canonical = buildCanonicalFromEntity(
        row,
        svc.buildTerms(row, { attestationPolicy: { tee: [] } }),
      );
      expect(() => parseMdopContract(JSON.parse(canonical))).toThrow(
        /至少声明一条链型/,
      );
    });
  });
});
