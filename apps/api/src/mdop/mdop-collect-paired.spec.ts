import {
  canonicalSm3,
  mergeReleaseManifests,
  parseReleaseManifest,
} from "@medtrust/mdop";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { collectPairedCohort } from "@medtrust/domain-med";

/**
 * 平台侧**收集** `paired-cohort`（任务 3.12c）。
 *
 * 跨院配对在可信空间节点内算完，平台是收集方而不是合并方；这条补齐前，
 * 配对作业的 C3 一到达合并阶段就会因为「只接受失衡四格表」而卡住（作业永远不到 SUCCEEDED）。
 */

const PLATFORM = "urn:tds:sh-med:participant:platform";
const TEE = "urn:tds:sh-med:participant:tee-1";
const TEE2 = "urn:tds:sh-med:participant:tee-2";
const JOB = "job-paired";
const AT = new Date("2026-09-25T10:00:00.000Z");

function pairedAggregate(over: Record<string, unknown> = {}) {
  return {
    analysisType: "paired-cohort",
    cohortSize: 400,
    exposed: 134,
    outcome: 80,
    exposedWithOutcome: 27,
    rate: 27 / 134,
    strata: [
      {
        key: "60-69|F",
        exposed: 90,
        outcome: 55,
        exposedWithOutcome: 20,
        cohortSize: 300,
        rate: 20 / 90,
      },
      {
        key: "90-99|F",
        exposed: 4,
        outcome: 2,
        exposedWithOutcome: 1,
        cohortSize: 10,
        rate: 0.25,
      },
    ],
    ...over,
  };
}

function manifest(node: string) {
  return mergeReleaseManifests(
    [
      {
        node,
        minCell: 5,
        suppressed: 1,
        dp: { mode: "none" as const },
        budget: {
          dataset: "dp-1",
          snapshot: `sm3:${"a".repeat(64)}`,
          unit: "queries" as const,
          spent: 1,
          limit: 2,
        },
        at: AT.toISOString(),
      },
    ],
    { now: AT },
  );
}

async function run(
  producers: Array<{ node: string; payload: Record<string, unknown> }>,
  /** 各节点的阶段（用来验证「谁产出 C3 才欠投递」这条判据）；不给则不建阶段记录。 */
  stages: Array<{ node: string; stageId: string; outputLabel: string }> = [],
) {
  const jobsRepo = mockRepo();
  const deliveriesRepo = mockRepo();
  const fragmentsRepo = mockRepo();
  const stagesRepo = mockRepo();
  await jobsRepo.save(
    jobsRepo.create({ id: JOB, status: "RUNNING", contracts: [] }),
  );
  for (const p of producers)
    await fragmentsRepo.save(
      fragmentsRepo.create({ jobId: JOB, node: p.node, stages: [] }),
    );
  for (const s of stages)
    await stagesRepo.save(
      stagesRepo.create({
        id: `${JOB}#${s.stageId}`,
        jobId: JOB,
        stageId: s.stageId,
        node: s.node,
        opRef:
          s.outputLabel === "C3"
            ? "declassify.small_cell@1.0.0"
            : "seal.envelope@1.0.0",
        opDigest: "component:x@1",
        params: {},
        inputs: [],
        outputLabel: s.outputLabel,
        outputSchema: "s",
        status: "SUCCEEDED",
      }),
    );
  for (const p of producers) {
    await deliveriesRepo.save(
      deliveriesRepo.create({
        id: `${p.node}:delivery`,
        jobId: JOB,
        node: p.node,
        handle: `art://${p.node}/${JOB}/pair`,
        label: "C3",
        digest: canonicalSm3(p.payload),
        accepted: true,
        payload: p.payload,
      }),
    );
  }
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
  return { merge, jobsRepo };
}

describe("配对结果的收集（任务 3.12c）", () => {
  it("单一产出节点：结果原样交付，作业进 SUCCEEDED，发布审查清单随行", async () => {
    const payload = { ...pairedAggregate(), release_manifest: manifest(TEE) };
    // 阶段记录：两院只出 C2（封存），只有可信空间节点出 C3（节点内降密）
    const { merge, jobsRepo } = await run(
      [{ node: TEE, payload }],
      [
        {
          node: "urn:tds:sh-med:participant:p-demohospa",
          stageId: "sealA",
          outputLabel: "C2",
        },
        {
          node: "urn:tds:sh-med:participant:p-demohospb",
          stageId: "sealB",
          outputLabel: "C2",
        },
        { node: TEE, stageId: "decTee", outputLabel: "C3" },
      ],
    );

    const outcome = await merge.mergeIfReady(JOB, {
      type: "paired-cohort",
    } as never);
    expect(outcome.merged).toBe(true);
    expect((await jobsRepo.findOne({ where: { id: JOB } })).status).toBe(
      "SUCCEEDED",
    );

    const result = (await merge.mergedResult(JOB))!;
    expect(result).toMatchObject({
      analysisType: "paired-cohort",
      cohortSize: 400,
      exposedWithOutcome: 27,
    });
    expect(parseReleaseManifest(result.release_manifest).suppressedTotal).toBe(
      1,
    );
  });

  it("多产出节点（异常/未来分片）：按分层 key 求和并重算率", async () => {
    const collected = collectPairedCohort({
      tables: [
        { node: TEE, aggregate: pairedAggregate() as never },
        {
          node: TEE2,
          aggregate: pairedAggregate({
            cohortSize: 100,
            exposed: 30,
            outcome: 20,
            exposedWithOutcome: 5,
            strata: [
              {
                key: "60-69|F",
                exposed: 30,
                outcome: 20,
                exposedWithOutcome: 5,
                cohortSize: 100,
                rate: 5 / 30,
              },
            ],
          }) as never,
        },
      ],
    });
    expect(collected.cohortSize).toBe(500);
    expect(collected.exposedWithOutcome).toBe(32);
    expect(collected.rate).toBeCloseTo(32 / 164, 10);
    const cell = collected.strata.find((c) => c.key === "60-69|F")!;
    expect(cell).toMatchObject({
      exposed: 120,
      exposedWithOutcome: 25,
      cohortSize: 400,
    });
    expect(cell.rate).toBeCloseTo(25 / 120, 10);
  });

  it("各节点投递的分析类型不一致 → 拒（不拿两种口径混算）", async () => {
    const { merge } = await run([
      { node: TEE, payload: pairedAggregate() },
      {
        node: TEE2,
        payload: {
          analysisType: "disproportionality",
          cohortSize: 1,
          buckets: [],
        },
      },
    ]);
    await expect(
      merge.mergeIfReady(JOB, { type: "disproportionality" } as never),
    ).rejects.toThrow(/分析类型不一致/);
  });

  it("配对结果缺分层表 / 名字对不上 → 拒（形状不对不猜）", () => {
    expect(() =>
      collectPairedCohort({
        tables: [
          { node: TEE, aggregate: { analysisType: "paired-cohort" } as never },
        ],
      }),
    ).toThrow(/缺分层表/);
    expect(() => collectPairedCohort({ tables: [] })).toThrow(/没有任何输入表/);
  });
});
