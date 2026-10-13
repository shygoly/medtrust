import {
  ORCHESTRATION_ENTRIES,
  OrchestrationChannelError,
  assertEntryAllowed,
  assertNoLegacyWrite,
  channelForAnalysisType,
  decideEntry,
  isCutoverPassed,
  keyForPlanOps,
  keyForTemplate,
  ledgerTemplates,
  legacyKeys,
  ORCHESTRATION_OP_TO_KEY,
  resolveEntryKey,
  ORCHESTRATION_TEMPLATE_TO_KEY,
  resolveChannel,
  type ChannelEntry,
} from "./orchestration.channels";

const entry = (over: Partial<ChannelEntry> = {}): ChannelEntry => ({
  key: "rws.test",
  kind: "rws-analysis",
  label: "t",
  channel: "legacy",
  state: "pending",
  mdopTemplate: null,
  legacyTables: ["cp_rws_task", "cp_rws_assignment"],
  legacyRefs: [],
  equivalenceEvidence: null,
  verification: null,
  sunset: null,
  cutoverAt: null,
  ...over,
});

describe("orchestration channels（D-MDOP-7 解析单点）", () => {
  it("台账每一项的 resolveChannel 与台账一致（唯一事实源）", () => {
    for (const e of ORCHESTRATION_ENTRIES)
      expect(resolveChannel(e.key)).toBe(e.channel);
  });

  it("未知 key fail-closed，不回退默认通道", () => {
    expect(() => resolveChannel("rws.does-not-exist")).toThrow(
      OrchestrationChannelError,
    );
    try {
      resolveChannel("rws.does-not-exist");
      throw new Error("应当抛错");
    } catch (e) {
      expect((e as OrchestrationChannelError).code).toBe("E_CHANNEL_UNKNOWN");
    }
  });

  it("全部 RWS analysisType 都可在台账里解析（映射全覆盖）", () => {
    const types = [
      "adverse-event-signal",
      "cohort-count",
      "condition-prevalence",
      "disproportionality",
      "comparative-effect",
      "causal-psm",
      "causal-survival",
      "algorithm-validation",
    ];
    for (const t of types)
      expect(() => channelForAnalysisType(t)).not.toThrow();
    expect(channelForAnalysisType("disproportionality")).toBe("mdop");
    expect(channelForAnalysisType("comparative-effect")).toBe("legacy");
  });

  it("未到切换日：入口与授权通道不一致也不拦（合成条目）", () => {
    const r = decideEntry(
      entry({ channel: "mdop", state: "migrated", cutoverAt: null }),
      "mdop",
      "legacy",
    );
    expect(r.enforced).toBe(false);
    expect(r.channel).toBe("mdop");
  });

  it("真台账：L1.5 已到切换日 → 旧入口被拒（E_CHANNEL_MDOP），MDOP 入口放行", () => {
    expect(() =>
      assertEntryAllowed("rws.disproportionality", "legacy"),
    ).toThrow(/E_CHANNEL_MDOP/);
    expect(assertEntryAllowed("rws.disproportionality", "mdop").enforced).toBe(
      true,
    );
  });

  it("回滚演练（闸门⑤）：非生产开关让旧入口重新放行，台账本身不变", () => {
    const prev = process.env.ORCHESTRATION_FORCE_CHANNEL;
    try {
      process.env.ORCHESTRATION_FORCE_CHANNEL = "rws.disproportionality=legacy";
      // 开关在 → 旧入口可用：窗口内回滚确实可行
      expect(assertEntryAllowed("rws.disproportionality", "legacy")).toEqual({
        enforced: true,
        channel: "legacy",
      });
      // 去掉开关（= 不回滚）立刻恢复拒绝：回滚是显式动作，不是长期旁路
      delete process.env.ORCHESTRATION_FORCE_CHANNEL;
      expect(() =>
        assertEntryAllowed("rws.disproportionality", "legacy"),
      ).toThrow(/E_CHANNEL_MDOP/);
    } finally {
      if (prev === undefined) delete process.env.ORCHESTRATION_FORCE_CHANNEL;
      else process.env.ORCHESTRATION_FORCE_CHANNEL = prev;
    }
  });

  it("回滚开关在生产环境被忽略（MUST NOT 成为长期旁路）", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevForce = process.env.ORCHESTRATION_FORCE_CHANNEL;
    try {
      process.env.ORCHESTRATION_FORCE_CHANNEL = "rws.disproportionality=legacy";
      process.env.NODE_ENV = "production";
      expect(() =>
        assertEntryAllowed("rws.disproportionality", "legacy"),
      ).toThrow(/E_CHANNEL_MDOP/);
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
      if (prevForce === undefined)
        delete process.env.ORCHESTRATION_FORCE_CHANNEL;
      else process.env.ORCHESTRATION_FORCE_CHANNEL = prevForce;
    }
  });

  it("到点后旧入口被拒（E_CHANNEL_MDOP）；授权入口放行", () => {
    const past = entry({
      channel: "mdop",
      state: "migrated",
      cutoverAt: "2000-01-01",
    });
    expect(() => decideEntry(past, "mdop", "legacy")).toThrow(/E_CHANNEL_MDOP/);
    expect(decideEntry(past, "mdop", "mdop").enforced).toBe(true);
  });

  it("到点后反向：legacy 类型不得从 MDOP 入口提交（E_CHANNEL_LEGACY）", () => {
    const legacy = entry({ cutoverAt: "2000-01-01" });
    expect(() => decideEntry(legacy, "legacy", "mdop")).toThrow(
      /E_CHANNEL_LEGACY/,
    );
  });

  it("isCutoverPassed 只认已到的日期", () => {
    expect(isCutoverPassed({ cutoverAt: "2000-01-01" })).toBe(true);
    expect(isCutoverPassed({ cutoverAt: "2099-01-01" })).toBe(false);
    expect(isCutoverPassed({ cutoverAt: null })).toBe(false);
  });

  it("规矩 1（不双写）：走 MDOP 的类型不得写旧表", () => {
    expect(() =>
      assertNoLegacyWrite("rws.disproportionality", "cp_rws_task"),
    ).toThrow(/不双写/);
    expect(() =>
      assertNoLegacyWrite("rws.disproportionality", "cp_mdop_job"),
    ).not.toThrow();
    expect(() =>
      assertNoLegacyWrite("rws.comparative-effect", "cp_rws_task"),
    ).not.toThrow();
  });

  it("模板入口与台账 mdopTemplate 一一对应（不多不少）", () => {
    const mappedTemplates = Object.keys(ORCHESTRATION_TEMPLATE_TO_KEY).sort();
    const declaredTemplates = ledgerTemplates().sort();
    expect(mappedTemplates).toEqual(declaredTemplates);
  });

  it("未登记模板 fail-closed；L1.5 模板映射到可推导的 key", () => {
    expect(keyForTemplate("rws.l15.disproportionality")).toBe(
      "rws.disproportionality",
    );
    expect(keyForTemplate("rws.ve-tnd")).toBe("mdop.ve-tnd");
    expect(() => keyForTemplate("rws.not-a-template")).toThrow(
      /E_CHANNEL_UNKNOWN/,
    );
  });

  it("通用入口归属：显式 analysisKey 优先，其次由 merge 算子推导，否则 null", () => {
    expect(resolveEntryKey({ analysisKey: "rws.disproportionality" })).toBe(
      "rws.disproportionality",
    );
    expect(
      resolveEntryKey({
        ops: [
          "source.dataset@1.0.0",
          "declassify.small_cell@1.0.0",
          "merge.disproportionality@1.0.0",
        ],
      }),
    ).toBe("rws.disproportionality");
    // 版本后缀不影响归属
    expect(keyForPlanOps(["merge.disproportionality@9.9.9"])).toBe(
      "rws.disproportionality",
    );
    // 计划里没有可归属的算子 → null（调用方必须 fail-closed）
    expect(
      resolveEntryKey({
        ops: ["source.dataset@1.0.0", "declassify.small_cell@1.0.0"],
      }),
    ).toBeNull();
    expect(resolveEntryKey({})).toBeNull();
  });

  it("算子映射的值都在台账里（防漂移）", () => {
    const keys = Object.values(ORCHESTRATION_OP_TO_KEY);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(() => resolveChannel(key)).not.toThrow();
  });

  it("legacyKeys 与台账的 legacy 条目一致", () => {
    expect(legacyKeys().length).toBe(
      ORCHESTRATION_ENTRIES.filter((e) => e.channel === "legacy").length,
    );
    expect(legacyKeys()).toContain("fl.l4-prediction");
  });
});
