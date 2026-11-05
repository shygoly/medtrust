// 跨院可对齐假名：同 id 同 purpose 跨院等值、不同 purpose 不等值、轮换可复算（Phase 3）。
//
// 这些用例是决策文档（phase3-alignment-pseudonym.md §6）里的机检项 —— 每条都对应一个
// "如果错了会怎样"：配不上（静默漏人）、跨项目可链接（超范围关联）、轮换后假装同名（历史错乱）。
import {
  ALIGNMENT_KEY_MIN_LENGTH,
  ALIGNMENT_PSEUDONYM_PREFIX,
  AlignmentDeriver,
  AlignmentError,
  alignmentKeyId,
  alignmentKidOf,
  deriveAlignmentPseudonym,
  isAlignmentPseudonym,
  normalizeAlignmentIdentifier,
} from "./subject-alignment";

const KEY_A = "a".repeat(ALIGNMENT_KEY_MIN_LENGTH);
const KEY_B = "b".repeat(ALIGNMENT_KEY_MIN_LENGTH);
const ID = "310101199001011234";
const PURPOSE = "dedup-incidence:ckd-2026";

describe("deriveAlignmentPseudonym — 跨院对齐", () => {
  it("同一标识 + 同一用途 + 同一密钥 → 两个机构算出同一个值", () => {
    const h1 = deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: PURPOSE });
    const h2 = deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: PURPOSE });
    expect(h1).toBe(h2);
    expect(h1.startsWith(ALIGNMENT_PSEUDONYM_PREFIX)).toBe(true);
    expect(isAlignmentPseudonym(h1)).toBe(true);
  });

  it("不同主体 → 不同值（无碰撞的直观检查）", () => {
    const values = new Set(
      ["310101199001011234", "310101199001011235", "320202198512310001"].map((id) =>
        deriveAlignmentPseudonym(id, { key: KEY_A, purpose: PURPOSE }),
      ),
    );
    expect(values.size).toBe(3);
  });

  it("不同用途 → 不同值（跨项目链接被结构性切断）", () => {
    const a = deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: PURPOSE });
    const b = deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: "ve-scri:2026" });
    expect(a).not.toBe(b);
    expect(alignmentKidOf(a)).not.toBe(alignmentKidOf(b));
  });

  it("不同密钥 → 不同值（未持钥方无法对齐）", () => {
    expect(deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: PURPOSE })).not.toBe(
      deriveAlignmentPseudonym(ID, { key: KEY_B, purpose: PURPOSE }),
    );
  });

  it("值里带 kid，可直接用于审计与轮换对账", () => {
    const value = deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: PURPOSE });
    expect(alignmentKidOf(value)).toBe(alignmentKeyId({ key: KEY_A, purpose: PURPOSE }));
    expect(value).toMatch(/^lk_[0-9a-f]{16}_[0-9a-f]{32}$/);
  });

  it("值里不含原标识（逐字检查）", () => {
    const value = deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: PURPOSE });
    expect(value).not.toContain(ID);
    expect(value).not.toContain(ID.slice(0, 6));
  });
});

describe("normalizeAlignmentIdentifier — 规范化先于派生", () => {
  it.each([
    ["310101199001011234", "310101199001011234"],
    ["  310101199001011234  ", "310101199001011234"],
    ["310101 19900101 1234", "310101199001011234"],
    ["310101-19900101-1234", "310101199001011234"],
    ["31010119900101123x", "31010119900101123X"],
    ["31010119900101123X", "31010119900101123X"],
  ])("把 %p 归一为 %p", (raw, expected) => {
    expect(normalizeAlignmentIdentifier(raw)).toBe(expected);
  });

  it("抄写形态不同的同一标识派生出同一个值（跨院对不上的真实原因）", () => {
    const a = deriveAlignmentPseudonym("31010119900101123x", { key: KEY_A, purpose: PURPOSE });
    const b = deriveAlignmentPseudonym(" 310101 19900101 123X ", { key: KEY_A, purpose: PURPOSE });
    expect(a).toBe(b);
  });

  it("不是身份证形态的标识只做空白归一，不折叠大小写（部分系统编号大小写敏感）", () => {
    expect(normalizeAlignmentIdentifier(" AbC-123 ")).toBe("AbC123");
  });

  it("空标识 → 拒（不产生任何值）", () => {
    expect(() => normalizeAlignmentIdentifier("   ")).toThrow(AlignmentError);
    expect(() => deriveAlignmentPseudonym("  ", { key: KEY_A, purpose: PURPOSE })).toThrow(
      /ALIGNMENT_IDENTIFIER/,
    );
  });
});

describe("fail-closed 边界", () => {
  it("没有密钥 → 拒", () => {
    expect(() => deriveAlignmentPseudonym(ID, { key: "", purpose: PURPOSE })).toThrow(
      /ALIGNMENT_KEY_MISSING/,
    );
  });

  it("密钥太短 → 拒（弱密钥下标识空间可枚举）", () => {
    expect(() =>
      deriveAlignmentPseudonym(ID, { key: "short-key", purpose: PURPOSE }),
    ).toThrow(/ALIGNMENT_KEY_TOO_SHORT/);
    expect(ALIGNMENT_KEY_MIN_LENGTH).toBe(32);
  });

  it("没有用途域 → 拒（否则跨项目可链接）", () => {
    expect(() => deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: "  " })).toThrow(
      /ALIGNMENT_PURPOSE_MISSING/,
    );
    expect(() => deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: "a b" })).toThrow(
      /ALIGNMENT_PURPOSE_MISSING/,
    );
  });
});

describe("AlignmentDeriver — 轮换", () => {
  it("轮换后：新值用新 kid，历史值可用退役密钥复算（不假装同名）", () => {
    const oldKid = alignmentKeyId({ key: KEY_A, purpose: PURPOSE });
    const oldValue = deriveAlignmentPseudonym(ID, { key: KEY_A, purpose: PURPOSE });

    const deriver = new AlignmentDeriver({ key: KEY_B, purpose: PURPOSE }).retire(oldKid, KEY_A);
    const current = deriver.current(ID);
    expect(alignmentKidOf(current)).toBe(deriver.kid());
    expect(current).not.toBe(oldValue);
    // 历史值可复算 —— 与库里的旧值逐字节一致
    expect(deriver.historical(ID, oldKid)).toBe(oldValue);
  });

  it("没有那把退役密钥 → 拒绝用现行密钥冒充历史值", () => {
    const deriver = new AlignmentDeriver({ key: KEY_B, purpose: PURPOSE });
    expect(() => deriver.historical(ID, "0123456789abcdef")).toThrow(/ALIGNMENT_KEY_MISSING/);
  });

  it("构造时就做 fail-closed 校验", () => {
    expect(() => new AlignmentDeriver({ key: "short", purpose: PURPOSE })).toThrow(
      /ALIGNMENT_KEY_TOO_SHORT/,
    );
    expect(() => new AlignmentDeriver({ key: KEY_A, purpose: "" })).toThrow(
      /ALIGNMENT_PURPOSE_MISSING/,
    );
  });
});

describe("isAlignmentPseudonym / alignmentKidOf", () => {
  it("只认本形态，其它一律不算", () => {
    expect(isAlignmentPseudonym("sk_abc")).toBe(false);
    expect(isAlignmentPseudonym("lk_short_abc")).toBe(false);
    expect(isAlignmentPseudonym(undefined)).toBe(false);
    expect(alignmentKidOf("sk_abc")).toBeNull();
  });
});
