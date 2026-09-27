import {
  FLOW_LABELS,
  assertDeclassifyNotWeaker,
  assertNodeCanRun,
  deriveOutputLabel,
  edgeRef,
  joinAll,
  joinLabels,
  leq,
  validateEdge,
  type EdgeCheckContext,
  type FlowLabel,
  type NodeCapability,
  type PlanEdge,
} from "./lattice";
import { parseOperatorManifest, type OperatorManifest } from "../schema/operator";
import { MdopError } from "../errors";

const capability = (over: Partial<NodeCapability> = {}): NodeCapability => ({
  node: "hospA",
  runtime: ["wasm", "native"],
  system_ops: ["source.dataset@1.0.0", "declassify.small_cell@1.0.0"],
  whitelist_digests: [],
  tee: null,
  protocols: [],
  ...over,
});

function ctx(over: Partial<EdgeCheckContext> = {}): EdgeCheckContext {
  return {
    contract_recipients: ["hospA", "hospB", "platform"],
    capabilities: new Map([
      ["hospA", capability({ node: "hospA" })],
      ["hospB", capability({ node: "hospB" })],
      [
        "platform",
        capability({ node: "platform", system_ops: ["merge.disproportionality@1.0.0"] }),
      ],
    ]),
    ...over,
  };
}

function edge(over: Partial<PlanEdge> = {}): PlanEdge {
  return {
    from_stage: "s1",
    to_stage: "s2",
    label: "C3",
    from_node: "hospA",
    to_node: "platform",
    ...over,
  };
}

const localOp = (over: Record<string, unknown> = {}): OperatorManifest =>
  parseOperatorManifest({
    apiVersion: "mdop/v0.2",
    kind: "wasm",
    id: "rws.disproportionality",
    version: "1.0.0",
    category: "local",
    digest: `sm3:${"a".repeat(64)}`,
    publisher: "urn:tds:space-x:participant:platform",
    inputs: [{ name: "dataset", schema: "mdop.table/1.0", accept_labels: ["C0"] }],
    outputs: [{ name: "table", schema: "mdop.table/1.0", label_rule: "inherit" }],
    params: {},
    environments: ["plain"],
    security: { network: "none" },
    build: {
      source_digest: `sm3:${"b".repeat(64)}`,
      toolchain: "asc@0.27.37",
      reproducible: true,
    },
    ...over,
  });

const declassifyOp = (): OperatorManifest =>
  parseOperatorManifest({
    apiVersion: "mdop/v0.2",
    kind: "system",
    id: "declassify.small_cell",
    version: "1.0.0",
    category: "declassify",
    digest: "component:connector@1",
    publisher: "urn:tds:space-x:participant:platform",
    inputs: [{ name: "table", schema: "mdop.table/1.0", accept_labels: ["C0"] }],
    outputs: [{ name: "table", schema: "mdop.table/1.0", label_rule: "C3" }],
    params: { minCell: { type: "int" } },
    environments: ["plain"],
    security: { network: "none" },
    component: "mdop-gate@1.0.0",
  });

const sealOp = (over: Record<string, unknown> = {}): OperatorManifest =>
  parseOperatorManifest({
    apiVersion: "mdop/v0.2",
    kind: "system",
    id: "seal.envelope",
    version: "1.0.0",
    category: "seal",
    digest: "component:seal@1",
    publisher: "urn:tds:space-x:participant:platform",
    inputs: [{ name: "data", schema: "mdop.dataset/1.0", accept_labels: ["C0"] }],
    outputs: [{ name: "envelope", schema: "mdop.env/1.0", label_rule: "C2" }],
    params: {},
    environments: ["plain"],
    security: { network: "none" },
    component: "seal@1.0.0",
    ...over,
  });

const unsealOp = (): OperatorManifest =>
  parseOperatorManifest({
    apiVersion: "mdop/v0.2",
    kind: "system",
    id: "unseal.envelope",
    version: "1.0.0",
    category: "seal",
    digest: "component:unseal@1",
    publisher: "urn:tds:space-x:participant:platform",
    inputs: [{ name: "envelope", schema: "mdop.env/1.0", accept_labels: ["C2"] }],
    outputs: [{ name: "data", schema: "mdop.dataset/1.0", label_rule: "C0" }],
    params: {},
    environments: ["plain"],
    security: { network: "none" },
    component: "unseal@1.0.0",
  });

describe("封装类算子（seal / unseal）的等级规则", () => {
  it("封装：C0 → C2（持有方本地）", () => {
    expect(deriveOutputLabel(sealOp(), ["C0"])).toBe("C2");
  });

  it("封装只能封 C0：把 C1/C3 塞进去、或没有输入，都拒", () => {
    for (const input of [["C1"], ["C3"], ["C0", "C1"]] as FlowLabel[][]) {
      expect(() => deriveOutputLabel(sealOp(), input)).toThrow(
        expect.objectContaining({ code: "E_LABEL_VIOLATION" }),
      );
    }
    expect(() => deriveOutputLabel(sealOp(), [])).toThrow(
      expect.objectContaining({ code: "E_LABEL_VIOLATION" }),
    );
  });

  it("解封：C2 → C0（可信空间节点内，产出视为该节点的 C0）", () => {
    expect(deriveOutputLabel(unsealOp(), ["C2"])).toBe("C0");
  });

  it("解封只接受 C2：拿 C0/C3 来解，拒", () => {
    for (const input of [["C0"], ["C3"], ["C0", "C2"]] as FlowLabel[][]) {
      expect(() => deriveOutputLabel(unsealOp(), input)).toThrow(
        expect.objectContaining({ code: "E_LABEL_VIOLATION" }),
      );
    }
  });

  it("清单登记阶段：封装类算子必须声明 C2（封装）或 C0（解封），inherit / C3 / C1 直接不给登记", () => {
    for (const rule of ["inherit", "C3", "C1"]) {
      expect(() =>
        sealOp({ outputs: [{ name: "envelope", schema: "mdop.env/1.0", label_rule: rule }] }),
      ).toThrow(/封装类算子的输出规则/);
    }
  });

  it("非封装算子不得从非 C2 输入造出 C2（只有 seal 能产生信封）", () => {
    const op = localOp();
    expect(() => deriveOutputLabel(op, ["C0", "C2"])).toThrow(
      expect.objectContaining({ code: "E_LABEL_VIOLATION" }),
    );
    // 纯 C2 输入仍按 R1 传递（例如节点内的搬运/路由）
    expect(deriveOutputLabel(op, ["C2"])).toBe("C2");
  });

  it("system 允许承载封装机制（清单可直接登记）", () => {
    expect(sealOp().category).toBe("seal");
    expect(sealOp().kind).toBe("system");
  });
});

describe("流动等级格 C0–C3", () => {
  it("穷举 5×5：C0_internal < C0 最严、C3 最宽、C1 与 C2 互不可比", () => {
    const expected: Record<string, FlowLabel> = {
      "C0_internal,C0_internal": "C0_internal",
      "C0_internal,C0": "C0",
      "C0_internal,C1": "C1",
      "C0_internal,C2": "C2",
      "C0_internal,C3": "C3",
      "C0,C0_internal": "C0",
      "C0,C0": "C0",
      "C0,C1": "C1",
      "C0,C2": "C2",
      "C0,C3": "C3",
      "C1,C0_internal": "C1",
      "C1,C0": "C1",
      "C1,C1": "C1",
      "C1,C2": "C0",
      "C1,C3": "C3",
      "C2,C0_internal": "C2",
      "C2,C0": "C2",
      "C2,C1": "C0",
      "C2,C2": "C2",
      "C2,C3": "C3",
      "C3,C0_internal": "C3",
      "C3,C0": "C3",
      "C3,C1": "C3",
      "C3,C2": "C3",
      "C3,C3": "C3",
    };
    for (const a of FLOW_LABELS)
      for (const b of FLOW_LABELS) expect(joinLabels(a, b)).toBe(expected[`${a},${b}`]);
  });

  it("序关系：C1 与 C2 互不可比，join 判 C0（规格场景）", () => {
    expect(leq("C1", "C2")).toBe(false);
    expect(leq("C2", "C1")).toBe(false);
    expect(leq("C0", "C1")).toBe(true);
    expect(leq("C2", "C3")).toBe(true);
    expect(joinAll(["C1", "C2"])).toBe("C0");
    expect(joinAll(["C1", "C2", "C3"])).toBe("C0");
    // 判据是集合，与顺序无关
    expect(joinAll(["C3", "C2", "C1"])).toBe("C0");
    // 无输入（source 类）按最严处理，不得凭空判成最宽
    expect(joinAll([])).toBe("C0");
  });

  it("普通算子输出 = 全部输入的 join（穷举 16 种组合）", () => {
    const manifest = localOp();
    for (const a of FLOW_LABELS)
      for (const b of FLOW_LABELS)
        // 唯一的例外是「从非 C2 输入算出 C2」：那是凭空造信封，只有封装算子可以做（R4）。
        if (joinLabels(a, b) === "C2" && (a !== "C2" || b !== "C2")) {
          expect(() => deriveOutputLabel(manifest, [a, b])).toThrow(
            expect.objectContaining({ code: "E_LABEL_VIOLATION" }),
          );
        } else {
          expect(deriveOutputLabel(manifest, [a, b])).toBe(joinLabels(a, b));
        }
  });

  it("普通算子声明固定输出等级 → E_LABEL_VIOLATION", () => {
    expect(() =>
      parseOperatorManifest({
        apiVersion: "mdop/v0.2",
        kind: "wasm",
        id: "x",
        version: "1.0.0",
        category: "local",
        digest: `sm3:${"a".repeat(64)}`,
        publisher: "p",
        inputs: [],
        outputs: [{ name: "o", schema: "s", label_rule: "C3" }],
        params: {},
        environments: ["plain"],
        security: { network: "none" },
        build: { source_digest: `sm3:${"b".repeat(64)}`, toolchain: "t", reproducible: true },
      }),
    ).toThrow(/inherit/);
  });

  it("降密算子可降级；参数弱于合约 → E_LABEL_VIOLATION", () => {
    const manifest = declassifyOp();
    expect(deriveOutputLabel(manifest, ["C0"])).toBe("C3");
    expect(() => assertDeclassifyNotWeaker({ minCell: 10 }, { minCell: 10 })).not.toThrow();
    expect(() => assertDeclassifyNotWeaker({ minCell: 11 }, { minCell: 10 })).not.toThrow();
    expect(() => assertDeclassifyNotWeaker({ minCell: 7 }, { minCell: 10 })).toThrow(
      expect.objectContaining({ code: "E_LABEL_VIOLATION" }),
    );
    expect(() => assertDeclassifyNotWeaker({}, { minCell: 10 })).toThrow(MdopError);
  });
});

describe("跨节点边校验（含违规边定位）", () => {
  it("同节点边不校验（C0 不出节点由其它闸门管）", () => {
    expect(() => validateEdge(edge({ label: "C0", to_node: "hospA" }), ctx())).not.toThrow();
  });

  it("C0 跨节点 → E_LABEL_VIOLATION，并指出边", () => {
    try {
      validateEdge(edge({ label: "C0" }), ctx());
      throw new Error("应当抛错");
    } catch (e) {
      expect(e).toBeInstanceOf(MdopError);
      expect((e as MdopError).code).toBe("E_LABEL_VIOLATION");
      expect((e as MdopError).where.edge).toBe(edgeRef(edge()));
    }
  });

  it("C3 目标不在合约接收方列表 → E_CAPABILITY_MISMATCH", () => {
    const context = ctx({ contract_recipients: ["hospA"] });
    try {
      validateEdge(edge({ label: "C3" }), context);
      throw new Error("应当抛错");
    } catch (e) {
      expect((e as MdopError).code).toBe("E_CAPABILITY_MISMATCH");
      expect((e as MdopError).where.edge).toBe("s1->s2");
    }
  });

  it("C3 目标在列表内则通过", () => {
    expect(() => validateEdge(edge({ label: "C3" }), ctx())).not.toThrow();
  });

  it("C1 边端点未声明同一协同协议 → E_CAPABILITY_MISMATCH；声明一致则通过", () => {
    expect(() => validateEdge(edge({ label: "C1" }), ctx())).toThrow(
      expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }),
    );
    const context = ctx({
      capabilities: new Map([
        ["hospA", capability({ node: "hospA", protocols: [{ name: "mpc", version: "1" }] })],
        ["platform", capability({ node: "platform", protocols: [{ name: "mpc", version: "1" }] })],
      ]),
    });
    expect(() => validateEdge(edge({ label: "C1" }), context)).not.toThrow();
  });

  it("C2 目标未声明 TEE 能力 → E_CAPABILITY_MISMATCH（本期一律如此）", () => {
    expect(() => validateEdge(edge({ label: "C2" }), ctx())).toThrow(
      expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }),
    );
    const context = ctx({
      capabilities: new Map([
        ["hospA", capability({ node: "hospA" })],
        ["platform", capability({ node: "platform", tee: { kind: "tdx" } })],
      ]),
      attestation_policy: { tee: ["tdx"] },
    });
    expect(() => validateEdge(edge({ label: "C2" }), context)).not.toThrow();
  });
});

describe("节点能力匹配", () => {
  it("本期 oci 未启用 → E_CAPABILITY_MISMATCH", () => {
    const oci = parseOperatorManifest({
      apiVersion: "mdop/v0.2",
      kind: "oci",
      id: "x",
      version: "1.0.0",
      category: "local",
      digest: "sha256:abc",
      publisher: "p",
      inputs: [],
      outputs: [{ name: "o", schema: "s", label_rule: "inherit" }],
      params: {},
      environments: ["plain"],
      security: { network: "none" },
    });
    expect(() =>
      assertNodeCanRun(oci, capability(), { id: "x", version: "1.0.0" }),
    ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
  });

  it("未通告 wasm 运行时 / 未登记 system 算子 → E_CAPABILITY_MISMATCH", () => {
    expect(() =>
      assertNodeCanRun(localOp(), capability({ runtime: ["native"] }), {
        id: "rws.disproportionality",
        version: "1.0.0",
      }),
    ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
    expect(() =>
      assertNodeCanRun(declassifyOp(), capability({ system_ops: [] }), {
        id: "declassify.small_cell",
        version: "1.0.0",
      }),
    ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
  });

  it("能力齐备则通过", () => {
    expect(() =>
      assertNodeCanRun(declassifyOp(), capability(), { id: "declassify.small_cell", version: "1.0.0" }),
    ).not.toThrow();
  });
});
