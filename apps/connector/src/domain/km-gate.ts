import type { KmCurvePayload } from './types';

export const DEFAULT_MIN_AT_RISK = 5;

/** KM 尾部在险数抑制 (任务 5.5). */
export function gateKmCurve(
  curve: KmCurvePayload,
  minAtRisk = DEFAULT_MIN_AT_RISK,
): KmCurvePayload {
  const bins = curve.bins.map((bin) => {
    if (bin.atRisk > 0 && bin.atRisk < minAtRisk) {
      return { ...bin, atRisk: 0, survival: 0, suppressed: true };
    }
    return bin;
  });
  return { ...curve, bins };
}

export function countKmTailSuppressed(curve: KmCurvePayload, minAtRisk = DEFAULT_MIN_AT_RISK): number {
  return curve.bins.filter((b) => b.atRisk > 0 && b.atRisk < minAtRisk).length;
}
