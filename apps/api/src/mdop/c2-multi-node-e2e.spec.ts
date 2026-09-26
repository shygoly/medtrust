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
import { MdopJobsService, type SubmitJobInput } from "./mdop-jobs.service";
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
import { MdopTicketService } from "./mdop-ticket.service";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";

/**
 * **两可信空间节点（多分片）的 C2 端到端**：覆盖收集路径的多节点分支与「销毁覆盖两个节点」。
 *
 * 为什么单独跑这一支：单节点场景（`c2-conformance-e2e.spec.ts`）里平台是**原样收集**一份 C3；
 * 多节点的分支要求平台**按分层 key 求和并重算率**（`collect-paired-cohort` 的多表分支），
 * 以及销毁编排覆盖**两个**可信空间节点。这一支在变更文档里被标为「异常/未来多分片，本场景不会出现」，
 * 因此它是**覆盖面**而不是首个场景的必经路径——但它一旦被用到，出错的方式很隐蔽
 * （少收一个节点、求和口径错、只销毁其中一个节点）。
 *
 * 形态：四家持有方分成两组，各自在同组的两方之间做配对 → 两个节点各出一份 C3 → 平台收集求和。
 * 如实边界与其它端到端用例一致：平台侧是真实实现，持有方与节点按协议扮演；
 * 真实硬件/KMS 仍待 §9.2/§9.3。
 */

const SPACE = "sh-med";
const CONTRACT = "ctr-c2-multi";
const HOLDERS = ["p-a1", "p-a2", "p-b1", "p-b2"] as const;
const HOLDER_URNS = HOLDERS.map((h) => participantUrn(SPACE, h));
const TEE1 = participantUrn(SPACE, "tee-1");
const TEE2 = participantUrn(SPACE, "tee-2");
const PLATFORM = participantUrn(SPACE, "platform");
const MEAS = `sm3:${"a".repeat(64)}`;
const NOW = () => new Date();
const PAIR_OP = "rws.paired-cohort@1.0.0";
const DECLASSIFY_OP = "declassify.small_cell@1.0.0";

describe("§8.5 C2 多节点（多分片）：两节点各出一份 C3 → 平台按分层求和 → 覆盖两节点的销毁", () => {
  const gm = new GMCryptoService();
  const holderKeys = HOLDERS.map(() => gm.generateSM2KeyPair());
  const tee1Keys = gm.generateSM2KeyPair();
  const tee2Keys = gm.generateSM2KeyPair();
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
  let merge: MdopMergeService;
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

    const register = async (
      participantId: string,
      keys: { publicKey: string },
    ) => {
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
    };
    for (const [index, holder] of HOLDERS.entries())
      await register(holder, holderKeys[index]);
    await register("tee-1", tee1Keys);
    await register("tee-2", tee2Keys);

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
        dataProductId: "dp-a1",
        providerId: HOLDERS[0],
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
    // 接收方：平台 + 两个可信空间节点 + 其余三家持有方（C2 边的对端校验按这份名单判）
    const offer = await contracts.offer(CONTRACT, {
      extraRecipients: [
        ...[...HOLDER_URNS.slice(1), TEE1, TEE2].map((party) => ({
          party,
          role: "final" as const,
          jurisdiction: "CN",
        })),
      ],
      attestationPolicy: { tee: ["tdx"], minTcb: { tdx: "3.1.0" } },
    });
    await contracts.agree({
      contractId: CONTRACT,
      canonical: offer.canonical,
      holderSignature: gm.sm2Sign(offer.canonical, holderKeys[0].privateKey),
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
    ).toBeUndefined();
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
    for (const node of [TEE1, TEE2]) {
      await attestations.acceptEndorsement(
        signEndorsementPush({
          verifier: "kms-1",
          endorsement: {
            node,
            kind: "tdx",
            measurement: MEAS,
            tcb: "3.1.2",
            quoteDigest: `sm3:${(node === TEE1 ? "b" : "d").repeat(64)}`,
            verifiedAt: new Date(Date.now() - 30_000).toISOString(),
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
          privateKey: kms.privateKey,
          publicKey: kms.publicKey,
        }),
      );
    }

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
    merge = new MdopMergeService(
      jobsRepo,
      deliveriesRepo,
      fragmentsRepo,
      stagesRepo,
      purge,
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
      merge,
      tickets,
      scheduler,
      certsRepo as never,
      mockRepo() as never,
      deliveriesRepo as never,
      jobsRepo as never,
      fragmentsRepo as never,
    );
  });

  it("两节点各出一份 C3：平台按分层求和、作业 SUCCEEDED、销毁覆盖两个节点后才 PURGED", async () => {
    // ① 计划：四家持有方分成两组，各组在自己的两方之间配对，配对与降密分别落在两个可信空间节点
    // 阶段 id 与下面 `stages` 生成规则一致（pair_<组号> / dec_<组号>）
    const groups: Array<{
      node: string;
      tee: string;
      pair: string;
      dec: string;
      holders: Array<{ urn: string; product: string }>;
    }> = [
      {
        node: TEE1,
        tee: "tee-1",
        pair: "pair_0",
        dec: "dec_0",
        holders: [
          { urn: HOLDER_URNS[0], product: "dp-a1" },
          { urn: HOLDER_URNS[1], product: "dp-a2" },
        ],
      },
      {
        node: TEE2,
        tee: "tee-2",
        pair: "pair_1",
        dec: "dec_1",
        holders: [
          { urn: HOLDER_URNS[2], product: "dp-b1" },
          { urn: HOLDER_URNS[3], product: "dp-b2" },
        ],
      },
    ];
    const stages: SubmitJobInput["stages"] = [];
    const groupStages = groups.map((group, index) => {
      const sealIds: string[] = [];
      for (const [i, holder] of group.holders.entries()) {
        const src = `src_${index}_${i}`;
        const seal = `seal_${index}_${i}`;
        stages.push({
          id: src,
          op: "source.dataset@1.0.0",
          inputs: [
            {
              from: `ds://${holder.urn.replace(`urn:tds:${SPACE}:participant:`, "")}/${holder.product}`,
            },
          ],
          params: {
            uri: `ds://${holder.urn.replace(`urn:tds:${SPACE}:participant:`, "")}/${holder.product}`,
          },
        });
        stages.push({
          id: seal,
          op: "seal.envelope@1.0.0",
          inputs: [{ from: src }],
          params: { contractId: CONTRACT },
        });
        sealIds.push(seal);
      }
      const pair = `pair_${index}`;
      const dec = `dec_${index}`;
      stages.push({
        id: pair,
        op: PAIR_OP,
        inputs: sealIds.map((from) => ({ from })),
        params: {},
        at: group.node,
      });
      stages.push({
        id: dec,
        op: DECLASSIFY_OP,
        inputs: [{ from: pair }],
        params: { minCell: 5, contractId: CONTRACT },
        at: group.node,
      });
      return {
        srcIds: sealIds.map((s) => s.replace("seal", "src")),
        sealIds,
        pair,
        dec,
      };
    });

    const job = await jobs.submit({
      purpose: "RWS.EFFECTIVENESS",
      applicant: {
        org: "urn:tds:sh-med:participant:pharma-1",
        project: "q4-pilot",
      },
      contracts: [CONTRACT],
      stages,
      not_before: "2026-09-24T00:00:00.000Z",
      not_after: "2026-10-24T00:00:00.000Z",
    });
    const holderCapability = (node: string): NodeCapability => ({
      node,
      runtime: ["native", "wasm"],
      system_ops: ["source.dataset@1.0.0", "seal.envelope@1.0.0"],
      whitelist_digests: [],
      tee: null,
      protocols: [],
    });
    const teeCapability = (node: string): NodeCapability => ({
      node,
      runtime: ["native", "wasm"],
      system_ops: ["declassify.small_cell@1.0.0"],
      whitelist_digests: [],
      tee: { kind: "tdx", min_tcb: "3.1.0" },
      protocols: [],
    });
    const compiled = await jobs.compile({
      jobId: job.id,
      capabilities: new Map<string, NodeCapability>([
        ...HOLDER_URNS.map((node) => [node, holderCapability(node)] as const),
        [TEE1, teeCapability(TEE1)],
        [TEE2, teeCapability(TEE2)],
      ]),
      jobNotBefore: "2026-09-24T00:00:00.000Z",
      jobNotAfter: "2026-10-24T00:00:00.000Z",
    });
    expect(compiled.job.status).toBe("COMPILED");
    // 两个可信空间节点各自拿到自己的 pair + dec（互相看不到对方的阶段）
    for (const group of groups) {
      const fragment = compiled.fragments.find((f) => f.node === group.node)!;
      expect(fragment.stages.map((s) => s.id).sort()).toEqual(
        [group.pair, group.dec].sort(),
      );
    }

    // ② 要约：六个片段节点都要签；两个节点各自冻结自己的执行环境期望
    const { core } = await tickets.offerTickets({
      jobId: job.id,
      notBefore: "2026-09-24T00:00:00.000Z",
      notAfter: "2026-10-24T00:00:00.000Z",
    });
    expect(Object.keys(core.attestation ?? {}).sort()).toEqual(
      [TEE1, TEE2].sort(),
    );
    const offered = await outboxRepo.find({
      where: { msg_type: "PlanFragmentOffer" },
    });
    expect(offered.map((r: { receiver: string }) => r.receiver).sort()).toEqual(
      [...HOLDER_URNS, TEE1, TEE2].sort(),
    );

    const signerKeys = new Map<
      string,
      { privateKey: string; publicKey: string }
    >([
      ...HOLDER_URNS.map((urn, index) => [urn, holderKeys[index]] as const),
      [TEE1, tee1Keys],
      [TEE2, tee2Keys],
    ]);
    for (const [node, keys] of signerKeys) {
      const snapshot = canonicalSm3({ dataset: node, stages: [] });
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

    // ③ 各院 source → seal（seal 后把 C2 信封中继给本组节点）
    await dispatch();
    for (const [index, group] of groups.entries()) {
      for (const [i, holder] of group.holders.entries()) {
        const keys = holderKeys[index * 2 + i];
        const srcStage = compiled.fragments
          .find((f) => f.node === holder.urn)!
          .stages.find((s) => s.op.startsWith("source.dataset"))!;
        await reportStage({
          from: holder.urn,
          keys,
          stageId: srcStage.id,
          label: "C0",
          digest: canonicalSm3({ dataset: holder.product, rows: 3 }),
        });
      }
    }
    await dispatch();
    for (const [index, group] of groups.entries()) {
      for (const [i, holder] of group.holders.entries()) {
        const keys = holderKeys[index * 2 + i];
        const sealStage = compiled.fragments
          .find((f) => f.node === holder.urn)!
          .stages.find((s) => s.op.startsWith("seal.envelope"))!;
        const ciphertext = Buffer.from(`sealed-${holder.product}`).toString(
          "base64",
        );
        const envelopeBody = {
          envelope: "mdop.env/1.0",
          payload: {
            cipher: "AES-256-GCM",
            ciphertext_ref: `ref-${holder.product}`,
            digest: `sm3:${sm3Hex(Buffer.from(ciphertext, "base64"))}`,
          },
          wrapped_key: { kms: "kms-1", key_id: `key-${holder.product}` },
          policy: {
            contract: CONTRACT,
            purpose: ["RWS.EFFECTIVENESS"],
            allowed_ops: [PAIR_OP, DECLASSIFY_OP],
            attestation_policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
            export: "C3_only",
            not_after: "2026-10-24T00:00:00.000Z",
          },
          watermark: `wm:site-${holder.product}:${SPACE}`,
          origin_sig: {
            signer: holder.urn,
            alg: "SM2-SM3",
            value: signCanonicalObject(
              { ref: `ref-${holder.product}` },
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
            from: holder.urn,
            keys,
            msgType: "ArtifactReady",
            jobId: job.id,
            idempotencyKey: `ready:${job.id}:${sealStage.id}`,
            body: {
              handle: {
                handle: `art://${holder.urn}/${job.id}/${sealStage.id}`,
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
            from: holder.urn,
            keys,
            msgType: "C2EnvelopeSubmit",
            jobId: job.id,
            idempotencyKey: `c2:${holder.product}`,
            body: { data_envelope: envelopeBody },
          }),
          sealed: { ciphertext, iv: "aXY=", tag: "dGFn" },
          target: group.node,
        });
        await reportStage({
          from: holder.urn,
          keys,
          stageId: sealStage.id,
          label: "C2",
          digest: canonicalSm3(envelopeBody),
        });
      }
    }
    // 两个节点各自收到**本组的**两条信封（没有串台）
    const relays1 = await outboxRepo.find({
      where: { msg_type: "C2EnvelopeRelay", receiver: TEE1 },
    });
    const relays2 = await outboxRepo.find({
      where: { msg_type: "C2EnvelopeRelay", receiver: TEE2 },
    });
    expect(relays1).toHaveLength(2);
    expect(relays2).toHaveLength(2);

    // ④ 两个节点各自 pair → decTee，各出一份 C3（分层 key 相同、计数不同）
    const payloads = [
      {
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
      },
      {
        analysisType: "paired-cohort",
        cohortSize: 4,
        exposed: 3,
        outcome: 3,
        exposedWithOutcome: 2,
        rate: 2 / 3,
        strata: [
          {
            key: "60-69|F",
            exposed: 3,
            outcome: 3,
            exposedWithOutcome: 2,
            cohortSize: 4,
            rate: 2 / 3,
          },
        ],
        buckets: [{ key: "60-69|F", count: 3, rate: 2 / 3 }],
      },
    ];
    await dispatch();
    for (const [index, group] of groups.entries()) {
      const keys = index === 0 ? tee1Keys : tee2Keys;
      const pairStage = compiled.fragments
        .find((f) => f.node === group.node)!
        .stages.find((s) => s.id === group.pair)!;
      await messages.messages({
        envelope: signedEnvelope({
          from: group.node,
          keys,
          msgType: "ArtifactReady",
          jobId: job.id,
          idempotencyKey: `ready:${job.id}:${group.pair}`,
          body: {
            handle: {
              handle: `art://${group.node}/${job.id}/${group.pair}`,
              label: "C2",
              schema: "rws.paired-cohort@1",
              digest: canonicalSm3(payloads[index]),
              producer: {
                stage: group.pair,
                op: PAIR_OP,
                op_digest: pairStage.op_digest,
              },
              ticket_id: core.ticket_id,
              expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
              stats: null,
            },
          },
        }),
      });
      await reportStage({
        from: group.node,
        keys,
        stageId: group.pair,
        label: "C2",
        digest: canonicalSm3(payloads[index]),
      });
    }
    await dispatch();
    for (const [index, group] of groups.entries()) {
      const keys = index === 0 ? tee1Keys : tee2Keys;
      const decStage = compiled.fragments
        .find((f) => f.node === group.node)!
        .stages.find((s) => s.id === group.dec)!;
      await messages.messages({
        envelope: signedEnvelope({
          from: group.node,
          keys,
          msgType: "ArtifactReady",
          jobId: job.id,
          idempotencyKey: `ready:${job.id}:${group.dec}`,
          body: {
            handle: {
              handle: `art://${group.node}/${job.id}/${group.dec}`,
              label: "C3",
              schema: "mdop.table/1.0",
              digest: canonicalSm3(payloads[index]),
              producer: {
                stage: group.dec,
                op: DECLASSIFY_OP,
                op_digest: decStage.op_digest,
              },
              ticket_id: core.ticket_id,
              expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
              stats: { row_count: 1 },
            },
          },
        }),
      });
      await messages.deliveries({
        envelope: signedEnvelope({
          from: group.node,
          keys,
          msgType: "ResultDeliver",
          jobId: job.id,
          idempotencyKey: `deliver:${job.id}:${group.dec}`,
          body: {
            handle: `art://${group.node}/${job.id}/${group.dec}`,
            digest: canonicalSm3(payloads[index]),
            label: "C3",
          },
        }),
        handle: {
          handle: `art://${group.node}/${job.id}/${group.dec}`,
          label: "C3",
          digest: canonicalSm3(payloads[index]),
        },
        payload: payloads[index],
      });
      await reportStage({
        from: group.node,
        keys,
        stageId: group.dec,
        label: "C3",
        digest: canonicalSm3(payloads[index]),
      });
    }

    // ⑤ 平台收集：两份都在才合并；按**分层 key 求和**并重算率
    const merged = await merge.mergeIfReady(
      job.id,
      l15AnalysisOf(await jobsRepo.findOne({ where: { id: job.id } })),
    );
    expect(merged.merged).toBe(true); // 两个节点都投递了 → 收集路径收齐即合并
    const result = (await merge.mergedResult(job.id)) as Record<
      string,
      unknown
    >;
    expect(result).toMatchObject({
      analysisType: "paired-cohort",
      cohortSize: 7,
      exposed: 5,
      exposedWithOutcome: 3,
    });
    expect(Number(result.rate)).toBeCloseTo(3 / 5, 10);
    const strata = result.strata as Array<{
      key: string;
      exposed: number;
      exposedWithOutcome: number;
      cohortSize: number;
    }>;
    expect(strata).toEqual([
      {
        key: "60-69|F",
        exposed: 5,
        outcome: 5,
        exposedWithOutcome: 3,
        cohortSize: 7,
        rate: 3 / 5,
      },
    ]);
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "SUCCEEDED",
    );
    // 出域物里没有主体键、没有行
    expect(JSON.stringify(result)).not.toContain("subjectKey");

    // ⑥ 销毁：两个可信空间节点 + 四家持有方都在范围内；收齐回执才 PURGED
    const { ordered } = await purge.orchestratePurge(job.id);
    expect(ordered.sort()).toEqual([...HOLDER_URNS, TEE1, TEE2].sort());
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
    // 第二个参数是**平台节点**（要从销毁范围里排除的那一个）——不是发出回执的节点
    for (const node of [...HOLDER_URNS, TEE1])
      await purge.onPurgeReceipt(
        fakeReceipt(node),
        purgeSenderCtx(node),
        PLATFORM,
      );
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "SUCCEEDED",
    );
    await purge.onPurgeReceipt(
      fakeReceipt(TEE2),
      purgeSenderCtx(TEE2),
      PLATFORM,
    );
    expect((await jobsRepo.findOne({ where: { id: job.id } })).status).toBe(
      "PURGED",
    );
  });
});
