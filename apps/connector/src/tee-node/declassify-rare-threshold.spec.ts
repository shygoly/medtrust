import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { NodePublicationReview } from '../mdop/node/publication-review';
import { NODE_DECLASSIFY_OP, registerNodeDeclassifyOperator } from './declassify-op';

/**
 * 降密算子的**罕见病双阈值**（跨院去重场景）：
 *
 *  - 常规列按 `minCell` 判（由发布审查做）；
 *  - **罕见病列另按 `minCellRare` 判**：`0 < rareCases < minCellRare` 的层把 `rareCases` 置零并标
 *    `rareSuppressed`，**不牵连**该层其它列（罕见病小细胞 ≠ 整层不可发布）；
 *  - `minCellRare` 不得小于 `minCell`（罕见病小细胞重识别风险更高，放宽即拒）；
 *  - 合约条款与阶段参数取**较大值**（参数不得弱于合约）。
 *
 * 罕见病列的判定与分层对齐都在**发布审查**（`NodePublicationReview.review`）里——降密算子只负责
 * 取阈值。这样单阶段会话出口（不经降密算子、直接走 `review`）拿到的也是同一份判定，
 * 所以这里用**真实的**审查与闸门，并单独覆盖「直接调用 review」那条路。
 */

const PAYLOAD = {
  analysisType: 'dedup-incidence',
  mergeAdjacent: true,
  strata: [
    { key: '65+|F', uniqueSubjects: 1042, personDaysUnion: 500_000, eventsDeduped: 458, rareCases: 4 },
    { key: '65+|M', uniqueSubjects: 1011, personDaysUnion: 490_000, eventsDeduped: 393, rareCases: 12 },
  ],
  buckets: [
    { key: '65+|F', count: 458 },
    { key: '65+|M', count: 393 },
  ],
  rareBuckets: [
    { key: '65+|F', count: 4 },
    { key: '65+|M', count: 12 },
  ],
};

function realReview(): NodePublicationReview {
  return new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));
}

const MANIFEST = {
  apiVersion: 'mdop/v1',
  kind: 'system',
  id: 'declassify.small_cell',
  version: '1.0.0',
  category: 'declassify',
  digest: 'component:node-publication-review@1',
  publisher: 'urn:tds:platform',
  inputs: [{ name: 'in', schema: 'rws.dedup-incidence/1.0', accept_labels: ['C2'] }],
  outputs: [{ name: 'out', schema: 'rws.dedup-incidence/1.0', label_rule: 'C3' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  component: 'node-publication-review@1.0.0',
};

async function run(
  params: Record<string, unknown>,
  terms?: Record<string, unknown>,
  candidate: Record<string, unknown> = PAYLOAD,
) {
  const executor = new MdopStageExecutor();
  registerNodeDeclassifyOperator(executor, {
    review: realReview(),
    ...(terms ? { contractTerms: () => terms } : {}),
  });
  return executor.execute(
    {
      jobId: 'job-dedup',
      stage: {
        id: 'decTee',
        node: 'urn:tds:sh-med:participant:tee-node-a',
        op: NODE_DECLASSIFY_OP,
        op_digest: 'component:node-publication-review@1',
        params: { contractId: 'c-1', ...params },
        inputs: [{ from: 'dedup' }],
        input_labels: ['C2'],
        output_label: 'C3',
        output_schema: 'rws.dedup-incidence/1.0',
      } as never,
      inputs: new Map([['dedup', structuredClone(candidate)]]),
      attempt: 1,
    },
    MANIFEST as never,
  );
}

describe('降密算子：罕见病双阈值', () => {
  it('0 < rareCases < minCellRare 的层：只抑制罕见病列，其余列照常发布', async () => {
    const out = await run({ minCell: 5, minCellRare: 10 });
    expect(out.label).toBe('C3');
    const payload = out.payload as {
      strata: Array<Record<string, unknown>>;
      rareBuckets: Array<Record<string, unknown>>;
    };
    expect(payload.strata[0]).toEqual({
      key: '65+|F',
      uniqueSubjects: 1042,
      personDaysUnion: 500_000,
      eventsDeduped: 458,
      rareCases: 0, // 4 < 10 → 置零
      rareSuppressed: true,
    });
    expect(payload.strata[1]).toEqual({
      key: '65+|M',
      uniqueSubjects: 1011,
      personDaysUnion: 490_000,
      eventsDeduped: 393,
      rareCases: 12, // 12 ≥ 10 → 照常
    });
    expect(payload.rareBuckets[0]).toEqual({ key: '65+|F', count: 0, suppressed: true });
    expect(payload.rareBuckets[1]).toEqual({ key: '65+|M', count: 12 });
  });

  it('未给 minCellRare 时缺省 10', async () => {
    const out = await run({ minCell: 5 });
    const payload = out.payload as { strata: Array<Record<string, unknown>> };
    expect(payload.strata[0]!.rareCases).toBe(0);
    expect(payload.strata[1]!.rareCases).toBe(12);
  });

  it('合约阈值更严时取合约（参数不得弱于合约）：minCellRare=20 → 12 例那层也被抑制', async () => {
    const out = await run({ minCell: 5, minCellRare: 10 }, { publication: { minCell: 5, minCellRare: 20 } });
    const payload = out.payload as { strata: Array<Record<string, unknown>> };
    expect(payload.strata[0]!.rareCases).toBe(0);
    expect(payload.strata[1]!.rareCases).toBe(0);
    expect(payload.strata[1]!.rareSuppressed).toBe(true);
  });

  it('罕见病阈值小于常规阈值 → 直接拒（放宽即拒，fail-closed）', async () => {
    await expect(run({ minCell: 5, minCellRare: 3 })).rejects.toThrow(/罕见病阈值/);
  });

  it('常规阈值高于 10 且没给 minCellRare：缺省跟着抬到常规阈值，而不是拒发', async () => {
    // 合约允许把 minCell 定到 20；缺省的 10 不能反过来让发布因为「10 < 20」整个失败
    const out = await run({ minCell: 20 });
    const payload = out.payload as { strata: Array<Record<string, unknown>> };
    expect(payload.strata[0]!.rareCases).toBe(0); // 4 < 20
    expect(payload.strata[1]!.rareCases).toBe(0); // 12 < 20：按抬高后的阈值抑制
    expect(payload.strata[1]!.rareSuppressed).toBe(true);
    expect(payload.strata[1]!.eventsDeduped).toBe(393); // 常规列不受牵连
  });

  it('不带罕见病列的载荷（其它分析类型）：常规阈值高于 10 也照常审查', async () => {
    const other = {
      analysisType: 'vaccine-scri',
      strata: [
        { key: '<40|F', nRisk: 1795, casesRisk: 30, casesControl: 35 },
        { key: '<40|M', nRisk: 1737, casesRisk: 43, casesControl: 12 },
      ],
      buckets: [
        { key: '<40|F', count: 30 },
        { key: '<40|M', count: 12 },
      ],
    };
    const out = await run({ minCell: 20 }, undefined, other);
    const payload = out.payload as { strata: Array<Record<string, unknown>> };
    expect(payload.strata[0]).toEqual(other.strata[0]);
    // 12 < 20：该层被常规闸门抑制，分层表同步清零
    expect(payload.strata[1]).toEqual({ key: '<40|M', nRisk: 0, casesRisk: 0, casesControl: 0, suppressed: true });
  });
});

describe('发布审查本身（单阶段会话出口不经降密算子，直接走这里）', () => {
  it('被常规闸门抑制的分层在分层表里同步清零；罕见病列按缺省阈值单独抑制', () => {
    const candidate = {
      ...structuredClone(PAYLOAD),
      strata: [
        ...structuredClone(PAYLOAD.strata),
        { key: '18-39|F', uniqueSubjects: 3, personDaysUnion: 900, eventsDeduped: 3, rareCases: 0 },
      ],
      buckets: [...structuredClone(PAYLOAD.buckets), { key: '18-39|F', count: 3 }],
      rareBuckets: [...structuredClone(PAYLOAD.rareBuckets), { key: '18-39|F', count: 0 }],
    };
    const { payload } = realReview().review({ candidate, minCell: 5, contractId: 'c-1' });
    const strata = (payload as { strata: Array<Record<string, unknown>> }).strata;
    expect(strata[0]!.rareCases).toBe(0); // 4 < 10：只抑制罕见病列
    expect(strata[0]!.rareSuppressed).toBe(true);
    expect(strata[0]!.uniqueSubjects).toBe(1042);
    expect(strata[1]!.rareCases).toBe(12);
    // 3 < 5：整层清零，不留未抑制的分层计数
    expect(strata[2]).toEqual({
      key: '18-39|F',
      uniqueSubjects: 0,
      personDaysUnion: 0,
      eventsDeduped: 0,
      rareCases: 0,
      suppressed: true,
    });
  });

  it('显式给出的罕见病阈值小于常规阈值 → 拒', () => {
    expect(() =>
      realReview().review({ candidate: structuredClone(PAYLOAD), minCell: 10, minCellRare: 5, contractId: 'c-1' }),
    ).toThrow(/罕见病阈值/);
  });
});
