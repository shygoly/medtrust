import { mergeProportionality } from "../../mdop/operators/merge-disproportionality";
import { mergeDisproportionalityAggregates } from "../rws-orchestrator/disproportionality";
import type {
  RwsAnalysisSpec,
  RwsPartyAggregate,
} from "../rws-orchestrator/types";

/**
 * L1.5 等价性对拍（openspec mdop-orchestration-migration，tasks 3.1）。
 *
 * 两条通道的合并口径**是同一份代码**：MDOP 的合并算子
 * `mdop/operators/merge-disproportionality.ts` 第 1 行就 import 了旧通道的
 * `mergeDisproportionalityAggregates`。因此等价性的风险不在公式，而在**接线**：
 * 喂进同一个函数的输入是否一致、MDOP 算子有没有额外后处理改写数字。
 * 本测试用固定 fixture 把这条接线 + 一组黄金数字钉住：将来谁改 MDOP 算子而动了数字，这里先红。
 *
 * 节点侧那一层（各院产出的 2×2）由既有测试覆盖，不在此重复：
 *  - apps/connector/src/domain/sandbox/admission-gates.spec.ts:101「与独立参考实现（内置 TS）逐字段一致」
 *  - apps/connector/src/domain/sandbox/admission-e2e.spec.ts:142（准入 e2e 里的同一对拍）
 * 两条都跑在 pnpm test 里；MDOP 的院内算子（connector mdop/operators/l15.ts）走的正是同一个
 * 已登记 wasm 模块（runProportionality 不接入即 fail-closed，不回退内置实现）。
 */

const ANALYSIS: RwsAnalysisSpec = {
  type: "disproportionality",
  level: "L1.5",
  drug: "阿莫西林",
  outcome: "ALT升高",
  outcomeKind: "adverse_event",
};

const party = (
  cohortSize: number,
  t: { a: number; b: number; c: number; d: number },
): RwsPartyAggregate => ({
  analysisType: "disproportionality",
  cohortSize,
  buckets: [
    {
      key: "ALT升高",
      count: t.a,
      // 本院自己的粗率（合并时会被池化重算，这里如实给本院值，不写死）
      rate: Number((t.a / (t.a + t.b + t.c + t.d)).toFixed(4)),
      b: t.b,
      c: t.c,
      d: t.d,
    },
  ],
});

/** 固定 fixture：三院、同一个 (drug × event)，逐格数字故意全是整数，便于人工复核。 */
const FIXTURE: RwsPartyAggregate[] = [
  party(465, { a: 20, b: 40, c: 5, d: 400 }),
  party(535, { a: 10, b: 30, c: 5, d: 490 }),
  party(610, { a: 8, b: 22, c: 4, d: 576 }),
];

const viaMdop = () =>
  mergeProportionality({
    analysis: ANALYSIS,
    tables: FIXTURE.map((aggregate, i) => ({
      node: "hospital-" + (i + 1),
      aggregate,
    })),
  });

describe("L1.5 等价性：旧通道 vs MDOP 通道（tasks 3.1）", () => {
  it("同一份固定数据，两条通路的合并结果逐字段一致", () => {
    const legacy = mergeDisproportionalityAggregates(ANALYSIS, FIXTURE);
    const mdop = viaMdop();
    expect(mdop).toEqual(legacy);
  });

  it("黄金数字：池化 2×2 与 PRR/ROR/IC/信号", () => {
    const merged = viaMdop();
    expect(merged.analysisType).toBe("disproportionality");
    expect(merged.cohortSize).toBe(1610);
    expect(merged.buckets).toHaveLength(1);
    const b = merged.buckets[0];
    expect(b.key).toBe("ALT升高");
    // 逐格相加（固定 fixture 的整数和，可人工复核）
    expect({ a: b.count, b: b.b, c: b.c, d: b.d }).toEqual({
      a: 38,
      b: 92,
      c: 14,
      d: 1466,
    });
    // 实测值打印出来，供证据档引用（不心算）
    console.log(
      "[l15-equivalence] " +
        JSON.stringify({
          pooled: { a: b.count, b: b.b, c: b.c, d: b.d },
          cohortSize: merged.cohortSize,
          rate: b.rate,
          prr: b.prr,
          prrCi95: b.prrCi95,
          ror: b.ror,
          rorCi95: b.rorCi95,
          chiSqYates: b.chiSqYates,
          ic: b.ic,
          signal: b.signal,
        }),
    );
  });

  it("MDOP 算子拒绝非失衡检测的四格表（不静默合并）", () => {
    expect(() =>
      mergeProportionality({
        analysis: ANALYSIS,
        tables: [
          {
            node: "hospital-1",
            aggregate: { ...FIXTURE[0], analysisType: "comparative-effect" },
          },
        ],
      }),
    ).toThrow(/只接受失衡检测四格表/);
  });
});
