import { participantUrn } from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import {
  BATCH_LARGE_BYTES,
  LARGE_BODY_BYTES,
  LARGE_REDELIVERY_MS,
  MdopOutboxService,
} from "./mdop-outbox.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";

/**
 * 发件箱**有界重发**与**指令撤回**（2026-10-07 真机事故回归，作业 job-muxxbwia-21abafc5）。
 *
 * 事故形态：KMS 隧道中断期间两家持有方的 `seal.envelope` 反复失败，平台按退避发了 4 个 attempt；
 * 隧道恢复后**每个 attempt 的 StageDispatch 都还在发件箱里**，持有方各封了 4 次（4 把不同的密钥），
 * 平台按「密钥 + 目标」各存一条中继 → 节点一次长轮询拿到 8 份 ~650KB 信封（5.2MB），
 * 而且**每一轮都整批重发**，直到作业 PURGED。
 *
 * 这里钉四件事：
 *  ① 阶段状态被平台接受 = 该指令已被应答 → 从发件箱撤回（不再随每轮重发、重启后也不会重跑）；
 *  ② 新 attempt 顶替旧 attempt 的指令（任何时刻一个阶段至多一条在途指令）；
 *  ③ 吃 C2 的阶段终结后，对应信封撤回；作业终态后执行类消息一律撤回；
 *  ④ 已送出的大载荷在重投间隔内不再重发全文，单批大载荷总量有上限。
 */

const SPACE = "sh-med";
const PLATFORM = participantUrn(SPACE, "platform");
const HOLDER_A = participantUrn(SPACE, "p-cdc-demo");
const HOLDER_B = participantUrn(SPACE, "p-demohospb");
const NODE = participantUrn(SPACE, "tee-node-a");
const JOB = "job-bounded";
const T0 = new Date("2026-10-07T09:48:00.000Z");

describe("发件箱有界重发与指令撤回（2026-10-07 事故回归）", () => {
  let outboxRepo: ReturnType<typeof mockRepo>;
  let jobs: ReturnType<typeof mockRepo>;
  let stages: ReturnType<typeof mockRepo>;
  let fragments: ReturnType<typeof mockRepo>;
  let outbox: MdopOutboxService;
  let scheduler: MdopSchedulerService;

  const dispatchRows = async (receiver: string, stageId?: string) =>
    (
      (await outboxRepo.find({
        where: { receiver, msg_type: "StageDispatch" },
      })) as Array<{ body: { stage_id: string; attempt: number } }>
    ).filter((r) => !stageId || r.body.stage_id === stageId);

  const relayRows = async () =>
    (await outboxRepo.find({
      where: { receiver: NODE, msg_type: "C2EnvelopeRelay" },
    })) as Array<{ id: string; body: { holder: string } }>;

  /** 一条中继行（`bytes` 控制密文体大小；真机上约 650KB）。 */
  const seedRelay = async (
    keyId: string,
    holder: string,
    bytes: number,
    createdAt: Date = T0,
    jobId = JOB,
  ) =>
    outboxRepo.save(
      outboxRepo.create({
        id: `C2EnvelopeRelay:relay:${keyId}:${NODE}`,
        msg_id: `msg-${keyId}`,
        msg_type: "C2EnvelopeRelay",
        job_id: jobId,
        receiver: NODE,
        sender: PLATFORM,
        idempotency_key: `relay:${keyId}:${NODE}`,
        body: {
          data_envelope: { wrapped_key: { key_id: keyId } },
          sealed: { ciphertext: "A".repeat(bytes), iv: "aXY=", tag: "dGFn" },
          holder,
          credential_id: "tkt-1",
        },
        createdAt,
      }),
    );

  const seedSmall = async (id: string, msgType: string, createdAt = T0) =>
    outboxRepo.save(
      outboxRepo.create({
        id: `${msgType}:${id}`,
        msg_id: `msg-${id}`,
        msg_type: msgType,
        job_id: JOB,
        receiver: NODE,
        sender: PLATFORM,
        idempotency_key: id,
        body: { ticket_id: "tkt-1" },
        createdAt,
      }),
    );

  /** 事故里的计划形状：两家各 `seal`（C2 出）→ 节点 `scri`（吃两份 C2）。 */
  const seedJob = async (status = "TICKETED") => {
    await jobs.save(
      jobs.create({
        id: JOB,
        contracts: ["ctr-1"],
        status,
        logicalPlan: {},
        createdAt: T0,
      }),
    );
    const stage = (
      stageId: string,
      node: string,
      inputs: string[],
      outputLabel: string,
    ) =>
      stages.create({
        id: `${JOB}#${stageId}`,
        jobId: JOB,
        stageId,
        node,
        opRef: "x@1.0.0",
        opDigest: "component:x@1",
        params: {},
        inputs: inputs.map((from) => ({ from })),
        outputLabel,
        outputSchema: "mdop.env/1.0",
        status: "PENDING",
        attempt: 0,
        updatedAt: T0,
      });
    await stages.save(stage("seal_a", HOLDER_A, [], "C2"));
    await stages.save(stage("seal_b", HOLDER_B, [], "C2"));
    await stages.save(stage("scri", NODE, ["seal_a", "seal_b"], "C2"));
    for (const node of [HOLDER_A, HOLDER_B, NODE])
      await fragments.save(
        fragments.create({ id: `${JOB}#${node}`, jobId: JOB, node }),
      );
  };

  beforeEach(async () => {
    process.env.SPACE_ID = SPACE;
    const gm = new GMCryptoService();
    const ca = new CaService(gm, mockRepo(), mockRepo(), SPACE);
    await ca.onModuleInit();
    outboxRepo = mockRepo();
    jobs = mockRepo();
    stages = mockRepo();
    fragments = mockRepo();
    outbox = new MdopOutboxService(
      gm,
      ca,
      outboxRepo,
      mockRepo(),
      jobs,
      mockRepo(),
    );
    scheduler = new MdopSchedulerService(
      jobs,
      stages,
      outboxRepo,
      // 凭证签发不在本用例范围：只要「已签发」
      {
        issuedTicket: async () => ({ core: { ticket_id: "tkt-1" } }),
      } as never,
      new MdopPurgeService(jobs, fragments, outboxRepo, mockRepo()),
      // C2 阶段下发前的证明复检：本用例固定为「登记有效」
      {
        describeForNode: async () => ({
          contract: { attestation_policy: { tee: ["tdx"] } },
        }),
      } as never,
      { assertUsableForC2: async () => undefined } as never,
    );
  });

  afterEach(() => {
    delete process.env.SPACE_ID;
  });

  describe("调度：状态被接受即撤回指令，新 attempt 顶替旧 attempt", () => {
    it("可重试失败被接受 → 该 attempt 的 StageDispatch 撤回；退避到点后**只有最新 attempt 一条**在途", async () => {
      await seedJob();
      expect(await scheduler.dispatchReadyStages(JOB)).toBe(2);
      expect(await dispatchRows(HOLDER_A)).toHaveLength(1);

      // 事故里隧道断了约 2 分钟，seal 连续失败 3 次；每一轮都要保证「至多一条在途指令」
      for (const attempt of [1, 2, 3]) {
        const out = await scheduler.onStageStatus({
          jobId: JOB,
          stageId: "seal_a",
          reporter: HOLDER_A,
          status: "FAILED",
          code: "E_RUNTIME",
          attempt,
        });
        expect(out.stage).toBe("RETRYING");
        // 失败已被平台接受 = 这一份指令已经得到应答：退避期间**不再**随长轮询重发
        // （否则持有方每一轮都会把旧 attempt 再跑一遍，隧道一恢复就各跑一次）
        expect(await dispatchRows(HOLDER_A, "seal_a")).toHaveLength(0);

        const stage = await stages.findOne({
          where: { id: `${JOB}#seal_a` },
        });
        const due = new Date(
          new Date(stage.updatedAt).getTime() + 121_000, // 覆盖 30/60/120 秒三档退避
        );
        expect(await scheduler.sweepRetries(due)).toBeGreaterThan(0);
        const inFlight = await dispatchRows(HOLDER_A, "seal_a");
        expect(inFlight.map((r) => r.body.attempt)).toEqual([attempt + 1]);
      }
      // 另一家的指令不受影响（撤回按「作业 + 阶段」，不是按作业一刀切）
      expect(
        (await dispatchRows(HOLDER_B, "seal_b")).map((r) => r.body.attempt),
      ).toEqual([1]);
    });

    it("发件箱里残留的旧 attempt 指令（升级前留下的）在下发新 attempt 时一并撤掉", async () => {
      await seedJob("RUNNING");
      await stages.update(
        { id: `${JOB}#seal_a` },
        { status: "RETRYING", attempt: 2, updatedAt: T0 },
      );
      await stages.update({ id: `${JOB}#seal_b` }, { status: "SUCCEEDED" });
      for (const attempt of [1, 2])
        await outboxRepo.save(
          outboxRepo.create({
            id: `StageDispatch:${JOB}:seal_a:${attempt}`,
            msg_id: `msg-old-${attempt}`,
            msg_type: "StageDispatch",
            job_id: JOB,
            receiver: HOLDER_A,
            sender: PLATFORM,
            idempotency_key: `${JOB}:seal_a:${attempt}`,
            body: { ticket_id: "tkt-1", stage_id: "seal_a", attempt },
          }),
        );
      await scheduler.dispatchReadyStages(JOB);
      expect(
        (await dispatchRows(HOLDER_A, "seal_a")).map((r) => r.body.attempt),
      ).toEqual([3]);
    });

    it("阶段成功 → 指令撤回；吃 C2 的阶段成功 → 它消费的信封一并撤回（重启后的节点不会再解封一遍）", async () => {
      await seedJob();
      await scheduler.dispatchReadyStages(JOB);
      for (const [stageId, reporter] of [
        ["seal_a", HOLDER_A],
        ["seal_b", HOLDER_B],
      ] as const) {
        await scheduler.onStageStatus({
          jobId: JOB,
          stageId,
          reporter,
          status: "SUCCEEDED",
          attempt: 1,
        });
        expect(await dispatchRows(reporter, stageId)).toHaveLength(0);
      }
      await seedRelay("k-a", HOLDER_A, 1024);
      await seedRelay("k-b", HOLDER_B, 1024);
      // 别的作业给同一个节点的信封不得被连带撤掉
      await seedRelay("k-other", HOLDER_A, 1024, T0, "job-other");

      expect(await scheduler.dispatchReadyStages(JOB)).toBe(1);
      expect(await dispatchRows(NODE, "scri")).toHaveLength(1);
      // 上游成功不等于信封已被消费：节点阶段没跑完之前信封必须留着
      expect((await relayRows()).map((r) => r.id).sort()).toHaveLength(3);

      await scheduler.onStageStatus({
        jobId: JOB,
        stageId: "scri",
        reporter: NODE,
        status: "SUCCEEDED",
        attempt: 1,
      });
      expect(await dispatchRows(NODE, "scri")).toHaveLength(0);
      expect((await relayRows()).map((r) => r.id)).toEqual([
        `C2EnvelopeRelay:relay:k-other:${NODE}`,
      ]);
    });

    it("被顶替的旧 attempt 迟到的状态不驱动状态机（不把新 attempt 记成失败，也不误报 400）", async () => {
      await seedJob("RUNNING");
      await stages.update(
        { id: `${JOB}#seal_a` },
        { status: "RUNNING", attempt: 3, updatedAt: T0 },
      );
      const late = await scheduler.onStageStatus({
        jobId: JOB,
        stageId: "seal_a",
        reporter: HOLDER_A,
        status: "FAILED",
        code: "E_RUNTIME",
        attempt: 1,
      });
      expect(late).toMatchObject({ stage: "RUNNING", stale: true });
      expect(
        (await stages.findOne({ where: { id: `${JOB}#seal_a` } })).status,
      ).toBe("RUNNING");

      // 事故原样：旧 attempt 在隧道恢复后「成功」了，而平台正在等新 attempt 的退避
      await stages.update({ id: `${JOB}#seal_a` }, { status: "RETRYING" });
      const lateSuccess = await scheduler.onStageStatus({
        jobId: JOB,
        stageId: "seal_a",
        reporter: HOLDER_A,
        status: "SUCCEEDED",
        attempt: 2,
      });
      expect(lateSuccess).toMatchObject({ stage: "RETRYING", stale: true });
    });

    it("不可重试失败 → 作业 FAILED：该作业在途的 StageDispatch 与 C2 信封立即撤回", async () => {
      await seedJob();
      await scheduler.dispatchReadyStages(JOB);
      await seedRelay("k-b", HOLDER_B, 1024);
      const out = await scheduler.onStageStatus({
        jobId: JOB,
        stageId: "seal_a",
        reporter: HOLDER_A,
        status: "FAILED",
        code: "E_OP_REVOKED",
        attempt: 1,
      });
      expect(out).toMatchObject({ stage: "FAILED", jobStatus: "FAILED" });
      expect(await dispatchRows(HOLDER_A)).toHaveLength(0);
      expect(await dispatchRows(HOLDER_B)).toHaveLength(0);
      expect(await relayRows()).toHaveLength(0);
      // 销毁指令是收尾消息，必须留着等回执
      expect(
        (await outboxRepo.find({ where: { msg_type: "PurgeOrder" } })).length,
      ).toBeGreaterThan(0);
    });
  });

  describe("长轮询批次有界", () => {
    const LARGE = LARGE_BODY_BYTES + 4096;

    it("已送出的大载荷在重投间隔内不重发全文，到点才重发；小消息仍每轮重发（重启后的状态恢复靠它）", async () => {
      await seedSmall("offer-1", "PlanFragmentOffer");
      await seedRelay("k-a", HOLDER_A, LARGE);
      await seedRelay("k-b", HOLDER_B, LARGE);

      const first = await outbox.pendingFor(NODE, 200, T0);
      expect(first.map((e) => e.msg_type)).toEqual([
        "PlanFragmentOffer",
        "C2EnvelopeRelay",
        "C2EnvelopeRelay",
      ]);

      // 25 秒后的下一轮长轮询：事故里这一轮会把两份信封整份再发一遍
      const second = await outbox.pendingFor(
        NODE,
        200,
        new Date(T0.getTime() + 25_000),
      );
      expect(second.map((e) => e.msg_type)).toEqual(["PlanFragmentOffer"]);

      // 仍是「至少一次」：过了重投间隔还没终结就再发（响应中途断掉 / 节点重启都靠这一条恢复）
      const third = await outbox.pendingFor(
        NODE,
        200,
        new Date(T0.getTime() + LARGE_REDELIVERY_MS + 1_000),
      );
      expect(third.map((e) => e.msg_type)).toEqual([
        "PlanFragmentOffer",
        "C2EnvelopeRelay",
        "C2EnvelopeRelay",
      ]);
      // 重发复用同一 msg_id（接收方按它与 key_id 去重）
      expect(third[1].msg_id).toBe(first[1].msg_id);
    });

    it("单批大载荷总量有上限：放不下的留到下一轮（先进先出，至少放行一条）", async () => {
      const each = Math.floor(BATCH_LARGE_BYTES / 2) - 1024; // 两条刚好放得下，第三条放不下
      await seedRelay("k-1", HOLDER_A, each, new Date(T0.getTime() + 1));
      await seedRelay("k-2", HOLDER_B, each, new Date(T0.getTime() + 2));
      await seedRelay("k-3", HOLDER_A, each, new Date(T0.getTime() + 3));
      await seedSmall(
        "dispatch-1",
        "StageDispatch",
        new Date(T0.getTime() + 4),
      );

      const first = await outbox.pendingFor(NODE, 200, T0);
      const keysOf = (batch: typeof first) =>
        batch
          .filter((e) => e.msg_type === "C2EnvelopeRelay")
          .map(
            (e) =>
              (
                e.body as {
                  data_envelope: { wrapped_key: { key_id: string } };
                }
              ).data_envelope.wrapped_key.key_id,
          );
      expect(keysOf(first)).toEqual(["k-1", "k-2"]);
      // 小消息不被大载荷挡在后面（队头阻塞会让派发指令晚一轮甚至永远到不了）
      expect(first.some((e) => e.msg_type === "StageDispatch")).toBe(true);
      const bytes = Buffer.byteLength(JSON.stringify(first));
      expect(bytes).toBeLessThan(BATCH_LARGE_BYTES + 64 * 1024);

      // 下一轮：前两条在重投间隔内不重发，被挡下的那条现在放行
      const second = await outbox.pendingFor(
        NODE,
        200,
        new Date(T0.getTime() + 25_000),
      );
      expect(keysOf(second)).toEqual(["k-3"]);

      // 单条就超过上限也要放行（否则永远送不出去）
      await outboxRepo.delete({ msg_type: "C2EnvelopeRelay" });
      await seedRelay("k-huge", HOLDER_A, BATCH_LARGE_BYTES + 1024);
      const third = await outbox.pendingFor(
        NODE,
        200,
        new Date(T0.getTime() + 50_000),
      );
      expect(keysOf(third)).toEqual(["k-huge"]);
    });

    it("作业进入终态后，执行类消息（StageDispatch / C2EnvelopeRelay）清掉，收尾消息（PurgeOrder）保留", async () => {
      await seedJob("RUNNING");
      await seedRelay("k-a", HOLDER_A, 1024);
      await seedSmall("dispatch-1", "StageDispatch");
      await seedSmall("purge-1", "PurgeOrder");
      await seedSmall("offer-1", "PlanFragmentOffer");

      // 执行中：一条都不能清（节点重启后要靠要约/凭证恢复状态）
      expect(await outbox.pruneSettled()).toBe(0);

      for (const status of ["FAILED", "ABORTED", "SUCCEEDED"]) {
        await seedRelay("k-a", HOLDER_A, 1024);
        await seedSmall("dispatch-1", "StageDispatch");
        await jobs.update({ id: JOB }, { status });
        await outbox.pruneSettled();
        const left = (
          (await outboxRepo.find()) as Array<{ msg_type: string }>
        ).map((r) => r.msg_type);
        expect(left.sort()).toEqual(["PlanFragmentOffer", "PurgeOrder"]);
      }
    });
  });
});
