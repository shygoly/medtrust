import { canonicalSm3 } from "../crypto/sm3";
import { computePlanHash, fragmentHash, recomputeForNode, type PlanHashJobHeader } from "./hash";
import { parseFragment, type Fragment } from "../schema/plan";

const digest = (c: string) => `sm3:${c.repeat(64)}`;

const job: PlanHashJobHeader = {
  job_id: "job-1",
  purpose: "RWS.EFFECTIVENESS",
  applicant: { org: "sponsor", project: "t2dm" },
  contracts: ["ctr-A", "ctr-B"],
  ethics_ref: "eth-1",
  dp_budget: 2,
  not_before: "2026-09-24T00:00:00Z",
  not_after: "2026-10-01T00:00:00Z",
};

const fragmentA: Fragment = parseFragment({
  node: "hospA",
  stages: [
    {
      id: "s1",
      node: "hospA",
      op: "source.dataset@1.0.0",
      op_digest: "component:connector@1",
      params: { uri: "ds://hospA/dp-1" },
      inputs: [],
      input_labels: [],
      output_label: "C0",
      output_schema: "mdop.table/1.0",
    },
  ],
  edges: [],
});

describe("片段哈希与 plan_hash", () => {
  it("片段哈希 = JCS 后的 SM3，字段顺序无关", () => {
    const reordered = parseFragment(JSON.parse(JSON.stringify({ edges: [], stages: fragmentA.stages, node: "hospA" })));
    expect(fragmentHash(reordered)).toBe(fragmentHash(fragmentA));
    expect(fragmentHash(fragmentA)).toBe(canonicalSm3(fragmentA));
  });

  it("片段任一字段变化 → 哈希变化", () => {
    const changed = parseFragment({ ...fragmentA, stages: [{ ...fragmentA.stages[0], params: { uri: "ds://hospA/dp-2" } }] });
    expect(fragmentHash(changed)).not.toBe(fragmentHash(fragmentA));
  });

  it("plan_hash = SM3(JCS({作业头, fragments}))，作业头顺序无关、省略与显式 null 等价", () => {
    const fragments = { hospA: digest("a"), hospB: digest("b") };
    const hash = computePlanHash({ job, fragments });
    expect(hash).toBe(
      canonicalSm3({
        job: {
          job_id: "job-1",
          purpose: "RWS.EFFECTIVENESS",
          applicant: { project: "t2dm", org: "sponsor" },
          contracts: ["ctr-A", "ctr-B"],
          ethics_ref: "eth-1",
          dp_budget: 2,
          not_before: job.not_before,
          not_after: job.not_after,
        },
        fragments,
      }),
    );
    // 未给可选字段 == 显式 null
    const bare: PlanHashJobHeader = {
      job_id: "job-1",
      purpose: "RWS.EFFECTIVENESS",
      applicant: { org: "sponsor", project: "t2dm" },
      contracts: ["ctr-A", "ctr-B"],
      not_before: job.not_before,
      not_after: job.not_after,
    };
    expect(computePlanHash({ job: bare, fragments })).toBe(
      computePlanHash({
        job: { ...bare, ethics_ref: undefined, dp_budget: undefined },
        fragments,
      }),
    );
    expect(computePlanHash({ job: bare, fragments })).not.toBe(hash);
  });

  it("plan_hash 任一字段变化 → 变化", () => {
    const fragments = { hospA: digest("a") };
    const base = computePlanHash({ job, fragments });
    expect(computePlanHash({ job: { ...job, purpose: "OTHER" }, fragments })).not.toBe(base);
    expect(
      computePlanHash({ job, fragments: { hospA: digest("c") } }),
    ).not.toBe(base);
    expect(computePlanHash({ job, fragments: { ...fragments, hospB: digest("d") } })).not.toBe(base);
  });

  it("节点能独立重算：本方片段哈希与 plan_hash 与要约一致", () => {
    const fragments = { hospA: fragmentHash(fragmentA), hospB: digest("b") };
    const plan = computePlanHash({ job, fragments });
    const recomputed = recomputeForNode({ job, fragment: fragmentA, fragments });
    expect(recomputed.fragment_hash).toBe(fragments.hospA);
    expect(recomputed.plan_hash).toBe(plan);
  });

  it("片段哈希表里没有本节点 → 拒", () => {
    expect(() => recomputeForNode({ job, fragment: fragmentA, fragments: { hospB: digest("b") } })).toThrow(
      /没有本节点 hospA/,
    );
  });

  it("片段哈希形状非法 → 拒", () => {
    expect(() => computePlanHash({ job, fragments: { hospA: "deadbeef" } })).toThrow(/sm3:<64hex>/);
    expect(() => computePlanHash({ job, fragments: {} })).toThrow(/至少要有一个节点片段/);
  });
});
