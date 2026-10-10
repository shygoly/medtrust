import {
  MAX_STRATUM_KEYS,
  isNonEmptyStringList,
  isStratumAgeBand,
  isStratumKey,
  isStratumSex,
  stratumKeyListProblem,
} from "./stratum-key";

describe("出域分层键的闭合语法（三处共用的同一份判据）", () => {
  it("年龄段：区间 / 下界+ / <上界 / all / unknown（出生日期缺失）；其余一律不收", () => {
    for (const ok of ["18-39", "40-64", "65+", "80+", "<40", "0-9", "100-109", "all", "unknown"])
      expect(isStratumAgeBand(ok)).toBe(true);
    for (const bad of [
      "",
      "Unknown",
      "未知",
      "40 +",
      "40-",
      "-40",
      ">40",
      "1000+",
      "40-64 ",
      "40–64", // 长横线不是连字符
      "ALL",
      "65+|F",
      "张三",
      40,
      null,
      undefined,
    ])
      expect(isStratumAgeBand(bad)).toBe(false);
  });

  it("性别：F / M / U / all 与 FHIR 性别编码全集；大小写与其它写法不收", () => {
    for (const ok of ["F", "M", "U", "male", "female", "other", "unknown", "all"])
      expect(isStratumSex(ok)).toBe(true);
    for (const bad of ["", "f", "Male", "FEMALE", "Other", "others", "女", "F ", 1, null, undefined])
      expect(isStratumSex(bad)).toBe(false);
  });

  it("分层键恰好是 <年龄段>|<性别>：少一段、多一段、任一段不合规都不收", () => {
    for (const ok of ["18-39|F", "65+|M", "<40|U", "all|all", "70-79|male", "unknown|other"])
      expect(isStratumKey(ok)).toBe(true);
    for (const bad of [
      "18-39",
      "18-39|",
      "|F",
      "18-39|F|x",
      "18-39|others",
      "备注：门诊随访|F",
      "18-39|F\n",
      ["18-39|F"],
      undefined,
    ])
      expect(isStratumKey(bad)).toBe(false);
  });

  it("分层键列表：非数组 / 超过上限 / 含不合规键 / 有重复 各自给出原因类别（不带取值）", () => {
    expect(stratumKeyListProblem(["18-39|F", "65+|M"])).toBeUndefined();
    expect(stratumKeyListProblem([])).toBeUndefined();
    expect(stratumKeyListProblem("18-39|F")).toBe("not-array");
    expect(stratumKeyListProblem(undefined)).toBe("not-array");
    expect(stratumKeyListProblem(["18-39|F", "自由文本"])).toBe("bad-key");
    expect(stratumKeyListProblem(["18-39|F", 7])).toBe("bad-key");
    expect(stratumKeyListProblem(["18-39|F", "18-39|F"])).toBe("duplicate");
    const many = Array.from({ length: MAX_STRATUM_KEYS + 1 }, (_, i) => `${i}-${i + 1}|F`);
    expect(stratumKeyListProblem(many)).toBe("too-many");
    expect(stratumKeyListProblem(many.slice(0, MAX_STRATUM_KEYS))).toBeUndefined();
  });

  it("非空字符串列表：空数组、非数组、夹着非字符串或空串都不算有效白名单", () => {
    expect(isNonEmptyStringList(["207", "208"])).toBe(true);
    for (const bad of [[], undefined, null, "207", { 0: "207" }, ["207", 208], ["207", ""], ["  "], [null]])
      expect(isNonEmptyStringList(bad)).toBe(false);
  });
});
