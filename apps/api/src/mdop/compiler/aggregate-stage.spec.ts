import {
  MdopError,
  parseOperatorManifest,
  type PhysicalStage,
} from "@medtrust/mdop";
import { compileAggregateStage, expandAggregateStage } from "./aggregate-stage";

const manifest = parseOperatorManifest({
  apiVersion: "mdop/v0.3",
  kind: "secure_aggregate",
  id: "merge.fedavg-secure",
  version: "1.0.0",
  category: "aggregation",
  digest: "component:fedavg-secure@1.0.0",
  publisher: "urn:tds:space-x:participant:platform",
  inputs: [
    {
      name: "local_contribution",
      schema: "mdop.aggregate/1.0",
      accept_labels: ["C1"],
    },
  ],
  outputs: [
    { name: "aggregated", schema: "mdop.aggregate/1.0", label_rule: "C3" },
  ],
  params: {},
  environments: ["native"],
  security: { network: "relay" },
  component: "aggregator@1.0.0",
  aggregation: {
    encryption: "per_recipient_pubkey",
    party_closure: "compile_time",
  },
});

const platform = "urn:tds:space-x:participant:platform";

describe("compileAggregateStage", () => {
  it("从数据持有节点闭合参与方，并为每方生成贡献上传片段", () => {
    const compiled = compileAggregateStage({
      stageId: "agg",
      manifest,
      inputLabels: ["C1", "C1"],
      upstreamNodes: ["node-b", "node-a", "node-b"],
      platformNode: platform,
      params: { timeout_s: 60 },
    });
    expect(compiled.parties).toEqual(["node-a", "node-b"]);
    expect(compiled.outputLabel).toBe("C3");
    expect(compiled.subplan).toEqual([
      { node: "node-a", steps: ["contribute", "upload"] },
      { node: "node-b", steps: ["contribute", "upload"] },
    ]);
  });

  it("C0 输入拒绝并指明边", () => {
    expect.assertions(3);
    try {
      compileAggregateStage({
        stageId: "agg",
        manifest,
        inputLabels: ["C0", "C1"],
        upstreamNodes: ["node-a", "node-b"],
        platformNode: platform,
        params: { timeout_s: 60 },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(MdopError);
      const mdop = err as MdopError;
      expect(mdop.code).toBe("E_LABEL_VIOLATION");
      expect(mdop.where.edge).toBe("node-a+node-b->agg");
    }
  });
});

describe("expandAggregateStage", () => {
  it("每个参与方片段只保留本节点的上游", () => {
    const local = (id: string, node: string): PhysicalStage => ({
      id,
      node,
      op: "local.train@1.0.0",
      op_digest: "sm3:" + "a".repeat(64),
      params: {},
      inputs: [],
      input_labels: ["C0"],
      output_label: "C1",
      output_schema: "mdop.aggregate/1.0",
    });
    const agg: PhysicalStage = {
      id: "agg",
      node: "node-a",
      op: "merge.fedavg-secure@1.0.0",
      op_digest: "component:fedavg-secure@1.0.0",
      params: {
        aggregate: {
          parties: ["node-a", "node-b"],
          timeout_s: 60,
          encryption: "per_recipient_pubkey",
          algorithm: "fedavg",
          steps: ["contribute", "upload"],
        },
      },
      inputs: [{ from: "train-a" }, { from: "train-b" }],
      input_labels: ["C1", "C1"],
      output_label: "C3",
      output_schema: "mdop.aggregate/1.0",
    };
    const copies = expandAggregateStage(agg, [
      local("train-a", "node-a"),
      local("train-b", "node-b"),
      agg,
    ]);
    expect(
      copies?.map((stage) => [stage.node, stage.inputs.map((i) => i.from)]),
    ).toEqual([
      ["node-a", ["train-a"]],
      ["node-b", ["train-b"]],
    ]);
  });
});
