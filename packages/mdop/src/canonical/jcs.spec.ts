import { canonicalize, CanonicalizationError } from "./jcs";
import { sm3Hex, canonicalSm3 } from "../crypto/sm3";

/**
 * RFC 8785 金标向量（附录中的 ES6 数字与字符串样例）+ 数值/Unicode 边界。
 * 任务 3.2「用 RFC 8785 附录样例，加上数值与 Unicode 边界用例作金标向量」。
 */

describe("JCS 规范化（RFC 8785）", () => {
  it("附录样例：字段顺序不影响结果，数字按 ES6 最短表示", () => {
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
      string: "€$\u000f\nA'B\"\\\\\"/",
      literals: [null, true, false],
    };
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("RFC 8785 的 ES6 数字金标", () => {
    const cases: Array<[number, string]> = [
      [0, "0"],
      [-0, "0"],
      [1, "1"],
      [Number.MAX_SAFE_INTEGER, "9007199254740991"],
      [1e21, "1e+21"],
      [1e-7, "1e-7"],
      [0.000001, "0.000001"],
      [1000000000000000128, "1000000000000000100"],
    ];
    for (const [value, expected] of cases) expect(canonicalize(value)).toBe(expected);
  });

  it("字段顺序不同 → 规范化结果相同", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("任一字段变化 → 哈希变化", () => {
    const a = canonicalSm3({ a: 1, b: "x" });
    expect(canonicalSm3({ a: 1, b: "y" })).not.toBe(a);
    expect(canonicalSm3({ a: 2, b: "x" })).not.toBe(a);
  });

  it("控制字符用最小转义、\\u 为小写十六进制", () => {
    expect(canonicalize("\u0000\u001f")).toBe('"\\u0000\\u001f"');
    expect(canonicalize("\b\t\n\f\r")).toBe('"\\b\\t\\n\\f\\r"');
  });

  it("Unicode：代理对按原字符输出，未配对代理项即拒", () => {
    expect(canonicalize("\u{1F600}")).toBe('"\u{1F600}"');
    expect(() => canonicalize("\ud800")).toThrow(CanonicalizationError);
    expect(() => canonicalize("\udc00")).toThrow(CanonicalizationError);
  });

  it("不可表示的值一律拒绝，不静默修正", () => {
    expect(() => canonicalize(NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Infinity)).toThrow(CanonicalizationError);
    expect(() => canonicalize(undefined)).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize(1n)).toThrow(CanonicalizationError);
  });

  it("SM3 是国密口径（不是 sha256）", () => {
    expect(sm3Hex("abc")).toBe(
      "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0",
    );
    expect(canonicalSm3({ a: 1 })).toMatch(/^sm3:[0-9a-f]{64}$/);
  });
});
