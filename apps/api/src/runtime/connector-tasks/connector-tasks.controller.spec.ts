import { CaKeypair, Certificate } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import { ConnectorAdminService } from "../participant-identity/connector-admin.service";
import { ConnectorAuthService } from "../participant-identity/connector-auth.service";
import { mockRepo } from "../test-utils/mock-repo";
import { ConnectorTaskNotifier } from "./connector-task-notifier.service";
import { ConnectorTaskSigner } from "./connector-task-signer.service";
import { ConnectorTasksController } from "./connector-tasks.controller";

interface Harness {
  controller: ConnectorTasksController;
  notifier: ConnectorTaskNotifier;
  rwsPull: jest.Mock;
  flPull: jest.Mock;
  roundsPull: jest.Mock;
  touch: jest.Mock;
  revocationList: jest.Mock;
  /** connector-agent-deidentification：脱敏规格包 + 吊销名单载荷。 */
  deid: { connectorBatchPayload: jest.Mock };
}

async function harness(): Promise<Harness> {
  const gm = new GMCryptoService();
  const ca = new CaService(
    gm,
    mockRepo<CaKeypair>() as never,
    mockRepo<Certificate>() as never,
  );
  await ca.onModuleInit();
  const notifier = new ConnectorTaskNotifier();
  const signer = new ConnectorTaskSigner(ca, gm);
  const rwsPull = jest.fn().mockResolvedValue([]);
  const flPull = jest.fn().mockResolvedValue([]);
  const roundsPull = jest.fn().mockReturnValue([]);
  const touch = jest.fn().mockResolvedValue(undefined);
  // connector-agent-deidentification：脱敏规格包 + 吊销名单（缺省空载荷）
  const deid = {
    connectorBatchPayload: jest.fn().mockResolvedValue({
      deidSpecs: [],
      deidRevocations: { version: 0, issuedAt: "", revoked: [] },
    }),
  };
  // third-party-module-admission 闸 5:批次里带吊销名单(本用例只需一个空名单)。
  const revocationList = jest
    .fn()
    .mockResolvedValue({ version: 0, issuedAt: "", revoked: [] });
  const controller = new ConnectorTasksController(
    { pullPending: rwsPull } as never,
    { pullPending: flPull } as never,
    { pullPendingRounds: roundsPull } as never,
    notifier,
    signer,
    { touch } as unknown as ConnectorAdminService,
    { verifyPayloadSignature: jest.fn() } as unknown as ConnectorAuthService,
    gm,
    { revocationList } as never,
    // mdop-kernel:算子清单 + MDOP 吊销名单（本用例给空载荷）
    { manifestPayload: jest.fn().mockResolvedValue([]) } as never,
    { signedList: jest.fn().mockResolvedValue(undefined) } as never,
    { pendingFor: jest.fn().mockResolvedValue([]) } as never,
    // connector-agent-deidentification:脱敏规格包 + 吊销名单（本用例给空载荷）
    deid as never,
  );
  return {
    controller,
    notifier,
    rwsPull,
    flPull,
    roundsPull,
    touch,
    revocationList,
    deid,
  };
}

const req = { connectorParticipantId: "p-demohospa" };
const rwsAssignment = {
  assignmentId: "a-1",
  taskId: "t-1",
  purpose: "PV",
  workloadType: "rws" as const,
  analysis: { type: "cohort-count" },
  contract: { id: "c-1" },
};

describe("ConnectorTasksController — 统一长轮询 (D2 / 任务 3.5)", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("有待办时立即返回,并按参与方签名", async () => {
    const h = await harness();
    h.rwsPull.mockResolvedValue([rwsAssignment]);
    const batch = await h.controller.pending(req, "25000");

    expect(batch.participantId).toBe("p-demohospa");
    expect(batch.rws).toHaveLength(1);
    expect(batch.rws[0].kind).toBe("rws");
    expect(batch.rws[0].taskId).toBe("a-1");
    expect(batch.rws[0].participantId).toBe("p-demohospa");
    expect(batch.rws[0].signature).toBeTruthy();
    expect(batch.rws[0].sm3).toMatch(/^[0-9a-f]{64}$/);
    expect(h.touch).toHaveBeenCalledWith("p-demohospa");
  });

  // 这两条用例等的是**真实定时器**（长轮询挂起与唤醒），在满载并行下（20+ worker）
  // 默认 5s 的上限会被机器负载吃掉而偶发超时；给它们明确的宽限，不改变被测行为。
  it("没有待办时挂起,超时返回空结果", async () => {
    const h = await harness();
    const started = Date.now();
    const batch = await h.controller.pending(req, "60");
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(batch.rws).toEqual([]);
    expect(batch.flPrediction).toEqual([]);
    expect(batch.flRounds).toEqual([]);
  }, 15_000);

  it("挂起期间来新任务 → 立即返回(不必等超时)", async () => {
    const h = await harness();
    // 先空 → 挂起 → 唤醒时待办已就绪
    h.rwsPull.mockResolvedValueOnce([]).mockResolvedValue([rwsAssignment]);
    const started = Date.now();
    const pending = h.controller.pending(req, "25000");
    await new Promise((r) => setTimeout(r, 30));
    expect(h.notifier.waiting("p-demohospa")).toBe(1);
    h.notifier.notify("p-demohospa");
    const batch = await pending;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(batch.rws).toHaveLength(1);
  }, 15_000);

  it("漏唤醒竞态:登记后、查待办前来的任务仍能被领走", async () => {
    const h = await harness();
    // notify 发生在第一次查待办之前(登记已完成),查待办能看到任务
    h.rwsPull.mockImplementation(async () => {
      h.notifier.notify("p-demohospa");
      return [rwsAssignment];
    });
    const batch = await h.controller.pending(req, "25000");
    expect(batch.rws).toHaveLength(1);
    expect(h.notifier.waiting("p-demohospa")).toBe(0);
  });

  it("waitMs 上限 25 秒", async () => {
    const h = await harness();
    const batch = await h.controller.pending(req, "0");
    expect(batch.waitMs).toBe(0);
    // 请求 999999 时按上限裁剪(不真的等:有待办立即返回)
    h.rwsPull.mockResolvedValue([rwsAssignment]);
    const big = await h.controller.pending(req, "999999");
    expect(big.waitMs).toBe(25_000);
  });

  it("三类待办合并返回,训练轮次按 roundTaskId 标识", async () => {
    const h = await harness();
    h.rwsPull.mockResolvedValue([rwsAssignment]);
    h.flPull.mockResolvedValue([
      { assignmentId: "fl-1", taskId: "t-2", purpose: "FL", contract: {} },
    ]);
    h.roundsPull.mockReturnValue([
      {
        roundTaskId: "r-1",
        taskId: "t-3",
        participantId: "p-demohospa",
        round: 0,
        specYaml: "{}",
        globalAdapterJson: "",
        nodePlan: [],
        contract: {},
      },
    ]);
    const batch = await h.controller.pending(req, "0");
    expect(batch.rws[0].kind).toBe("rws");
    expect(batch.flPrediction[0].kind).toBe("fl-prediction");
    expect(batch.flRounds[0].kind).toBe("fl-round");
    expect(batch.flRounds[0].taskId).toBe("r-1");
  });
});

describe("吊销名单随批次下发（third-party-module-admission 闸 5）", () => {
  it("每个批次（含空批次）都带当前吊销名单", async () => {
    const { controller, revocationList } = await harness();
    revocationList.mockResolvedValue({
      version: 7,
      issuedAt: "2026-09-20T00:00:00.000Z",
      revoked: [
        {
          sm3: "a".repeat(64),
          reason: "security-incident",
          revokedAt: "2026-09-20T00:00:00.000Z",
          revokedBy: "platform-review",
        },
      ],
    });
    const batch = await controller.pending(req, "0");
    expect(batch.revocations?.version).toBe(7);
    expect(batch.revocations?.revoked[0].sm3).toBe("a".repeat(64));
    // 空批次也带 —— 否则闲时的连接器拿不到吊销。
    expect(batch.rws).toHaveLength(0);
  });

  it("名单读取失败不拖垮长轮询，但也不伪造成「无吊销」", async () => {
    const { controller, revocationList } = await harness();
    revocationList.mockRejectedValue(new Error("db down"));
    const batch = await controller.pending(req, "0");
    expect(batch.revocations).toBeUndefined();
    expect(batch.participantId).toBe("p-demohospa");
  });
});

describe("ConnectorTasksController — 脱敏规格随批次下发 (connector-agent-deidentification)", () => {
  it("批次里带规格包与吊销名单（连接器不必额外轮询）", async () => {
    const { controller, deid } = await harness();
    deid.connectorBatchPayload.mockResolvedValue({
      deidSpecs: [
        {
          specId: "deid.ckd.v3",
          version: 2,
          specJson: '{"id":"deid.ckd.v3"}',
          specSm3: "b".repeat(64),
          signature: "sig",
          keyId: "c".repeat(64),
          issuedAt: "2026-11-01T00:00:00.000Z",
          notAfter: "2027-05-01T00:00:00.000Z",
          signaturePayload: `medtrust.deid-spec.v1:${"b".repeat(64)}`,
        },
      ],
      deidRevocations: {
        version: 1,
        issuedAt: "2026-11-02T00:00:00.000Z",
        revoked: [
          {
            specSm3: "d".repeat(64),
            specId: "deid.ckd.v3",
            version: 1,
            reason: "口径撤回",
            revokedAt: "2026-11-02T00:00:00.000Z",
            revokedBy: "compliance-01",
          },
        ],
      },
    });
    const batch = await controller.pending(req, "0");
    expect(batch.deidSpecs?.map((p) => p.version)).toEqual([2]);
    expect(batch.deidRevocations?.version).toBe(1);
  });

  it("取不到规格 → 不带字段（连接器按 fail-closed 处置，不当作「不需要脱敏」）", async () => {
    const { controller, deid } = await harness();
    deid.connectorBatchPayload.mockRejectedValue(new Error("db down"));
    const batch = await controller.pending(req, "0");
    expect(batch.deidSpecs).toBeUndefined();
    expect(batch.deidRevocations).toBeUndefined();
    expect(batch.participantId).toBe("p-demohospa");
  });
});
