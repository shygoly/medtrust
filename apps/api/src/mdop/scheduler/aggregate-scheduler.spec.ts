import { sm3Hex } from "@medtrust/mdop";
import { mockRepo } from "../../runtime/test-utils/mock-repo";
import { AggregateController } from "./aggregate.controller";
import { AggregateSchedulerService } from "./aggregate-scheduler.service";

const binding = {
  parties: ["node-a", "node-b"],
  timeout_s: 60,
  encryption: "per_recipient_pubkey",
  algorithm: "fedavg",
  steps: ["contribute", "upload"],
};

function stage() {
  return {
    id: "job-1#agg",
    jobId: "job-1",
    stageId: "agg",
    node: "node-a",
    opRef: "merge.fedavg-secure@1.0.0",
    status: "PENDING",
    params: { aggregate: binding },
  };
}

function blob(text: string) {
  const ciphertext = Buffer.from(text).toString("base64");
  return {
    ciphertext,
    digest: `sm3:${sm3Hex(Buffer.from(ciphertext, "base64"))}`,
  };
}

describe("aggregate scheduler", () => {
  function setup() {
    const jobs = mockRepo();
    const stages = mockRepo();
    const outbox = mockRepo();
    const contributions = mockRepo();
    const scheduler = new AggregateSchedulerService(
      jobs as never,
      stages as never,
      outbox as never,
      contributions as never,
    );
    const controller = new AggregateController(scheduler);
    return { jobs, stages, outbox, contributions, scheduler, controller };
  }

  it("收齐两方密文后分发全部句柄", async () => {
    const { jobs, stages, outbox, scheduler, controller } = setup();
    await jobs.save({ id: "job-1", status: "RUNNING" });
    await stages.save(stage());
    const job = (await jobs.find())[0];
    const row = (await stages.find())[0];
    await scheduler.begin(job, row, "tkt-1");

    const a = blob("cipher-a");
    const b = blob("cipher-b");
    const uploaded = await controller.upload({
      jobId: "job-1",
      stageId: "agg",
      contributorId: "node-a",
      ciphertext: a.ciphertext,
      digest: a.digest,
      partialSignature: "sig-a",
    });
    expect(uploaded.contributionRef).toMatch(/^blob:\/\//);
    await controller.upload({
      jobId: "job-1",
      stageId: "agg",
      contributorId: "node-b",
      ciphertext: b.ciphertext,
      digest: b.digest,
      partialSignature: "sig-b",
    });

    const stored = (await stages.find())[0];
    expect(stored.status).toBe("AGGREGATED");
    const results = (await outbox.find()).filter(
      (row) => row.msg_type === "AggregateResult",
    );
    expect(results).toHaveLength(2);
    expect(results[0].body.contribution_refs).toHaveLength(2);
    expect(results[0].body.complete).toBe(true);
    const fetched = await controller.download(uploaded.contributionRef);
    expect(fetched.ciphertext).toBe(a.ciphertext);
    expect(fetched.digest).toBe(a.digest);
  });

  it("超时未收齐则 REJECTED，且不下发部分结果", async () => {
    const { jobs, stages, outbox, scheduler } = setup();
    await jobs.save({ id: "job-1", status: "RUNNING" });
    await stages.save(stage());
    const job = (await jobs.find())[0];
    const row = (await stages.find())[0];
    await scheduler.begin(job, row, "tkt-1");
    const a = blob("cipher-a");
    await scheduler.upload({
      jobId: "job-1",
      stageId: "agg",
      contributorId: "node-a",
      ciphertext: a.ciphertext,
      digest: a.digest,
      partialSignature: "sig-a",
    });
    const rejected = await scheduler.sweepTimeouts(
      new Date(Date.now() + 61_000),
    );
    expect(rejected).toBe(1);
    expect((await stages.find())[0].status).toBe("REJECTED");
    expect((await jobs.find())[0].status).toBe("REJECTED");
    expect(
      (await outbox.find()).some((row) => row.msg_type === "AggregateResult"),
    ).toBe(false);
  });

  it("超过 72 小时的密文不可再下载", async () => {
    const { jobs, stages, scheduler, controller } = setup();
    await jobs.save({ id: "job-1", status: "RUNNING" });
    await stages.save(stage());
    const job = (await jobs.find())[0];
    const row = (await stages.find())[0];
    await scheduler.begin(job, row, "tkt-1");
    const a = blob("cipher-a");
    const uploaded = await scheduler.upload({
      jobId: "job-1",
      stageId: "agg",
      contributorId: "node-a",
      ciphertext: a.ciphertext,
      digest: a.digest,
      partialSignature: "sig-a",
    });
    const removed = await scheduler.sweepExpiredBlobs(
      new Date(Date.now() + 73 * 60 * 60 * 1000),
    );
    expect(removed).toBe(1);
    await expect(controller.download(uploaded.contributionRef)).rejects.toThrow(
      /过期/,
    );
  });
});
