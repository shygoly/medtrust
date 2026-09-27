import {
  parseServiceProtocolSpec,
  validateServiceTopology,
  parseMdopContract,
  type ServiceProtocolSpec,
} from "../index";

describe("服务计算协议标准 Schema（ServiceProtocolSpec）", () => {
  const validSpec: ServiceProtocolSpec = {
    protocol_version: "medtrust.service_proto/1.0",
    target_corpus_ids: ["corpus_alpha_2026"],
    topology: {
      stages: [
        {
          stage_id: "stage_filter",
          required_op: "filter.row_filter@1.0.0",
          depends_on: ["ds://provider/corpus_alpha_2026"],
          intermediate_label: "C0_internal",
        },
        {
          stage_id: "stage_aggregate",
          required_op: "stat.aggregation@1.0.0",
          depends_on: ["stage_filter"],
          intermediate_label: "C0_internal",
        },
      ],
      final_stage_id: "stage_aggregate",
    },
    operator_whitelist: [
      {
        op: "filter.row_filter",
        version: "1.0.0",
        kind: "wasm",
        sm3_digest: "a".repeat(64),
      },
      {
        op: "stat.aggregation",
        version: "1.0.0",
        kind: "wasm",
        sm3_digest: "b".repeat(64),
      },
    ],
    parameter_space: {
      allowed_filter_columns: ["age_bracket", "region_code"],
      max_time_window_days: 30,
      allowed_grouping_columns: ["region_code"],
      prohibited_predicates: ["raw_identifier_match"],
    },
    budget_policy: {
      total_epsilon: 10.0,
      delta: 1e-5,
      max_queries: 100,
      min_cell_size: 5,
      rate_limit_per_hour: 20,
      circuit_breaker_enabled: true,
    },
  };

  it("正常解析服务协议标准规范", () => {
    const parsed = parseServiceProtocolSpec(validSpec);
    expect(parsed.protocol_version).toBe("medtrust.service_proto/1.0");
    expect(parsed.target_corpus_ids).toEqual(["corpus_alpha_2026"]);
    expect(parsed.topology.stages).toHaveLength(2);
    expect(parsed.budget_policy.total_epsilon).toBe(10.0);
    expect(parsed.budget_policy.min_cell_size).toBe(5);
  });

  it("拓扑阶段存在重复 stage_id 时抛出 SchemaError", () => {
    const invalid = {
      ...validSpec,
      topology: {
        stages: [
          {
            stage_id: "dup_stage",
            required_op: "op1@1",
            depends_on: [],
            intermediate_label: "C0_internal",
          },
          {
            stage_id: "dup_stage",
            required_op: "op2@1",
            depends_on: [],
            intermediate_label: "C0_internal",
          },
        ],
        final_stage_id: "dup_stage",
      },
    };
    expect(() => parseServiceProtocolSpec(invalid)).toThrow("重复的阶段标识");
  });

  it("最终阶段不在 stages 列表中时抛出 SchemaError", () => {
    const invalid = {
      ...validSpec,
      topology: {
        ...validSpec.topology,
        final_stage_id: "non_existent_final",
      },
    };
    expect(() => parseServiceProtocolSpec(invalid)).toThrow("不在管道阶段列表中");
  });

  it("中间阶段标签非 C0_internal 时抛出 SchemaError（强制飞地内存隔离）", () => {
    const invalid = {
      ...validSpec,
      topology: {
        stages: [
          {
            stage_id: "stage_1",
            required_op: "op@1",
            depends_on: [],
            intermediate_label: "C3", // 非法：中间产物不能标 C3 出域
          },
        ],
        final_stage_id: "stage_1",
      },
    };
    expect(() => parseServiceProtocolSpec(invalid)).toThrow("中间阶段标签必须为 C0_internal");
  });

  it("拓扑中检测到环路依赖时抛出 SchemaError", () => {
    const cyclic = {
      stages: [
        {
          stage_id: "a",
          required_op: "op_a@1",
          depends_on: ["b"],
          intermediate_label: "C0_internal" as const,
        },
        {
          stage_id: "b",
          required_op: "op_b@1",
          depends_on: ["a"],
          intermediate_label: "C0_internal" as const,
        },
      ],
      final_stage_id: "b",
    };
    expect(() => validateServiceTopology(cyclic)).toThrow("管道拓扑存在环路依赖");
  });

  it("依赖了不存在的前序阶段时抛出 SchemaError", () => {
    const broken = {
      stages: [
        {
          stage_id: "a",
          required_op: "op_a@1",
          depends_on: ["ghost_stage"],
          intermediate_label: "C0_internal" as const,
        },
      ],
      final_stage_id: "a",
    };
    expect(() => validateServiceTopology(broken)).toThrow("引用了不存在的前序阶段");
  });

  it("非 wasm 算子类型被严格拒绝（fail-closed）", () => {
    const invalid = {
      ...validSpec,
      operator_whitelist: [
        {
          op: "shell.exec",
          version: "1.0",
          kind: "native_binary",
          sm3_digest: "c".repeat(64),
        },
      ],
    };
    expect(() => parseServiceProtocolSpec(invalid)).toThrow("仅支持 wasm");
  });

  it("非法 SM3 哈希长度或格式被拒绝", () => {
    const invalid = {
      ...validSpec,
      operator_whitelist: [
        {
          op: "test.op",
          version: "1.0",
          kind: "wasm",
          sm3_digest: "not_a_valid_sm3_digest",
        },
      ],
    };
    expect(() => parseServiceProtocolSpec(invalid)).toThrow("64 字节十六进制哈希");
  });

  it("预算参数非法（如 epsilon <= 0 或 max_queries <= 0）时被拒绝", () => {
    expect(() =>
      parseServiceProtocolSpec({
        ...validSpec,
        budget_policy: { ...validSpec.budget_policy, total_epsilon: -1 },
      }),
    ).toThrow("必须大于 0");

    expect(() =>
      parseServiceProtocolSpec({
        ...validSpec,
        budget_policy: { ...validSpec.budget_policy, max_queries: 0 },
      }),
    ).toThrow("必须为正整数");
  });

  it("数字合约可包含并严格解析 service_protocol", () => {
    const rawContract = {
      apiVersion: "mdop.contract/1.0",
      contract_id: "ct_service_001",
      data_product_id: "dp_001",
      provider: "party_provider",
      consumer: "party_consumer",
      purpose: "service_analytics",
      retention: "contract-duration",
      recipients: [{ party: "party_consumer", role: "final", jurisdiction: "CN" }],
      allowed_ops: ["a".repeat(64)],
      review: { mode: "auto", deadline_hours: 24 },
      ethics: { required: false, ref: null, valid_until: null },
      provider_public_key_kid: "kid_p",
      platform_public_key_kid: "kid_plat",
      pre_review_snapshot: null,
      publication: { minCell: 5 },
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2026-12-31T23:59:59.000Z",
      service_protocol: validSpec,
    };

    const parsed = parseMdopContract(rawContract);
    expect(parsed.service_protocol).toBeDefined();
    expect(parsed.service_protocol?.protocol_version).toBe("medtrust.service_proto/1.0");
    expect(parsed.service_protocol?.target_corpus_ids).toEqual(["corpus_alpha_2026"]);
  });
});
