import {
  canonicalSm3,
  generateSm2KeyPair,
  participantUrn,
  parseDataEnvelope,
  parseOperatorManifest,
  publicKeyFromPrivateKey,
  signCanonicalObject,
  signEndorsementPush,
  mergeReleaseManifests,
  withReleaseManifest,
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
import {
  MdopMessagesController,
  l15AnalysisOf,
} from "./mdop-messages.controller";
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
 * **首个 C2 场景的端到端单进程演练**（§8.5 的合成数据版、§9.2/§9.3 的单进程预演）。
 *
 * 与既有的 `conformance-e2e.spec.ts`（L1.5 那条链）的差别：这条链上有 **C2 边**与一个
 * **可信空间节点**，因此把 C2 特有的每一步都串起来跑一遍：
 *
 *   证明背书推送（D-TEE-6）→ 编译（C2 放置）→ 要约（带已双签合约副本）→ 三方签名接受
 *   → 签发凭证（冻结节点执行环境期望）→ 各院封存 → **C2 中继到节点**（平台只转运）
 *   → 节点内配对（C2 制品不出节点）→ 节点内降密 → **只出 C3** 投递 → 平台收集
 *   → 作业 SUCCEEDED → 销毁编排（含节点）→ 收齐回执才 PURGED → 回执链 ingest。
 *
 * 如实边界（不得含糊）：**平台侧跑的是真实实现**（真实控制器/服务/仓库替身），
 * 各院与节点**按协议扮演**（用 `packages/mdop` 原语签名与投递）——它们的应用实现
 * （真实 wasm 沙箱、发布审查、KMS 释放、长驻循环）由 `apps/connector` 的用例覆盖
 * （`stage-dispatch` / `node-messages` / `runtime` / `pairing-sandbox` 等）。
 * 三方实机演练（真实硬件与 KMS）仍是 §9.2/§9.3，本用例**不能**当作「C2 已可用」的证据。
 */

const SPACE = "sh-med";
const CONTRACT = "ctr-c2-e2e";
const DATASET_A = "dp-a";
const DATASET_B = "dp-b";
const HOLDER_A = "p-huashan";
const HOLDER_B = "p-ruijin";
const NODE_A = participantUrn(SPACE, HOLDER_A);
const NODE_B = participantUrn(SPACE, HOLDER_B);
const TEE = participantUrn(SPACE, "tee-1");
const PLATFORM = participantUrn(SPACE, "platform");
const MEAS = `sm3:${"a".repeat(64)}`;
const QUOTE = `sm3:${"b".repeat(64)}`;
const NOW = () => new Date();

describe("§8.5 C2 首个场景：两院封存 → 节点内配对降密 → 只出 C3（单进程端到端）", () => {
  const gm = new GMCryptoService();
  const holderA = gm.generateSM2KeyPair();
  const holderB = gm.generateSM2KeyPair();
  const tee = gm.generateSM2KeyPair();
  const kms = gm.generateSM2KeyPair();

  let ca: CaService;
  let jobsRepo: ReturnType<typeof mockRepo>;
  let stagesRepo: ReturnType<typeof mockRepo>;
  let fragmentsRepo: ReturnType<typeof mockRepo>;
  let ticketsRepo: ReturnType<typeof mockRepo>;
  let signaturesRepo: ReturnType<typeof mockRepo>;
  let outboxRepo: ReturnType<typeof mockRepo>;
  let certsRepo: ReturnType<typeof mockRepo>;
  let handlesRepo: ReturnType<typeof mockRepo>;
  let deliveriesRepo: ReturnType<typeof mockRepo>;
  let attestationRepo: ReturnType<typeof mockRepo>;
  let receiptsRepo: ReturnType<typeof mockRepo>;
  let contractsRepo: ReturnType<typeof mockRepo>;
  let contracts: MdopContractService;
  let operators: MdopOperatorRegistryService;
  let jobs: MdopJobsService;
  let tickets: MdopTicketService;
  let scheduler: MdopSchedulerService;
  let purge: MdopPurgeService;
  let merge: MdopMergeService;
  let receiptChain: MdopReceiptChainService;
  let attestations: MdopAttestationService;
  let messages: MdopMessagesController;
  let outbox: MdopOutboxService;

  /** 把一条**由参与方签名**的信封投给平台（走真实控制器的入站校验）。 */
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
    ticketsRepo = mockRepo();
    signaturesRepo = mockRepo();
    outboxRepo = mockRepo();
    certsRepo = mockRepo();
    handlesRepo = mockRepo();
    deliveriesRepo = mockRepo();
    attestationRepo = mockRepo();
    receiptsRepo = mockRepo();
    contractsRepo = mockRepo();

    // 三方登记证书（平台按登记公钥验各自签名；平台永不接触私钥）
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
    // 合约：接收方必须含**可信空间节点**（否则各院复核 C2 边时会以「对端不在接收方之列」拒片）
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
      // 与线上同口径：持有方对**规范化条款串**本身签名（`MdopContractService.agree` 的判据，
      // 用平台自己的 GM 实现——签名格式与平台侧 `sm2Verify` 对齐）
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
    // 封存算子（system）不是内置种子，按本仓既有做法显式登记
    const seal = SYSTEM_OPERATORS.find((m) => m.id === "seal.envelope");
    expect(seal).toBeDefined(); // 封装算子已进种子表（2026-10-03）；下面的显式登记保留以验证幂等
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

    attestations = new MdopAttestationService(attestationRepo as never, {
      trustedVerifiers: ["kms-1"],
      registryMeasurements: [MEAS],
      kmsPublicKey: kms.publicKey,
    });
    // **作业之前的证明登记**（D-TEE-6）：没有它，C2 作业在编译期就会被拒（先有鸡还是先有蛋）
    await attestations.acceptEndorsement(
      signEndorsementPush({
        verifier: "kms-1",
        endorsement: {
          node: TEE,
          kind: "tdx",
          measurement: MEAS,
          tcb: "3.1.2",
          quoteDigest: QUOTE,
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
      ticketsRepo,
      signaturesRepo,
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
    // 注入合约与证明登记：C2 阶段下发前要**再核一次**证明登记（规格「证明在编译后过期」）
    scheduler = new MdopSchedulerService(
      jobsRepo,
      stagesRepo,
      outboxRepo,
      tickets,
      purge,
      contracts,
      attestations,
    );
    merge = new MdopMergeService(
      jobsRepo,
      deliveriesRepo,
      fragmentsRepo,
      stagesRepo,
      purge,
    );
    receiptChain = new MdopReceiptChainService(receiptsRepo, mockRepo());
    outbox = new MdopOutboxService(
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
      receiptChain,
      merge,
      tickets,
      scheduler,
      certsRepo as never,
      handlesRepo as never,
      deliveriesRepo as never,
      jobsRepo as never,
      fragmentsRepo as never,
    );
  });

  it("一条链跑完：背书 → 编译 → 要约 → 三方接受 → 封存与中继 → 节点内配对降密 → 收集 → 销毁", async () => {
    // ── 1) 编计划（跨院配对模板）与编译（C2 放置）──────────────────────
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
    const teeFragment = compiled.fragments.find((f) => f.node === TEE)!;
    expect(teeFragment.stages.map((s) => s.id).sort()).toEqual([
      "decTee",
      "pair",
    ]);
    // 配对的两条入边都是 C2（封装自两院）
    const pair = teeFragment.stages.find((s) => s.id === "pair")!;
    expect(pair.input_labels).toEqual(["C2", "C2"]);
    expect(pair.output_label).toBe("C2");
    // 降密落在同一节点上，产物是 C3
    const decTee = teeFragment.stages.find((s) => s.id === "decTee")!;
    expect(decTee.node).toBe(TEE);
    expect(decTee.output_label).toBe("C3");

    // ── 2) 要约：三方都要签，且随带**已双签合约副本** ─────────────────
    const { core } = await tickets.offerTickets({
      jobId: job.id,
      notBefore: draft.not_before,
      notAfter: draft.not_after,
    });
    expect(core.attestation?.[TEE]).toMatchObject({
      tee: "tdx",
      measurement: MEAS,
      min_tcb: "3.1.0",
    });
    const offerRows = await outboxRepo.find({
      where: { msg_type: "PlanFragmentOffer" },
    });
    expect(
      offerRows.map((r: { receiver: string }) => r.receiver).sort(),
    ).toEqual([NODE_A, NODE_B, TEE].sort());
    const teeOffer = offerRows.find(
      (r: { receiver: string }) => r.receiver === TEE,
    ) as {
      body: { contracts?: Array<Record<string, unknown>> };
    };
    expect(teeOffer.body.contracts?.[0]?.contract_id).toBe(CONTRACT);
    expect(
      String(teeOffer.body.contracts?.[0]?.holder_signature ?? ""),
    ).not.toBe("");

    // ── 3) 三方签名接受（节点也签，否则平台收不齐、凭证签不出来）──────
    for (const [node, keys] of [
      [NODE_A, holderA],
      [NODE_B, holderB],
      [TEE, tee],
    ] as const) {
      const snapshot = canonicalSm3({
        dataset: node === NODE_B ? DATASET_B : DATASET_A,
        stages: [],
      });
      const acceptance = signCanonicalObject(
        { core, snapshot } as Record<string, unknown>,
        keys.privateKey,
        { publicKey: keys.publicKey },
      );
      await tickets.accept(
        {
          jobId: job.id,
          ticketId: core.ticket_id,
          core,
          snapshot,
          signer: node,
          holderSignature: acceptance,
        },
        { urn: node, publicKey: keys.publicKey },
      );
    }
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "TICKETED",
    );

    // ── 4) 调度：先各院 source → seal，再节点的 pair → decTee ──────────
    const dispatch = () => scheduler.dispatchReadyStages(job.id);
    const outboxFor = async (receiver: string, msgType: string) =>
      (await outboxRepo.find({
        where: { receiver, msg_type: msgType },
      })) as Array<{
        body: Record<string, unknown>;
      }>;
    await dispatch();
    let teeDispatches = await outboxFor(TEE, "StageDispatch");
    expect(teeDispatches).toHaveLength(0); // 上游（封存）没好之前，节点一个阶段都不会被下发

    const reportStage = async (input: {
      from: string;
      keys: { privateKey: string; publicKey: string };
      stageId: string;
      label: string;
      digest: string;
    }) => {
      await messages.messages({
        envelope: signedEnvelope({
          from: input.from,
          keys: input.keys,
          msgType: "StageStatus",
          jobId: job.id,
          idempotencyKey: `status:${job.id}:${input.stageId}`,
          body: {
            job_id: job.id,
            stage_id: input.stageId,
            ticket_id: core.ticket_id,
            attempt: 1,
            status: "SUCCEEDED",
            digest: input.digest,
            label: input.label,
          },
        }),
      });
    };

    // 各院 source 阶段（C0，本地）
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
        label: "C0",
        digest: canonicalSm3({ dataset, rows: 3 }),
      });
    }
    await dispatch();

    // 各院 seal 阶段（C0→C2）：登记句柄 + 中继信封 + 阶段成功
    const sealedRefs: string[] = [];
    for (const [node, keys, dataset] of [
      [NODE_A, holderA, DATASET_A],
      [NODE_B, holderB, DATASET_B],
    ] as const) {
      const sealStage = compiled.fragments
        .find((f) => f.node === node)!
        .stages.find((s) => s.op.startsWith("seal.envelope"))!;
      // 密文体与信封（平台不解密，只看摘要与绑定）
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
      parseDataEnvelope(envelopeBody); // 结构自检：中继端也会严格解析
      sealedRefs.push(envelopeBody.payload.ciphertext_ref);

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
      // 中继：持有方 → 平台（只转运）→ 节点
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
        label: "C2",
        digest: canonicalSm3(envelopeBody),
      });
    }
    // 平台只转运：中继消息落在**节点**的发件箱里，平台侧没有明文载荷
    const relays = await outboxRepo.find({
      where: { receiver: TEE, msg_type: "C2EnvelopeRelay" },
    });
    expect(relays).toHaveLength(2);
    const c2Rows = (await deliveriesRepo.find({
      where: { jobId: job.id, label: "C2" },
    })) as Array<{
      payload: unknown;
    }>;
    expect(c2Rows.length).toBeGreaterThan(0);
    expect(c2Rows.every((r) => r.payload === null)).toBe(true); // C2 只有「转运记录」，没有载荷

    // ── 5) 节点跑 pair：C2 制品留在节点内，只登记句柄 + 报阶段成功 ─────
    await dispatch();
    teeDispatches = await outboxFor(TEE, "StageDispatch");
    expect(teeDispatches.map((d) => d.body.stage_id)).toEqual(["pair"]);
    const pairedPayload = {
      analysisType: "paired-cohort",
      cohortSize: 3,
      exposed: 2,
      outcome: 2,
      exposedWithOutcome: 1,
      rate: 0.5,
      // 节点出的**规范聚合形状**（平台收集方按它校验/求和）
      strata: [
        {
          key: "60-69|F",
          exposed: 2,
          outcome: 2,
          exposedWithOutcome: 1,
          cohortSize: 3,
          rate: 0.5,
        },
        {
          key: "90-99|F",
          exposed: 0,
          outcome: 0,
          exposedWithOutcome: 0,
          cohortSize: 0,
          rate: 0,
          suppressed: true,
        },
      ],
      buckets: [
        { key: "60-69|F", count: 2, rate: 0.5 },
        { key: "90-99|F", count: 0, rate: 0, suppressed: true },
      ],
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
            digest: canonicalSm3(pairedPayload),
            producer: {
              stage: "pair",
              op: "rws.paired-cohort@1.0.0",
              op_digest: pair.op_digest,
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
      label: "C2",
      digest: canonicalSm3(pairedPayload),
    });

    // ── 6) 节点跑 decTee：只出 C3 投递（带发布审查清单）──────────────
    await dispatch();
    teeDispatches = await outboxFor(TEE, "StageDispatch");
    // `pair` 的成功已被平台接受 = 那份指令已得到应答，随即从发件箱撤回（不再随每轮长轮询重发，
    // 节点重启后也不会把已完成的阶段再跑一遍）；它消费掉的两份 C2 信封同理。
    expect(teeDispatches.map((d) => d.body.stage_id)).toEqual(["decTee"]);
    expect(
      await outboxRepo.find({
        where: { receiver: TEE, msg_type: "C2EnvelopeRelay" },
      }),
    ).toHaveLength(0);
    // 节点发布路径的真实写法：先造清单（口径只有一份），再挂到载荷上
    const c3Payload = withReleaseManifest(
      pairedPayload,
      mergeReleaseManifests(
        [
          {
            node: TEE,
            minCell: 5,
            suppressed: 1,
            dp: { mode: "none" as const },
            budget: {
              dataset: DATASET_A,
              snapshot: `sm3:${"0".repeat(64)}`,
              unit: "queries" as const,
              spent: 1,
              limit: 5,
            },
            at: NOW().toISOString(),
          },
        ],
        { now: NOW() },
      ),
    );
    await messages.messages({
      envelope: signedEnvelope({
        from: TEE,
        keys: tee,
        msgType: "ArtifactReady",
        jobId: job.id,
        idempotencyKey: `ready:${job.id}:decTee`,
        body: {
          handle: {
            handle: `art://${TEE}/${job.id}/decTee`,
            label: "C3",
            schema: "mdop.table/1.0",
            digest: canonicalSm3(c3Payload),
            producer: {
              stage: "decTee",
              op: "declassify.small_cell@1.0.0",
              op_digest: decTee.op_digest,
            },
            ticket_id: core.ticket_id,
            expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
            stats: { row_count: 2 },
          },
        },
      }),
    });
    await messages.deliveries({
      envelope: signedEnvelope({
        from: TEE,
        keys: tee,
        msgType: "ResultDeliver",
        jobId: job.id,
        idempotencyKey: `deliver:${job.id}:decTee`,
        body: {
          handle: `art://${TEE}/${job.id}/decTee`,
          digest: canonicalSm3(c3Payload),
          label: "C3",
        },
      }),
      handle: {
        handle: `art://${TEE}/${job.id}/decTee`,
        label: "C3",
        digest: canonicalSm3(c3Payload),
      },
      payload: c3Payload,
    });
    await reportStage({
      from: TEE,
      keys: tee,
      stageId: "decTee",
      label: "C3",
      digest: canonicalSm3(c3Payload),
    });

    // ── 7) 平台收集（配对结果不是失衡表，这条分支必须走对）──────────
    const merged = await merge.mergeIfReady(
      job.id,
      l15AnalysisOf(await jobsRepo.findOne({ where: { id: job.id } })),
    );
    expect(merged.merged).toBe(true);
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "SUCCEEDED",
    );
    const result = (await merge.mergedResult(job.id)) as Record<
      string,
      unknown
    >;
    expect(result).toMatchObject({
      analysisType: "paired-cohort",
      cohortSize: 3,
    });
    // 出域物里没有主体键、没有行；发布审查清单随行
    expect(JSON.stringify(result)).not.toContain("subjectKey");
    expect(result.release_manifest).toBeDefined();

    // ── 8) 销毁：**收齐含节点在内的全部回执**才 PURGED（熔断）────────
    const { ordered } = await purge.orchestratePurge(job.id);
    expect(ordered.sort()).toEqual([NODE_A, NODE_B, TEE].sort());
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
    for (const node of [NODE_A, NODE_B])
      await purge.onPurgeReceipt(fakeReceipt(node), purgeSenderCtx(node), node);
    // 只回了两院：作业**不得**进 PURGED（缺节点回执就不算销毁完）
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).not.toBe(
      "PURGED",
    );
    await purge.onPurgeReceipt(fakeReceipt(TEE), purgeSenderCtx(TEE), TEE);
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "PURGED",
    );

    // ── 9) 回执链 ingest：节点回执按协议形状入链 ─────────────────────
    const receipt = {
      receipt_id: `rcpt-chain-${job.id}`,
      job_id: job.id,
      stage: "decTee",
      event: "EXITED" as const,
      input_digests: [],
      op_digest: "component:node-exit@1",
      output_digest: canonicalSm3(c3Payload),
      label: "C3" as const,
      prev_receipt_hash: null,
      signer: TEE,
      at: NOW().toISOString(),
    };
    const signed = {
      ...receipt,
      sig: signCanonicalObject(receipt, tee.privateKey, {
        publicKey: tee.publicKey,
      }),
    };
    // 身份上下文来自**消息层已认证的发送方**（节点自己的证书公钥），不是回执正文自述
    const ingested = await receiptChain.ingestAuditReceipt(signed, {
      urn: TEE,
      publicKey: tee.publicKey,
    });
    expect(ingested.accepted).toBe(true);

    // 解析一下中继过的信封：结构合规（密文摘要与密文一致）
    const relayed = parseDataEnvelope(
      (relays[0].body as { data_envelope: unknown }).data_envelope,
    );
    expect(relayed.payload.digest).toBe(
      `sm3:${sm3Hex(Buffer.from(relayed.payload.ciphertext_ref === "ref-dp-a" ? Buffer.from("sealed-dp-a").toString("base64") : Buffer.from("sealed-dp-b").toString("base64"), "base64"))}`,
    );
    expect(
      parseOperatorManifest(
        (await operators.list()).find(
          (r: { ref: string }) => r.ref === "rws.paired-cohort@1.0.0",
        )!.manifest,
      ).category,
    ).toBe("collab");
    expect(sealedRefs.sort()).toEqual(["ref-dp-a", "ref-dp-b"]);
  });
});
