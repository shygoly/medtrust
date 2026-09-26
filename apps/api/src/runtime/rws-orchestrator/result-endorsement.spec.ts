// on-chain-provider-endorsement —— 平台侧验签 + 持久化 + 上链 payload + 独立核验。
//
// 覆盖 tasks 2.1 / 2.2 / 2.3 / 3.1 / 3.2 / 4.1 / 4.3 / 6.1 / 6.3。
// 全程用真实 SM2 crypto(不 mock 验签),负例才有意义:伪造/篡改必须当场被拒。
import { ForbiddenException } from "@nestjs/common";
import { sm2 } from "sm-crypto";
import { sm2Sign, sm2Verify } from "@medtrust/mdop";
import {
  Certificate as CertificateEntity,
  RwsAssignmentEntity,
  RwsTaskEntity,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { ContractService } from "../digital-contract/contract.service";
import { ConnectorAuthService } from "../participant-identity/connector-auth.service";
import { mockRepo } from "../test-utils/mock-repo";
import { L0ValidationMergeService } from "./l0-validation-merge";
import { MetaAnalysisService } from "./meta-analysis.service";
import { RwsAdmissionService } from "./rws-admission.service";
import {
  RwsOrchestratorService,
  aggregateSm3,
} from "./rws-orchestrator.service";
import {
  collectEndorsements,
  endorsementRequired,
  resultEndorsementPayload,
} from "./result-endorsement";

const HUASHAN = "p-huashan";
const RUIJIN = "p-ruijin";

/**
 * 连接器侧签名 —— 与 apps/connector/src/domain/result-endorsement.ts 同口径：
 * 国标 SM2（Z_A + DER，D-MDOP-3）。公钥由私钥推出（sm2Sign 内部完成）。
 */
function connectorSign(resultSm3: string, privateKey: string): string {
  return sm2Sign(resultEndorsementPayload(resultSm3), privateKey);
}

describe("collectEndorsements — 上链前按院收集背书 (task 3.2)", () => {
  const row = (over: Partial<RwsAssignmentEntity>) =>
    ({
      providerId: "p",
      status: "completed",
      resultSm3: "a".repeat(64),
      connectorResultSig: "sig",
      connectorCertFingerprint: "SM2:FP",
      ...over,
    }) as RwsAssignmentEntity;

  it("按 participantId 排序(上链 payload 不依赖回传顺序)", () => {
    const out = collectEndorsements([
      row({ providerId: RUIJIN }),
      row({ providerId: HUASHAN }),
    ]);
    expect(out.map((e) => e.participantId)).toEqual([HUASHAN, RUIJIN]);
  });

  it("未完成/三件套不全的记录不产生半截背书(渐进期旧连接器)", () => {
    expect(
      collectEndorsements([
        row({ providerId: "a", status: "failed" }),
        row({ providerId: "b", connectorResultSig: null }),
        row({ providerId: "c", resultSm3: null }),
        row({ providerId: "d", connectorCertFingerprint: null }),
      ]),
    ).toEqual([]);
  });

  it("resultSm3 归一为小写(与离线核验口径一致)", () => {
    const [e] = collectEndorsements([row({ resultSm3: "A".repeat(64) })]);
    expect(e.resultSm3).toBe("a".repeat(64));
  });
});

describe("endorsementRequired — 渐进 → fail-closed 开关 (task 6.1)", () => {
  const original = process.env.RWS_ENDORSEMENT_REQUIRED;
  afterEach(() => {
    if (original === undefined) delete process.env.RWS_ENDORSEMENT_REQUIRED;
    else process.env.RWS_ENDORSEMENT_REQUIRED = original;
  });

  it("默认渐进(不强制)", () => {
    delete process.env.RWS_ENDORSEMENT_REQUIRED;
    expect(endorsementRequired()).toBe(false);
  });

  it("显式 true 才切强制", () => {
    process.env.RWS_ENDORSEMENT_REQUIRED = "TRUE";
    expect(endorsementRequired()).toBe(true);
    process.env.RWS_ENDORSEMENT_REQUIRED = "1";
    expect(endorsementRequired()).toBe(false);
  });
});

describe("RwsOrchestratorService — 连接器结果级背书 (tasks 2.x / 3.x)", () => {
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const admission = { admit: jest.fn() };
  const huashanKeys = sm2.generateKeyPairHex();
  const ruijinKeys = sm2.generateKeyPairHex();
  const HUASHAN_FP = "SM2:HUASHAN";
  const RUIJIN_FP = "SM2:RUIJIN";

  let taskRepo: ReturnType<typeof mockRepo<RwsTaskEntity>>;
  let assignmentRepo: ReturnType<typeof mockRepo<RwsAssignmentEntity>>;
  let certRepo: ReturnType<typeof mockRepo<CertificateEntity>>;
  let attestation: AttestationService;
  let connectorAuth: ConnectorAuthService;
  let orchestrator: RwsOrchestratorService;
  const envBackup = process.env.RWS_ENDORSEMENT_REQUIRED;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.RWS_ENDORSEMENT_REQUIRED;
    taskRepo = mockRepo<RwsTaskEntity>();
    assignmentRepo = mockRepo<RwsAssignmentEntity>();
    certRepo = mockRepo<CertificateEntity>();
    await certRepo.save([
      {
        sm2Fingerprint: HUASHAN_FP,
        participantId: HUASHAN,
        connectorId: "c-huashan",
        spaceId: "sh-med",
        subjectPublicKey: huashanKeys.publicKey,
        validUntil: new Date(Date.now() + 86_400_000),
        revoked: false,
      },
      {
        sm2Fingerprint: RUIJIN_FP,
        participantId: RUIJIN,
        connectorId: "c-ruijin",
        spaceId: "sh-med",
        subjectPublicKey: ruijinKeys.publicKey,
        validUntil: new Date(Date.now() + 86_400_000),
        revoked: false,
      },
    ]);
    attestation = new AttestationService(new GMCryptoService());
    connectorAuth = new ConnectorAuthService(new GMCryptoService(), certRepo);
    orchestrator = new RwsOrchestratorService(
      admission as unknown as RwsAdmissionService,
      contracts as unknown as ContractService,
      new MetaAnalysisService(new GMCryptoService(), attestation),
      new L0ValidationMergeService(new GMCryptoService(), attestation),
      taskRepo,
      assignmentRepo,
      attestation,
      undefined,
      connectorAuth,
    );
    admission.admit.mockImplementation(async () =>
      [HUASHAN, RUIJIN].map((providerId, i) => ({
        id: `c${i + 1}`,
        dataProductId: `dp${i + 1}`,
        providerId,
        consumerId: "p-meddata",
        purpose: "PV",
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      })),
    );
  });

  afterEach(() => {
    if (envBackup === undefined) delete process.env.RWS_ENDORSEMENT_REQUIRED;
    else process.env.RWS_ENDORSEMENT_REQUIRED = envBackup;
  });

  const aggregateFor = (cohortSize: number) => ({
    analysisType: "disproportionality",
    cohortSize,
    buckets: [{ key: "ALT升高", count: 6, rate: 0.6, b: 0, c: 0, d: 4 }],
  });

  async function submitTwoSite() {
    const record = await orchestrator.submit({
      purpose: "PV",
      analysis: {
        type: "disproportionality",
        drug: "D",
        designType: "cross-sectional",
        rationale: "药物警戒描述性失衡分析",
      },
      contractIds: ["c1", "c2"],
      consumerId: "p-meddata",
    });
    const [huashan] = await orchestrator.pullPending(HUASHAN);
    const [ruijin] = await orchestrator.pullPending(RUIJIN);
    return { taskId: record.taskId, huashan, ruijin };
  }

  /** 连接器回传:算 resultSm3 → 签 → 带三件套回传。 */
  async function completeWithEndorsement(
    assignmentId: string,
    providerId: string,
    keys: { privateKey: string },
    fingerprint: string,
    cohortSize = 10,
  ) {
    const aggregate = aggregateFor(cohortSize);
    const resultSm3 = aggregateSm3(aggregate);
    return orchestrator.completeAssignment(
      assignmentId,
      providerId,
      {
        aggregate,
        aggregateHash: resultSm3,
        resultSm3,
        connectorResultSig: connectorSign(resultSm3, keys.privateKey),
        connectorCertFingerprint: fingerprint,
      },
      fingerprint,
    );
  }

  it("回传带结果级签名 → 验签通过 → 按院持久化三件套 (task 2.1/2.2)", async () => {
    const { taskId, huashan } = await submitTwoSite();
    await completeWithEndorsement(
      huashan.assignmentId,
      HUASHAN,
      huashanKeys,
      HUASHAN_FP,
    );

    const rows = await assignmentRepo.find({ where: { taskId } });
    const row = rows.find((r) => r.providerId === HUASHAN)!;
    expect(row.status).toBe("completed");
    expect(row.resultSm3).toBe(aggregateSm3(aggregateFor(10)));
    expect(row.connectorCertFingerprint).toBe(HUASHAN_FP);
    expect(
      sm2Verify(
        resultEndorsementPayload(row.resultSm3!),
        row.connectorResultSig!,
        huashanKeys.publicKey,
      ),
    ).toBe(true);
  });

  it("多院任务:上链 payload 含各院背书 (task 3.1/3.3)", async () => {
    const anchorSpy = jest.spyOn(attestation, "anchor");
    const { huashan, ruijin } = await submitTwoSite();
    await completeWithEndorsement(
      huashan.assignmentId,
      HUASHAN,
      huashanKeys,
      HUASHAN_FP,
      10,
    );
    await completeWithEndorsement(
      ruijin.assignmentId,
      RUIJIN,
      ruijinKeys,
      RUIJIN_FP,
      12,
    );

    expect(anchorSpy).toHaveBeenCalled();
    const metadata = anchorSpy.mock.calls.at(-1)?.[1] as {
      endorsements?: Array<{ participantId: string; resultSm3: string }>;
    };
    expect(metadata?.endorsements?.map((e) => e.participantId)).toEqual([
      HUASHAN,
      RUIJIN,
    ]);
    // 合并 resultHash 仍在 data_hash;背书是**额外**的按院归因,不替代它。
    expect(anchorSpy.mock.calls.at(-1)?.[0]).toMatch(/^SM3:[0-9a-f]{64}$/);
  });

  it("单院任务同样带该院背书(非仅一个平台锚的哈希)", async () => {
    const anchorSpy = jest.spyOn(attestation, "anchor");
    admission.admit.mockResolvedValueOnce([
      {
        id: "c1",
        dataProductId: "dp1",
        providerId: HUASHAN,
        consumerId: "p-meddata",
        purpose: "PV",
        retention: "阅后即焚",
        output: "仅聚合",
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        status: "active",
      },
    ]);
    const record = await orchestrator.submit({
      purpose: "PV",
      analysis: {
        type: "disproportionality",
        drug: "D",
        designType: "cross-sectional",
        rationale: "药物警戒描述性失衡分析",
      },
      contractIds: ["c1"],
      consumerId: "p-meddata",
    });
    expect(record.taskId).toBeDefined();
    const [pending] = await orchestrator.pullPending(HUASHAN);
    await completeWithEndorsement(
      pending.assignmentId,
      HUASHAN,
      huashanKeys,
      HUASHAN_FP,
    );
    const metadata = anchorSpy.mock.calls.at(-1)?.[1] as {
      endorsements?: Array<{ participantId: string }>;
    };
    expect(metadata?.endorsements).toHaveLength(1);
    expect(metadata?.endorsements?.[0].participantId).toBe(HUASHAN);
  });

  it("用别家的私钥签 → 验签失败,拒该院贡献 (task 2.3)", async () => {
    const { taskId, huashan } = await submitTwoSite();
    const aggregate = aggregateFor(10);
    const resultSm3 = aggregateSm3(aggregate);
    await expect(
      orchestrator.completeAssignment(
        huashan.assignmentId,
        HUASHAN,
        {
          aggregate,
          aggregateHash: resultSm3,
          resultSm3,
          // 瑞金的私钥签、华山的指纹 —— 平台按指纹取公钥,必然验不过。
          connectorResultSig: connectorSign(resultSm3, ruijinKeys.privateKey),
          connectorCertFingerprint: HUASHAN_FP,
        },
        HUASHAN_FP,
      ),
    ).rejects.toThrow(ForbiddenException);
    const rows = await assignmentRepo.find({ where: { taskId } });
    expect(rows.find((r) => r.providerId === HUASHAN)!.status).not.toBe(
      "completed",
    );
  });

  it("签的是别的结果哈希 → 拒(背书必须绑住这份结果)", async () => {
    const { huashan } = await submitTwoSite();
    const aggregate = aggregateFor(10);
    const resultSm3 = aggregateSm3(aggregate);
    await expect(
      orchestrator.completeAssignment(
        huashan.assignmentId,
        HUASHAN,
        {
          aggregate,
          aggregateHash: resultSm3,
          resultSm3,
          connectorResultSig: connectorSign(
            "b".repeat(64),
            huashanKeys.privateKey,
          ),
          connectorCertFingerprint: HUASHAN_FP,
        },
        HUASHAN_FP,
      ),
    ).rejects.toThrow(/验签失败/);
  });

  it("自报的 resultSm3 与平台算得的不符 → 拒(不认连接器自报)", async () => {
    const { huashan } = await submitTwoSite();
    const aggregate = aggregateFor(10);
    const resultSm3 = aggregateSm3(aggregate);
    await expect(
      orchestrator.completeAssignment(
        huashan.assignmentId,
        HUASHAN,
        {
          aggregate,
          aggregateHash: resultSm3,
          resultSm3: "c".repeat(64),
          connectorResultSig: connectorSign(
            "c".repeat(64),
            huashanKeys.privateKey,
          ),
          connectorCertFingerprint: HUASHAN_FP,
        },
        HUASHAN_FP,
      ),
    ).rejects.toThrow(/与平台算得的聚合结果摘要不符/);
  });

  it("渐进期:旧连接器不带背书 → 任务不破,但存证无该院背书 (Migration)", async () => {
    const anchorSpy = jest.spyOn(attestation, "anchor");
    const { taskId, huashan, ruijin } = await submitTwoSite();
    const aggregate = aggregateFor(10);
    await orchestrator.completeAssignment(huashan.assignmentId, HUASHAN, {
      aggregate,
      aggregateHash: aggregateSm3(aggregate),
    });
    await completeWithEndorsement(
      ruijin.assignmentId,
      RUIJIN,
      ruijinKeys,
      RUIJIN_FP,
      12,
    );
    const rows = await assignmentRepo.find({ where: { taskId } });
    expect(rows.find((r) => r.providerId === HUASHAN)!.status).toBe(
      "completed",
    );
    expect(rows.find((r) => r.providerId === HUASHAN)!.resultSm3).toBeNull();
    const metadata = anchorSpy.mock.calls.at(-1)?.[1] as {
      endorsements?: Array<{ participantId: string }>;
    };
    expect(metadata?.endorsements?.map((e) => e.participantId)).toEqual([
      RUIJIN,
    ]);
  });

  it("切 fail-closed 后:不带背书即拒该院贡献 (task 6.1)", async () => {
    process.env.RWS_ENDORSEMENT_REQUIRED = "true";
    const { huashan } = await submitTwoSite();
    const aggregate = aggregateFor(10);
    await expect(
      orchestrator.completeAssignment(huashan.assignmentId, HUASHAN, {
        aggregate,
        aggregateHash: aggregateSm3(aggregate),
      }),
    ).rejects.toThrow(/RWS_ENDORSEMENT_REQUIRED/);
  });

  it("带背书但请求未认证指纹 → 拒(只认守卫认证过的那张证书)", async () => {
    const { huashan } = await submitTwoSite();
    const aggregate = aggregateFor(10);
    const resultSm3 = aggregateSm3(aggregate);
    await expect(
      orchestrator.completeAssignment(huashan.assignmentId, HUASHAN, {
        aggregate,
        aggregateHash: resultSm3,
        resultSm3,
        connectorResultSig: connectorSign(resultSm3, huashanKeys.privateKey),
        connectorCertFingerprint: HUASHAN_FP,
      }),
    ).rejects.toThrow(/未携带已认证的连接器证书指纹/);
  });

  it("证书已吊销 → 背书验不过,拒该院贡献", async () => {
    await certRepo.update({ sm2Fingerprint: HUASHAN_FP }, { revoked: true });
    const { huashan } = await submitTwoSite();
    await expect(
      completeWithEndorsement(
        huashan.assignmentId,
        HUASHAN,
        huashanKeys,
        HUASHAN_FP,
      ),
    ).rejects.toThrow(/验签失败/);
  });

  it("回退:关掉背书即回到只锚 resultHash,链与连接器不受影响 (task 6.3)", async () => {
    const anchorSpy = jest.spyOn(attestation, "anchor");
    const { huashan, ruijin } = await submitTwoSite();
    const a1 = aggregateFor(10);
    await orchestrator.completeAssignment(huashan.assignmentId, HUASHAN, {
      aggregate: a1,
      aggregateHash: aggregateSm3(a1),
    });
    const a2 = aggregateFor(12);
    await orchestrator.completeAssignment(ruijin.assignmentId, RUIJIN, {
      aggregate: a2,
      aggregateHash: aggregateSm3(a2),
    });
    const metadata = anchorSpy.mock.calls.at(-1)?.[1] as {
      endorsements?: unknown;
    };
    expect(metadata?.endorsements).toBeUndefined();
    const receipt = await anchorSpy.mock.results.at(-1)?.value;
    expect(receipt.hash).toMatch(/^SM3:[0-9a-f]{64}$/);
    expect(receipt.attestationLevel).toBe("software");
  });
});
