import { ConnectorTaskNotifier } from "../connector-tasks/connector-task-notifier.service";
import { FlRoundQueueService } from "./fl-round-queue.service";

const contract = {
  id: "c-fl",
  dataProductId: "dp-fl",
  providerId: "p-demohospa",
  consumerId: "p-meddata",
  purpose: "PV",
  retention: "阅后即焚",
  output: "仅模型增量",
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: "active" as const,
};

function enqueueInput(over: Record<string, unknown> = {}) {
  return {
    taskId: "t-fl",
    participantId: "p-demohospa",
    round: 0,
    purpose: "PV",
    specYaml: "{}",
    globalAdapterJson: "",
    nodePlan: [],
    contract,
    ...over,
  };
}

describe("FlRoundQueueService — 轮次入队/领取/回传 (D3)", () => {
  it("入队即唤醒该院长轮询;领取后回传 resolve", async () => {
    const notifier = new ConnectorTaskNotifier();
    const notifySpy = jest.spyOn(notifier, "notify");
    const queue = new FlRoundQueueService(notifier);

    const waiting = queue.enqueue(enqueueInput());
    expect(notifySpy).toHaveBeenCalledWith("p-demohospa");

    const [round] = queue.pullPendingRounds("p-demohospa");
    expect(round.roundTaskId).toBeTruthy();
    expect(round.purpose).toBe("PV");
    expect(queue.pendingCount()).toBe(1);
    // 领取后不会重复下发
    expect(queue.pullPendingRounds("p-demohospa")).toEqual([]);

    queue.complete(round.roundTaskId, "p-demohospa", {
      adapterDeltaJson: '{"w":[1]}',
      sampleCount: 7,
      localLoss: 0.2,
    });
    await expect(waiting).resolves.toMatchObject({ sampleCount: 7 });
    expect(queue.pendingCount()).toBe(0);
  });

  it("只下发本院轮次", async () => {
    const queue = new FlRoundQueueService(new ConnectorTaskNotifier());
    void queue.enqueue(enqueueInput());
    expect(queue.pullPendingRounds("p-demohospb")).toEqual([]);
    expect(queue.pullPendingRounds("p-demohospa")).toHaveLength(1);
  });

  it("超时 reject(编排器据此踢出本轮)", async () => {
    const queue = new FlRoundQueueService(new ConnectorTaskNotifier());
    const waiting = queue.enqueue(enqueueInput({ timeoutMs: 20 }));
    await expect(waiting).rejects.toThrow(/训练轮次超时/);
    expect(queue.pendingCount()).toBe(0);
  });

  it("连接器上报失败 → 立刻 reject,不必等超时", async () => {
    const queue = new FlRoundQueueService(new ConnectorTaskNotifier());
    const waiting = queue.enqueue(enqueueInput({ timeoutMs: 5_000 }));
    const [round] = queue.pullPendingRounds("p-demohospa");
    queue.fail(round.roundTaskId, "p-demohospa", "agent 调用失败");
    await expect(waiting).rejects.toThrow(/agent 调用失败/);
  });

  it("别院不能回传本院的轮次", async () => {
    const queue = new FlRoundQueueService(new ConnectorTaskNotifier());
    void queue.enqueue(enqueueInput());
    const [round] = queue.pullPendingRounds("p-demohospa");
    expect(() =>
      queue.complete(round.roundTaskId, "p-demohospb", {
        adapterDeltaJson: "{}",
        sampleCount: 1,
        localLoss: 0,
      }),
    ).toThrow(/不属于该参与方/);
  });
});
