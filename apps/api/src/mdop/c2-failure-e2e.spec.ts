import {
  canonicalSm3,
  generateSm2KeyPair,
  participantUrn,
  parseDataEnvelope,
  publicKeyFromPrivateKey,
  signCanonicalObject,
  signEndorsementPush,
  sm3Hex,
  withoutSignature,
  type Envelope,
  type NodeCapability,
} from "@medtrust/mdop";
import { MdopAttestationService } from "./mdop-attestation.service";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopJobsService } from "./mdop-jobs.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopMessagesController } from "./mdop-messages.controller";
import {
  MdopOperatorRegistryService,
  SYSTEM_OPERATORS,
} from "./operator-registry.service";
import { MdopOutboxService } from "./mdop-outbox.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { buildPairedCohortPlan } from "./plan-templates";
import { MdopTicketService } from "./mdop-ticket.service";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";

/**
 * **C2 首个场景的失败与销毁路径（端到端）**：§8.5「只出 C3 → 销毁」的另一半。
 *
 * 主线（成功路径）在 `c2-conformance-e2e.spec.ts` 里；这一支走的是同一条链的**熔断分支**：
 * 两院封存 → 中继到节点 → 节点内配对成功 → **节点内降密失败**（`E_RELEASE_CHECK_FAILED`，
 * 例如发布审查拒放）→ 平台把阶段与作业打成 `FAILED` → **终态即触发销毁编排**，给两院与节点
 * 都发 `PurgeOrder` → 收齐全部 `PurgeReceipt` 才进 `PURGED`。
 *
 * 为什么要单独跑这一支：失败路径最容易「看起来对但没走到」——作业失败后没人销毁、或者只销毁了
 * 部分节点、或者没收到节点回执就放行。这些都不是单元用例能覆盖的组合。
 *
 * 如实边界与成功路径同一口径：平台侧是**真实实现**，两院与节点**按协议扮演**
 * （模拟「被证明过的节点在审查不过时如实报 FAILED」），真实硬件/KMS 仍待 §9.2/§9.3。
 */

const SPACE = "sh-med";
const CONTRACT = "ctr-c2-fail";
const DATASET_A = "dp-a";
const DATASET_B = "dp-b";
const HOLDER_A = "p-huashan";
const HOLDER_B = "p-ruijin";
const NODE_A = participantUrn(SPACE, HOLDER_A);
const NODE_B = participantUrn(SPACE, HOLDER_B);
const TEE = participantUrn(SPACE, "tee-1");
const PLATFORM = participantUrn(SPACE, "platform");
const MEAS = `sm3:${"a".repeat(64)}`;
const NOW = () => new Date();

describe("§8.5 C2 首个场景：节点内降密失败 → 作业 FAILED → 销毁覆盖三方 → PURGED", () => {
  const gm = new GMCryptoService();
  const holderA = gm.generateSM2KeyPair();
  const holderB = gm.generateSM2KeyPair();
  const tee = gm.generateSM2KeyPair();
  const kms = gm.generateSM2KeyPair();

  let ca: CaService;
  let jobsRepo: ReturnType<typeof mockRepo>;
  let stagesRepo: ReturnType<typeof mockRepo>;
  let fragmentsRepo: ReturnType<typeof mockRepo>;
  let outboxRepo: ReturnType<typeof mockRepo>;
  let certsRepo: ReturnType<typeof mockRepo>;
  let deliveriesRepo: ReturnType<typeof mockRepo>;
  let receiptsRepo: ReturnType<typeof mockRepo>;
  let contractsRepo: ReturnType<typeof mockRepo>;
  let contracts: MdopContractService;
  let operators: MdopOperatorRegistryService;
  let jobs: MdopJobsService;
  let tickets: MdopTicketService;
  let scheduler: MdopSchedulerService;
  let purge: MdopPurgeService;
  let messages: MdopMessagesController;

  function signedEnvelope(input: {
    from: string;
    keys: { privateKey: string; publicKey: string };
    msgType: string;
    jobId: string;
    body: Record<string, unknown>;
    idempotencyKey: string;
  }): Envelope {
    const unsigned = {
      mdop: "0.2" as const,
      msg_id: `m-${Math.random().toString(36).slice(2)}`,
      msg_type: input.msgType,
      job_id: input.jobId,
      sender: input.from,
      receiver: PLATFORM,
      timestamp: NOW().toISOString(),
      nonce: `n-${Math.random().toString(36).slice(2)}`,
      idempotency_key: input.idempotencyKey,
      body: input.body,
    };
    return {
      ...unsigned,
      sig: signCanonicalObject(
        withoutSignature(unsigned as never),
        input.keys.privateKey,
        {
          publicKey: input.keys.publicKey,
        },
      ),
    } as unknown as Envelope;
  }

  beforeAll(async () => {
    ca = new CaService(gm, mockRepo(), mockRepo(), SPACE);
    await ca.onModuleInit();
    jobsRepo = mockRepo();
    stagesRepo = mockRepo();
    fragmentsRepo = mockRepo();
    outboxRepo = mockRepo();
    certsRepo = mockRepo();
    deliveriesRepo = mockRepo();
    receiptsRepo = mockRepo();
    contractsRepo = mockRepo();

    for (const [participantId, keys] of [
      [HOLDER_A, holderA],
      [HOLDER_B, holderB],
      ["tee-1", tee],
    ] as const) {
      await certsRepo.save(
        certsRepo.create({
          sm2Fingerprint: `SM2:${participantId}`,
          participantId,
          connectorId: `c-${participantId}`,
          spaceId: SPACE,
          subjectPublicKey: keys.publicKey,
          validUntil: new Date("2027-09-24T00:00:00.000Z"),
          revoked: false,
        }),
      );
    }

    contracts = new MdopContractService(
      gm,
      ca,
      contractsRepo,
      certsRepo,
      mockRepo(),
      SPACE,
    );
    await contractsRepo.save(
      contractsRepo.create({
        id: CONTRACT,
        dataProductId: DATASET_A,
        providerId: HOLDER_A,
        consumerId: "p-meddata",
        purpose: "RWS.EFFECTIVENESS",
        retention: "阅后即焚",
        output: "仅聚合统计",
        outputPolicy: { preset: "aggregate-only", minCell: 5 },
        validUntil: "2027-09-24T00:00:00.000Z",
        status: "active",
        pinnedModules: {},
        createdAt: new Date("2026-09-24T00:00:00.000Z"),
        mdopStatus: "unsigned",
      }),
    );
    const offer = await contracts.offer(CONTRACT, {
      extraRecipients: [
        { party: NODE_B, role: "final", jurisdiction: "CN" },
        { party: TEE, role: "merger", jurisdiction: "CN" },
      ],
      attestationPolicy: { tee: ["tdx"], minTcb: { tdx: "3.1.0" } },
    });
    await contracts.agree({
      contractId: CONTRACT,
      canonical: offer.canonical,
      holderSignature: gm.sm2Sign(offer.canonical, holderA.privateKey),
    });

    operators = new MdopOperatorRegistryService(
      gm,
      ca,
      mockRepo(),
      mockRepo(),
      {
        list: () => [
          {
            analysisType: "paired-cohort",
            file: "paired-cohort.wasm",
            abiVersion: 1,
            sm3: "c".repeat(64),
            compiler: { name: "assemblyscript", version: "0.27.37" },
            operator: {
              id: "rws.paired-cohort",
              version: "1.0.0",
              category: "collab",
              environments: ["tee"],
              inputs: [
                {
                  name: "left",
                  schema: "mdop.projection/1.0",
                  accept_labels: ["C2"],
                },
                {
                  name: "right",
                  schema: "mdop.projection/1.0",
                  accept_labels: ["C2"],
                },
              ],
              outputs: [
                {
                  name: "paired",
                  schema: "rws.paired-cohort/1.0",
                  label_rule: "inherit",
                },
              ],
            },
          },
        ],
      } as unknown as AlgorithmModuleRegistry,
    );
    await operators.onModuleInit();
    expect(
      SYSTEM_OPERATORS.find((m) => m.id === "seal.envelope"),
    ).toBeDefined();
    await operators.register(
      {
        apiVersion: "mdop/v0.2",
        kind: "system",
        id: "seal.envelope",
        version: "1.0.0",
        category: "seal",
        digest: "component:seal@1",
        publisher: "urn:tds:platform",
        inputs: [
          { name: "data", schema: "mdop.dataset/1.0", accept_labels: ["C0"] },
        ],
        outputs: [
          { name: "envelope", schema: "mdop.env/1.0", label_rule: "C2" },
        ],
        params: {},
        environments: ["plain"],
        security: { network: "none" },
        component: "seal@1.0.0",
      } as never,
      "e2e",
    );

    const attestations = new MdopAttestationService(mockRepo() as never, {
      trustedVerifiers: ["kms-1"],
      registryMeasurements: [MEAS],
      kmsPublicKey: kms.publicKey,
    });
    await attestations.acceptEndorsement(
      signEndorsementPush({
        verifier: "kms-1",
        endorsement: {
          node: TEE,
          kind: "tdx",
          measurement: MEAS,
          tcb: "3.1.2",
          quoteDigest: `sm3:${"b".repeat(64)}`,
          verifiedAt: new Date(Date.now() - 30_000).toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        privateKey: kms.privateKey,
        publicKey: kms.publicKey,
      }),
    );

    jobs = new MdopJobsService(
      jobsRepo,
      stagesRepo,
      fragmentsRepo,
      operators,
      contracts,
      attestations,
    );
    tickets = new MdopTicketService(
      gm,
      ca,
      jobsRepo,
      fragmentsRepo,
      stagesRepo,
      mockRepo(),
      mockRepo(),
      outboxRepo,
      certsRepo,
      contracts,
      attestations,
    );
    purge = new MdopPurgeService(
      jobsRepo,
      fragmentsRepo,
      outboxRepo,
      receiptsRepo,
    );
    scheduler = new MdopSchedulerService(
      jobsRepo,
      stagesRepo,
      outboxRepo,
      tickets,
      purge,
      contracts,
      attestations,
    );
    const outbox = new MdopOutboxService(
      gm,
      ca,
      outboxRepo,
      mockRepo(),
      jobsRepo,
      contractsRepo,
    );
    messages = new MdopMessagesController(
      outbox,
      contracts,
      purge,
      attestations,
      new MdopReceiptChainService(receiptsRepo, mockRepo()),
      new MdopMergeService(
        jobsRepo,
        deliveriesRepo,
        fragmentsRepo,
        stagesRepo,
        purge,
      ),
      tickets,
      scheduler,
      certsRepo as never,
      mockRepo() as never,
      deliveriesRepo as never,
      jobsRepo as never,
      fragmentsRepo as never,
    );
  });

  it("节点内降密失败 → 作业 FAILED（不静默算空集）→ 两院与节点都被要求销毁 → 收齐回执才 PURGED", async () => {
    const draft = buildPairedCohortPlan({
      purpose: "RWS.EFFECTIVENESS",
      applicant: {
        org: "urn:tds:sh-med:participant:pharma-1",
        project: "q4-pilot",
      },
      contracts: [CONTRACT],
      holders: [
        { participantId: HOLDER_A, dataProductId: DATASET_A },
        { participantId: HOLDER_B, dataProductId: DATASET_B },
      ],
      teeNode: TEE,
      minCell: 5,
      notBefore: "2026-09-24T00:00:00.000Z",
      notAfter: "2026-10-24T00:00:00.000Z",
    });
    const job = await jobs.submit({
      purpose: draft.purpose,
      applicant: draft.applicant,
      contracts: draft.contracts,
      stages: draft.stages,
      not_before: draft.not_before,
      not_after: draft.not_after,
    });
    const capability = (
      node: string,
      over: Partial<NodeCapability> = {},
    ): NodeCapability => ({
      node,
      runtime: ["native", "wasm"],
      system_ops: ["source.dataset@1.0.0", "seal.envelope@1.0.0"],
      whitelist_digests: [],
      tee: null,
      protocols: [],
      ...over,
    });
    const compiled = await jobs.compile({
      jobId: job.id,
      capabilities: new Map<string, NodeCapability>([
        [NODE_A, capability(NODE_A)],
        [NODE_B, capability(NODE_B)],
        [
          TEE,
          capability(TEE, {
            system_ops: ["declassify.small_cell@1.0.0"],
            tee: { kind: "tdx", min_tcb: "3.1.0" },
          }),
        ],
      ]),
      jobNotBefore: "2026-09-24T00:00:00.000Z",
      jobNotAfter: "2026-10-24T00:00:00.000Z",
    });
    expect(compiled.job.status).toBe("COMPILED");

    const { core } = await tickets.offerTickets({
      jobId: job.id,
      notBefore: draft.not_before,
      notAfter: draft.not_after,
    });
    for (const [node, keys] of [
      [NODE_A, holderA],
      [NODE_B, holderB],
      [TEE, tee],
    ] as const) {
      const snapshot = canonicalSm3({
        dataset: node === NODE_B ? DATASET_B : DATASET_A,
        stages: [],
      });
      await tickets.accept(
        {
          jobId: job.id,
          ticketId: core.ticket_id,
          core,
          snapshot,
          signer: node,
          holderSignature: signCanonicalObject(
            { core, snapshot } as Record<string, unknown>,
            keys.privateKey,
            {
              publicKey: keys.publicKey,
            },
          ),
        },
        { urn: node, publicKey: keys.publicKey },
      );
    }
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "TICKETED",
    );

    const dispatch = () => scheduler.dispatchReadyStages(job.id);
    const reportStage = async (input: {
      from: string;
      keys: { privateKey: string; publicKey: string };
      stageId: string;
      status: "SUCCEEDED" | "FAILED";
      label?: string;
      digest?: string;
      code?: string;
      message?: string;
    }) => {
      await messages.messages({
        envelope: signedEnvelope({
          from: input.from,
          keys: input.keys,
          msgType: "StageStatus",
          jobId: job.id,
          idempotencyKey: `status:${job.id}:${input.stageId}:${input.status}`,
          body: {
            job_id: job.id,
            stage_id: input.stageId,
            ticket_id: core.ticket_id,
            attempt: 1,
            status: input.status,
            ...(input.digest ? { digest: input.digest } : {}),
            ...(input.label ? { label: input.label } : {}),
            ...(input.code ? { code: input.code } : {}),
            ...(input.message ? { message: input.message } : {}),
          },
        }),
      });
    };
    const assertNoC3Delivery = async () => {
      const rows = (await deliveriesRepo.find({
        where: { jobId: job.id, label: "C3" },
      })) as unknown[];
      expect(rows).toHaveLength(0);
    };

    // ① 各院 source（C0，本地）
    await dispatch();
    for (const [node, keys, dataset] of [
      [NODE_A, holderA, DATASET_A],
      [NODE_B, holderB, DATASET_B],
    ] as const) {
      const srcStage = compiled.fragments
        .find((f) => f.node === node)!
        .stages.find((s) => s.op.startsWith("source.dataset"))!;
      await reportStage({
        from: node,
        keys,
        stageId: srcStage.id,
        status: "SUCCEEDED",
        label: "C0",
        digest: canonicalSm3({ dataset, rows: 3 }),
      });
    }

    // ② 各院 seal（C0→C2）：登记句柄 + 中继信封 + 阶段成功
    await dispatch();
    for (const [node, keys, dataset] of [
      [NODE_A, holderA, DATASET_A],
      [NODE_B, holderB, DATASET_B],
    ] as const) {
      const sealStage = compiled.fragments
        .find((f) => f.node === node)!
        .stages.find((s) => s.op.startsWith("seal.envelope"))!;
      const ciphertext = Buffer.from(`sealed-${dataset}`).toString("base64");
      const envelopeBody = {
        envelope: "mdop.env/1.0",
        payload: {
          cipher: "AES-256-GCM",
          ciphertext_ref: `ref-${dataset}`,
          digest: `sm3:${sm3Hex(Buffer.from(ciphertext, "base64"))}`,
        },
        wrapped_key: { kms: "kms-1", key_id: `key-${dataset}` },
        policy: {
          contract: CONTRACT,
          purpose: ["RWS.EFFECTIVENESS"],
          allowed_ops: [
            "rws.paired-cohort@1.0.0",
            "declassify.small_cell@1.0.0",
          ],
          attestation_policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
          export: "C3_only",
          not_after: "2026-10-24T00:00:00.000Z",
        },
        watermark: `wm:site-${dataset}:${SPACE}`,
        origin_sig: {
          signer: node,
          alg: "SM2-SM3",
          value: signCanonicalObject(
            { ref: `ref-${dataset}` },
            keys.privateKey,
            {
              publicKey: keys.publicKey,
            },
          ).value,
        },
        aad: {
          job_id: job.id,
          credential_id: core.ticket_id,
          contract_id: CONTRACT,
        },
      };
      parseDataEnvelope(envelopeBody);
      await messages.messages({
        envelope: signedEnvelope({
          from: node,
          keys,
          msgType: "ArtifactReady",
          jobId: job.id,
          idempotencyKey: `ready:${job.id}:${sealStage.id}`,
          body: {
            handle: {
              handle: `art://${node}/${job.id}/${sealStage.id}`,
              label: "C2",
              schema: "mdop.env/1.0",
              digest: canonicalSm3(envelopeBody),
              producer: {
                stage: sealStage.id,
                op: sealStage.op,
                op_digest: sealStage.op_digest,
              },
              ticket_id: core.ticket_id,
              expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
              stats: null,
            },
          },
        }),
      });
      await messages.relayEnvelope({
        envelope: signedEnvelope({
          from: node,
          keys,
          msgType: "C2EnvelopeSubmit",
          jobId: job.id,
          idempotencyKey: `c2:${dataset}`,
          body: { data_envelope: envelopeBody },
        }),
        sealed: { ciphertext, iv: "aXY=", tag: "dGFn" },
        target: TEE,
      });
      await reportStage({
        from: node,
        keys,
        stageId: sealStage.id,
        status: "SUCCEEDED",
        label: "C2",
        digest: canonicalSm3(envelopeBody),
      });
    }

    // ③ 节点跑 pair（成功）
    await dispatch();
    const paired = {
      analysisType: "paired-cohort",
      cohortSize: 3,
      exposed: 2,
      outcome: 2,
      exposedWithOutcome: 1,
      rate: 0.5,
      strata: [
        {
          key: "60-69|F",
          exposed: 2,
          outcome: 2,
          exposedWithOutcome: 1,
          cohortSize: 3,
          rate: 0.5,
        },
      ],
      buckets: [{ key: "60-69|F", count: 2, rate: 0.5 }],
    };
    await messages.messages({
      envelope: signedEnvelope({
        from: TEE,
        keys: tee,
        msgType: "ArtifactReady",
        jobId: job.id,
        idempotencyKey: `ready:${job.id}:pair`,
        body: {
          handle: {
            handle: `art://${TEE}/${job.id}/pair`,
            label: "C2",
            schema: "rws.paired-cohort@1",
            digest: canonicalSm3(paired),
            producer: {
              stage: "pair",
              op: "rws.paired-cohort@1.0.0",
              op_digest: "sm3:".concat("9".repeat(64)),
            },
            ticket_id: core.ticket_id,
            expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
            stats: null,
          },
        },
      }),
    });
    await reportStage({
      from: TEE,
      keys: tee,
      stageId: "pair",
      status: "SUCCEEDED",
      label: "C2",
      digest: canonicalSm3(paired),
    });

    // ④ 节点跑 decTee：**发布审查拒放**（小单元格/可识别内容）→ 如实报 FAILED + 错误码
    await dispatch();
    await reportStage({
      from: TEE,
      keys: tee,
      stageId: "decTee",
      status: "FAILED",
      code: "E_RELEASE_CHECK_FAILED",
      message: "发布审查未通过：结果含可识别内容",
    });

    // 作业进入 FAILED（不可重试错误直接失败），且**没有任何 C3 交付物**（不静默算空集）
    const failed = await jobsRepo.findOne({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(String(failed.rejectReason)).toContain("E_RELEASE_CHECK_FAILED");
    const failedStage = await stagesRepo.findOne({
      where: { id: `${job.id}#decTee` },
    });
    expect(failedStage.status).toBe("FAILED");
    await assertNoC3Delivery();

    // ⑤ 终态即触发销毁编排：**两院与节点都被要求销毁**（节点的 C2 制品也必须销毁）
    const { ordered } = await purge.orchestratePurge(job.id);
    expect(ordered.sort()).toEqual([NODE_A, NODE_B, TEE].sort());
    const purgeOrders = await outboxRepo.find({
      where: { msg_type: "PurgeOrder" },
    });
    expect(
      purgeOrders.map((r: { receiver: string }) => r.receiver).sort(),
    ).toEqual([NODE_A, NODE_B, TEE].sort());

    // ⑥ 收齐全部回执才 PURGED：先回两院 → 仍不是 PURGED；补节点回执 → PURGED
    // 销毁回执由**发出方自己**签：平台侧现在验签并核对 node 与已认证发送方一致
    const purgeKeys = new Map<
      string,
      { privateKey: string; publicKey: string }
    >();
    const purgeSender = (node: string) => {
      let key = purgeKeys.get(node);
      if (!key) {
        const pair = generateSm2KeyPair();
        key = {
          privateKey: pair.privateKey,
          publicKey: publicKeyFromPrivateKey(pair.privateKey),
        };
        purgeKeys.set(node, key);
      }
      return key;
    };
    const fakeReceipt = (node: string) => {
      const unsigned = {
        receipt_id: `rcpt-${node}`,
        job_id: job.id,
        node,
        reason: "purge-order" as const,
        handles: [`art://${node}/${job.id}/x`],
        destroyed_at: NOW().toISOString(),
        idempotency_key: `purge:${job.id}`,
      };
      const key = purgeSender(node);
      return {
        ...unsigned,
        sig: signCanonicalObject(unsigned, key.privateKey, {
          publicKey: key.publicKey,
        }),
      };
    };
    /** 消息层已认证上下文：URN + 证书公钥（服务按它验签与核对 node）。 */
    const purgeSenderCtx = (node: string) => ({
      urn: node,
      publicKey: purgeSender(node).publicKey,
    });
    // 第二个参数是**平台节点**（从销毁范围里排除的那一个），不是发出回执的节点
    for (const node of [NODE_A, NODE_B])
      await purge.onPurgeReceipt(
        fakeReceipt(node),
        purgeSenderCtx(node),
        PLATFORM,
      );
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "FAILED",
    );
    await purge.onPurgeReceipt(fakeReceipt(TEE), purgeSenderCtx(TEE), PLATFORM);
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "PURGED",
    );
  });
});
