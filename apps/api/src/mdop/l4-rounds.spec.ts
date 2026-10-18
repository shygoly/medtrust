import { ckdEsrdRiskFlPredictionSpec } from "../compute-task/dto/fl-prediction-task-spec";
import {
  buildMockFlPartyRunResult,
  mergeFlPartyResults,
} from "../compute-task/dto/fl-run-result";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopJobsService } from "./mdop-jobs.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopPurgeService } from "./mdop-purge.service";

/**
 * 批次 1A / design **D3：轮次与部分参与，按 MDOP 重定义**。
 *
 * 1A 范围内的三条不变量（跨院多轮权重交换**不在本变更**，属 D-MDOP-8 / 1B）：
 *  1. 阶段 id 在作业内**必须唯一**——「多轮 = 作业内的 stage 序列」靠带轮次的 stage id 表达；
 *     重名会在落库时静默合并（主键 `jobId#stageId`），所以要在**提交期** fail-loud；
 *  2. **任一片段未回执 → 不进入 `RELEASING`**，也不产生平台侧结果（fail-closed，无部分结果）；
 *  3. 合并**幂等**：收齐后重复调用不重算、不新增第二份平台交付物。
 */

const PLATFORM = "urn:tds:sh-med:participant:platform";
const NODE_A = "urn:tds:sh-med:participant:p-demohospa";
const NODE_B = "urn:tds:sh-med:participant:p-demohospb";
const JOB = "job-l4-rounds";

const spec = {
  ...ckdEsrdRiskFlPredictionSpec(),
  modelType: "logistic_regression" as const,
  aggregation: "fedavg" as const,
};

const L4_STAGES = [
  {
    id: "l4_a",
    op: "rws.l4-train@1.0.0",
    inputs: [{ from: "src_a" }],
    params: { spec },
  },
  {
    id: "merge",
    op: "merge.fedavg@1.0.0",
    inputs: [{ from: "dec_a" }, { from: "dec_b" }],
    params: { spec },
  },
];

async function harness(delivered: string[]) {
  const jobsRepo = mockRepo();
  const deliveriesRepo = mockRepo();
  const fragmentsRepo = mockRepo();
  const stagesRepo = mockRepo();
  await jobsRepo.save(
    jobsRepo.create({
      id: JOB,
      status: "RUNNING",
      contracts: [],
      logicalPlan: { stages: L4_STAGES },
    }),
  );
  for (const node of [NODE_A, NODE_B]) {
    await fragmentsRepo.save(
      fragmentsRepo.create({ jobId: JOB, node, stages: [] }),
    );
    await stagesRepo.save(
      stagesRepo.create({ jobId: JOB, node, outputLabel: "C3" }),
    );
  }
  const payloadOf = (node: string) =>
    buildMockFlPartyRunResult(
      "fl-1",
      node === NODE_A ? "p-demohospa" : "p-demohospb",
      node === NODE_A ? 300 : 100,
      2,
    );
  const deliver = async (node: string) =>
    deliveriesRepo.save(
      deliveriesRepo.create({
        id: node + ":delivery",
        jobId: JOB,
        node,
        handle: "art://" + node + "/" + JOB + "/dec/table",
        label: "C3",
        digest: "sm3:" + "0".repeat(64),
        accepted: true,
        payload: payloadOf(node),
      }),
    );
  for (const node of delivered) await deliver(node);
  const purge = new MdopPurgeService(
    jobsRepo,
    fragmentsRepo,
    mockRepo(),
    mockRepo(),
  );
  const merge = new MdopMergeService(
    jobsRepo,
    deliveriesRepo,
    fragmentsRepo,
    stagesRepo,
    purge,
  );
  return { merge, jobsRepo, deliveriesRepo, deliver, payloadOf };
}

describe("D3 轮次语义（批次 1A 范围内）", () => {
  it("阶段 id 在提交期必须唯一：重名（含多轮同名阶段）被拒，并给出带轮次 id 的修法", async () => {
    const operators = {
      find: async () => ({
        id: "rws.l4-train",
        version: "1.0.0",
        kind: "wasm",
        digest: "operator:rws.l4-train@1",
        category: "local",
        inputs: [],
        outputs: [],
      }),
    } as never;
    const jobs = new MdopJobsService(
      mockRepo(),
      mockRepo(),
      mockRepo(),
      operators,
      { assertUsableForJob: async () => true } as never,
    );
    await expect(
      jobs.submit({
        purpose: "L4 演示",
        applicant: { org: "p-meddata", project: "ckd-esrd" },
        contracts: ["c1"],
        stages: [
          {
            id: "l4_train",
            op: "rws.l4-train@1.0.0",
            inputs: [{ from: "src_a" }],
            params: {},
          },
          {
            // 第二轮忘了改 id —— 落库时会被静默合并成一行，等于少算一轮
            id: "l4_train",
            op: "rws.l4-train@1.0.0",
            inputs: [{ from: "src_a" }],
            params: {},
          },
        ],
        not_before: "2026-10-13T00:00:00.000Z",
        not_after: "2026-11-13T00:00:00.000Z",
      } as never),
    ).rejects.toThrow(/重复的阶段 id：l4_train/);
  });

  it("任一片段未回执 → 不进入 RELEASING、无平台结果；收齐后合并幂等", async () => {
    const { merge, jobsRepo, deliveriesRepo, deliver, payloadOf } =
      await harness([NODE_A]);

    // 只到了一院：不合、不放行、不产生任何平台侧交付物
    const partial = await merge.mergeIfReady(JOB, {
      type: "disproportionality",
      level: "L1.5",
    } as never);
    expect(partial.merged).toBe(false);
    expect(partial.digest).toBeUndefined();
    const afterPartial = (await deliveriesRepo.find()) as Array<{
      node?: string;
    }>;
    expect(afterPartial.filter((r) => r.node === PLATFORM)).toHaveLength(0);
    expect((await jobsRepo.findOne({ where: { id: JOB } }))?.status).toBe(
      "RUNNING",
    );

    // 第二院到位：合并结果 = 旧链共享函数对该两方结果的口径
    await deliver(NODE_B);
    const merged = await merge.mergeIfReady(JOB, {
      type: "disproportionality",
      level: "L1.5",
    } as never);
    expect(merged.merged).toBe(true);
    expect((await jobsRepo.findOne({ where: { id: JOB } }))?.status).toBe(
      "SUCCEEDED",
    );
    const platformRows = (
      (await deliveriesRepo.find()) as Array<{
        node?: string;
        payload?: unknown;
      }>
    ).filter((r) => r.node === PLATFORM);
    expect(platformRows).toHaveLength(1);
    expect(platformRows[0].payload).toEqual(
      mergeFlPartyResults([payloadOf(NODE_A), payloadOf(NODE_B)], spec, {
        runtime: "connector-ml",
      }),
    );

    // 幂等：重复调用不重算、不新增第二份交付物
    const again = await merge.mergeIfReady(JOB, {
      type: "disproportionality",
      level: "L1.5",
    } as never);
    expect(again.merged).toBe(true);
    expect(again.digest).toBe(merged.digest);
    const platformRows2 = (
      (await deliveriesRepo.find()) as Array<{
        node?: string;
      }>
    ).filter((r) => r.node === PLATFORM);
    expect(platformRows2).toHaveLength(1);
  });
});
