import {
  RELEASE_MANIFEST_KEY,
  canonicalSm3,
  mergeReleaseManifests,
  parseReleaseManifest,
  withReleaseManifest,
} from "@medtrust/mdop";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopPurgeService } from "./mdop-purge.service";

/**
 * 发布审查清单随 C3 交付（任务 7.3b）：
 * 各持有方各出一份 → 平台**汇总**成同一形状 → 随合并结果一起交付；
 * 没有清单时按原样交付（**不伪造**一份「审查过」）。
 */

const PLATFORM = "urn:tds:sh-med:participant:platform";
const NODE_A = "urn:tds:sh-med:participant:p-huashan";
const NODE_B = "urn:tds:sh-med:participant:p-ruijin";
const JOB = "job-manifest";
const AT = new Date("2026-09-25T10:00:00.000Z");

function party(
  node: string,
  over: { suppressed?: number; minCell?: number; epsilon?: number } = {},
) {
  return {
    node,
    minCell: over.minCell ?? 10,
    suppressed: over.suppressed ?? 1,
    dp:
      over.epsilon === undefined
        ? ({ mode: "none" } as const)
        : ({ mode: "epsilon", epsilon: over.epsilon } as const),
    budget: {
      dataset: `dp-${node.endsWith("huashan") ? "1" : "2"}`,
      snapshot: `sm3:${(node.endsWith("huashan") ? "a" : "b").repeat(64)}`,
      unit: "queries" as const,
      spent: 3,
      limit: 20,
    },
    at: AT.toISOString(),
  };
}

describe("C3 交付物随带发布审查清单（任务 7.3b）", () => {
  async function run(manifests: Record<string, unknown>) {
    const jobsRepo = mockRepo();
    const deliveriesRepo = mockRepo();
    const fragmentsRepo = mockRepo();
    const stagesRepo = mockRepo();
    await jobsRepo.save(
      jobsRepo.create({ id: JOB, status: "RUNNING", contracts: [] }),
    );
    for (const node of [NODE_A, NODE_B])
      await fragmentsRepo.save(
        fragmentsRepo.create({ jobId: JOB, node, stages: [] }),
      );

    const tables: Record<string, Record<string, unknown>> = {};
    for (const [node, manifest] of Object.entries(manifests)) {
      const base = {
        analysisType: "disproportionality",
        cohortSize: 4,
        buckets: [{ key: "x", count: 2, rate: 0.5, b: 1, c: 1, d: 0 }],
      };
      tables[node] = manifest
        ? (withReleaseManifest(base, parseReleaseManifest(manifest)) as Record<
            string,
            unknown
          >)
        : base;
      await deliveriesRepo.save(
        deliveriesRepo.create({
          id: `${node}:delivery`,
          jobId: JOB,
          node,
          handle: `art://${node}/${JOB}/dec/table`,
          label: "C3",
          digest: canonicalSm3(tables[node]),
          accepted: true,
          payload: tables[node],
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
    await merge.mergeIfReady(JOB, {
      type: "disproportionality",
      level: "L1.5",
      drug: "x",
    } as never);
    return merge.mergedResult(JOB);
  }

  it("两方都带清单 → 合并结果带**汇总**清单（抑制数求和、minCell 取严、DP 取强、预算逐方）", async () => {
    const result = (await run({
      [NODE_A]: mergeReleaseManifests(
        [party(NODE_A, { suppressed: 2, minCell: 5 })],
        { now: AT },
      ),
      [NODE_B]: mergeReleaseManifests(
        [party(NODE_B, { suppressed: 3, minCell: 10, epsilon: 1.5 })],
        {
          now: AT,
        },
      ),
    }))!;
    const manifest = parseReleaseManifest(result[RELEASE_MANIFEST_KEY]);
    expect(manifest.suppressedTotal).toBe(5);
    expect(manifest.minCell).toBe(10);
    expect(manifest.dp).toEqual({ mode: "epsilon", epsilon: 1.5 });
    expect(manifest.parties.map((p) => p.node).sort()).toEqual(
      [NODE_A, NODE_B].sort(),
    );
    // 合并口径没被清单影响：四格表照旧合并
    expect(result).toMatchObject({
      analysisType: "disproportionality",
      cohortSize: 8,
    });
  });

  it("只有一方带清单 → 交付里仍带该方（不因为另一方没有就丢掉）", async () => {
    const result = (await run({
      [NODE_A]: mergeReleaseManifests([party(NODE_A, { suppressed: 4 })], {
        now: AT,
      }),
      [NODE_B]: undefined,
    }))!;
    const manifest = parseReleaseManifest(result[RELEASE_MANIFEST_KEY]);
    expect(manifest.parties).toHaveLength(1);
    expect(manifest.suppressedTotal).toBe(4);
  });

  it("双方都没有清单 → 交付物里**不出现**该键（不伪造「审查过」）", async () => {
    const result = (await run({ [NODE_A]: undefined, [NODE_B]: undefined }))!;
    expect(result[RELEASE_MANIFEST_KEY]).toBeUndefined();
  });
});
