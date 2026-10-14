/**
 * Kaplan-Meier 曲线的画图前处理（rws-analytics-ladder 7.3 的第三块）。
 *
 * 为什么单独成纯函数：连接器出域时按规矩**分箱 + 在险人数低于阈值即抑制/合并**
 * （`apps/connector/src/domain/output-gate.ts` 的高阶统计量闸门），所以平台拿到的分箱可能带洞。
 * 洞里不能连线 —— 那不是「生存率掉到 0」，而是「这一段被抑制了」。这个区分是纯计算，
 * 因此在 `src/lib` 里实现并单测，组件只负责画。
 */

export interface KmBinLike {
  t: number;
  survival: number;
  atRisk: number;
  /** 该区间因在险人数过低被抑制/合并（不连线，且要如实标注）。 */
  suppressed?: boolean;
}

export interface KmPoint {
  t: number;
  survival: number;
  atRisk: number;
}

/**
 * 把分箱切成**连续可画段**：被抑制的区间断开，形成多段折线（不跨洞连线）。
 * 入参按 `t` 升序即可（不要求调用方排序，函数内部稳定排序）。
 */
export function kmSegments(bins: readonly KmBinLike[]): KmPoint[][] {
  const sorted = [...bins].sort((a, b) => a.t - b.t);
  const segments: KmPoint[][] = [];
  let current: KmPoint[] = [];
  for (const b of sorted) {
    if (b.suppressed) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({ t: b.t, survival: b.survival, atRisk: b.atRisk });
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** 在险人数表（逐区间；被抑制的区间照实标出，进表格但不画线）。 */
export function kmRiskTable(bins: readonly KmBinLike[]): KmBinLike[] {
  return [...bins].sort((a, b) => a.t - b.t);
}

/** 曲线的时间上界（天数）；空输入返回 0。 */
export function kmTimeMax(bins: readonly KmBinLike[]): number {
  return bins.reduce((m, b) => (b.t > m ? b.t : m), 0);
}
