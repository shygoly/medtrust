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
  const controller = new ConnectorTasksController(
    { pullPending: rwsPull } as never,
    { pullPending: flPull } as never,
    { pullPendingRounds: roundsPull } as never,
    notifier,
    signer,
    { touch } as unknown as ConnectorAdminService,
    { verifyPayloadSignature: jest.fn() } as unknown as ConnectorAuthService,
    gm,
  );
  return { controller, notifier, rwsPull, flPull, roundsPull, touch };
}

const req = { connectorParticipantId: "p-huashan" };
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

    expect(batch.participantId).toBe("p-huashan");
    expect(batch.rws).toHaveLength(1);
    expect(batch.rws[0].kind).toBe("rws");
    expect(batch.rws[0].taskId).toBe("a-1");
    expect(batch.rws[0].participantId).toBe("p-huashan");
    expect(batch.rws[0].signature).toBeTruthy();
    expect(batch.rws[0].sm3).toMatch(/^[0-9a-f]{64}$/);
    expect(h.touch).toHaveBeenCalledWith("p-huashan");
  });

  it("没有待办时挂起,超时返回空结果", async () => {
    const h = await harness();
    const started = Date.now();
    const batch = await h.controller.pending(req, "60");
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(batch.rws).toEqual([]);
    expect(batch.flPrediction).toEqual([]);
    expect(batch.flRounds).toEqual([]);
  });

  it("挂起期间来新任务 → 立即返回(不必等超时)", async () => {
    const h = await harness();
    // 先空 → 挂起 → 唤醒时待办已就绪
    h.rwsPull.mockResolvedValueOnce([]).mockResolvedValue([rwsAssignment]);
    const started = Date.now();
    const pending = h.controller.pending(req, "25000");
    await new Promise((r) => setTimeout(r, 30));
    expect(h.notifier.waiting("p-huashan")).toBe(1);
    h.notifier.notify("p-huashan");
    const batch = await pending;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(batch.rws).toHaveLength(1);
  });

  it("漏唤醒竞态:登记后、查待办前来的任务仍能被领走", async () => {
    const h = await harness();
    // notify 发生在第一次查待办之前(登记已完成),查待办能看到任务
    h.rwsPull.mockImplementation(async () => {
      h.notifier.notify("p-huashan");
      return [rwsAssignment];
    });
    const batch = await h.controller.pending(req, "25000");
    expect(batch.rws).toHaveLength(1);
    expect(h.notifier.waiting("p-huashan")).toBe(0);
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
        participantId: "p-huashan",
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
