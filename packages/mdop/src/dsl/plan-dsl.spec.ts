import {
  DslParseError,
  compileMdopPlanDsl,
  explainMdopPlanDsl,
  parseMdopPlanDsl,
} from "./plan-dsl";

const sample = () => ({
  dslVersion: "mdop.plan/v1",
  template: { id: "rws.external-control", version: "1.0.0" },
  draft: "frozen",
  purpose: "study-purpose",
  applicant: { org: "sponsor", project: "study-1" },
  sources: {
    trial: {
      participant: "${trial}",
      dataProduct: "${trialProduct}",
      role: "sponsor-trial",
      contract: "ct-trial",
      projection: "sponsor-trial",
    },
    controls: {
      participant: "${controls}",
      dataProduct: "${controlsProduct}",
      role: "site-controls",
      contract: "ct-controls",
      projection: "site-controls",
    },
  },
  roles: {
    "sponsor-trial": "trial",
    "site-controls": "controls",
  },
  contracts: ["ct-trial", "ct-controls"],
  contractBundle: {
    bundleId: "bundle-1",
    version: "version-1",
    members: [
      { role: "trial", contractId: "ct-trial" },
      { role: "controls", contractId: "ct-controls" },
    ],
  },
  operators: [
    {
      id: "match",
      op: "rws.external-control@1.0.0",
      inputs: ["trial", "controls"],
      placement: "urn:tee",
      parameters: {
        strataKeys: "${strata}",
        caliperDays: 30,
      },
    },
    {
      id: "release",
      op: "declassify.small_cell@1.0.0",
      inputs: ["match"],
      placement: { node: "urn:tee" },
      parameters: { minCell: "${minCell}" },
    },
  ],
  placement: {},
  release: { artifact: "aggregate" },
  ethics: { required: false },
  budget: { maxQueries: 1 },
  window: {
    notBefore: "2026-01-01T00:00:00.000Z",
    notAfter: "2026-02-01T00:00:00.000Z",
  },
  evidence: { receipt: true },
});

const registries = {
  templateRegistry: { "rws.external-control": "1.0.0" },
  operatorRegistry: {
    "rws.external-control@1.0.0": "registered",
    "declassify.small_cell@1.0.0": "registered",
  },
};

const values = {
  trial: "p-trial",
  trialProduct: "dp-trial",
  controls: "p-controls",
  controlsProduct: "dp-controls",
  strata: ["A", "B"],
  minCell: 5,
};

describe("mdop.plan/v1", () => {
  it("确定性编译为现有 LogicalPlan，并生成相同 logicalPlanHash", () => {
    const first = compileMdopPlanDsl({ dsl: sample(), values, ...registries });
    const second = compileMdopPlanDsl({ dsl: sample(), values, ...registries });
    expect(second.canonicalPlan).toEqual(first.canonicalPlan);
    expect(second.logicalPlanHash).toBe(first.logicalPlanHash);
    expect(first.canonicalPlan.job.contracts).toEqual(["ct-trial", "ct-controls"]);
    expect(first.canonicalPlan.stages.find((stage) => stage.id === "match")?.params).toEqual({
      strataKeys: ["A", "B"],
      caliperDays: 30,
    });
    expect(explainMdopPlanDsl(sample()).join("\n")).toContain("bundle=bundle-1@version-1");
  });

  it("未知字段、未登记算子、非法 placement 与缺失引用均 fail-closed 并返回路径", () => {
    const unknown = { ...sample(), dynamicCode: "boom" };
    expect(() => parseMdopPlanDsl(unknown)).toThrow(DslParseError);
    expect(() => parseMdopPlanDsl(unknown)).toThrow(/dsl\.dynamicCode/);

    const badOperator = sample();
    badOperator.operators[0]!.op = "custom.evil@1.0.0";
    expect(() => compileMdopPlanDsl({ dsl: badOperator, ...registries })).toThrow(
      /dsl\.operators\.match\.op/,
    );

    const badPlacement = sample();
    badPlacement.operators[0]!.placement = "http://evil.example";
    expect(() => parseMdopPlanDsl(badPlacement)).toThrow(/placement/);
    expect(() => parseMdopPlanDsl(badPlacement)).toThrow(/urn:/);

    const missingInput = sample();
    missingInput.operators[0]!.inputs = ["missing"];
    expect(() => compileMdopPlanDsl({ dsl: missingInput, values, ...registries })).toThrow(
      /missing/,
    );
  });

  it("循环、脚本、网络、SQL 与动态代码不是 DSL 词汇", () => {
    for (const key of ["loop", "script", "url", "sql", "eval"]) {
      expect(() => parseMdopPlanDsl({ ...sample(), [key]: "x" })).toThrow(/禁止/);
    }
  });

  it("llm-draft 在模板展开和人工确认前不能进入编译", () => {
    const draft = { ...sample(), draft: "llm-draft" };
    expect(() => compileMdopPlanDsl({ dsl: draft, values, ...registries })).toThrow(/模板展开/);
    expect(() =>
      compileMdopPlanDsl({ dsl: draft, values, ...registries, templateExpanded: true }),
    ).toThrow(/人工确认|模板展开/);
  });

  it("DSL 不得通过默认值或第一项自动绑定参与方/数据/合约", () => {
    const source = sample().sources.trial;
    expect(source.participant).toBe("${trial}");
    expect(source.dataProduct).toBe("${trialProduct}");
    expect(source.contract).toBe("ct-trial");
    expect(() =>
      compileMdopPlanDsl({ dsl: sample(), values: { trial: "p-trial" }, ...registries }),
    ).toThrow(/未提供的表单占位符/);
  });

  it("JSON 语法错误带行号和修复建议", () => {
    try {
      parseMdopPlanDsl('{\n  "dslVersion": "mdop.plan/v1",\n}');
      throw new Error("should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DslParseError);
      expect((error as DslParseError).line).not.toBeNull();
      expect((error as DslParseError).suggestions.length).toBeGreaterThan(0);
    }
  });

  it("注册型外部对照需要冻结 study profile；真实研究还要求 P0 门全确认", () => {
    const registration = sample();
    registration.template = {
      id: "rws.external-control-registration",
      version: "1.0.0",
    };
    registration.operators[0]!.op =
      "rws.external-control-registration@1.0.0";
    const registriesRegistration = {
      templateRegistry: { "rws.external-control-registration": "1.0.0" },
      operatorRegistry: {
        "rws.external-control-registration@1.0.0": "registered",
        "declassify.small_cell@1.0.0": "registered",
      },
    };
    expect(() =>
      compileMdopPlanDsl({
        dsl: registration,
        values,
        ...registriesRegistration,
      }),
    ).toThrow(/study/);

    const withStudy = {
      ...registration,
      study: {
        studyId: "REG-ECA-001",
        design: "single-arm-with-external-control",
        objective: "superiority",
        evidenceRole: "primary",
        estimand: "ATT",
        estimator: "IPTW-ATT",
        timeZero: "treatment-start",
        outcome: "event",
        profileVersion: "registration-eca/1.0.0",
        protocolVersion: "protocol-1",
        sapVersion: "sap-1",
        synthetic: false,
        frozen: true,
        p0DecisionsFrozen: false,
      },
    };
    expect(() =>
      compileMdopPlanDsl({
        dsl: withStudy,
        values,
        ...registriesRegistration,
      }),
    ).toThrow(/P0/);

    expect(
      compileMdopPlanDsl({
        dsl: { ...withStudy, study: { ...withStudy.study, synthetic: true } },
        values,
        ...registriesRegistration,
      }).audit.templateId,
    ).toBe("rws.external-control-registration");
  });
});
