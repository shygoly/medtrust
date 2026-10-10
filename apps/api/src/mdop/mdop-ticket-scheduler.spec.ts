import { BadRequestException } from "@nestjs/common";
import "reflect-metadata";
import {
  fragmentHash,
  holderSignAcceptance,
  participantUrn,
  parseTicketCore,
  verifyTicketForExecution,
  type TicketCore,
} from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopAttestationService } from "./mdop-attestation.service";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";

const HOSP_A = "p-demohospa";
const HOSP_B = "p-demohospb";
const NODE_A = participantUrn("sh-med", HOSP_A);
const NODE_B = participantUrn("sh-med", HOSP_B);
const PLAN_HASH = `sm3:${"a".repeat(64)}`;
const SNAPSHOT_A = `sm3:${"5".repeat(64)}`;
const SNAPSHOT_B = `sm3:${"6".repeat(64)}`;

describe("执行凭证与调度（任务 7.5 / 7.6）", () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let jobs: ReturnType<typeof mockRepo>;
  let fragments: ReturnType<typeof mockRepo>;
  let stages: ReturnType<typeof mockRepo>;
  let tickets: ReturnType<typeof mockRepo>;
  let signatures: ReturnType<typeof mockRepo>;
  let outbox: ReturnType<typeof mockRepo>;
  let certs: ReturnType<typeof mockRepo>;
  let ticketSvc: MdopTicketService;
  let scheduler: MdopSchedulerService;
  let keysA: { publicKey: string; privateKey: string };
  let keysB: { publicKey: string; privateKey: string };

  const fragment = (node: string, stageId: string) => ({
    node,
    stages: [
      {
        id: stageId,
        node,
        op: "rws.disproportionality@1.0.0",
        op_digest: "component:x@1",
        params: {},
        inputs: [],
        input_labels: ["C0"],
        output_label: "C0",
        output_schema: "mdop.table/1.0",
      },
    ],
    edges: [],
  });

  const seedJob = async (jobStatus = "COMPILED") => {
    await jobs.save(
      jobs.create({
        id: "job-1",
        purpose: "RWS.EFFECTIVENESS",
        applicant: { org: "o", project: "p" },
        contracts: ["ctr-1"],
        status: jobStatus,
        planHash: PLAN_HASH,
        logicalPlan: {},
        createdAt: new Date(),
      }),
    );
    for (const [node, stageId] of [
      [NODE_A, "sA"],
      [NODE_B, "sB"],
    ] as const) {
      await fragments.save(
        fragments.create({
          id: `job-1#${node}`,
          jobId: "job-1",
          node,
          fragment: fragment(node, stageId),
          // 片段哈希必须是真的（凭证里的哈希要和连接器重算的一致）
          fragmentHash: fragmentHash(fragment(node, stageId) as never),
        }),
      );
      await stages.save(
        stages.create({
          id: `job-1#${stageId}`,
          jobId: "job-1",
          stageId,
          node,
          opRef: "rws.disproportionality@1.0.0",
          opDigest: "component:x@1",
          params: {},
          inputs: [],
          outputLabel: "C0",
          outputSchema: "mdop.table/1.0",
          status: "PENDING",
          attempt: 0,
        }),
      );
    }
  };

  const offer = () =>
    ticketSvc.offerTickets({
      jobId: "job-1",
      notBefore: "2026-09-24T00:00:00.000Z",
      notAfter: "2026-10-24T00:00:00.000Z",
    });

  const accept = async (
    core: TicketCore,
    signer: string,
    keys: typeof keysA,
    snapshot: string,
  ) =>
    ticketSvc.accept(
      {
        jobId: "job-1",
        ticketId: core.ticket_id,
        core,
        snapshot,
        signer,
        holderSignature: holderSignAcceptance(
          core,
          snapshot,
          signer,
          keys.privateKey,
          keys.publicKey,
        ).sig,
      },
      { urn: signer, publicKey: keys.publicKey },
    );

  beforeEach(async () => {
    process.env.SPACE_ID = "sh-med";
    gm = new GMCryptoService();
    ca = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    await ca.onModuleInit();
    jobs = mockRepo();
    fragments = mockRepo();
    stages = mockRepo();
    tickets = mockRepo();
    signatures = mockRepo();
    outbox = mockRepo();
    certs = mockRepo();
    ticketSvc = new MdopTicketService(
      gm,
      ca,
      jobs,
      fragments,
      stages,
      tickets,
      signatures,
      outbox,
      certs,
    );
    // 调度器在作业失败时触发销毁编排（§7.8）
    const purge = new MdopPurgeService(jobs, fragments, outbox, mockRepo());
    scheduler = new MdopSchedulerService(
      jobs,
      stages,
      outbox,
      ticketSvc,
      purge,
    );
    keysA = gm.generateSM2KeyPair();
    keysB = gm.generateSM2KeyPair();
    await certs.save(
      certs.create({
        sm2Fingerprint: "SM2:A",
        participantId: HOSP_A,
        connectorId: "c-a",
        spaceId: "sh-med",
        subjectPublicKey: keysA.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
    await certs.save(
      certs.create({
        sm2Fingerprint: "SM2:B",
        participantId: HOSP_B,
        connectorId: "c-b",
        spaceId: "sh-med",
        subjectPublicKey: keysB.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );
  });

  afterEach(() => {
    delete process.env.SPACE_ID;
  });

  it("发要约：每节点一份，只含本方片段 + 全量哈希表；作业进 NEGOTIATING", async () => {
    await seedJob();
    const { core, offeredNodes } = await offer();
    expect(offeredNodes.sort()).toEqual([NODE_A, NODE_B].sort());
    const msgs = await outbox.find();
    expect(msgs).toHaveLength(2);
    for (const msg of msgs) {
      expect(msg.msg_type).toBe("PlanFragmentOffer");
      const target = msg.receiver === NODE_A ? NODE_A : NODE_B;
      const other = target === NODE_A ? NODE_B : NODE_A;
      expect(msg.body.fragment.node).toBe(target);
      // 只给哈希表，不给对方片段内容
      expect(Object.keys(msg.body.fragments).sort()).toEqual(
        [NODE_A, NODE_B].sort(),
      );
      expect(JSON.stringify(msg.body.fragment)).not.toContain(other);
    }
    const job = await jobs.findOne({ where: { id: "job-1" } });
    expect(job.status).toBe("NEGOTIATING");
    expect(parseTicketCore(core).plan_hash).toBe(PLAN_HASH);
  });

  it("全部接受 → 签发凭证并下发；凭证含双方签名与快照，平台签名可验", async () => {
    await seedJob();
    const { core } = await offer();
    expect(await accept(core, NODE_A, keysA, SNAPSHOT_A)).toEqual({
      status: "COLLECTING",
    });
    expect(await accept(core, NODE_B, keysB, SNAPSHOT_B)).toEqual({
      status: "TICKETED",
    });

    const job = await jobs.findOne({ where: { id: "job-1" } });
    expect(job.status).toBe("TICKETED");
    const issued = await ticketSvc.issuedTicket("job-1");
    expect(issued).not.toBeNull();
    expect(issued!.signatures.filter((s) => s.role === "holder")).toHaveLength(
      2,
    );
    expect(issued!.signatures.find((s) => s.signer === NODE_A)!.snapshot).toBe(
      SNAPSHOT_A,
    );

    // 平台签名用平台节点公钥验得过；用 CA 根钥验不过（用途互斥）
    const platformSig = issued!.signatures.find((s) => s.role === "platform")!;
    expect(
      ca.verifyObjectWith("platform-node", issued!.core, platformSig.sig),
    ).toBe(true);
    expect(
      ca.verifyObjectWith("certificate", issued!.core, platformSig.sig),
    ).toBe(false);

    // 连接器侧执行前校验：给 A 的凭证能通过（含快照绑定）
    const fragA = (
      await fragments.findOne({ where: { id: `job-1#${NODE_A}` } })
    ).fragment;
    expect(() =>
      verifyTicketForExecution({
        ticket: issued!,
        node: NODE_A,
        fragment: fragA as never,
        nodePublicKey: keysA.publicKey,
        platformPublicKey: ca.platformNodePublicKey,
        platformParty: participantUrn("sh-med", "platform"),
        now: new Date("2026-09-25T00:00:00.000Z"),
        recomputedSnapshot: SNAPSHOT_A,
      }),
    ).not.toThrow();

    const issueMsgs = (await outbox.find()).filter(
      (m) => m.msg_type === "ExecutionTicketIssue",
    );
    expect(issueMsgs.map((m) => m.receiver).sort()).toEqual(
      [NODE_A, NODE_B].sort(),
    );
  });

  it("任一院拒绝 → 作业 REJECTED、通知他方作废、且没有任何 StageDispatch", async () => {
    await seedJob();
    const { core } = await offer();
    await accept(core, NODE_A, keysA, SNAPSHOT_A);
    const out = await ticketSvc.reject(
      {
        jobId: "job-1",
        ticketId: core.ticket_id,
        signer: NODE_B,
        code: "E_PURPOSE_MISMATCH",
        message: "用途不符",
      },
      { urn: NODE_B, publicKey: keysB.publicKey },
    );
    expect(out.status).toBe("REJECTED");
    const job = await jobs.findOne({ where: { id: "job-1" } });
    expect(job.status).toBe("REJECTED");
    expect(job.rejectReason).toContain("E_PURPOSE_MISMATCH");
    const msgs = await outbox.find();
    expect(
      msgs.some((m) => m.msg_type === "JobAbort" && m.receiver === NODE_A),
    ).toBe(true);
    expect(msgs.some((m) => m.msg_type === "StageDispatch")).toBe(false);
  });

  it("复核超时 → 视同拒绝，作业 REJECTED", async () => {
    await seedJob();
    await offer();
    await ticketSvc.expireNegotiation("job-1");
    const job = await jobs.findOne({ where: { id: "job-1" } });
    expect(job.status).toBe("REJECTED");
    expect(job.rejectReason).toContain("超时");
  });

  it("凭证核心被改动 / 用别家密钥签 → 拒", async () => {
    await seedJob();
    const { core } = await offer();
    const tampered = {
      ...core,
      plan_hash: `sm3:${"9".repeat(64)}`,
    } as TicketCore;
    await expect(accept(tampered, NODE_A, keysA, SNAPSHOT_A)).rejects.toThrow(
      BadRequestException,
    );
    // A 用 B 的密钥签 → 验签失败
    await expect(
      ticketSvc.accept(
        {
          jobId: "job-1",
          ticketId: core.ticket_id,
          core,
          snapshot: SNAPSHOT_A,
          signer: NODE_A,
          holderSignature: holderSignAcceptance(
            core,
            SNAPSHOT_A,
            NODE_A,
            keysB.privateKey,
            keysB.publicKey,
          ).sig,
        },
        { urn: NODE_A, publicKey: keysA.publicKey },
      ),
    ).rejects.toMatchObject({ code: "E_AUTH_INVALID" });
  });

  /**
   * 铺一个「上游是 C2 的阶段」：示范甲封存（已完成）→ 可信空间节点内降密（待下发）。
   * 只有这种阶段才会触发下发前的证明复检（规格「证明在编译后过期」）。
   */
  const seedC2Dispatchable = async (jobId: string): Promise<string> => {
    const TEE = participantUrn("sh-med", "tee-1");
    const frag = fragment(TEE, "decTee");
    await jobs.save(
      jobs.create({
        id: jobId,
        purpose: "RWS.EFFECTIVENESS",
        applicant: { org: "o", project: "p" },
        contracts: ["ctr-1"],
        status: "TICKETED",
        planHash: PLAN_HASH,
        logicalPlan: {},
        createdAt: new Date(),
      }),
    );
    await fragments.save(
      fragments.create({
        id: `${jobId}#${TEE}`,
        jobId,
        node: TEE,
        fragment: frag,
        fragmentHash: fragmentHash(frag as never),
      }),
    );
    await stages.save(
      stages.create({
        id: `${jobId}#sealA`,
        jobId,
        stageId: "sealA",
        node: NODE_A,
        opRef: "seal.envelope@1.0.0",
        opDigest: "component:seal@1",
        params: {},
        inputs: [],
        outputLabel: "C2",
        outputSchema: "mdop.env/1.0",
        status: "SUCCEEDED",
        attempt: 1,
      }),
    );
    await stages.save(
      stages.create({
        id: `${jobId}#decTee`,
        jobId,
        stageId: "decTee",
        node: TEE,
        opRef: "declassify.small_cell@1.0.0",
        opDigest: "component:gate@1",
        params: {},
        inputs: [{ from: "sealA" }],
        outputLabel: "C3",
        outputSchema: "mdop.table/1.0",
        status: "PENDING",
        attempt: 0,
      }),
    );
    await tickets.save(
      tickets.create({
        ticketId: `tkt-${jobId}`,
        jobId,
        core: {
          ticket_id: `tkt-${jobId}`,
          job_id: jobId,
          plan_hash: PLAN_HASH,
          fragments: { [TEE]: fragmentHash(frag as never) },
          not_before: "2026-09-24T00:00:00.000Z",
          not_after: "2026-10-24T00:00:00.000Z",
        },
        signatures: [],
        status: "ISSUED",
      }),
    );
    return TEE;
  };

  it("调度器的可选注入在**类型元数据**里是值类型（`import type` 会让 Nest 启动即报无法解析依赖）", () => {
    const types = Reflect.getMetadata(
      "design:paramtypes",
      MdopSchedulerService,
    ) as unknown[];
    expect(types).toContain(MdopContractService);
    expect(types).toContain(MdopAttestationService);
  });

  it("C2 阶段下发前复检证明登记：服务缺失即不下发（fail-closed），作业失败并触发销毁", async () => {
    const TEE = await seedC2Dispatchable("job-c2-missing");
    const dispatched = await scheduler.dispatchReadyStages("job-c2-missing");
    expect(dispatched).toBe(0);
    expect(
      await outbox.find({ where: { msg_type: "StageDispatch" } }),
    ).toHaveLength(0);
    expect(
      (await stages.findOne({ where: { id: "job-c2-missing#decTee" } })).status,
    ).toBe("FAILED");
    expect(
      (await jobs.findOne({ where: { id: "job-c2-missing" } })).status,
    ).toBe("FAILED");
    // 终态即触发销毁编排：给该节点发了 PurgeOrder（收齐回执才 PURGED）
    expect(
      (await outbox.find({ where: { msg_type: "PurgeOrder", receiver: TEE } }))
        .length,
    ).toBeGreaterThan(0);
  });

  it("C2 阶段下发前复检证明登记：登记有效才下发；登记过期则不下发（E_ATTESTATION_FAILED）", async () => {
    const policy = { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } };
    const contractsStub = {
      describeForNode: async () => ({
        contract: { contract_id: "ctr-1", attestation_policy: policy },
        recipients: [NODE_A],
      }),
    } as never;
    const purge = new MdopPurgeService(jobs, fragments, outbox, mockRepo());

    // ① 登记有效 → 正常下发
    const okTee = await seedC2Dispatchable("job-c2-ok");
    const okScheduler = new MdopSchedulerService(
      jobs,
      stages,
      outbox,
      ticketSvc,
      purge,
      contractsStub,
      {
        assertUsableForC2: async () => ({}),
      } as never,
    );
    expect(await okScheduler.dispatchReadyStages("job-c2-ok")).toBe(1);
    const dispatched = await outbox.find({
      where: {
        msg_type: "StageDispatch",
        receiver: okTee,
        job_id: "job-c2-ok",
      },
    });
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0].body as { stage_id: string }).stage_id).toBe(
      "decTee",
    );
    expect((await jobs.findOne({ where: { id: "job-c2-ok" } })).status).toBe(
      "RUNNING",
    );

    // ② 登记过期（编译到下发之间过期）→ 不下发、阶段与作业 FAILED
    const expiredTee = await seedC2Dispatchable("job-c2-expired");
    const expiredScheduler = new MdopSchedulerService(
      jobs,
      stages,
      outbox,
      ticketSvc,
      purge,
      contractsStub,
      {
        assertUsableForC2: async () => {
          throw new Error("该节点没有有效的证明登记（未登记或已过期）");
        },
      } as never,
    );
    expect(await expiredScheduler.dispatchReadyStages("job-c2-expired")).toBe(
      0,
    );
    const expiredDispatches = await outbox.find({
      where: {
        msg_type: "StageDispatch",
        receiver: expiredTee,
        job_id: "job-c2-expired",
      },
    });
    expect(expiredDispatches).toHaveLength(0);
    const failedStage = await stages.findOne({
      where: { id: "job-c2-expired#decTee" },
    });
    expect(failedStage.status).toBe("FAILED");
    expect(String(failedStage.lastError)).toContain("E_ATTESTATION_FAILED");
    expect(
      (await jobs.findOne({ where: { id: "job-c2-expired" } })).status,
    ).toBe("FAILED");
  });

  it("可信空间节点与医院节点同构：调度会把 StageDispatch 下发给它、销毁指令也覆盖它", async () => {
    const TEE = "urn:tds:sh-med:participant:tee-1";
    // 一个作业：示范甲片段（封存）+ 可信空间节点片段（节点内降密）
    await jobs.save(
      jobs.create({
        id: "job-2",
        purpose: "RWS.EFFECTIVENESS",
        applicant: { org: "o", project: "p" },
        contracts: ["ctr-1"],
        status: "COMPILED",
        planHash: PLAN_HASH,
        logicalPlan: {},
        createdAt: new Date(),
      }),
    );
    for (const [node, stageId] of [
      [NODE_A, "sA"],
      [TEE, "sT"],
    ] as const) {
      await fragments.save(
        fragments.create({
          id: `job-2#${node}`,
          jobId: "job-2",
          node,
          fragment: fragment(node, stageId),
          fragmentHash: fragmentHash(fragment(node, stageId) as never),
        }),
      );
      await stages.save(
        stages.create({
          id: `job-2#${stageId}`,
          jobId: "job-2",
          stageId,
          node,
          opRef: "rws.disproportionality@1.0.0",
          opDigest: "component:x@1",
          params: {},
          inputs: [],
          outputLabel: "C0",
          outputSchema: "mdop.table/1.0",
          status: "PENDING",
          attempt: 0,
        }),
      );
    }
    const teeKeys = gm.generateSM2KeyPair();
    await certs.save(
      certs.create({
        sm2Fingerprint: "SM2:TEE",
        participantId: "tee-1",
        connectorId: "c-tee",
        spaceId: "sh-med",
        subjectPublicKey: teeKeys.publicKey,
        validUntil: new Date("2027-09-24T00:00:00.000Z"),
        revoked: false,
      }),
    );

    const { core, offeredNodes } = await ticketSvc.offerTickets({
      jobId: "job-2",
      notBefore: "2026-09-24T00:00:00.000Z",
      notAfter: "2026-10-24T00:00:00.000Z",
    });
    // 要约发给持有方（含可信空间节点）；平台的合并片段不发
    expect(offeredNodes).toContain(TEE);
    for (const [signer, keys, snapshot] of [
      [NODE_A, keysA, SNAPSHOT_A],
      [TEE, teeKeys, SNAPSHOT_B],
    ] as const) {
      await ticketSvc.accept(
        {
          jobId: "job-2",
          ticketId: core.ticket_id,
          core,
          snapshot,
          signer,
          holderSignature: holderSignAcceptance(
            core,
            snapshot,
            signer,
            keys.privateKey,
            keys.publicKey,
          ).sig,
        },
        { urn: signer, publicKey: keys.publicKey },
      );
    }

    // 调度：两个阶段各下发一次，其中一条发给可信空间节点
    expect(await scheduler.dispatchReadyStages("job-2")).toBe(2);
    const dispatches = (await outbox.find()).filter(
      (m) => m.msg_type === "StageDispatch",
    );
    expect(dispatches.map((m) => m.receiver).sort()).toEqual(
      [NODE_A, TEE].sort(),
    );

    // 终态销毁：PurgeOrder 覆盖可信空间节点（平台自己的片段不需要销毁）
    await jobs.update({ id: "job-2" }, { status: "SUCCEEDED" });
    const purgeSvc = new MdopPurgeService(jobs, fragments, outbox, mockRepo());
    const { ordered } = await purgeSvc.orchestratePurge("job-2");
    expect(ordered.sort()).toEqual([NODE_A, TEE].sort());
  });

  it("调度：凭证齐备后下发 StageDispatch（带幂等键），重复调用不重复下发", async () => {
    await seedJob();
    const { core } = await offer();
    await accept(core, NODE_A, keysA, SNAPSHOT_A);
    await accept(core, NODE_B, keysB, SNAPSHOT_B);

    expect(await scheduler.dispatchReadyStages("job-1")).toBe(2);
    const first = (await outbox.find()).filter(
      (m) => m.msg_type === "StageDispatch",
    );
    expect(first).toHaveLength(2);
    expect(first[0].idempotency_key).toBe("job-1:sA:1");
    expect(first[0].body.ticket_id).toBe(core.ticket_id);

    expect(await scheduler.dispatchReadyStages("job-1")).toBe(0);
    expect(
      (await outbox.find()).filter((m) => m.msg_type === "StageDispatch"),
    ).toHaveLength(2);
    const job = await jobs.findOne({ where: { id: "job-1" } });
    expect(job.status).toBe("RUNNING");
  });

  it("可重试错误按 30/60/120 退避重试；超过次数 → 阶段与作业 FAILED", async () => {
    await seedJob();
    const { core } = await offer();
    await accept(core, NODE_A, keysA, SNAPSHOT_A);
    await accept(core, NODE_B, keysB, SNAPSHOT_B);
    await scheduler.dispatchReadyStages("job-1");

    const attempts: Array<{ stage: string; retryAfterSeconds?: number }> = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await scheduler.onStageStatus({
        jobId: "job-1",
        stageId: "sA",
        reporter: NODE_A,
        status: "FAILED",
        code: "E_TIMEOUT",
      });
      attempts.push(r);
      // RETRYING → RUNNING 由调度器重新下发驱动（新 attempt，不复用中间产物）
      if (r.stage === "RETRYING") await scheduler.dispatchReadyStages("job-1");
    }
    // 退避序列 30 / 60 / 120，第 4 次超过重试次数直接失败
    expect(attempts.map((a) => a.retryAfterSeconds)).toEqual([
      30,
      60,
      120,
      undefined,
    ]);
    expect(attempts[3]).toMatchObject({ stage: "FAILED", jobStatus: "FAILED" });
    const stage = await stages.findOne({ where: { id: "job-1#sA" } });
    expect(stage.status).toBe("FAILED");
    const job = await jobs.findOne({ where: { id: "job-1" } });
    expect(job.status).toBe("FAILED");
  });

  it("不可重试错误直接失败（不重试）", async () => {
    await seedJob();
    const { core } = await offer();
    await accept(core, NODE_A, keysA, SNAPSHOT_A);
    await accept(core, NODE_B, keysB, SNAPSHOT_B);
    await scheduler.dispatchReadyStages("job-1");
    const out = await scheduler.onStageStatus({
      jobId: "job-1",
      stageId: "sB",
      reporter: NODE_B,
      status: "FAILED",
      code: "E_OP_REVOKED",
    });
    expect(out).toMatchObject({ stage: "FAILED", jobStatus: "FAILED" });
  });

  it("接受/拒绝不得替别家发：signer 与已认证发送方不符 → 拒（拒绝尤其不能替，会把作业作废）", async () => {
    await seedJob();
    const { core } = await offer();
    const keysBForSign = keysB;

    // ① 接受：A 的密钥签、但消息自称是 B（身份不符）→ 拒，不能「记到 B 账上」
    await expect(
      ticketSvc.accept(
        {
          jobId: "job-1",
          ticketId: core.ticket_id,
          core,
          snapshot: SNAPSHOT_A,
          signer: NODE_B,
          holderSignature: holderSignAcceptance(
            core,
            SNAPSHOT_A,
            NODE_B,
            keysBForSign.privateKey,
            keysBForSign.publicKey,
          ).sig,
        },
        { urn: NODE_A },
      ),
    ).rejects.toMatchObject({ code: "E_AUTH_INVALID" });

    // ② 拒绝：协议里 reject 没有签名，身份绑定是**唯一**可控点——
    //    不绑的话任何参与方都能替别家拒绝，把整个作业打成 REJECTED 并向各院广播 JobAbort
    await expect(
      ticketSvc.reject(
        {
          jobId: "job-1",
          ticketId: core.ticket_id,
          signer: NODE_B,
          code: "E_PURPOSE_MISMATCH",
        },
        { urn: NODE_A },
      ),
    ).rejects.toMatchObject({ code: "E_AUTH_INVALID" });
    expect((await jobs.findOne({ where: { id: "job-1" } })).status).not.toBe(
      "REJECTED",
    );
    expect(
      (await outbox.find()).some(
        (m: { msg_type: string }) => m.msg_type === "JobAbort",
      ),
    ).toBe(false);
  });

  it("阶段状态不得替别家上报：上报方不是该阶段的落点节点 → 拒（状态机一动不动）", async () => {
    await seedJob();
    const { core } = await offer();
    await accept(core, NODE_A, keysA, SNAPSHOT_A);
    await accept(core, NODE_B, keysB, SNAPSHOT_B);
    await scheduler.dispatchReadyStages("job-1");

    const before = await stages.findOne({ where: { id: "job-1#sA" } });
    // sA 落在 NODE_A，却由 NODE_B 上报「成功」——若不核对身份，平台会据此解锁下游下发
    await expect(
      scheduler.onStageStatus({
        jobId: "job-1",
        stageId: "sA",
        reporter: NODE_B,
        status: "SUCCEEDED",
      }),
    ).rejects.toThrow(/不得替别家上报阶段状态/);
    const after = await stages.findOne({ where: { id: "job-1#sA" } });
    expect(after.status).toBe(before.status);

    // 同样不得替别家把阶段刷成失败（那会把作业打成 FAILED）
    await expect(
      scheduler.onStageStatus({
        jobId: "job-1",
        stageId: "sA",
        reporter: NODE_B,
        status: "FAILED",
        code: "E_OP_REVOKED",
      }),
    ).rejects.toThrow(/不得替别家上报阶段状态/);
    expect((await jobs.findOne({ where: { id: "job-1" } })).status).not.toBe(
      "FAILED",
    );
  });
});
