import { MDOP_MESSAGE_TYPES } from "../envelope";
import { MdopError } from "../errors";
import { propagateLabels } from "../label/lattice";
import { OPERATOR_KINDS, parseOperatorManifest } from "./operator";
import { SchemaError } from "./strict";
import {
  parseAggregateContribution,
  parseAggregateRequest,
  parseAggregateResult,
  serializeAggregateRequest,
} from "./aggregate";

const DIGEST = `sm3:${"ab".repeat(32)}`;

const requestBody = () => ({
  stage_id: "agg-1",
  op: "merge.fedavg-secure@1.0.0",
  aggregation: { algorithm: "fedavg", params: { weight: "sample_count" } },
  parties: ["node-a", "node-b"],
  timeout_s: 3600,
  encryption: "per_recipient_pubkey",
});

function secureAggregateManifest(over: Record<string, unknown> = {}) {
  return parseOperatorManifest({
    apiVersion: "mdop/v0.3",
    kind: "secure_aggregate",
    id: "merge.fedavg-secure",
    version: "1.0.0",
    category: "aggregation",
    digest: "component:fedavg-secure@1.0.0",
    publisher: "urn:tds:space-x:participant:platform",
    inputs: [{ name: "local_contribution", schema: "mdop.aggregate/1.0", accept_labels: ["C1"] }],
    outputs: [{ name: "aggregated", schema: "mdop.aggregate/1.0", label_rule: "C3" }],
    params: {},
    environments: ["native"],
    security: { network: "relay" },
    component: "aggregator@1.0.0",
    aggregation: { encryption: "per_recipient_pubkey", party_closure: "compile_time" },
    ...over,
  });
}

describe("aggregate messages", () => {
  it("请求体序列化后再解析得到同一规格", () => {
    const parsed = parseAggregateRequest(requestBody());
    expect(parseAggregateRequest(serializeAggregateRequest(parsed))).toEqual(parsed);
    expect(parsed.spec.parties).toEqual(["node-a", "node-b"]);
    expect(parsed.spec.encryption).toBe("per_recipient_pubkey");
  });

  it("贡献与结果可往返", () => {
    const contribution = {
      stage_id: "agg-1",
      contributor_id: "node-a",
      contribution_ref: "blob://agg-1/node-a",
      digest: DIGEST,
      partial_signature: "der:sig",
    };
    expect(parseAggregateContribution(JSON.parse(JSON.stringify(contribution)))).toEqual(contribution);

    const result = {
      stage_id: "agg-1",
      complete: true,
      contribution_refs: [
        { contributor_id: "node-a", contribution_ref: "blob://a", digest: DIGEST },
        { contributor_id: "node-b", contribution_ref: "blob://b", digest: DIGEST },
      ],
    };
    expect(parseAggregateResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it("缺参与方或重复参与方时拒绝结果", () => {
    expect(() =>
      parseAggregateResult({ stage_id: "agg-1", complete: false, contribution_refs: [] }),
    ).toThrow(SchemaError);
  });

  it("信封 msg_type 含聚合三型", () => {
    expect(MDOP_MESSAGE_TYPES).toEqual(
      expect.arrayContaining(["AggregateRequest", "AggregateContribution", "AggregateResult"]),
    );
  });
});

describe("secure_aggregate operator kind", () => {
  it("kind 枚举含 secure_aggregate，且清单可登记", () => {
    expect(OPERATOR_KINDS).toContain("secure_aggregate");
    const manifest = secureAggregateManifest();
    expect(manifest.kind).toBe("secure_aggregate");
    expect(manifest.aggregation).toEqual({
      encryption: "per_recipient_pubkey",
      party_closure: "compile_time",
    });
  });

  it("输入不是 C1 的清单不得登记", () => {
    expect(() =>
      secureAggregateManifest({
        inputs: [{ name: "local_contribution", schema: "mdop.aggregate/1.0", accept_labels: ["C0"] }],
      }),
    ).toThrow(SchemaError);
  });
});

describe("propagateLabels", () => {
  const edge = "local-update->aggregate";

  it("C1 输入经 secure_aggregate 得到 C3", () => {
    expect(propagateLabels(secureAggregateManifest(), ["C1"], edge)).toBe("C3");
  });

  it("C0 输入拒绝，并指明边", () => {
    const manifest = secureAggregateManifest();
    expect.assertions(3);
    try {
      propagateLabels(manifest, ["C0"], edge);
    } catch (err) {
      expect(err).toBeInstanceOf(MdopError);
      const mdop = err as MdopError;
      expect(mdop.code).toBe("E_LABEL_VIOLATION");
      expect(mdop.where.edge).toBe(edge);
    }
  });
});
