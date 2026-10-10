import { mergeDisproportionalityAggregates } from "../../runtime/rws-orchestrator/disproportionality";
import type {
  RwsAnalysisSpec,
  RwsPartyAggregate,
} from "../../runtime/rws-orchestrator/types";
import { mergeProportionality } from "./merge-disproportionality";
import { MdopMergeService } from "../mdop-merge.service";
import { MdopPurgeService } from "../mdop-purge.service";
import { mockRepo } from "../../runtime/test-utils/mock-repo";

const analysis = {
  type: "disproportionality",
  level: "L1.5",
  drug: "注射用紫杉醇",
} as RwsAnalysisSpec;

const siteA: RwsPartyAggregate = {
  analysisType: "disproportionality",
  cohortSize: 4,
  buckets: [
    { key: "胰腺炎", count: 2, rate: 0.5, b: 1, c: 1, d: 0 },
    { key: "中性粒细胞减少", count: 1, rate: 0.25, b: 2, c: 1, d: 0 },
  ],
} as RwsPartyAggregate;

const siteB: RwsPartyAggregate = {
  analysisType: "disproportionality",
  cohortSize: 4,
  buckets: [
    { key: "胰腺炎", count: 1, rate: 0.25, b: 1, c: 1, d: 1 },
    { key: "中性粒细胞减少", count: 2, rate: 0.5, b: 0, c: 1, d: 1 },
  ],
} as RwsPartyAggregate;

describe("平台合并算子与 MDOP 通道对拍（§9.5 / §9.7）", () => {
  it("合并口径与旧通道逐字段一致（PRR/ROR/IC/卡方/信号）", () => {
    const oldChannel = mergeDisproportionalityAggregates(analysis, [
      siteA,
      siteB,
    ]);
    const mdopChannel = mergeProportionality({
      analysis,
      tables: [
        { node: "urn:tds:sh-med:participant:p-demohospa", aggregate: siteA },
        { node: "urn:tds:sh-med:participant:p-demohospb", aggregate: siteB },
      ],
    });
    expect(mdopChannel).toEqual(oldChannel);
    // 逐字段显式断言（防止将来某一边悄悄改了字段名）
    expect(
      mdopChannel.buckets.map((b) => [
        b.key,
        b.count,
        b.b,
        b.c,
        b.d,
        b.prr,
        b.ror,
        b.ic,
        b.signal,
      ]),
    ).toEqual(
      oldChannel.buckets.map((b) => [
        b.key,
        b.count,
        b.b,
        b.c,
        b.d,
        b.prr,
        b.ror,
        b.ic,
        b.signal,
      ]),
    );
  });

  it("只接受四格表输入（其他分析类型一律拒）", () => {
    expect(() =>
      mergeProportionality({
        analysis,
        tables: [
          {
            node: "n",
            aggregate: {
              analysisType: "comparative-effect",
              cohortSize: 1,
              buckets: [],
            } as never,
          },
        ],
      }),
    ).toThrow(/只接受失衡检测四格表/);
  });

  describe("收齐投递才合并（任务 7.7 执行侧）", () => {
    const setup = async () => {
      const jobs = mockRepo();
      const deliveries = mockRepo();
      const fragments = mockRepo();
      const outbox = mockRepo();
      process.env.SPACE_ID = "sh-med";
      const platform = "urn:tds:sh-med:participant:platform";
      await jobs.save(
        jobs.create({
          id: "job-1",
          purpose: "RWS.EFFECTIVENESS",
          applicant: { org: "o", project: "p" },
          contracts: ["c1"],
          status: "RUNNING",
          logicalPlan: {
            stages: [
              {
                op: "rws.disproportionality@1.0.0",
                params: { drug: "注射用紫杉醇" },
              },
            ],
          },
          createdAt: new Date(),
        }),
      );
      for (const node of [
        "urn:tds:sh-med:participant:p-demohospa",
        "urn:tds:sh-med:participant:p-demohospb",
      ]) {
        await fragments.save(
          fragments.create({
            id: `job-1#${node}`,
            jobId: "job-1",
            node,
            fragment: {},
            fragmentHash: "x",
          }),
        );
      }
      const purge = new MdopPurgeService(jobs, fragments, outbox, mockRepo());
      // 平台自己的合并片段在收齐投递后就地推进状态，所以服务要能写阶段表。
      const merge = new MdopMergeService(
        jobs,
        deliveries,
        fragments,
        mockRepo(),
        purge,
      );
      const deliver = async (node: string, aggregate: unknown) =>
        deliveries.save(
          deliveries.create({
            id: `${node}:d`,
            jobId: "job-1",
            node,
            handle: `art://${node}/job-1/dec/table`,
            label: "C3",
            digest: `sm3:${"a".repeat(64)}`,
            accepted: true,
            payload: aggregate,
          }),
        );
      return { jobs, deliveries, outbox, merge, purge, platform, deliver };
    };

    afterEach(() => {
      delete process.env.SPACE_ID;
    });

    it("缺一个院 → 不合并；收齐 → 合并为 C3 交付物、作业 SUCCEEDED、触发销毁", async () => {
      const { jobs, deliveries, merge, platform, deliver } = await setup();
      await deliver("urn:tds:sh-med:participant:p-demohospa", siteA);
      const pending = await merge.mergeIfReady("job-1", analysis);
      expect(pending).toMatchObject({ merged: false });

      await deliver("urn:tds:sh-med:participant:p-demohospb", siteB);
      const done = await merge.mergeIfReady("job-1", analysis);
      expect(done).toMatchObject({ merged: true });
      const job = await jobs.findOne({ where: { id: "job-1" } });
      expect(job.status).toBe("SUCCEEDED");

      // 平台侧交付物（C3）留存，且不被销毁
      const mergedRow = await deliveries.findOne({
        where: { jobId: "job-1", node: platform },
      });
      expect(mergedRow.label).toBe("C3");
      expect(mergedRow.payload).toEqual(
        mergeDisproportionalityAggregates(analysis, [
          siteA,
          siteB,
        ]) as unknown as Record<string, unknown>,
      );
      // 幂等：重复调用不再算一遍
      const again = await merge.mergeIfReady("job-1", analysis);
      expect(again.digest).toBe(done.digest);
    });
  });
});
