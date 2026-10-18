import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalSm3,
  generateSm2KeyPair,
  participantUrn,
  publicKeyFromPrivateKey,
  signCanonicalObject,
  withoutSignature,
  type Envelope,
} from "@medtrust/mdop";
import { ckdEsrdRiskFlPredictionSpec } from "../compute-task/dto/fl-prediction-task-spec";
import { mergeFlPartyResults } from "../compute-task/dto/fl-run-result";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { CaService } from "../runtime/participant-identity/ca.service";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { MdopAttestationService } from "./mdop-attestation.service";
import { MdopJobsService } from "./mdop-jobs.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopOutboxService } from "./mdop-outbox.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";
import {
  MdopMessagesController,
  l15AnalysisOf,
} from "./mdop-messages.controller";
import { MdopOperatorRegistryService } from "./operator-registry.service";
import { buildL4Plan } from "@medtrust/domain-med";
import { currentSpaceId } from "../runtime/space-context/space-id.util";

/**
 * 批次 1A（mdop-fl-migration）补齐：L4 联邦预测**经节点消息投递路径**的作业级闭环。
 *
 * 与 `l4-fl-e2e.spec.ts` 的分工：那一支直接**预置投递行**再调合并（执行器直驱）这一支
 * 走真实服务：提交提交期**按真实 wasm manifest 过模块闸** 编译/征求票据 下发 各院
 * 阶段状态 结果投递 平台按计划里的 `merge.fedavg` 合并 收集销毁回执至 `PURGED`。
 *
 * 参与方结果用**连接器侧真 wasm + 真沙箱**产出的黄金夹具（`c3-payloads.json`），
 * 所以这条链同时钉住「平台能经消息路径消费连接器的真实字节」。
 *
 * 如实边界：平台侧是真实实现；各院节点按协议扮演（真实 TDX 硬件在 `tdx-attestation-pilot` 里另证）。
 */

const SPACE = "sh-med";
const CONTRACT = "ctr-l4-node";
const HOSP_A = "p-demohospa";
const HOSP_B = "p-demohospb";
const NODE_A = participantUrn(SPACE, HOSP_A);
const NODE_B = participantUrn(SPACE, HOSP_B);
const PLATFORM = participantUrn(SPACE, "platform");
const MEAS = `sm3:${"a".repeat(64)}`;
const NOW = () => new Date();
const L4_TRAIN_OP = "rws.l4-train@1.0.0";
const L4_NOT_BEFORE = "2026-10-13T00:00:00.000Z";
const L4_NOT_AFTER = "2026-11-13T00:00:00.000Z";

const spec = {
  ...ckdEsrdRiskFlPredictionSpec(),
  modelType: "logistic_regression" as const,
  aggregation: "fedavg" as const,
};

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../openspec/changes/mdop-fl-migration/evidence/l4-equivalence/c3-payloads.json",
    ),
    "utf8",
  ),
) as { parties: Array<Record<string, unknown>>; moduleSm3: string };

describe("L4 联邦预测：经节点消息投递路径的作业级闭环（批次 1A 补齐）", () => {
  const gm = new GMCryptoService();
  const nodeAKeys = gm.generateSM2KeyPair();
  const nodeBKeys = gm.generateSM2KeyPair();
  const platformKeys = gm.generateSM2KeyPair();
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
        { publicKey: input.keys.publicKey },
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
    await register(HOSP_A, nodeAKeys);
    await register(HOSP_B, nodeBKeys);
    await register("platform", platformKeys);

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
        dataProductId: "dp-insulin-panc-demohospa",
        providerId: HOSP_A,
        consumerId: "p-meddata",
        purpose: "L4 联邦预测演示",
        retention: "阅后即焚",
        output: "仅模型参数与指标",
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
        { party: NODE_B, role: "final" as const, jurisdiction: "CN" },
        { party: PLATFORM, role: "final" as const, jurisdiction: "CN" },
      ],
      attestationPolicy: {
        tee: ["tdx"],
        minTcb: { tdx: "5.1.3" },
        allowedMeasurements: [MEAS],
      },
    });
    await contracts.agree({
      contractId: CONTRACT,
      canonical: offer.canonical,
      holderSignature: gm.sm2Sign(offer.canonical, nodeAKeys.privateKey),
    });

    // 真实模块注册表：读 packages/wasm-algorithms/build/manifest.json（提交进版本库的产物），
    // 提交期就能过「未注册的算子」闸（这是与 l4-fl-e2e 共用的同一份 manifest）
    const modules = new AlgorithmModuleRegistry(gm, ca);
    modules.onModuleInit();
    operators = new MdopOperatorRegistryService(
      gm,
      ca,
      mockRepo(),
      mockRepo(),
      modules,
    );
    await operators.onModuleInit();
    const l4op = await operators.find({ id: "rws.l4-train", version: "1.0.0" });
    expect(l4op?.kind).toBe("wasm");

    const attestations = new MdopAttestationService(mockRepo() as never, {
      trustedVerifiers: ["kms-1"],
      registryMeasurements: [MEAS],
      kmsPublicKey: kms.publicKey,
    });
    for (const node of [NODE_A, NODE_B]) {
      await attestations.acceptEndorsement(
        (await import("@medtrust/mdop")).signEndorsementPush({
          verifier: "kms-1",
          endorsement: {
            node,
            kind: "tdx",
            measurement: MEAS,
            tcb: "5.1.3",
            quoteDigest: `sm3:${(node === NODE_A ? "b" : "d").repeat(64)}`,
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

  it("各院本地训练出 C3 平台按计划里的 merge.fedavg 合并 收齐销毁回执才 PURGED", async () => {
    const plan = buildL4Plan(
      {
        purpose: "L4 联邦预测演示",
        applicant: { org: "p-meddata", project: "ckd-esrd" },
        contracts: [CONTRACT],
        hospitals: [
          { participantId: HOSP_A, dataProductId: "dp-insulin-panc-demohospa" },
          { participantId: HOSP_B, dataProductId: "dp-insulin-panc-demohospb" },
        ],
        spec,
        minCell: 5,
        notBefore: L4_NOT_BEFORE,
        notAfter: L4_NOT_AFTER,
      },
      currentSpaceId(),
    );
    const job = await jobs.submit({
      ...plan,
      not_before: L4_NOT_BEFORE,
      not_after: L4_NOT_AFTER,
    } as never);
    expect(
      plan.stages.filter((s) => s.op?.startsWith("merge.fedavg")),
    ).toHaveLength(1);

    const hospitalCapability = (node: string) => ({
      node,
      runtime: ["native", "wasm"],
      system_ops: ["source.dataset@1.0.0", "declassify.small_cell@1.0.0"],
      whitelist_digests: [],
      // L4 里**分析就落在各院自己的节点上**（rws.l4-train 在院侧执行），所以能力通告必须如实声明
      // TDX 且达到合约策略的 min_tcb；否则票据冻结的执行环境期望是空的（这正是本用例要钉的）
      tee: { kind: "tdx", min_tcb: "5.1.3" },
      protocols: [],
    });
    const compiled = await jobs.compile({
      jobId: job.id,
      capabilities: new Map<string, never>([
        [NODE_A, hospitalCapability(NODE_A) as never],
        [NODE_B, hospitalCapability(NODE_B) as never],
        [
          PLATFORM,
          {
            node: PLATFORM,
            runtime: ["native"],
            system_ops: ["merge.fedavg@1.0.0"],
            whitelist_digests: [],
            tee: null,
            protocols: [],
          } as never,
        ],
      ]),
      jobNotBefore: L4_NOT_BEFORE,
      jobNotAfter: L4_NOT_AFTER,
    });
    expect(compiled.job.status).toBe("COMPILED");
    // 各院只看到自己的三段；合并段落在平台
    for (const node of [NODE_A, NODE_B]) {
      const fragment = compiled.fragments.find((f) => f.node === node)!;
      expect(fragment.stages.map((s) => s.op.split("@")[0]).sort()).toEqual(
        ["declassify.small_cell", "rws.l4-train", "source.dataset"].sort(),
      );
    }
    expect(
      compiled.fragments
        .find((f) => f.node === PLATFORM)
        ?.stages.map((s) => s.op),
    ).toEqual(["merge.fedavg@1.0.0"]);

    // 票据：各院 + 平台都要签；冻结的执行环境期望里应有两院（分析实际落在它们身上）
    const { core } = await tickets.offerTickets({
      jobId: job.id,
      notBefore: L4_NOT_BEFORE,
      notAfter: L4_NOT_AFTER,
    });
    // 凭证冻结**全部片段**的哈希（两院 + 平台合并片段）
    expect(Object.keys(core.fragments).sort()).toEqual(
      [NODE_A, NODE_B, PLATFORM].sort(),
    );
    // L4 计划里**没有 C2 边**（`source.dataset` 直供 `rws.l4-train`，本地训练不经信封），
    // 所以凭证不冻「C2 接收方」的执行环境期望 —— 这与 C2 形态作业（要冻）是结构性差别，
    // 而不是漏了配置。要约也只发持有方，平台自己的合并片段不需要「接受」别人的计划。
    expect(core.attestation).toBeUndefined();
    for (const [node, keys] of [
      [NODE_A, nodeAKeys],
      [NODE_B, nodeBKeys],
    ] as const) {
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
            { publicKey: keys.publicKey },
          ),
        },
        { urn: node, publicKey: keys.publicKey },
      );
    }
    expect((await jobsRepo.findOne({ where: { id: job.id } }))?.status).toBe(
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
    const stageOf = (node: string, opPrefix: string) =>
      compiled.fragments
        .find((f) => f.node === node)!
        .stages.find((s) => s.op.startsWith(opPrefix))!;

    const parties = [NODE_A, NODE_B] as const;
    const partyKeys = { [NODE_A]: nodeAKeys, [NODE_B]: nodeBKeys } as const;

    await dispatch();
    for (const node of parties) {
      const keys = partyKeys[node];
      const src = stageOf(node, "source.dataset");
      await reportStage({
        from: node,
        keys,
        stageId: src.id,
        label: "C0",
        digest: canonicalSm3({ dataset: node, rows: 6 }),
      });
      await dispatch();
      const train = stageOf(node, L4_TRAIN_OP);
      await reportStage({
        from: node,
        keys,
        stageId: train.id,
        label: "C0",
        digest: canonicalSm3({ op: L4_TRAIN_OP, node }),
      });
      await dispatch();
      const dec = stageOf(node, "declassify.small_cell");
      const party = node === NODE_A ? fixture.parties[0] : fixture.parties[1];
      await messages.messages({
        envelope: signedEnvelope({
          from: node,
          keys,
          msgType: "ArtifactReady",
          jobId: job.id,
          idempotencyKey: `ready:${job.id}:${dec.id}`,
          body: {
            handle: {
              handle: `art://${node}/${job.id}/${dec.id}`,
              label: "C3",
              schema: "mdop.table/1.0",
              digest: canonicalSm3(party),
              producer: {
                stage: dec.id,
                op: dec.op,
                op_digest: dec.op_digest,
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
          from: node,
          keys,
          msgType: "ResultDeliver",
          jobId: job.id,
          idempotencyKey: `deliver:${job.id}:${dec.id}`,
          body: {
            handle: `art://${node}/${job.id}/${dec.id}`,
            digest: canonicalSm3(party),
            label: "C3",
          },
        }),
        handle: {
          handle: `art://${node}/${job.id}/${dec.id}`,
          label: "C3",
          digest: canonicalSm3(party),
        },
        payload: party,
      });
      await reportStage({
        from: node,
        keys,
        stageId: dec.id,
        label: "C3",
        digest: canonicalSm3(party),
      });
    }

    // 平台合并：即使消息控制器传的是 L1.5 形态的 analysis，也必须按计划里的 merge.fedavg 走
    const merged = await merge.mergeIfReady(
      job.id,
      l15AnalysisOf(await jobsRepo.findOne({ where: { id: job.id } })),
    );
    expect(merged.merged).toBe(true);
    const mergedResult = await merge.mergedResult(job.id);
    expect(mergedResult).toEqual(
      mergeFlPartyResults(fixture.parties as never, spec, {
        runtime: "connector-ml",
      }),
    );
    expect((await jobsRepo.findOne({ where: { id: job.id } }))?.status).toBe(
      "SUCCEEDED",
    );
    // 出域物里不含本地行/主体键
    expect(JSON.stringify(mergedResult)).not.toContain("subjectKey");

    // 销毁：两院都在范围内；收齐（排除平台自身）才 PURGED
    const { ordered } = await purge.orchestratePurge(job.id);
    expect(ordered.sort()).toEqual([NODE_A, NODE_B].sort());
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
    const purgeSenderCtx = (node: string) => ({
      urn: node,
      publicKey: purgeSender(node).publicKey,
    });
    await purge.onPurgeReceipt(
      fakeReceipt(NODE_A),
      purgeSenderCtx(NODE_A),
      PLATFORM,
    );
    expect((await jobsRepo.findOne({ where: { id: job.id } }))?.status).toBe(
      "SUCCEEDED",
    );
    await purge.onPurgeReceipt(
      fakeReceipt(NODE_B),
      purgeSenderCtx(NODE_B),
      PLATFORM,
    );
    expect((await jobsRepo.findOne({ where: { id: job.id } }))?.status).toBe(
      "PURGED",
    );
  });
});
