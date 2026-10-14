import {
  DISABLED_KINDS,
  parseOperatorManifest,
  parseOperatorRef,
} from "./operator";
import { parseLogicalPlan } from "./plan";
import { parseTicketCore } from "./ticket";
import { parseArtifactHandle } from "./artifact";
import { parseMdopContract } from "./contract";
import { parseRevocationList, assertMonotonicVersion } from "./revocation";
import { SchemaError } from "./strict";

const digest = `sm3:${"a".repeat(64)}`;

describe("协议对象结构校验：缺必填 / 多未定义一律拒", () => {
  it("凭证核心缺 plan_hash → 拒（不按缺省补全）", () => {
    expect(() =>
      parseTicketCore({
        ticket_id: "tkt-1",
        job_id: "job-1",
        fragments: { hospA: digest },
        not_before: "2026-09-24T00:00:00Z",
        not_after: "2026-09-25T00:00:00Z",
      }),
    ).toThrow(/缺少必填字段 plan_hash/);
  });

  it("凭证核心多一个未定义字段 → 拒", () => {
    expect(() =>
      parseTicketCore({
        ticket_id: "tkt-1",
        job_id: "job-1",
        plan_hash: digest,
        fragments: { hospA: digest },
        not_before: "2026-09-24T00:00:00Z",
        not_after: "2026-09-25T00:00:00Z",
        extra: true,
      }),
    ).toThrow(/未定义字段 extra/);
  });

  it("逻辑计划缺用途编码 → 拒", () => {
    expect(() =>
      parseLogicalPlan({
        job: { applicant: { org: "o", project: "p" }, contracts: ["c1"] },
        stages: [],
      }),
    ).toThrow(/缺少必填字段 purpose/);
  });

  it("逻辑计划参数里夹带可执行代码 → 拒", () => {
    expect(() =>
      parseLogicalPlan({
        job: { purpose: "RWS.EFFECTIVENESS", applicant: { org: "o", project: "p" }, contracts: ["c1"] },
        stages: [{ id: "s1", op: "x@1.0.0", inputs: [], params: { script: "..." } }],
      }),
    ).toThrow(/可执行代码/);
  });

  it("句柄：非 C3 带 stats 一律拒；C3 可以带", () => {
    const base = {
      handle: "art://hospA/job-1/s1/out",
      schema: "mdop.table/1.0",
      digest,
      producer: { stage: "s1", op: "x@1.0.0", op_digest: digest },
      ticket_id: "tkt-1",
      expires_at: "2026-09-27T00:00:00Z",
    };
    expect(() => parseArtifactHandle({ ...base, label: "C0", stats: { rows: 3 } })).toThrow(
      /只有 C3 句柄可以填写 stats/,
    );
    expect(parseArtifactHandle({ ...base, label: "C3", stats: { rows: 3 } }).stats).toEqual({
      rows: 3,
    });
    expect(parseArtifactHandle({ ...base, label: "C0", stats: null }).stats).toBeNull();
  });

  it("句柄缺凭证关联（ticket_id）→ 拒：句柄必须能追溯到执行凭证，否则无法归属到会话", () => {
    const base = {
      handle: "art://hospA/job-1/s1/out",
      label: "C3",
      schema: "mdop.table/1.0",
      digest,
      producer: { stage: "s1", op: "x@1.0.0", op_digest: digest },
      expires_at: "2026-09-27T00:00:00Z",
      stats: null,
    };
    // 有 ticket_id → 通过（对照组，证明拒的是缺字段而不是别的）
    expect(parseArtifactHandle({ ...base, ticket_id: "tkt-1" }).ticket_id).toBe("tkt-1");
    // 缺 ticket_id → 拒（`checkKeys` 的必填项；这就是「缺少关联的句柄 MUST 被拒绝登记」的 enforcement）
    expect(() => parseArtifactHandle(base)).toThrow(/ticket_id/);
    expect(() => parseArtifactHandle({ ...base, ticket_id: "" })).toThrow(/ticket_id/);
  });

  it("算子引用必须是 id@x.y.z", () => {
    expect(parseOperatorRef("rws.disproportionality@1.0.0")).toEqual({
      id: "rws.disproportionality",
      version: "1.0.0",
    });
    expect(() => parseOperatorRef("rws.disproportionality")).toThrow(SchemaError);
  });
});

describe("算子清单规则（D-MDOP-5）", () => {
  const systemBase = {
    apiVersion: "mdop/v0.2",
    kind: "system",
    id: "source.dataset",
    version: "1.0.0",
    category: "source",
    digest: "component:connector@1",
    publisher: "urn:tds:space-x:participant:platform",
    inputs: [],
    outputs: [{ name: "o", schema: "s", label_rule: "inherit" }],
    params: {},
    environments: ["plain"],
    security: { network: "none" },
    component: "connector@1.0.0",
  };

  it("system 算子冒充分析算子 → 拒", () => {
    expect(() => parseOperatorManifest({ ...systemBase, category: "local" })).toThrow(
      /不许冒充分析算子/,
    );
  });

  it("system 算子必须是 source / seal / declassify / merge 之一", () => {
    for (const category of ["source", "declassify", "merge"]) {
      const label_rule = category === "declassify" ? "C3" : "inherit";
      expect(() =>
        parseOperatorManifest({
          ...systemBase,
          category,
          outputs: [{ name: "o", schema: "s", label_rule }],
        }),
      ).not.toThrow();
    }
    // seal 是机制型算子，可声明 C2（封装）/ C0（解封），见协议 §4.2 R4 补注
    expect(() =>
      parseOperatorManifest({
        ...systemBase,
        id: "seal.envelope",
        category: "seal",
        outputs: [{ name: "o", schema: "s", label_rule: "C2" }],
      }),
    ).not.toThrow();
    expect(() => parseOperatorManifest({ ...systemBase, category: "control" })).toThrow(
      /不许冒充分析算子/,
    );
    expect(() =>
      parseOperatorManifest({
        ...systemBase,
        kind: "wasm",
        category: "control",
        build: { source_digest: digest, toolchain: "t", reproducible: true },
        component: undefined,
      }),
    ).toThrow(/control 类只能是 system 机制/);
  });

  it("非协同算子的 security.network 必须是 none", () => {
    expect(() => parseOperatorManifest({ ...systemBase, security: { network: "egress" } })).toThrow(
      /必须是 none/,
    );
  });

  it("wasm 算子必须有可复现构建记录", () => {
    const wasm = {
      apiVersion: "mdop/v0.2",
      kind: "wasm",
      id: "x",
      version: "1.0.0",
      category: "local",
      digest,
      publisher: "p",
      inputs: [],
      outputs: [{ name: "o", schema: "s", label_rule: "inherit" }],
      params: {},
      environments: ["plain"],
      security: { network: "none" },
    };
    expect(() => parseOperatorManifest(wasm)).toThrow(/可复现构建记录/);
    expect(() =>
      parseOperatorManifest({
        ...wasm,
        build: { source_digest: digest, toolchain: "asc@0.27.37", reproducible: false },
      }),
    ).toThrow(/复现不出的摘要不得登记/);
    expect(() =>
      parseOperatorManifest({
        ...wasm,
        build: { source_digest: digest, toolchain: "asc@0.27.37", reproducible: true },
      }),
    ).not.toThrow();
  });

  it("oci 摘要必须是镜像 digest（且本期 kind 在被禁用清单里）", () => {
    expect(DISABLED_KINDS).toContain("oci");
    expect(() =>
      parseOperatorManifest({
        ...systemBase,
        kind: "oci",
        category: "local",
        digest: "not-a-digest",
        component: undefined,
      }),
    ).toThrow(SchemaError);
  });
});

describe("合约与吊销名单", () => {
  const contract = {
    apiVersion: "mdop/v0.2",
    contract_id: "ctr-1",
    data_product_id: "dp-1",
    provider: "urn:tds:space-x:participant:hospA",
    consumer: "urn:tds:space-x:participant:sponsor",
    purpose: "RWS.EFFECTIVENESS",
    retention: "阅后即焚",
    recipients: [
      { party: "urn:tds:space-x:participant:hospA", role: "final", jurisdiction: "CN" },
      { party: "urn:tds:space-x:participant:platform", role: "merger", jurisdiction: "CN" },
    ],
    allowed_ops: [digest],
    review: { mode: "auto", deadline_hours: 72 },
    ethics: { required: false, ref: null, valid_until: null },
    provider_public_key_kid: "a".repeat(64),
    platform_public_key_kid: "b".repeat(64),
    pre_review_snapshot: null,
    publication: { minCell: 10 },
    valid_from: "2026-09-01T00:00:00Z",
    valid_until: "2027-09-01T00:00:00Z",
  };

  it("合约解析通过；要求伦理批件却没批件号即拒", () => {
    expect(parseMdopContract(contract).publication.minCell).toBe(10);
    // D-RWS-7 / 跨院去重变更 tasks 10.1：罕见病列的更严阈值也在合约里，
    // 且 `minCellRare < minCell` 属放宽 -> fail-closed。
    const rare = parseMdopContract({
      ...contract,
      publication: { minCell: 10, minCellRare: 20 },
    });
    expect(rare.publication).toEqual({ minCell: 10, minCellRare: 20 });
    expect(() =>
      parseMdopContract({
        ...contract,
        publication: { minCell: 10, minCellRare: 5 },
      }),
    ).toThrow(SchemaError);
    expect(() =>
      parseMdopContract({ ...contract, ethics: { required: true, ref: null, valid_until: null } }),
    ).toThrow(/必须给出批件号/);
  });

  it("证明策略（C2）：缺省即无 C2 资格；给了就要按形状解析", () => {
    // 缺省：非 C2 作业的合约不带该字段（向后兼容，规范化里也不出现）
    expect(parseMdopContract(contract).attestation_policy).toBeUndefined();

    const withPolicy = parseMdopContract({
      ...contract,
      attestation_policy: {
        tee: ["csv", "tdx"],
        min_tcb: { csv: "2026-06", tdx: "3.1.2" },
        allowed_measurements: ["sm3:" + "c".repeat(64)],
      },
    });
    expect(withPolicy.attestation_policy).toEqual({
      tee: ["csv", "tdx"],
      min_tcb: { csv: "2026-06", tdx: "3.1.2" },
      allowed_measurements: ["sm3:" + "c".repeat(64)],
    });

    // 单值阈值也接受
    expect(
      parseMdopContract({ ...contract, attestation_policy: { tee: ["csv"], min_tcb: "2026-06" } })
        .attestation_policy?.min_tcb,
    ).toBe("2026-06");
  });

  it("证明策略形状非法即拒：空链型清单 / 空度量清单 / 未知字段 / 非字符串阈值", () => {
    for (const bad of [
      { tee: [] },
      { tee: ["tdx"], allowed_measurements: [] },
      { tee: ["tdx"], extra: true },
      { tee: ["tdx"], min_tcb: 202606 },
    ]) {
      expect(() => parseMdopContract({ ...contract, attestation_policy: bad })).toThrow(SchemaError);
    }
  });

  it("接收方 role 只许 merger / final", () => {
    expect(() =>
      parseMdopContract({
        ...contract,
        recipients: [{ party: "p", role: "other", jurisdiction: "CN" }],
      }),
    ).toThrow(/必须 merger 或 final/);
  });

  it("吊销名单版本单调：低版本拒、同版本同内容可重复、同版本不同内容拒", () => {
    const list = (version: number, digests: string[]) => ({
      version,
      issued_at: "2026-09-24T00:00:00Z",
      revoked_digests: digests,
      sig: { alg: "SM2-SM3", kid: "a".repeat(64), value: "00" },
    });
    const local = { version: 5, revoked_digests: [digest] };
    expect(() => assertMonotonicVersion(parseRevocationList(list(6, [digest])), local)).not.toThrow();
    expect(() => assertMonotonicVersion(parseRevocationList(list(5, [digest])), local)).not.toThrow();
    expect(() => assertMonotonicVersion(parseRevocationList(list(4, [digest])), local)).toThrow(
      /版本回退/,
    );
    expect(() => assertMonotonicVersion(parseRevocationList(list(5, ["sm3:" + "c".repeat(64)])), local)).toThrow(
      /同版本内容不一致/,
    );
  });
});
