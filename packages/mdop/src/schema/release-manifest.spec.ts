import {
  mergeReleaseManifests,
  parseReleaseManifest,
  releaseManifestOf,
  withReleaseManifest,
  type PartyReleaseManifest,
  type ReleaseManifest,
} from "./release-manifest";

const AT = "2026-09-25T10:00:00.000Z";

function party(over: Partial<PartyReleaseManifest> = {}): PartyReleaseManifest {
  return {
    node: "urn:tds:sh-med:participant:tee-1",
    minCell: 10,
    suppressed: 2,
    dp: { mode: "none" },
    budget: {
      dataset: "dp-1",
      snapshot: `sm3:${"a".repeat(64)}`,
      unit: "queries",
      spent: 3,
      limit: 20,
    },
    at: AT,
    ...over,
  };
}

/** 载荷里随行的那一份（单方＝退化情形）。 */
function manifest(over: Partial<PartyReleaseManifest> = {}): ReleaseManifest {
  return mergeReleaseManifests([party(over)], { now: new Date(AT) });
}

describe("发布审查清单（任务 7.3b）", () => {
  it("严格解析：未知字段 / 缺字段 / 非法 DP / 非法单位 / 负数 → 逐条拒", () => {
    expect(() => parseReleaseManifest({ ...manifest(), extra: 1 })).toThrow(/未定义字段/);
    const { minCell: _drop, ...missing } = manifest();
    expect(() => parseReleaseManifest(missing)).toThrow(/缺少必填字段/);
    expect(() => parseReleaseManifest({ ...manifest(), apiVersion: "mdop.release/9.9" })).toThrow(
      /只接受 mdop.release\/1.0/,
    );
    expect(() => parseReleaseManifest({ ...manifest(), dp: { mode: "laplace" } })).toThrow(/未知 DP 模式/);
    expect(() =>
      parseReleaseManifest(
        mergeReleaseManifests([party({ budget: { ...party().budget!, unit: "rows" as never } })]),
      ),
    ).toThrow(/未知计量单位/);
    expect(() => parseReleaseManifest({ ...manifest(), suppressedTotal: -1 })).toThrow(/不能为负/);
    // 单方条目的必填项缺失也要拒（node/at 等）
    expect(() => parseReleaseManifest({ ...manifest(), parties: [{ minCell: 1 }] })).toThrow(
      /缺少必填字段/,
    );
  });

  it("挂进载荷：保留键、不接受覆盖写；读回来等价", () => {
    // 载荷字段刻意用**领域中立**的名字：本包是协议核，出现领域词会被领域中立检查拒掉
    const payload = { analysisType: "disproportionality", rows: 100 } as Record<string, unknown>;
    const wrapped = withReleaseManifest(payload, manifest());
    expect(releaseManifestOf(wrapped)?.suppressedTotal).toBe(2);
    expect(releaseManifestOf(wrapped)?.parties[0].node).toContain("tee-1");
    // 载荷原有字段原样保留（合并侧照常读到）
    expect(wrapped.analysisType).toBe("disproportionality");
    expect(() => withReleaseManifest(wrapped, manifest())).toThrow(/已经有一份/);
    // 没有清单就是 undefined；有但非法即抛（不静默忽略）
    expect(releaseManifestOf({})).toBeUndefined();
    expect(() => releaseManifestOf({ release_manifest: { apiVersion: "x" } })).toThrow();
  });

  it("合并：抑制数求和、minCell 取最严、DP 取最强、预算保留逐方列表", () => {
    const a = party({ suppressed: 3, minCell: 5, dp: { mode: "none" } });
    const b = party({
      node: "urn:tds:sh-med:participant:tee-2",
      suppressed: 4,
      minCell: 10,
      dp: { mode: "epsilon", epsilon: 1.5 },
      budget: {
        dataset: "dp-2",
        snapshot: `sm3:${"b".repeat(64)}`,
        unit: "queries",
        spent: 7,
        limit: 20,
      },
    });
    const merged = mergeReleaseManifests([a, b], { now: new Date(AT) });
    expect(merged.suppressedTotal).toBe(7);
    expect(merged.minCell).toBe(10);
    expect(merged.dp).toEqual({ mode: "epsilon", epsilon: 1.5 });
    expect(merged.parties.map((p) => p.budget?.spent)).toEqual([3, 7]);
    expect(merged.at).toBe(AT);
  });

  it("合并空列表 → 拒（不产出空清单冒充「审查过」）", () => {
    expect(() => mergeReleaseManifests([])).toThrow(/没有可合并的清单/);
  });
});
