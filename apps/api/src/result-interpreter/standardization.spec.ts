import { directStandardizedRatePer100k, parseStandardWeights } from "./standardization";

describe("直接标准化率（dedup 5.3）", () => {
  it("按权重加权平均；只算有权重且率可算的层，并给出覆盖率", () => {
    // 层 A：1 例 / 365.25 人日 = 1 例/人年 = 100000/10 万人年；层 B：0 例 -> 0
    const r = directStandardizedRatePer100k(
      [
        { key: "A", events: 1, personDays: 365.25 },
        { key: "B", events: 0, personDays: 365.25 },
      ],
      { A: 1, B: 3 },
    )!;
    // (100000*1 + 0*3) / 4 = 25000
    expect(Math.round(r.ratePer100k)).toBe(25000);
    expect(r.includedKeys).toEqual(["A", "B"]);
    expect(r.coverage).toBe(1);
  });

  it("缺权重 / 人日为零 / 权重为零的层被排除，并如实给出原因与覆盖率", () => {
    const r = directStandardizedRatePer100k(
      [
        { key: "A", events: 1, personDays: 365.25 },
        { key: "B", events: 5, personDays: 0 },
        { key: "C", events: 9, personDays: 365.25 },
      ],
      { A: 1, B: 1, C: 0 },
    )!;
    expect(r.includedKeys).toEqual(["A"]);
    expect(r.excluded).toEqual([
      { key: "B", reason: "zero-person-days" },
      { key: "C", reason: "zero-weight" },
    ]);
    // 权重合计 2，用到的只有 A 的 1；没有权重的层（若存在）会另标 no-weight
    expect(r.coverage).toBe(0.5);
  });

  it("没有任何层可参与 -> 返回 null（不得静默返回 0）", () => {
    expect(
      directStandardizedRatePer100k([{ key: "A", events: 1, personDays: 365.25 }], {}),
    ).toBeNull();
  });

  it("配置解析：合法对象通过；非对象 / 负数 / 非数字一律拒绝", () => {
    expect(parseStandardWeights(undefined)).toBeNull();
    expect(parseStandardWeights('{"A":1}')).toEqual({ A: 1 });
    expect(() => parseStandardWeights("[]")).toThrow(/必须是/);
    expect(() => parseStandardWeights('{"A":-1}')).toThrow(/非负/);
    expect(() => parseStandardWeights('{"A":"x"}')).toThrow(/非负/);
    expect(() => parseStandardWeights("not json")).toThrow(/JSON/);
  });
});
