import { generateSm2KeyPair, parseAggregateResult } from "@medtrust/mdop";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import {
  downloadContributions,
  uploadLocalContribution,
  type AggregatePlatformClient,
} from "../../../connector/src/mdop/aggregation/channel";
import { fedAvg } from "../../../connector/src/mdop/aggregation/ciphertext";
import { compileAggregateStage } from "./compiler/aggregate-stage";
import { AggregateSchedulerService } from "./scheduler/aggregate-scheduler.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";

const binding = {
  parties: ["node-a", "node-b"],
  timeout_s: 60,
  encryption: "per_recipient_pubkey" as const,
  algorithm: "fedavg" as const,
  steps: ["contribute", "upload"] as ["contribute", "upload"],
};

const updateA = { n: 1, weights: [0, 10] };
const updateB = { n: 3, weights: [4, 0] };

function setup() {
  const jobs = mockRepo();
  const stages = mockRepo();
  const outbox = mockRepo();
  const contributions = mockRepo();
  const aggregates = new AggregateSchedulerService(
    jobs as never,
    stages as never,
    outbox as never,
    contributions as never,
  );
  const scheduler = new MdopSchedulerService(
    jobs as never,
    stages as never,
    outbox as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    aggregates,
  );
  const client: AggregatePlatformClient = {
    upload: (body) => aggregates.upload(body),
    download: (contributionRef) => aggregates.download(contributionRef),
  };
  return { jobs, stages, outbox, contributions, aggregates, scheduler, client };
}

describe("聚合阶段端到端", () => {
  const alice = generateSm2KeyPair();
  const bob = generateSm2KeyPair();
  const parties = [
    { id: "node-a", publicKey: alice.publicKey },
    { id: "node-b", publicKey: bob.publicKey },
  ];

  async function beginJob(
    harness: ReturnType<typeof setup>,
    jobId = "job-agg",
  ) {
    await harness.jobs.save({ id: jobId, status: "RUNNING" });
    await harness.stages.save({
      id: `${jobId}#agg`,
      jobId,
      stageId: "agg",
      node: "node-a",
      opRef: "merge.fedavg-secure@1.0.0",
      status: "PENDING",
      params: { aggregate: binding },
      inputs: [],
    });
    const job = (await harness.jobs.find({ where: { id: jobId } }))[0];
    const stage = (await harness.stages.find({ where: { jobId } }))[0];
    await harness.aggregates.begin(job, stage, "tkt-1");
    return { job, stage };
  }

  async function uploadBoth(
    harness: ReturnType<typeof setup>,
    jobId = "job-agg",
  ) {
    await uploadLocalContribution(harness.client, {
      jobId,
      stageId: "agg",
      selfId: "node-a",
      privateKey: alice.privateKey,
      publicKey: alice.publicKey,
      parties,
      update: updateA,
    });
    await uploadLocalContribution(harness.client, {
      jobId,
      stageId: "agg",
      selfId: "node-b",
      privateKey: bob.privateKey,
      publicKey: bob.publicKey,
      parties,
      update: updateB,
    });
  }

  it("两节点上传密文后本地 FedAvg 与明文一致，作业 SUCCEEDED", async () => {
    const harness = setup();
    await beginJob(harness);
    const requests = (await harness.outbox.find()).filter(
      (row) => row.msg_type === "AggregateRequest",
    );
    expect(requests.map((row) => row.receiver).sort()).toEqual([
      "node-a",
      "node-b",
    ]);

    await uploadBoth(harness);
    const results = (await harness.outbox.find()).filter(
      (row) => row.msg_type === "AggregateResult",
    );
    expect(results).toHaveLength(2);
    const result = parseAggregateResult(results[0].body);
    const refs = result.contribution_refs.map((item) => item.contribution_ref);

    const fromA = await downloadContributions(
      harness.client,
      refs,
      "node-a",
      alice.privateKey,
    );
    const fromB = await downloadContributions(
      harness.client,
      refs,
      "node-b",
      bob.privateKey,
    );
    const expected = fedAvg([updateA, updateB]);
    expect(fedAvg(fromA)).toEqual(expected);
    expect(fedAvg(fromB)).toEqual(expected);
    expect(expected).toEqual({ n: 4, weights: [3, 2.5] });

    const job = (await harness.jobs.find())[0];
    let stage = (await harness.stages.find())[0];
    await harness.aggregates.onNodeReport(job, stage, {
      reporter: "node-a",
      status: "SUCCEEDED",
    });
    stage = (await harness.stages.find())[0];
    const done = await harness.aggregates.onNodeReport(job, stage, {
      reporter: "node-b",
      status: "SUCCEEDED",
    });
    expect(done).toEqual({ stage: "SUCCEEDED", jobStatus: "SUCCEEDED" });
    expect((await harness.jobs.find())[0].status).toBe("SUCCEEDED");
  });

  it("一方超时未贡献则 REJECTED，不把已收到的贡献当成结果", async () => {
    const harness = setup();
    await beginJob(harness);
    await uploadLocalContribution(harness.client, {
      jobId: "job-agg",
      stageId: "agg",
      selfId: "node-a",
      privateKey: alice.privateKey,
      publicKey: alice.publicKey,
      parties,
      update: updateA,
    });
    const rejected = await harness.aggregates.sweepTimeouts(
      new Date(Date.now() + 61_000),
    );
    expect(rejected).toBe(1);
    expect((await harness.stages.find())[0].status).toBe("REJECTED");
    expect((await harness.jobs.find())[0].status).toBe("REJECTED");
    expect(
      (await harness.outbox.find()).some(
        (row) => row.msg_type === "AggregateResult",
      ),
    ).toBe(false);
    expect(await harness.contributions.find()).toEqual([]);
  });

  it("解密失败使整个聚合 REJECTED，不做部分合并", async () => {
    const harness = setup();
    await beginJob(harness);
    await uploadBoth(harness);
    const result = parseAggregateResult(
      (await harness.outbox.find()).find(
        (row) => row.msg_type === "AggregateResult",
      ).body,
    );
    const refs = result.contribution_refs.map((item) => item.contribution_ref);
    await expect(
      downloadContributions(harness.client, refs, "node-b", alice.privateKey),
    ).rejects.toThrow(/解密失败/);

    const job = (await harness.jobs.find())[0];
    const stage = (await harness.stages.find())[0];
    const reported = await harness.aggregates.onNodeReport(job, stage, {
      reporter: "node-b",
      status: "FAILED",
      code: "E_RUNTIME",
      message: "解密失败",
    });
    expect(reported).toEqual({ stage: "REJECTED", jobStatus: "REJECTED" });
    expect((await harness.stages.find())[0].status).not.toBe("SUCCEEDED");
    expect(await harness.contributions.find()).toEqual([]);
    expect(
      (await harness.outbox.find()).some(
        (row) => row.msg_type === "AggregateResult",
      ),
    ).toBe(false);
  });

  it("L1.5 作业与含聚合阶段的作业同时在途时互不推进", async () => {
    const harness = setup();
    const compiled = compileAggregateStage({
      stageId: "agg",
      manifest: {
        apiVersion: "mdop/v0.3",
        kind: "secure_aggregate",
        id: "merge.fedavg-secure",
        version: "1.0.0",
        category: "aggregation",
        digest: "component:fedavg-secure@1.0.0",
        publisher: "urn:tds:space-x:participant:platform",
        inputs: [
          {
            name: "local",
            schema: "mdop.aggregate/1.0",
            accept_labels: ["C1"],
          },
        ],
        outputs: [
          {
            name: "aggregated",
            schema: "mdop.aggregate/1.0",
            label_rule: "C3",
          },
        ],
        params: {},
        environments: ["native"],
        security: { network: "relay" },
        component: "aggregator@1.0.0",
        aggregation: {
          encryption: "per_recipient_pubkey",
          party_closure: "compile_time",
        },
      },
      inputLabels: ["C1", "C1"],
      upstreamNodes: ["node-a", "node-b"],
      platformNode: "urn:tds:space-x:participant:platform",
      params: { timeout_s: 60 },
    });
    expect(compiled.binding.parties).toEqual(["node-a", "node-b"]);

    await harness.jobs.save({ id: "job-l15", status: "RUNNING" });
    await harness.stages.save({
      id: "job-l15#decA",
      jobId: "job-l15",
      stageId: "decA",
      node: "node-a",
      opRef: "declassify.small_cell@1.0.0",
      status: "RUNNING",
      params: { minCell: 10 },
      inputs: [],
    });
    await beginJob(harness, "job-lora");

    await harness.scheduler.onStageStatus({
      jobId: "job-l15",
      stageId: "decA",
      reporter: "node-a",
      status: "SUCCEEDED",
    });

    const l15 = (await harness.stages.find({ where: { jobId: "job-l15" } }))[0];
    const lora = (
      await harness.stages.find({ where: { jobId: "job-lora" } })
    )[0];
    expect(l15.status).toBe("SUCCEEDED");
    expect(l15.params.aggregate).toBeUndefined();
    expect(lora.status).toBe("AGGREGATING");
    const messages = await harness.outbox.find();
    expect(messages.every((row) => row.job_id === "job-lora")).toBe(true);
    expect(messages.some((row) => row.msg_type === "AggregateRequest")).toBe(
      true,
    );
    expect(
      (await harness.jobs.find({ where: { id: "job-l15" } }))[0].status,
    ).toBe("RUNNING");
  });
});
