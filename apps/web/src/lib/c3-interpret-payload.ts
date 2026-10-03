/**
 * 从作业的合并结果（C3 交付物）里挑出「结果解读」接口接受的聚合字段。
 *
 * 接口对入参做严格白名单（未知字段即 400），所以这里**只挑不透传**：
 * 发布审查清单、warnings、分层明细等一律不带。不支持的分析类型返回 null
 * （界面据此不显示解读入口）。
 */

const BUCKET_NUMBERS = ['prr', 'ror'] as const;
const BUCKET_INTERVALS = ['prrCi95', 'rorCi95'] as const;
const BUCKET_FLAGS = ['signal', 'suppressed'] as const;

export type C3InterpretPayload = Record<string, unknown>;

export function c3InterpretPayload(result: unknown): C3InterpretPayload | null {
  if (typeof result !== 'object' || result === null) return null;
  const r = result as Record<string, unknown>;

  if (r.analysisType === 'paired-cohort') {
    const { cohortSize, exposed, outcome, exposedWithOutcome } = r;
    if ([cohortSize, exposed, outcome, exposedWithOutcome].some((n) => typeof n !== 'number'))
      return null;
    return { analysisType: 'paired-cohort', cohortSize, exposed, outcome, exposedWithOutcome };
  }

  if (r.analysisType === 'disproportionality') {
    if (typeof r.cohortSize !== 'number' || !Array.isArray(r.buckets)) return null;
    const buckets = (r.buckets as Array<Record<string, unknown>>).map((b) => {
      const picked: Record<string, unknown> = { key: b.key, count: b.count };
      for (const k of BUCKET_NUMBERS) if (typeof b[k] === 'number') picked[k] = b[k];
      for (const k of BUCKET_INTERVALS) if (Array.isArray(b[k])) picked[k] = b[k];
      for (const k of BUCKET_FLAGS) if (typeof b[k] === 'boolean') picked[k] = b[k];
      return picked;
    });
    return { analysisType: 'disproportionality', cohortSize: r.cohortSize, buckets };
  }

  if (r.analysisType === 'vaccine-scri') {
    const w = r.windows as { risk?: unknown; control?: unknown } | undefined;
    if (!w || !Array.isArray(w.risk) || !Array.isArray(w.control) || !Array.isArray(r.strata)) return null;
    const strata = (r.strata as Array<Record<string, unknown>>).map((s) => ({
      key: s.key,
      doses: s.doses,
      riskEvents: s.riskEvents,
      controlEvents: s.controlEvents,
      ...(typeof s.suppressed === 'boolean' ? { suppressed: s.suppressed } : {}),
    }));
    return { analysisType: 'vaccine-scri', windows: { risk: w.risk, control: w.control }, strata };
  }

  return null;
}
